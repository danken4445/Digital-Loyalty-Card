# Offline Member QR + Staff Stamp Scanner Implementation Plan

**Spec Reference:** `docs/superpowers/specs/2026-11-10-offline-member-qr-and-staff-scanner-design.md`  
**Status:** Completed

---

## Tasks & Progress

### Task 1: Signed Member Stamp Token (`tcpm1`)
- [x] Create `lib/security/memberStampToken.ts` with HMAC-SHA256 signature and `timingSafeEqual` verification.
- [x] Bound to `(customerId, tenantId)`. Distinct `tcpm1` prefix to prevent token confusion with redemption tokens (`tcp2` / `tcpig2`).
- [x] Redact `tcpm1.` pattern in `lib/security/logger.ts`.
- [x] Tests: `tests/unit/member-stamp-token.test.ts`.

### Task 2: Staff Stamp API (`POST /api/staff/stamp`)
- [x] Update `app/api/staff/stamp/route.ts` to accept `memberToken?: string`.
- [x] Verify tenant isolation: `payload.tenantId === staff.tenantId`.
- [x] Backward compatible with manual `customerId` entry.
- [x] Tests: `tests/unit/staff-stamp-scanner.test.ts`.

### Task 3: Staff Stamp Camera Scanner & Reason Chips (`/staff/stamp`)
- [x] Upgrade `ManualStampForm.tsx` with `QrCameraScanner` mode switcher.
- [x] Add one-tap quick-reason chips ("Customer offline / no signal", "NFC antenna unavailable", "Counter tag unreachable").
- [x] Detect invalid tokens and warn barista if a redemption token (`tcp2.` / `tcpig2.`) is scanned instead of a member QR.
- [x] Tests: `tests/unit/staff-stamp-scanner.test.ts`.

### Task 4: Customer `<MemberStampQrPanel />` & Offline Storage (`localStorage`)
- [x] Create `lib/offline/cardCache.ts` (`saveOfflineCard`, `readOfflineCards`, `removeOfflineCard`, `clearAllOfflineCards`).
- [x] Create `components/card/MemberStampQrPanel.tsx` with online/offline detection and collapsible QR drawer.
- [x] Integrate into `app/s/[slug]/page.tsx`.
- [x] Connect RA 10173 erasure hookup in `components/card/DeleteCardButton.tsx`.
- [x] Tests: `tests/unit/offline-member-qr.test.ts`.

### Task 5: Offline Fallback Page (`/offline`) & Service Worker (`public/sw.js`)
- [x] Create `public/sw.js` to pre-cache `/offline` and intercept document navigations when offline without intercepting `/api/*`, `/staff/*`, or `/auth/*`.
- [x] Create `components/offline/OfflineServiceWorkerRegister.tsx` and register in `app/layout.tsx`.
- [x] Create `app/offline/page.tsx` rendering cached cards, QR codes, and reconnection retry buttons.
- [x] Update `middleware.ts` to exclude `/sw.js`.
- [x] Tests: `tests/unit/offline-fallback-page.test.ts`.
