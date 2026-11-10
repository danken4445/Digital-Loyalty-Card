# Offline Member QR & Staff Stamp Scanner Design Spec

**Date:** 2026-11-10
**Status:** Approved for Planning

## 1. Problem & Goal

When a returning customer arrives at a shop without mobile data (or when their phone's NFC antenna fails), they cannot complete the standard NFC tap (`GET /t/[tagId]`) to earn a stamp. Meanwhile, staff on `/staff/stamp` (`ManualStampForm`) currently have to type or paste a 36-character customer UUID by hand, even though `QrCameraScanner` is already built and used on `/staff/redeem`.

**Goal:**
1. Give every customer card a signed, shop-bound **Member Stamp QR Code** (`tcpm1.<payloadB64Url>.<signatureB64Url>`) that works both online (via a toggleable "Show Member QR" drawer on the card) and offline (automatically expanded when `navigator.onLine === false`, or rendered via a Service Worker offline fallback page `/offline` backed by `localStorage`).
2. Upgrade `/staff/stamp` (`ManualStampForm`) with the existing `QrCameraScanner` (plus one-tap quick-reason chips and raw UUID fallback) so baristas can scan a customer's Member Stamp QR in 1 second to issue a stamp.

## 2. Security & Architecture

### 2.1 Signed Member Stamp Token (`tcpm1`)
- **Prefix:** `tcpm1` (distinct from reward redemption prefixes `tcp2` and `tcpig2`, so a Member Stamp QR can never be used to redeem a free reward, and a reward QR scanned on `/staff/stamp` is rejected with a clear message).
- **Payload (`MemberStampTokenPayload`):**
  ```ts
  export interface MemberStampTokenPayload {
    customerId: string; // UUID
    tenantId: string;   // UUID of the shop
    iat: number;        // Unix epoch seconds
  }
  ```
- **Signature:** HMAC-SHA256 over `tcpm1.${payloadB64Url}` using `REDEEM_TOKEN_SECRET`, verified in constant time (`timingSafeEqual`).
- **Offline Longevity:** Unlike 5-minute redemption tokens, a Member Stamp Token does not expire after 5 minutes because it is cached on the customer's device for offline fallback. Security is enforced because:
  1. Only authenticated staff (`requireStaffSession()`) can call `POST /api/staff/stamp`.
  2. The token is cryptographically bound to `(customerId, tenantId)` — staff of Shop B cannot stamp a token minted for Shop A (`wrong-tenant`).
  3. `stamp_card_manual` enforces the shop's `cooldown_minutes`, `daily_cap`, active card check, and writes an immutable `audit_log` row with the staff actor and reason.
- **PII / Log Redaction:** `lib/security/logger.ts` `TOKEN_VALUE_PATTERN` must redact `tcpm1.<payload>.<sig>` alongside existing token prefixes.

### 2.2 Staff Stamp Endpoint (`POST /api/staff/stamp`) & Scanner UI
- `POST /api/staff/stamp` accepts `{ customerId?: string; memberToken?: string; reason: string }`:
  - If `memberToken` is provided, verify it via `verifyMemberStampToken(memberToken)`.
  - If invalid, return `400 invalid_input` (`"Invalid or unrecognized member QR code."`).
  - If `payload.tenantId !== staff.tenantId`, return `403 forbidden` (`"This member QR belongs to another shop."`).
  - Otherwise extract `customerId = payload.customerId` and proceed to `admin.rpc('stamp_card_manual', ...)`.
  - If `customerId` (UUID) is provided directly (manual fallback), validate UUID and proceed as before.
- `ManualStampForm` (`/staff/stamp`) adds:
  - Camera Scanner / Manual UUID mode switcher (matching `RedeemRewardForm`, while keeping the SSR/initial form inputs rendered for accessibility and backward compatibility).
  - Quick-reason preset pills (`"Customer offline / no signal"`, `"NFC antenna unavailable"`, `"Counter tag unreachable"`) that populate the `reason` field in one tap, plus custom text entry.
  - When `QrCameraScanner` scans a code:
    - If it starts with `tcpm1.`, set `memberToken`, extract a preview badge (`Card #XXXX • Code YYYY-YYYY`), and if a reason is already selected (defaulting to `"Customer offline / no signal"` on camera scan if blank), allow instant submission or 1-tap confirm.
    - If a raw UUID is scanned, populate `customerId`.
    - If a reward token (`tcp2.` or `tcpig2.`) is scanned on `/staff/stamp`, show a helpful alert directing the barista to `/staff/redeem`.

### 2.3 Customer Card Member QR & Offline Caching (`/s/[slug]`, `/wallet`, `/offline`)
- **On `/s/[slug]` (Active Card View):**
  - Server Component mints `memberStampToken = await issueMemberStampToken(cardState.customerId, tenant.id)` and passes it to `<MemberStampQrPanel />`.
  - `<MemberStampQrPanel />`:
    - Saves the card snapshot (`customerId`, `tenantId`, `tenantSlug`, `tenantName`, `displayName`, `availableStamps`, `rewardThreshold`, `rewardLabel`, `memberToken`, `displayCode`, `qrSvg`, `updatedAtIso`) to `localStorage` under key `tcp_offline_cards_v1` (keyed by `tenantSlug`, keeping up to 10 cards).
    - Listens to `window` `'online'` / `'offline'` events and `navigator.onLine`.
    - When **online**: renders a compact collapsible button `"No signal or NFC trouble? Show Member QR"` that toggles the QR code drawer open/closed.
    - When **offline** (`isOffline === true`): automatically expands the QR drawer with a high-contrast amber status banner `"OFFLINE MODE • SHOW QR TO BARISTA TO STAMP"`.
    - When a customer deletes their card or wallet (`DeleteCardButton`), clear the corresponding entry (or all entries) from `tcp_offline_cards_v1` so erased data never lingers in `localStorage` (RA 10173 compliance).
- **Offline Fallback Route (`/offline`) & Service Worker (`/sw.js`):**
  - `/offline` (`app/offline/page.tsx`): A client-capable page cached by the Service Worker that reads `tcp_offline_cards_v1` from `localStorage` and renders the customer's cached card(s) and their scannable Member QR SVG even when the browser loads with zero internet connection.
  - `/sw.js` (`public/sw.js`): Lightweight, zero-dependency Service Worker that pre-caches `/offline` on install and intercepts failed document navigation requests (`request.mode === 'navigate'`) when offline, serving the cached `/offline` shell. Never caches `/api/*`, `/t/*`, `/auth/*`, or `/staff/*` responses.
  - Registered via a tiny `<OfflineServiceWorkerRegister />` client component mounted in `app/layout.tsx`, and `/sw.js` added to `middleware.ts` static exclusion matcher.

