# Phase 13: Wallet and Per-Shop Branding (The Collectible Experience) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the customer loyalty card experience into a multi-shop collectible wallet where each shop's card is dynamically rendered with WCAG AA compliant branding from tenant settings, cards are organized in an interactive wallet stack, per-shop privacy notices are generated, and account backup and erasure operate at their proper tenant/wallet scopes.

**Architecture:**
- **Dynamic Branding & Contrast:** `lib/brand/contrast.ts` and `lib/brand/theme.ts` parse `tenant_settings.brand`, compute relative luminance and WCAG AA contrast (at least 4.5:1 for normal text, 3:1 for large text/card art), and supply safe fallbacks so cards are legible under all café lighting.
- **Wallet Experience (`/wallet`):** Collectible card stack ordered by `last_visit`, real-time card counters, completed cards history (`cardsCompleted`), restored mascot/illustration on empty wallet, and centralized account backup ("Back up all your cards with Google or email").
- **Shop Card (`/s/[slug]`):** Branded card display, add-card moment animation upon joining, timezone-aware "Member Since" formatting (`formatDateTimeInZone`), and clean CTAs (omitting "CLAIM STAMP" when no tag was scanned).
- **Privacy & Compliance (RA 10173):** Dedicated `/s/[slug]/privacy` notice naming the shop as controller and detailing shop retention/rules, linked from the add-card consent screen, while `/privacy` remains the platform wallet notice. Per-shop card removal (`remove_card` via `DELETE /api/cards`) leaves other wallet cards intact; wallet deletion (`delete_wallet` via `DELETE /api/customers`) wipes the global account.
- **Deferred Tech Debt:** Cached `Intl.DateTimeFormat` in `formatDateTimeInZone`, IPv6-safe host parsing in `getTenantSlugForHost`, runtime validation for `merge_wallets` RPC, and dead Turnstile code pruning.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind CSS, Supabase SSR (`@supabase/ssr`), Vitest, pgTAP.

**Spec:**
- `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md`: Section 1 (decisions D1–D4), Section 6 Phase 13 scope, Findings F-05, F-10, F-11.
- `DECISIONS.md`: D-010, D-012, D-013.
- `docs/superpowers/handoff/2026-11-04-phases-13-15-handoff.md`: Phase 13 scope and deferred minors.
- `lib/contracts.ts`: Shared types.

## Global Constraints

- **Contracts:** Additive types are committed in `lib/contracts.ts`. Sub-agents treat `lib/contracts.ts` as fixed.
- **Gate:** Every task leaves `npm run lint && npm run typecheck && npm run test:unit` passing.
- **New test files:** Follow `tests/unit/phase13-<topic>.test.ts`, matching existing mock styles (`vi.mock('server-only', () => ({}))`, mocked `@/lib/supabase/server`, `@/lib/supabase/admin`, `@/lib/security/ratelimit`).
- **Route conventions:**
  - `verifySameOriginRequest(request)` first on state-changing POST/DELETE routes.
  - `ApiResponse<T>` JSON bodies with `ApiErrorCode`s.
  - `checkPublicEndpointRateLimit` keyed by IP and user via `getClientIp(request)`.
  - `Cache-Control: no-store` on authenticated customer pages and token endpoints.
- **Database access:**
  - Service-role admin client (`createSupabaseAdminClient`): `.rpc(...)` calls only.
  - Reads use `createSupabaseServerClient()` (session client; RLS applies) or public tenant readers in `lib/tenants/context.ts`.
- **Tenant source:** Never trust a tenant from the client request body. Stamping reads tags; staff actions read the active membership; customer views resolve from the URL slug.
- **Accessibility & Contrast:** All dynamically styled card text and interactive elements must pass WCAG AA (>= 4.5:1 for body text, >= 3.0:1 for large headings >= 18pt or bold >= 14pt).
- **Commits:** Conventional Commits, no co-author or Claude attribution trailers; never commit `.claude/` or `.superpowers/`.

## Review Focus

1. **WCAG AA Contrast Failure Fallback:** A tenant configures bright yellow primary `#FFFE00` and white accent `#FFFFFF`. The contrast engine detects `< 4.5:1` and automatically clamps text to dark `#0A0A0A` for legibility. → Task 1 test `contrast_engine_falls_back_when_contrast_fails_aa`.
2. **Cross-Shop Card Removal Isolation:** A customer holding cards at Shop A and Shop B calls `DELETE /api/cards` for Shop A (`remove_card`). Shop A's card and stamps are deleted; Shop B's card and stamps remain completely intact in `/wallet`. → Task 5 test `remove_card_preserves_other_shop_cards`.
3. **Wallet Backup Identity Preservation:** An anonymous customer with 3 shop cards connects Google/email at the wallet level. All 3 cards remain present in `/wallet` after authentication. → Task 4 test `wallet_backup_preserves_all_cards`.
4. **Add-Card Consent & Pending Tag Claim Animation:** A customer without a card taps a physical tag (`no-card`). They see the add-card screen with a direct link to `/s/<slug>/privacy`. Submitting adds the card, displays the celebration animation, and claims the pending stamp. → Task 3 tests `add_card_links_to_shop_privacy`, `add_card_triggers_moment_animation`.
5. **Signed-Out & Empty Wallet Handling:** A user visits `/wallet` with no cards and signed out. It renders cleanly with the restored mascot illustration and onboarding copy with zero unhandled exceptions. → Task 4 test `wallet_empty_renders_mascot_and_copy`.

---

### Task 1: Dynamic Branding, WCAG AA Contrast Engine & Formatter Caching

**Files:**
- Create: `lib/brand/contrast.ts`, `tests/unit/phase13-contrast-and-branding.test.ts`
- Modify: `lib/rules/display.ts` (formatter caching)

**Interfaces:**
- Produces in `lib/brand/contrast.ts`:
  - `getLuminance(hexColor: string): number`
  - `getContrastRatio(color1: string, color2: string): number`
  - `resolveCardTheme(brand: TenantBrand): ResolvedCardTheme`
    ```ts
    export interface ResolvedCardTheme {
      primaryColor: string;
      accentColor: string;
      textColor: string;
      subtextColor: string;
      surfaceBg: string;
      cardBorder: string;
      logoUrl: string | null;
      cardArtUrl: string | null;
      tagline: string | null;
      passesAA: boolean;
    }
    ```
    - Checks contrast of `textColor` against `primaryColor` (background). If `< 4.5:1`, overrides `textColor` with `#FFFFFF` or `#0A0A0A` (whichever provides higher contrast).
    - Preserves Tenant #1 (`caffeine-plug`) default palette (`#0A0A0A` primary, `#FFFFFF` accent, `#141414` elevated, `/images/brand/circle-logo-dark.png`).
- Modifies in `lib/rules/display.ts`:
  - Add module-level memoization map `const formatterCache = new Map<string, Intl.DateTimeFormat>()` inside `formatDateTimeInZone` (fixes Deferred Minor #11).

- [ ] **Step 1: Write failing tests** in `tests/unit/phase13-contrast-and-branding.test.ts`:
  - `contrast_ratio_calculates_black_and_white_as_21_to_1`
  - `contrast_engine_falls_back_when_contrast_fails_aa` (yellow `#FFFF00` on white `#FFFFFF` falls back to dark text `#0A0A0A` with ratio >= 4.5:1)
  - `resolve_card_theme_preserves_tenant1_defaults` when brand properties are empty
  - `formatDateTimeInZone_reuses_cached_formatter_instances` (verify memoization produces identical format outputs and doesn't leak memory)
- [ ] **Step 2: Run test to verify failure**
  - Run: `npx vitest run tests/unit/phase13-contrast-and-branding.test.ts`
  - Expected: FAIL (module not found).
- [ ] **Step 3: Implement `lib/brand/contrast.ts` and memoize `formatDateTimeInZone` in `lib/rules/display.ts`**
  - Implement standard sRGB relative luminance calculation ($L = 0.2126 R + 0.7152 G + 0.0722 B$).
  - Calculate contrast ratio $(L_1 + 0.05) / (L_2 + 0.05)$.
  - Implement `resolveCardTheme` with safe fallback logic.
  - Update `formatDateTimeInZone` to read/store in `formatterCache`.
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run tests/unit/phase13-contrast-and-branding.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**
  - `git add lib/brand/contrast.ts lib/rules/display.ts tests/unit/phase13-contrast-and-branding.test.ts`
  - `git commit -m "feat(brand): add WCAG AA contrast engine and cache date formatters"`

---

### Task 2: Robustness Fixes: IPv6 Host Parsing, Merge Validation & Turnstile Dead Code Cleanup

**Files:**
- Modify: `lib/tenants/context.ts` (IPv6 host parsing)
- Modify: `app/api/customers/merge/route.ts` (validate `merge_wallets` response with `isMergeWalletsOutcome`)
- Modify/Remove: `lib/security/turnstile.ts` (prune unused exports / dead code; fixes Deferred Minor #7)
- Test: `tests/unit/phase13-robustness-fixes.test.ts`

**Interfaces:**
- In `lib/tenants/context.ts`:
  - Update `getTenantSlugForHost(host: string | null): Promise<string | null>` to strip bracketed IPv6 port safely (e.g., `[::1]:3000` -> `[::1]`, `127.0.0.1:3000` -> `127.0.0.1`, `example.com:443` -> `example.com`) using URL host parsing instead of naive `host.split(':')[0]` (fixes Deferred Minor #10).
- In `app/api/customers/merge/route.ts`:
  - Validate `rpcResult` with `isMergeWalletsOutcome` instead of unchecked type cast (fixes Deferred Minor #8).
- In `lib/security/turnstile.ts`:
  - Remove dead `verifyTurnstileToken` and `TurnstileVerificationResult` exports, keeping file minimal or cleanly removing references.

- [ ] **Step 1: Write failing tests** in `tests/unit/phase13-robustness-fixes.test.ts`:
  - `getTenantSlugForHost_parses_ipv6_host_correctly` (`[::1]:3000` does not mangle host to `[`)
  - `getTenantSlugForHost_parses_standard_host_with_port` (`card.thecaffeineplug.ph:443` -> `card.thecaffeineplug.ph`)
  - `merge_route_validates_rpc_outcome_runtime_shape` (rejects malformed RPC JSON response with `internal_error`)
  - `turnstile_file_contains_no_unused_verify_function`
- [ ] **Step 2: Run test to verify failure**
  - Run: `npx vitest run tests/unit/phase13-robustness-fixes.test.ts`
  - Expected: FAIL
- [ ] **Step 3: Implement fixes in `lib/tenants/context.ts`, `app/api/customers/merge/route.ts`, and prune `lib/security/turnstile.ts`**
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run tests/unit/phase13-robustness-fixes.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**
  - `git add lib/tenants/context.ts app/api/customers/merge/route.ts lib/security/turnstile.ts tests/unit/phase13-robustness-fixes.test.ts`
  - `git commit -m "fix(security): resolve IPv6 host mangling, validate merge outcome, and prune dead turnstile helper"`

---

### Task 3: Shop Card Dynamic Branding, Timezone Display & Add-Card Moment Animation

**Files:**
- Modify: `app/s/[slug]/page.tsx`
- Modify: `components/card/AddCardPanel.tsx`
- Modify: `components/card/OnboardingCard.tsx`
- Test: `tests/unit/phase13-shop-branding-and-animation.test.ts`

**Interfaces:**
- `app/s/[slug]/page.tsx`:
  - Dynamically injects `ResolvedCardTheme` inline styles (background, border, text color, accent highlights).
  - Formats "Member Since" using `formatDateTimeInZone(cardState.createdAt, tenant.settings.timezone)` instead of `formatManilaDateTime` (fixes Deferred Minor #1).
  - When customer is signed out and no `t` (tagId) parameter is present, CTA copy displays `"GET MY CARD"` rather than `"GET MY CARD & CLAIM STAMP"` (fixes Deferred Minor #2).
- `components/card/AddCardPanel.tsx`:
  - Links to `/s/${tenantSlug}/privacy` (Shop Privacy Notice) right next to consent copy.
  - When card addition succeeds with pending stamp or direct add, redirects with `?added=1` to trigger celebration.
- `app/s/[slug]/page.tsx`:
  - Detects `?added=1` searchParam and renders an animated "Card added to your wallet!" micro-interaction badge (slide-in / pulse / auto-dismiss).

- [ ] **Step 1: Write failing tests** in `tests/unit/phase13-shop-branding-and-animation.test.ts`:
  - `shop_card_applies_dynamic_theme_colors_from_tenant_settings`
  - `shop_card_formats_member_since_in_tenant_timezone` (e.g. `America/New_York` shows correct local date)
  - `signed_out_shop_page_without_tag_omits_claim_stamp_copy`
  - `add_card_panel_links_to_tenant_privacy_notice`
  - `add_card_triggers_moment_animation` (renders animation wrapper when `?added=1` is present)
- [ ] **Step 2: Run test to verify failure**
  - Run: `npx vitest run tests/unit/phase13-shop-branding-and-animation.test.ts`
  - Expected: FAIL
- [ ] **Step 3: Implement dynamic theme application, timezone formatting, CTA conditional copy, and add-card animation**
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run tests/unit/phase13-shop-branding-and-animation.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**
  - `git add app/s/[slug]/page.tsx components/card/AddCardPanel.tsx components/card/OnboardingCard.tsx tests/unit/phase13-shop-branding-and-animation.test.ts`
  - `git commit -m "feat(ui): dynamic shop card branding, timezone formatting, and add-card celebration moment"`

---

### Task 4: Collectible `/wallet` Stack, Card Counters, Empty State Mascot & Wallet-Level Backup

**Files:**
- Modify: `app/wallet/page.tsx`
- Modify: `lib/auth/customer.ts` (`listWalletCards` computes `cardsCompleted`)
- Create: `components/wallet/WalletCardStack.tsx`
- Create: `components/wallet/WalletBackupModal.tsx`
- Test: `tests/unit/phase13-wallet-stack.test.ts`

**Interfaces:**
- `lib/auth/customer.ts`:
  - In `listWalletCards()`, populate `cardsCompleted: calculateCardsCompleted(balance?.total_stamps ?? 0, tenant.tenant_settings.reward_threshold)` on each `WalletCardSummary`.
- `components/wallet/WalletCardStack.tsx`:
  - Renders cards as a layered stack with interactive cards sorted by most recent activity.
  - Displays "Cards collected: N" counter badge.
  - Displays each card's available stamps, reward label, and completed cards count (`cardsCompleted`).
  - Card cards render their own shop-branded preview (primary color background, accent borders).
- `app/wallet/page.tsx`:
  - Integrates `WalletCardStack`.
  - Empty state (`cards.length === 0` or signed out): Restores mascot illustration `/images/brand/kaws-standing-clean.png` (fixes Deferred Minor #5) alongside friendly zero-state copy.
  - Integrates wallet-level backup prompt ("Back up all your cards with Google or Email") via `BackupCardPanel` or `WalletBackupModal`.

- [ ] **Step 1: Write failing tests** in `tests/unit/phase13-wallet-stack.test.ts`:
  - `list_wallet_cards_populates_cards_completed`
  - `wallet_stack_renders_distinct_shop_branding_for_multiple_cards` (Customer with Shop A, Shop B, Shop C sees 3 distinct cards)
  - `wallet_stack_shows_cards_collected_count`
  - `wallet_empty_renders_mascot_and_copy` (Empty wallet displays mascot and zero-state guidance)
  - `wallet_backup_preserves_all_cards` (Wallet-level backup prompt triggers account linking for full wallet)
- [ ] **Step 2: Run test to verify failure**
  - Run: `npx vitest run tests/unit/phase13-wallet-stack.test.ts`
  - Expected: FAIL
- [ ] **Step 3: Implement `WalletCardStack`, empty-state mascot restoration, and wallet-level backup integration**
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run tests/unit/phase13-wallet-stack.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**
  - `git add app/wallet/page.tsx lib/auth/customer.ts components/wallet/WalletCardStack.tsx components/wallet/WalletBackupModal.tsx tests/unit/phase13-wallet-stack.test.ts`
  - `git commit -m "feat(wallet): collectible card stack, completed card counts, empty state mascot, and wallet backup"`

---

### Task 5: Per-Shop Privacy Notice (`/s/[slug]/privacy`) & Scoped Data Rights

**Files:**
- Create: `app/s/[slug]/privacy/page.tsx`
- Modify: `app/privacy/page.tsx` (generic platform notice)
- Modify: `components/card/DeleteCardButton.tsx` (verify per-shop `DELETE /api/cards` vs global `DELETE /api/customers`)
- Test: `tests/unit/phase13-privacy-notices.test.ts`

**Interfaces:**
- `app/s/[slug]/privacy/page.tsx`:
  - Server Component reading `getTenantBySlug(slug)`.
  - Displays shop name as Data Controller, shop retention policy (30-day stale policy), reward rules, and Data Subject Rights under Philippine RA 10173.
  - Includes "Remove this card from my wallet" CTA invoking `DELETE /api/cards` with `{ tenantSlug }` (calls `remove_card` RPC).
  - Back button links directly back to `/s/[slug]`.
- `app/privacy/page.tsx`:
  - Functions as the **Platform Privacy Notice**: describes platform operator role, wallet identity, cross-shop isolation, and Singapore database hosting (`ap-southeast-1`).
  - Includes "Delete my entire wallet & account" CTA invoking `DELETE /api/customers` (calls `delete_wallet` RPC).
- `DeleteCardButton.tsx`:
  - `scope="shop"` triggers per-shop card deletion (`DELETE /api/cards`).
  - `scope="wallet"` triggers full account erasure (`DELETE /api/customers`).

- [ ] **Step 1: Write failing tests** in `tests/unit/phase13-privacy-notices.test.ts`:
  - `shop_privacy_page_displays_tenant_name_and_rules`
  - `shop_privacy_page_returns_404_when_slug_invalid`
  - `remove_card_preserves_other_shop_cards` (Deleting Shop A card removes Shop A rows while Shop B rows remain untouched)
  - `platform_privacy_page_describes_platform_controller_and_wallet_scope`
- [ ] **Step 2: Run test to verify failure**
  - Run: `npx vitest run tests/unit/phase13-privacy-notices.test.ts`
  - Expected: FAIL
- [ ] **Step 3: Implement `app/s/[slug]/privacy/page.tsx`, update `app/privacy/page.tsx`, and verify `DeleteCardButton`**
- [ ] **Step 4: Run test to verify it passes**
  - Run: `npx vitest run tests/unit/phase13-privacy-notices.test.ts`
  - Expected: PASS
- [ ] **Step 5: Commit**
  - `git add app/s/[slug]/privacy/page.tsx app/privacy/page.tsx components/card/DeleteCardButton.tsx tests/unit/phase13-privacy-notices.test.ts`
  - `git commit -m "feat(privacy): add per-shop privacy notice and decouple shop card removal from wallet erasure"`

---

### Task 6: Full Phase 13 Test Suite, Accessibility Audit & Gate Verification

**Files:**
- Create: `tests/unit/phase13-integration-gate.test.ts`
- Run: Full gate commands (`npm run lint && npm run typecheck && npm run test:unit`)

**Interfaces:**
- `tests/unit/phase13-integration-gate.test.ts`:
  - Tests 3 distinct mock shops with contrasting brand palettes (e.g. monochrome, vibrant pastel, dark neon), verifying WCAG AA compliance across all.
  - Verifies all 5 Review Focus items:
    1. `contrast_engine_falls_back_when_contrast_fails_aa`
    2. `remove_card_preserves_other_shop_cards`
    3. `wallet_backup_preserves_all_cards`
    4. `add_card_links_to_shop_privacy`
    5. `wallet_empty_renders_mascot_and_copy`

- [ ] **Step 1: Write integration tests** in `tests/unit/phase13-integration-gate.test.ts`
- [ ] **Step 2: Run test suite**
  - Run: `npx vitest run tests/unit/phase13-integration-gate.test.ts`
  - Expected: PASS
- [ ] **Step 3: Run full gate checks**
  - Run: `npm run lint`
  - Run: `npm run typecheck`
  - Run: `npm run test:unit`
  - Expected: All pass with 0 errors.
- [ ] **Step 4: Commit**
  - `git add tests/unit/phase13-integration-gate.test.ts`
  - `git commit -m "test(phase13): add whole-phase integration test suite and accessibility verification"`

