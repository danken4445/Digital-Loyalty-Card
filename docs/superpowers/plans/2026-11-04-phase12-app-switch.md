# Phase 12: App Switch to the Multi-Tenant Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Next.js app off the legacy single-shop SQL functions onto the tenant-aware ones from Phases 10–11, then drop the legacy objects in a contract migration.

**Architecture:**
- **Customers:** shop pages live at `/s/<slug>`, and `/wallet` lists every card. NFC taps stay at `/t/<tagId>`; the shop is read from the tag in SQL (`stamp_card_nfc`). A first visit to a shop needs an explicit "Add to wallet" (`add_card`).
- **Staff:** keep `/staff/*` URLs and work in an **active shop**: an HttpOnly cookie re-verified against `tenant_members` on every request, with a switcher for people who work at several shops.
- **Database access:** staff reads go through the logged-in session client, so RLS applies. The service-role client is only used for `.rpc(...)`.
- **Contract migration (last task):** drops the legacy functions, `is_staff()`, `staff`, the transition triggers and the column defaults.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS (`@supabase/ssr`), Vitest (mock-based route tests), pgTAP, Supabase CLI.

**Spec:**
- `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md`: section 1 decisions D1–D4, section 6 Phase 12, findings F-03/F-04/F-06/F-07/F-08/F-09.
- `DECISIONS.md` D-012.
- `lib/contracts.ts`: shared types. Additive Phase 12 types are already committed; each task below adds its own breaking contract change, verbatim.

## Global Constraints

- **Contracts:** `lib/contracts.ts` changes only as each task's "Contract change" says, verbatim. Everything else in it is fixed.
- **Gate:** every task leaves `npm run lint && npm run typecheck && npm run test:unit` passing. Update existing unit tests that mock legacy RPC names when your task changes those calls; don't delete a test's intent, re-point it.
- **New test files:** `tests/unit/phase12-<topic>.test.ts`, following the existing mock style (`vi.mock('server-only', () => ({}))`, mocked `@/lib/supabase/server`, `@/lib/supabase/admin`, `@/lib/security/ratelimit`).
- **Route conventions** (as in existing handlers):
  - `verifySameOriginRequest(request)` first on POST/DELETE;
  - `ApiResponse<T>` JSON bodies with `ApiErrorCode`s;
  - `checkPublicEndpointRateLimit` keyed by IP and user;
  - `Cache-Control: no-store` on token responses.
- **Client IP:** after Task 1, all client IPs come from `getClientIp(request)`, never `x-forwarded-for` directly.
- **Database access:**
  - Service-role admin client (`createSupabaseAdminClient`): `.rpc(...)` only.
  - Reads use `createSupabaseServerClient()` (session; RLS applies) or the public tenant readers in `lib/tenants/context.ts`.
  - After Task 7, ESLint forbids `admin.from(`.
- **Tenant source:** never trust a tenant from the request body for NFC stamps; SQL reads it from the tag. Staff actions use the active shop from `requireStaffSession()`; customer actions use the shop resolved from the URL slug.
- **Copy and branding:** shop name, reward label, threshold, timezone and perks come from `TenantContext.settings`. The `SHOP_CONFIG`/`STAMP_RULES`/`BRAND_THEME` constants remain only as platform defaults and fallbacks.
- **Commits:** Conventional Commits, no co-author trailers; never commit `.claude/` or `.superpowers/`.

## Review Focus

1. **Cross-shop QR:** a customer shows a shop-A reward QR to shop-B staff. Shop B gets "This reward belongs to another shop", and nothing is redeemed. → Task 6 test `redeem_rejects_other_tenant_token`.
2. **Stale cookie:** a staff member's active-shop cookie names a shop they were removed from. They fall back to their first remaining membership, or get 403 if none, and never act for the old shop. → Task 5 test `stale_tenant_cookie_falls_back`.
3. **First tap at a new shop:** an anonymous customer with a shop-A card taps a shop-B tag. They see the add-card screen for B, and after "Add" the stamp lands on the B card. → Task 4 tests `tap_no_card_redirects_to_add_card`, `add_card_then_stamps`.
4. **Spoofed IP header:** a request with a spoofed `X-Forwarded-For` but a real `cf-connecting-ip` is rate-limited on the real IP. → Task 1 test `client_ip_prefers_cf_connecting_ip`.
5. **Plain staff can't manage tags:** a `staff`-role member POSTs to `/api/staff/tags`. They get 403, and no tag RPC is called. → Task 6 test `tag_actions_require_owner_or_manager`.

---

### Task 1: Tenant context readers, rule-aware display helpers, client IP

**Files:**
- Create: `lib/tenants/context.ts`, `tests/unit/phase12-tenant-context.test.ts`
- Modify: `lib/rules/display.ts`, `lib/security/ratelimit.ts`, and every route that reads `x-forwarded-for` (`app/t/[tagId]/route.ts`, `app/api/**/route.ts`), plus `lib/security/turnstile.ts` callers

**Contract change:** none.

**Interfaces (Produces):**
- `mapTenantRow(row: { id: string; slug: string; name: string; status: string; tenant_settings: {...snake_case columns...} | null }): TenantContext`
  - Pure function.
  - Converts snake_case to camelCase.
  - `brand` and `perks` default to `{}`.
  - Throws `Error('tenant settings missing')` when settings are null.
- `getTenantBySlug(slug: string): Promise<TenantContext | null>`
  - Lowercases and trims the slug.
  - One query: `tenants` with an embedded `tenant_settings(*)`, via `createSupabaseServerClient()`. RLS allows anon/authenticated SELECT.
- `getTenantById(id: string): Promise<TenantContext | null>`
- `getTenantSlugForHost(host: string | null): Promise<string | null>`
  - Strips any `:port` and lowercases.
  - Looks up `tenant_domains.host`.
- `getClientIp(request: Request): string | null` in `lib/security/ratelimit.ts`
  - Returns `cf-connecting-ip` if present.
  - Otherwise the first comma-separated `x-forwarded-for` value (local dev).
  - Otherwise `null`.
- `lib/rules/display.ts`:
  - `calculateStampProgress(availableStamps: number, rewardThreshold: number = STAMP_RULES.rewardThreshold)`
  - `calculateCardsCompleted(totalStamps: number, rewardThreshold: number = STAMP_RULES.rewardThreshold)`
  - New `formatDateTimeInZone(iso: string, timeZone: string): string`, same output format as `formatManilaDateTime`. Keep `formatManilaDateTime` as a wrapper calling it with `'Asia/Manila'`.

- [ ] **Step 1: Write failing tests** in `phase12-tenant-context.test.ts`:
  - `mapTenantRow` maps every settings field and defaults `brand`/`perks` to `{}`.
  - `getTenantBySlug(' Caffeine-Plug ')` queries slug `caffeine-plug` and returns null when no row.
  - `getTenantSlugForHost('card.thecaffeineplug.ph:443')` queries host `card.thecaffeineplug.ph`.
  - `client_ip_prefers_cf_connecting_ip`: headers `{ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }` give `'203.0.113.9'`.
  - Only `x-forwarded-for: '1.2.3.4, 5.6.7.8'` gives `'1.2.3.4'`; neither header gives `null`.
  - `calculateStampProgress(9, 8).isRewardReady === true`; `calculateStampProgress(9).isRewardReady === false`.
  - `formatDateTimeInZone('2026-11-08T15:30:00Z', 'Asia/Tokyo')` contains `Nov 9`, while `formatManilaDateTime` of the same instant contains `Nov 8` (or the equivalent in the existing format).
- [ ] **Step 2: Run** `npx vitest run tests/unit/phase12-tenant-context.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the interfaces above and replace every `request.headers.get('x-forwarded-for')` with `getClientIp(request)`.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm run test:unit`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(app): add tenant context readers, rule-aware display helpers and cf-connecting-ip client IP`

### Task 2: Shop-bound reward tokens (v2)

**Files:**
- Modify: `lib/security/redeemToken.ts`, `app/card/page.tsx`, `app/api/redeem-token/route.ts`, `app/api/perks/instagram-upsize/route.ts`, `app/api/staff/redeem/route.ts`, affected unit tests
- Test: `tests/unit/phase12-redeem-token-v2.test.ts`

**Contract change** (in `RedeemTokenPayload`, after `customerId: string;`):
```ts
  /** Phase 12 (token prefixes tcp2 / tcpig2): the shop the reward belongs to. Staff of another shop get 'wrong-tenant'. */
  tenantId: string;
```

**Interfaces:**
- `issueRedeemToken(customerId: string, tenantId: string, options?: IssueRedeemTokenOptions): Promise<IssuedRedeemToken>`.
- Prefixes become `'free-coffee' → 'tcp2'` and `'instagram-upsize' → 'tcpig2'`. Tokens with `tcp1`/`tcpig1`, or a payload without a UUID `tenantId`, verify as `{ valid: false, reason: 'invalid-token' }`.
- **Interim callers until Tasks 3 and 6:**
  - Customer routes and pages issue tokens with `TENANT_ONE_ID`.
  - `app/api/staff/redeem/route.ts` returns result `'wrong-tenant'` (message `'This reward belongs to another shop.'`) when `payload.tenantId !== TENANT_ONE_ID`, in both preview (400) and confirm (200 with result).

- [ ] **Step 1: Write failing tests:**
  - A token round-trips with its `tenantId`.
  - The `tcp2.` prefix is in the token.
  - A token signed with the old `tcp1` prefix and a valid HMAC is rejected as `invalid-token`.
  - The `tcp2`/`tcpig2` kinds still can't be swapped.
  - `redeem_rejects_other_tenant_token_interim`: the staff route with a token for tenant `7c1f0000-0000-4000-8000-00000000000b` returns `wrong-tenant`, and no RPC is called.
- [ ] **Step 2: Run** the new test file. Expected: FAIL.
- [ ] **Step 3: Implement** the contract change, the token changes and the interim callers. Update the existing token tests (`instagram-upsize-perk.test.ts`, phase5/phase6/phase7 suites) to the new signature.
- [ ] **Step 4: Run** the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(app): bind reward QR tokens to a shop (tcp2/tcpig2)`

### Task 3: Shop card page, wallet list, redirects, shop-scoped token routes

**Files:**
- Create: `app/s/[slug]/page.tsx`, `app/wallet/page.tsx`, `components/card/AddCardPanel.tsx`, `tests/unit/phase12-shop-pages.test.ts`
- Modify: `lib/auth/customer.ts`, `app/card/page.tsx` (becomes a redirector), `app/page.tsx`, `app/api/redeem-token/route.ts`, `app/api/perks/instagram-upsize/route.ts`, `components/card/RedeemRewardPanel.tsx`, `components/card/InstagramUpsizePanel.tsx`, `components/card/StampGrid.tsx`, `components/card/OnboardingCard.tsx`, affected tests

**Contract change** (in `CustomerCardState`, after `customerId: string;`):
```ts
  /** The shop this card belongs to (Phase 12: one card per shop). */
  tenant: TenantContext;
```

**Interfaces:**
- **`lib/auth/customer.ts`:**
  - `getCustomerCardState(tenant: TenantContext): Promise<CustomerCardState | null | 'no-card'>`
    - Returns `null` when signed out.
    - Returns `'no-card'` when the user has no `customer_cards` row for the tenant (session client).
    - Otherwise reads `card_balances` (`tenant_id`, `customer_id`) and the `perk_claims` row for `instagram_follow_upsize` in that tenant.
    - `cardsCompleted` uses the tenant threshold.
  - `listWalletCards(): Promise<WalletCardSummary[] | null>`
    - Returns `null` when signed out.
    - Reads the user's `customer_cards` joined to `tenants` + `tenant_settings` and `card_balances`, ordered by `last_stamped_at desc nulls last`, then `added_at desc`.
  - Remove `getAuthenticatedCustomerCardState`.
- **`app/s/[slug]/page.tsx`:**
  - Unknown slug or a `closed` tenant → `notFound()`.
  - Signed out → `OnboardingCard` with `GetCardButton mode="start" tagId={t}`. Title "Get your {tenant.name} card".
  - `'no-card'` → `AddCardPanel tenantSlug tenantName rewardLabel tagId={t}`.
  - Otherwise the existing card UI from `app/card/page.tsx`, moved here and parameterised by the tenant:
    - name, tagline (`brand.tagline` ?? `SHOP_CONFIG.tagline` for tenant #1 only);
    - threshold, `rewardLabel`, timezone for "Last stamp" (suffix: the tenant timezone's short name, e.g. PHT/JST via `Intl`);
    - the Instagram link and perk panel only when `settings.perks.instagram_follow_upsize` exists, using its `handle`.
  - Keep `?r=` result handling and `StripResultParam`.
- **`app/wallet/page.tsx`:**
  - Signed out → `OnboardingCard` "Your loyalty wallet", explaining that cards are added at each shop.
  - Otherwise a simple list of `WalletCardSummary` links to `ROUTES.shop(slug)` showing name, `available/threshold` and reward label. Phase 13 restyles this page.
- **`app/card/page.tsx`:** becomes a redirect only.
  1. A `tenant_domains` alias for the request host → `ROUTES.shop(slug)` (preserving `?r=`).
  2. Otherwise exactly one wallet card → that shop.
  3. Otherwise → `ROUTES.wallet`.
- **`app/page.tsx`:** keeps the auth-callback forwarding, then `redirect(ROUTES.card)`.
- **`components/card/AddCardPanel.tsx`** (client component):
  - Text: "Add {tenantName} to your wallet".
  - Primary button "Add card", which POSTs `ROUTES.api.cards` with `AddCardRequest { tenantSlug, tagId }` and `router.push(redirectTo)` on success. Shows the error message on failure.
  - The `/api/cards` endpoint arrives in Task 4.
- **Token routes:**
  - `POST /api/redeem-token` and `POST /api/perks/instagram-upsize` require body `RedeemTokenRequest { tenantSlug }`; unknown slug → 400 `invalid_input`.
  - They check the card state for that tenant: redeem needs `availableStamps >= tenant.settings.rewardThreshold`, and the perk must exist in `settings.perks`.
  - Then `issueRedeemToken(user.id, tenant.id, …)`.
  - The client panels send their `tenantSlug`.

- [ ] **Step 1: Write failing tests:**
  - `shop_page_unknown_slug_404`.
  - `card_redirects_single_card_to_shop`.
  - `card_redirects_multi_card_to_wallet`.
  - `card_redirects_host_alias_to_shop`.
  - `get_customer_card_state_no_card`.
  - `redeem_token_uses_tenant_threshold`: threshold 8 with 8 stamps issues a token whose `payload.tenantId` is the tenant's.
  - `perk_token_requires_configured_perk`.
- [ ] **Step 2: Run** the new test file. Expected: FAIL.
- [ ] **Step 3: Implement**, and update phase4/phase2/instagram tests that rendered `/card` or called `getAuthenticatedCustomerCardState`.
- [ ] **Step 4: Run** the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(app): shop card pages, wallet list and shop-scoped reward tokens`

### Task 4: Tenant-aware tap, claim and add-card

**Files:**
- Create: `app/api/cards/route.ts`, `tests/unit/phase12-stamping.test.ts`
- Modify: `app/t/[tagId]/route.ts`, `app/api/claim/route.ts`, `components/card/StripResultParam.tsx`, `components/card/GetCardButton.tsx`, `lib/security/ratelimit.ts` (add endpoint `'cards'`: `{ perIp: 20, perCustomer: 10 }`), affected tests

**Contract change** (in `STAMP_RESULT_CODES`, after `'invalid-tag',`):
```ts
  'no-card',
  'tenant-unavailable',
  'unauthorized',
```

**Interfaces:**
- **`GET /t/<tagId>`:**
  - Rate limits as today.
  - Signed out → `ROUTES.startWithTag(tagId)`.
  - Calls `admin.rpc('stamp_card_nfc', { p_customer: user.id, p_tag })` and maps the result:
    - `invalid-tag` → `ROUTES.cardWithResult('invalid-tag')`;
    - `no-card` → `ROUTES.shopAddCard(slug, tagId)`;
    - anything else → `ROUTES.shopWithResult(slug, result)`.
  - RPC error → `ROUTES.cardWithResult('invalid-tag')`.
- **`POST /api/claim`:** same mapping, returned as `ClaimStampResponse { result, redirectTo }`.
- **`POST /api/cards`** (`AddCardRequest` → `AddCardResponse`):
  1. CSRF check, then a signed-in user (anonymous is fine), then the `'cards'` rate limit.
  2. Zod body: `tenantSlug` 3–40 chars, optional `tagId`, optional `consentVersion` default `'v1'`.
  3. `getTenantBySlug`; unknown → 404 `invalid_input`.
  4. `admin.rpc('add_card', { p_customer, p_tenant, p_consent_version })`.
  5. If `tenant-unavailable` → 200 with `redirectTo: ROUTES.shop(slug)`.
  6. If `tagId` is present and the result is `added`/`already-added` → `stamp_card_nfc` and `stampResult`. A tag from a different tenant returns `no-card`/another slug: then report the `stampResult` but still `redirectTo` this tenant's shop page.
  7. `redirectTo = stampResult ? ROUTES.shopWithResult(slug, stampResult) : ROUTES.shop(slug)`.
- **`GetCardButton`** (`mode="start"` with a tag): after the claim response, follows `redirectTo` (an add-card page for first-time customers).
- **`StripResultParam`** messages:
  - `no-card`: "Add this shop's card to collect stamps."
  - `tenant-unavailable`: "This shop isn't accepting stamps right now."
  - `unauthorized`: "You're not allowed to do that."

- [ ] **Step 1: Write failing tests:**
  - `tap_no_card_redirects_to_add_card`.
  - `tap_stamped_redirects_to_shop_with_result`.
  - `tap_invalid_tag_redirects_to_card`.
  - `claim_returns_shop_redirect`.
  - `add_card_then_stamps` (`add_card` → `added`, then `stamp_card_nfc` → `stamped`; `redirectTo` `/s/bean-there?r=stamped`).
  - `add_card_unknown_slug_404`.
  - `add_card_requires_session` (401).
  - `add_card_csrf_blocked` (403).
- [ ] **Step 2: Run** the new test file. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the phase3 stamp-engine route tests from `record_stamp` to `stamp_card_nfc`.
- [ ] **Step 4: Run** the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(app): tenant-aware NFC taps and add-card consent`

### Task 5: Staff memberships and the active shop

**Files:**
- Create: `app/api/staff/tenant/route.ts`, `components/staff/StaffTenantSwitcher.tsx`, `tests/unit/phase12-staff-session.test.ts`
- Modify: `lib/auth/staff.ts`, `lib/supabase/middleware.ts`, `components/staff/StaffNav.tsx`, `components/staff/StaffPageShell.tsx`, `app/staff/login/page.tsx`, affected tests

**Contract change** (in `StaffSession`, after `active: true;`):
```ts
  /** The active shop: the STAFF_TENANT_COOKIE_NAME membership if valid, else the first membership by shop name. */
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /** Every active membership, for the shop switcher. */
  memberships: StaffMembership[];
```

**Interfaces:**
- **`requireStaffSession(): Promise<StaffAuthResult>`:**
  1. Signed-out or anonymous → `unauthenticated`.
  2. Session client: `tenant_members` where `user_id = user.id and active = true`, joined to `tenants(id, slug, name, status)`, excluding `closed`. RLS returns the user's own rows.
  3. No memberships → `forbidden`.
  4. Active shop = the membership whose `tenantId` equals the `STAFF_TENANT_COOKIE_NAME` cookie, else the first by `tenantName` (locale compare).
  5. `displayName` and `role` come from that membership.
  6. It no longer calls `is_staff` or reads `staff`.
- **`POST /api/staff/tenant`** (`StaffSwitchTenantRequest` → `StaffSwitchTenantResponse`):
  - CSRF check, then `requireStaffSession`.
  - `tenantId` must be in `memberships`, else 403 `forbidden`.
  - Sets the cookie: `httpOnly`, `sameSite: 'lax'`, `path: '/'` (it must reach both `/staff` pages and `/api/staff` routes), `secure` in production, `maxAge` 30 days.
- **Middleware** (`/staff/*` except login): keeps the signed-in, non-anonymous check. Instead of `rpc('is_staff')` it does a session `tenant_members` select `limit 1` (`active = true`); none → login `?error=forbidden`.
- **`StaffTenantSwitcher`:** rendered in `StaffNav` only when `memberships.length > 1`. A `<select>` labelled "Shop" that POSTs, then `router.refresh()`. The page shell shows the active `tenantName`.

- [ ] **Step 1: Write failing tests:**
  - `active_tenant_from_cookie`.
  - `stale_tenant_cookie_falls_back`: the cookie names a tenant not in memberships → first membership.
  - `no_memberships_forbidden`.
  - `switch_tenant_rejects_non_member` (403).
  - `switch_tenant_sets_cookie`.
  - `middleware_uses_memberships_not_is_staff`: no `rpc('is_staff')` call.
- [ ] **Step 2: Run** the new test file. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the phase5 suite's `requireStaffSession`/middleware mocks.
- [ ] **Step 4: Run** the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(staff): shop memberships, active shop and switcher`

### Task 6: Staff actions on the active shop

**Files:**
- Modify: `app/api/staff/stamp/route.ts`, `app/api/staff/redeem/route.ts`, `app/api/staff/tags/route.ts`, `lib/auth/staff.ts` (`getStaffActivityDashboardData`, `getStaffTagsList`, `decorateTagWithUrls`, `detectActivityAnomalies`), `components/staff/TagManagerClient.tsx`, `components/staff/RedeemRewardForm.tsx`, `components/staff/ManualStampForm.tsx`, staff pages as needed, affected tests
- Test: `tests/unit/phase12-staff-actions.test.ts`

**Contract change:** none.

**Interfaces:**
- **Manual stamp:**
  - `admin.rpc('stamp_card_manual', { p_actor: staff.userId, p_tenant: staff.tenantId, p_customer, p_reason })`.
  - Remove the admin `customers` lookup.
  - `no-card` → 404 `invalid_input` "This customer has no {tenantName} card."
  - `unauthorized` → 403.
  - The balance after stamping comes from the session client `card_balances` (`tenant_id`, `customer_id`).
  - Drop the duplicate `logStaffAuditEvent` call; the SQL function audits.
- **Redeem:**
  - `payload.tenantId !== staff.tenantId` → `wrong-tenant` (replaces the Task 2 interim check).
  - Preview reads session `card_balances` and `perk_claims` filtered by `staff.tenantId`.
  - `canRedeem` uses the tenant's `reward_threshold`, from `getTenantById`.
  - Confirm: free-coffee → `redeem_card_reward(p_actor, p_tenant, p_customer, p_nonce)`; instagram-upsize → `claim_card_perk(..., 'instagram_follow_upsize')`.
  - Remove the post-RPC `logStaffAuditEvent` for `staff_redeem_token_used` and the admin `audit_log` nonce pre-check. The RPC returns `invalid-token` for a used nonce, so preview runs the same check through the session client's `audit_log` read (RLS tenant-scoped).
  - Messages use the tenant's `rewardLabel` and threshold.
- **Tags:**
  - GET lists through the session client (`tags` where `tenant_id = staff.tenantId`).
  - POST requires `staff.role in TAG_MANAGER_ROLES`, else 403 `forbidden` "Only owners and managers can manage tags." with no RPC.
  - Actions map to `create_tag(p_actor, p_tenant, p_tag_id: generateRandomTagId(), p_label)`, `deactivate_tag`, `rotate_tag(…, p_new_tag_id: generateRandomTagId())`. `duplicate` → retry once with a new ID.
  - The response tag is re-read through the session client.
  - `decorateTagWithUrls`: `productionTapUrl` uses `NEXT_PUBLIC_SITE_URL` (trailing slash trimmed) instead of `SHOP_CONFIG.defaultProductionDomain`; `localTapUrl` is unchanged.
  - The tag manager UI hides create/rotate/deactivate for the `staff` role.
- **Activity:**
  - Session-client queries filtered by `tenant_id = staff.tenantId`.
  - `detectActivityAnomalies(input, rules: { dailyCap: number; timezone: string })` replaces the hard-coded cap of 2 and the Manila day.

- [ ] **Step 1: Write failing tests:**
  - `manual_stamp_uses_active_tenant`.
  - `manual_stamp_no_card_404`.
  - `redeem_rejects_other_tenant_token` (Review Focus 1).
  - `redeem_confirm_calls_redeem_card_reward_with_active_tenant`.
  - `perk_confirm_calls_claim_card_perk`.
  - `tag_actions_require_owner_or_manager` (Review Focus 5).
  - `tag_create_retries_duplicate_once`.
  - `activity_anomalies_use_tenant_cap`: cap 1 flags a customer with 1 stamp/day on 2 days.
  - `production_tap_url_uses_site_url`.
- [ ] **Step 2: Run** the new test file. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the phase5 suite to the new RPCs and session reads.
- [ ] **Step 4: Run** the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(staff): run staff actions against the active shop`

### Task 7: Wallet merge and deletion, Turnstile dedupe, admin-read lint ban

**Files:**
- Modify: `app/auth/callback/route.ts`, `app/api/customers/merge/route.ts`, `app/api/customers/route.ts`, `components/card/GetCardButton.tsx`, `supabase/config.toml` (`[auth.captcha]`), `.eslintrc.json`, `lib/auth/customer.ts` (if still calling `ensure_customer` unnecessarily), affected tests
- Test: `tests/unit/phase12-account-flows.test.ts`

**Contract change:** none.

**Interfaces:**
- **Merge:** the callback and the merge route call `admin.rpc('merge_wallets', { p_source, p_target })`. The result `{ result, cards_moved, cards_combined }` maps to `MergeCustomerResponse` (`result` = `result`). The totals after merging are summed over the user's `card_balances`.
- **`DELETE /api/customers`** → `admin.rpc('delete_wallet', { p_customer: user.id })`.
- **Turnstile:**
  - `GetCardButton` no longer sends `captchaToken` to `POST /api/customers` (Supabase Auth consumes it).
  - `POST /api/customers` drops its siteverify call and the `captchaToken` field.
  - Enable `[auth.captcha]` in `supabase/config.toml`: `enabled = true`, `provider = "turnstile"`, `secret = "env(TURNSTILE_SECRET_KEY)"`, so local dev matches production.
  - Add a runbook line to `docs/DEPLOYMENT_AND_OPS.md` section 5.1: enable CAPTCHA → Turnstile in the Supabase dashboard under Authentication → Attack Protection.
- **ESLint:** `.eslintrc.json` `rules["no-restricted-syntax"]` gets `{ "selector": "CallExpression[callee.property.name='from'][callee.object.name='admin']", "message": "Service-role reads bypass RLS: read through createSupabaseServerClient() or call an RPC." }`. Fix any remaining violations; they should be none after Tasks 3–6.

- [ ] **Step 1: Write failing tests:**
  - `callback_merges_with_merge_wallets`.
  - `merge_route_maps_merge_wallets_result`.
  - `delete_calls_delete_wallet`.
  - `customers_post_ignores_captcha_token`: no fetch to siteverify.
  - `eslint_bans_admin_from`: run ESLint's `Linter`/`ESLint` API on the snippet `const admin = createSupabaseAdminClient(); admin.from('x');` with the repo config and expect one `no-restricted-syntax` error.
- [ ] **Step 2: Run** the new test file. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the phase6/phase7/phase2 suites.
- [ ] **Step 4: Run** the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(app): wallet merge and deletion, single Turnstile check, ban service-role reads`

### Task 8: Contract migration, legacy test retirement, types, docs

**Files:**
- Create: `supabase/migrations/20261105000000_phase12_contract.sql`, `supabase/tests/database/12_phase12_contract.test.sql`
- Modify:
  - delete `supabase/tests/database/02_*`, `03_*`, `05_*`;
  - rewrite the legacy parts of `01_*` and `04_*`;
  - `lib/contracts.ts` (remove the deprecated `RpcContracts` entries and `ROUTES.cardWithResult` only if no callers remain; keep it if `/t` still uses it for `invalid-tag`);
  - `lib/supabase/database.types.ts` (regenerate);
  - `DECISIONS.md` (D-013), `docs/DEPLOYMENT_AND_OPS.md` section 9, `tests/e2e/loyalty-smoke.spec.ts` (point at `/s/caffeine-plug` / `/wallet`).

**Contract change:** remove the `@deprecated` `RpcContracts` entries (`is_staff`, `record_stamp`, `redeem_reward`, `claim_instagram_upsize`, `merge_anonymous_customer`, `delete_customer_data`).

**Migration, in this order, in one file:**
1. `create or replace function private.backfill_tenant1()` as **insert-only**: `on conflict do nothing` for both inserts. Then `select private.backfill_tenant1();`.
2. Composite FKs `(tenant_id, customer_id) references public.customer_cards (tenant_id, customer_id) on delete cascade` on `stamps`, `redemptions` and `perk_claims`.
3. Drop the triggers `staff_mirror_to_tenant1` and `tenants_single_tenant_guard`, and the functions `private.mirror_staff_to_tenant1()`, `private.guard_single_tenant()`, `private.backfill_tenant1()`.
4. Drop the functions:
   - `public.record_stamp(uuid, text, text, uuid, text, timestamptz)`
   - `public.redeem_reward(uuid, uuid)`, `public.redeem_reward(uuid, uuid, text)`
   - `public.claim_instagram_upsize(uuid, uuid)`
   - `public.merge_anonymous_customer(uuid, uuid)`
   - `public.delete_customer_data(uuid)`
5. Drop the view `public.customer_balances` and the table `public.staff`. Since `is_staff()` reads `staff`, drop `public.is_staff()` first.
6. `alter column tenant_id drop default` on `tags`, `stamps`, `redemptions`, `perk_claims`, `audit_log`.
7. Reclassify platform audit rows: `update public.audit_log set tenant_id = null where action in ('customer_self_deleted', 'stale_anonymous_cleanup', 'merge_anonymous_customer', 'customer_merge_token_used')`.
8. Replace `public.log_audit_event(uuid, text, text, jsonb)`:
   - `drop function` the 4-argument version;
   - create `public.log_audit_event(p_actor uuid, p_action text, p_target text default null, p_detail jsonb default null, p_tenant uuid default null)`, inserting `tenant_id`;
   - grants unchanged (service_role only).
9. `create or replace` `public.cleanup_stale_anonymous_customers` with an unqualified `coalesce` (the same bug fix as the `main` hotfix branch). The candidate filter also excludes users with any `tenant_members` row instead of `staff`.

**pgTAP:**
- `12_phase12_contract.test.sql`:
  - `hasnt_function` for each dropped function;
  - `hasnt_table('public','staff')`;
  - the composite FK rejects a stamp for a `(tenant, customer)` without a card (23503);
  - `log_audit_event` stores `p_tenant`;
  - `col_default_is`/no default on `stamps.tenant_id`;
  - `cleanup_stale_anonymous_customers()` runs (`lives_ok`).
- Delete `02` (covered by `08`), `03` and `05`.
- In `01` and `04`, remove or port the assertions that call dropped objects to the new functions. `04`'s cleanup tests stay.
- In tests `07`–`11`, drop the `app.allow_multi_tenant` opt-ins (the guard is gone), and drop `07`'s legacy-staff fixture lines (the `staff` table is gone).

**Docs:**
- D-013 records the app switch and the contract.
- Runbook section 9 becomes "Multi-tenant operations": adding a shop and staff with SQL until Phase 14's console. Section 4's "insert into staff" becomes an insert into `tenant_members`.

- [ ] **Step 1: Write** `12_phase12_contract.test.sql`. Run `npx supabase db reset && npx supabase test db`. Expected: FAIL (functions still exist).
- [ ] **Step 2: Write** the migration, retire and port the legacy tests, update the opt-ins.
- [ ] **Step 3: Run** `npx supabase db reset && npx supabase test db`. Expected: **every file `ok`, no failures**.
- [ ] **Step 4: Regenerate** types (`npm run db:types`, then `npx prettier --write lib/supabase/database.types.ts`), make the contract change, update docs and e2e. Run the full gate. Expected: pass.
- [ ] **Step 5: Commit** `feat(db): contract migration drops legacy single-shop objects`
