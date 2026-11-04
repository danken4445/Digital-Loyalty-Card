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

---

## D-011: Staff-Verified Instagram Follow Upsize Perk

- **Date:** 2026-11-02
- **Status:** Accepted
- **What:**
  1. Every card shows a one-time perk: follow `@thecaffeineplug8400` on Instagram for a free upsize on any drink. The customer opens the profile from the card, then taps claim to get a 5-minute signed QR token (`POST /api/perks/instagram-upsize`).
  2. Upsize tokens reuse the D-007 HMAC scheme with their own prefix (`tcpig1`). The prefix is part of the signed message, so an upsize token can never be passed off as a free-coffee (`tcp1`) token.
  3. Baristas scan it on the existing `/staff/redeem` screen, check the follow on the customer's phone, and confirm. `public.claim_instagram_upsize(p_customer, p_staff)` records it in `public.perk_claims`, with `unique (customer_id, perk)` and the customer advisory lock (namespace `1001`) allowing one claim per card. No stamps are spent.
  4. `merge_anonymous_customer` moves perk claims to the target and drops duplicates. Erasure cascades from `public.customers`.
- **Why:** Instagram's APIs don't let a third-party app check whether a given person follows an account, so the app can't verify the follow itself. An honor-system button would let anyone claim, so the barista does the check. Limit: a customer who clears their browser gets a new anonymous card and could claim again, but only by showing the follow at the counter again.

---

## D-012: Multi-Tenant Database (Phases 10–11): Wallet, Per-Shop Rules, Expand-Then-Contract

- **Date:** 2026-11-04
- **Status:** Accepted
- **What:**
  1. **Owner decisions** (see `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md`):
     - **D1:** one login with a separate card per shop, collected in a wallet (`public.customer_cards`).
     - **D2:** path routing on one domain (`/s/<slug>`, `/t/<tagId>` unchanged, `/wallet`).
     - **D3:** stamp rules configurable per shop (`public.tenant_settings`).
     - **D4:** billing deferred.
  2. **Shared schema with `tenant_id` on every business table.** The Caffeine Plug is tenant #1 (`7c1f0000-0000-4000-8000-000000000001`, slug `caffeine-plug`) with its original rules. RLS gives staff rows of the tenants they're active members of (`private.staff_tenant_ids()`), and gives customers their own rows across every tenant.
  3. **Tenant-aware functions use new names**, not overloads:
     - `stamp_card_nfc`, `add_card`, `stamp_card_manual`, `redeem_card_reward`, `claim_card_perk`;
     - `create_tag`, `rotate_tag`, `deactivate_tag`;
     - `remove_card`, `delete_wallet`, `merge_wallets`.

     The legacy functions have defaulted parameters, so an overload such as `record_stamp(uuid, text)` would make calls ambiguous ("function is not unique").

  4. **The tenant always comes from the database.** NFC stamps read `tags.tenant_id`. Staff actions take `p_actor` and require an active membership in `p_tenant`, plus a card for the customer in that tenant.
  5. **Transition rules until Phase 12 switches the app over:**
     - Legacy functions write tenant #1 rows through column defaults.
     - A transition-only trigger mirrors legacy `public.staff` rows into tenant #1 memberships.
     - Customers created by the legacy flow get their tenant #1 card when the Phase 12 contract migration re-runs `private.backfill_tenant1()`.
     - Phase 12 then:
       - adds the composite FK `(tenant_id, customer_id)` → `customer_cards`;
       - drops `public.is_staff()`, `public.staff`, the mirror trigger, the single-tenant guard (`private.guard_single_tenant`, which refuses tenants other than #1 unless `app.allow_multi_tenant` is on), `public.customer_balances`, the legacy stamp/redeem/merge/perk functions (including the unused `redeem_reward(uuid, uuid)`) and the `tenant_id` column defaults.
  6. **`delete_customer_data` lock fix.** It now takes the same customer lock as stamping, `pg_advisory_xact_lock(hashtextextended(p_customer::text, 1001))`.
- **Why:** One shared database is the only model a small shop's subscription can pay for. Working out the tenant inside SQL stops a routing or service-role bug from crediting, redeeming or reading another shop's data. Expand-then-contract keeps the deployed single-shop app working while the database changes underneath it.

---

## D-013: Multi-Tenant App Switch and Contract (Phase 12)

- **Date:** 2026-11-05
- **Status:** Accepted
- **What:**
  1. **The app switched to the tenant-aware functions.** Customers use `/s/<slug>` and `/wallet` (`/card` is only a redirector); NFC taps go through `stamp_card_nfc`, which reads the shop from the tag; staff actions take the active shop from the staff session and call `stamp_card_manual`, `redeem_card_reward`, `claim_card_perk` and the tag functions. Redemption QR tokens are v2 (`tcp2` / `tcpig2`) and carry the shop; v1 tokens are rejected.
  2. **The contract migration (`20261105000000_phase12_contract.sql`) removes every legacy single-shop object:**
     - the transition trigger and guard (`staff_mirror_to_tenant1`, `tenants_single_tenant_guard`) and their functions, plus `private.backfill_tenant1()` after one last insert-only run;
     - `record_stamp`, `redeem_reward` (both overloads), `claim_instagram_upsize`, `merge_anonymous_customer`, `delete_customer_data`, `is_staff()`, the `customer_balances` view and the `public.staff` table;
     - the `tenant_id` defaults on `tags`, `stamps`, `redemptions`, `perk_claims` and `audit_log`, so every writer must name its tenant.
  3. **Composite foreign keys** `(tenant_id, customer_id)` → `customer_cards` (cascade) on `stamps`, `redemptions` and `perk_claims`: a ledger row cannot exist without a wallet card, and removing a card erases that shop's ledger.
  4. **Platform audit rows have a null `tenant_id`** (`customer_self_deleted`, `stale_anonymous_cleanup`, `merge_anonymous_customer`, `customer_merge_token_used`). `log_audit_event` gained `p_tenant uuid default null`.
  5. **No service-role table reads.** ESLint forbids `admin.from(...)`: the service role calls RPCs only, and reads go through the session client (RLS) or the public tenant readers. The single-use merge nonce lookup moved to the service-role-only RPC `merge_nonce_used`, and callers fail closed when it errors.
  6. **`cleanup_stale_anonymous_customers` fix.** It no longer schema-qualifies `coalesce` (not a `pg_catalog` function, so the call failed at runtime), and spares anyone with a `tenant_members` row instead of a `staff` row.
  7. **Local setup:** Supabase Auth is the only Turnstile verifier; export `TURNSTILE_SECRET_KEY` (Cloudflare's test secret) before `supabase start`.
- **Why:** The expand-then-contract plan from D-012 ends here: with no caller left for the legacy functions, keeping them would leave a tenant-blind write path next to the safe one. Dropping the column defaults turns any future writer that forgets its tenant into a loud error instead of a silent tenant #1 row.

---

## D-014: Flexible Per-Customer Billing Plans (metering and estimates, no gateway)

- **Date:** 2026-11-05
- **Status:** Accepted (prices are placeholders to tune in pilots)
- **What:**
  1. **Shops pick a plan; the catalog is data.** `public.billing_plans` holds each plan as a base fee, an included-customer allowance, a per-customer rate and an optional monthly cap, all in whole centavos. Starting catalog: Pay as you go (₱10 each), Starter 50 (₱350 covers 50, then ₱7), Growth 200 (₱1,000 covers 200, then ₱5), Worry-free cap (₱8 each, never above ₱1,200). Changing a price is an edit to a row, not a deploy.
  2. **A billable customer is a card holder who earned at least one stamp at the shop that calendar month** (shop timezone). Holding a card without visiting is free, so a shop never pays for the wallet's reach.
  3. **Plan choice is per shop and effective by month** (`tenant_plan_selections`). The first choice applies to the current month; later changes apply from next month, so a shop cannot drop to a cheaper plan after seeing a busy month. A platform admin can apply a change immediately. Only the shop owner (or a platform admin) can choose; owners and managers can read billing.
  4. **`get_billing_estimate` computes the month's bill on demand** from the stamp ledger and the plan in force. Nothing is stored per invoice yet. Trial shops see what the plan would cost but are marked not billed.
  5. **Surfaces:** `/staff/billing` (owner and manager, with a "what if I had N customers" comparison) and a Billing Plan card on `/platform/<slug>`. Both call the same SQL; the shop always comes from the verified session or the slug, never the request body.
- **Why:** The owner wants clients to choose a price they are comfortable with (about ₱5 to ₱10 per customer). A per-active-customer meter with a no-commitment, a bundled and a capped option lets a shop trade commitment for a lower rate. Money is integer centavos so there is no rounding drift.
- **Not done (still D4):** no payment gateway, no stored invoices, no automatic suspension for non-payment. Pilots are invoiced by hand from the estimate. A platform-admin screen for editing the catalog, and persisted month-end invoices, are the natural next steps.
