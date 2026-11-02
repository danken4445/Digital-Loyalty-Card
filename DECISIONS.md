# Architectural & Design Decisions

This document records key technical, security, and branding decisions for The Caffeine Plug NFC Digital Loyalty Card.

---

## D-001: Next.js App Router + Supabase Anonymous Sign-In

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:** Use Next.js 15 App Router combined with Supabase anonymous authentication for customer onboarding.
- **Why:** In-person coffee shop customers should not have to download a native app from an app store or complete a lengthy registration form while waiting at the counter. When a customer taps an NFC card or scans a counter QR code, the app creates an anonymous session in their mobile browser instantly. This delivers a zero-friction, zero-install experience in under two seconds while still giving the backend a persistent, secure customer ID.

---

## D-002: Append-Only Ledger with Server-Enforced RPCs

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:** Loyalty stamps and reward redemptions are modeled as immutable append-only ledger tables (`stamps`, `redemptions`). Stamp awarding and reward redemption happen exclusively through PostgreSQL `SECURITY DEFINER` Remote Procedure Call (RPC) functions. These functions are invoked exclusively by the Next.js server using the privileged `SUPABASE_SERVICE_ROLE_KEY`, only after verifying the customer's session with `supabase.auth.getUser()`.
- **Why:** Prevent stamp fraud, counter tampering, and race conditions. Customers cannot directly insert, update, or delete rows in the `stamps` or `redemptions` tables; Row Level Security (RLS) blocks direct client writes. Total active stamps are computed from the ledger rather than read from an editable counter column. Running the mutation inside a database transaction behind server-side validation guarantees that stamps cannot be double-counted or faked.

---

## D-003: Monochrome Two-Tone Streetwear Brand Identity

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:** Adopt a strict monochrome two-tone palette (`#0A0A0A` deep black and `#FFFFFF` pure white) paired with KAWS-inspired mascot assets from The Caffeine Plug brand pack.
- **Why:** The aesthetic reflects The Caffeine Plug's urban street culture identity. The high-contrast black-and-white theme provides maximum legibility on mobile devices under varying cafe lighting conditions (from outdoor direct sunlight to low-light evening café ambience) while avoiding the generic corporate look of traditional loyalty apps.

---

## D-004: Default Canonical Domain, Timezone, and Currency

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:** Set the canonical production domain placeholder to `card.thecaffeineplug.ph` (configured via `NEXT_PUBLIC_SITE_URL`). Set the system timezone to `Asia/Manila` (UTC+8) and system currency formatting to Philippine Peso (`PHP`, ₱).
- **Why:** The Caffeine Plug operates physically in the Philippines. Rate limits, daily visit cooldowns, stamp ledger timestamps, and barista redemption windows must align with Philippine business hours. Using an environment variable for `NEXT_PUBLIC_SITE_URL` allows seamless transitions between local testing (`http://localhost:3000`), preview deployments, and final production domain cutover.

---

## D-005: Hierarchical Advisory Locking (`record_stamp` & `redeem_reward`)

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:** In `public.record_stamp`, acquire transaction-scoped advisory locks (`pg_advisory_xact_lock`) using `hashtextextended(p_tag, 1002)` first (when `p_tag` is present), followed by `hashtextextended(p_customer::text, 1001)`. In `public.redeem_reward`, acquire `hashtextextended(p_customer::text, 1001)` before reading balances or inserting redemptions.
- **Why:** Prevents race conditions (such as 20 simultaneous NFC taps or double-redemption requests) without locking entire tables, and guarantees deadlock freedom by enforcing a strict global lock acquisition order (`tag [1002] -> customer [1001]`).

---

## D-006: `SEC-REVIEW-AGENT` Phase 1 Audit Dispositions

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:**
  1. Added upper-bound string length constraints on `tags.id`, `tags.label`, `staff.display_name`, `stamps.reason`, `audit_log.action`, and `audit_log.target`.
  2. Added FK indexes (`stamps_staff_idx`, `redemptions_staff_idx`, `audit_log_actor_idx`) and `alter default privileges in schema public revoke execute on functions from public, anon, authenticated`.
  3. Normalized `p_tag := pg_catalog.btrim(p_tag)` prior to advisory lock hashing in `record_stamp`.
  4. Accepted `p_now` parameter on `record_stamp` strictly for `service_role` deterministic timezone boundary testing (midnight `Asia/Manila`); Next.js server routes must never pass client-supplied timestamps to `p_now`.
  5. Accepted `supabase/seed.sql` demo staff/tag credentials strictly for local Docker development (`supabase db reset`); production deployments use `supabase db push` and never execute `seed.sql`.
- **Why:** Resolves all Low/Info findings in code and establishes explicit guardrails for the two Medium operational findings from the Phase 1 security review.

---

## D-007: Signed 5-Minute HMAC Redemption Token & Offline SVG QR Rendering

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:** When a customer reaches 10+ stamps, the server issues a 5-minute (`300s`) HMAC-SHA256 signed token (`tcp1.<base64url(payload)>.<base64url(signature)>`) using `REDEEM_TOKEN_SECRET`, verified in constant time with `crypto.timingSafeEqual`. The QR code is rendered server-side into an inline SVG via `qrcode` (`QRCode.toString(..., { type: 'svg' })`) alongside an 8-character human-readable fingerprint (`XXXX-XXXX`) and one-tap copy token fallback.
- **Why:** Never sending redemption tokens to third-party QR image APIs prevents leaking bearer tokens over external requests and keeps our Content Security Policy (`img-src 'self' data:`) strict. The 5-minute TTL prevents screenshot replay attacks while giving customers plenty of time at the counter.

---

## D-008: `SEC-REVIEW-AGENT` Phase 5 Staff & Redemption Audit Dispositions

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:**
  1. **Atomic Single-Use Nonce Consumption (`High`)**: Added migration `20261102020000_phase5_atomic_redeem_nonce.sql` creating a partial unique index `audit_log_redeem_nonce_uidx` on `public.audit_log(target) WHERE action = 'staff_redeem_token_used'` and overloading `public.redeem_reward(p_customer, p_staff, p_nonce)` so single-use QR token nonce verification and recording execute atomically inside the `pg_advisory_xact_lock(hashtextextended(p_customer::text, 1001))` critical section.
  2. **Staff Login Redirect Validation (`Low`)**: Restricted `nextPath` on `/staff/login` to internal `/staff` routes excluding `/staff/login` to prevent redirect loops and open redirects.
  3. **Tag List Rate Limiting (`Low`)**: Added `checkPublicEndpointRateLimit` (`endpoint: 'staff-tags'`) to `GET /api/staff/tags`.
  4. **Verification Code Copy Alignment (`Info`)**: Updated `/staff/redeem` header copy to reference the 8-character verification code (`XXXX-XXXX`).
- **Why:** Eliminates TOCTOU race conditions on concurrent QR token redemptions and closes all High/Low/Info findings from the Phase 5 security review.

---

## D-009: Cryptographic Merge Intent Token & Canonical UUID Lock Ordering (`merge_anonymous_customer`)

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:**
  1. When an anonymous customer chooses to recover or merge with an existing backed-up Google/email account, the server issues a 10-minute HMAC-SHA256 signed `mergeIntentToken` (`tcp_merge1.<payload>.<signature>`, stored in an `HttpOnly`, `SameSite=Lax` cookie `tcp_merge_intent`) while authenticated as the anonymous user via `getVerifiedUser()`.
  2. After the customer completes authentication into their existing target account, the server verifies BOTH the current target session (`getVerifiedUser()`) and the signed `mergeIntentToken` before calling `public.merge_anonymous_customer(p_source_customer, p_target_customer)`.
  3. Inside `public.merge_anonymous_customer`, transaction-scoped advisory locks (`pg_advisory_xact_lock` namespace `1001`) are acquired in canonical ascending UUID text order (`least(p_source_customer::text, p_target_customer::text)` first, then `greatest(...)`).
- **Why:** Requiring a server-signed `mergeIntentToken` proves cryptographic ownership of the anonymous source account and prevents IDOR attacks where an attacker supplies another customer's UUID as `sourceCustomerId`. Acquiring locks in canonical UUID order makes concurrent bidirectional merge calls (`(A, B)` vs `(B, A)`) 100% deadlock-free.

---

## D-010: Phase 7 Hardening & Philippines RA 10173 Data Privacy Compliance

- **Date:** 2026-11-02
- **Status:** Locked (Phase 7)
- **Decision:**
  1. **HTTP Security Headers (`next.config.ts`):** Configure strict `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and `Permissions-Policy` across `/:path*`.
  2. **CSRF Defense-in-Depth (`lib/security/csrf.ts`):** Complement `SameSite=Lax` cookies with `verifySameOriginRequest(request)` on state-changing `POST`/`DELETE` routes, blocking `Sec-Fetch-Site: cross-site`, `Origin: null`, and mismatched `Origin`/`Referer` hosts.
  3. **Philippines Data Privacy Act of 2012 (RA 10173) Self-Service Erasure & Retention:**
     - Provide a plain-language `/privacy` page detailing data minimization, 30-day stale anonymous account cleanup, and RA 10173 Data Subject Rights.
     - Implement `public.delete_customer_data(p_customer uuid)` (`SECURITY DEFINER`, `service_role` only) and `DELETE /api/customers` so any customer can permanently erase their `auth.users`, `public.customers`, `public.stamps`, `public.redemptions`, and prior customer-identifiable `public.audit_log` rows in one atomic transaction while recording only an anonymized (`md5`) erasure count.
     - Implement `public.cleanup_stale_anonymous_customers(p_older_than interval default interval '30 days')` (`SECURITY DEFINER`, `service_role` only) to automatically purge zero-stamp anonymous accounts older than 30 days.
  4. **PII-Free Structured Logging (`lib/security/logger.ts`):** Redact emails, IPs, tokens, cookies, and secrets before emitting structured JSON logs.
  5. **Dependency Supply-Chain & Audit Triage (`package-lock.json`):** Removed extraneous `pnpm-lock.yaml` / `pnpm-workspace.yaml` so `package-lock.json` is the single authoritative lockfile matching CI (`npm ci`). Triaged `npm audit` advisories on `next@15.2.x` (`GHSA-f82v-jwr5-mffw` et al.) and `zod@3.x`: middleware bypass is mitigated in-depth because every page and route handler independently verifies identity and staff role via `getVerifiedUser()` / `requireStaffSession()`; Server Actions and remote image optimization (`remotePatterns`) are unused; upgrading across major/minor boundaries (`next@15.5.28`, `zod@4.x`) is deferred to a dedicated dependency upgrade PR (Review Date: `2026-12-01`) rather than running `npm audit fix --force`.
- **Why:** Satisfies the Philippines RA 10173 principles of transparency, legitimate purpose, proportionality, and data subject right to erasure while hardening all state-changing boundaries against CSRF, clickjacking, XSS, and log-based PII leakage.
