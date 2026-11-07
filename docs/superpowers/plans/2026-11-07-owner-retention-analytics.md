# Owner Retention & Loyalty Card Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an owner-only, mobile-first analytics view at `/staff/[slug]/settings/analytics` showing customer retention, loyalty card funnel health, monthly first-to-second visit cohorts, and the Top 10 loyal customers with resolved names.

**Architecture:** A single Postgres `SECURITY DEFINER` RPC `public.get_owner_analytics(p_actor uuid, p_tenant uuid, p_now timestamptz default null) returns jsonb` verifies that `p_actor` is an active `owner` of `p_tenant` (`private.member_role`), evaluates all retention, card funnel, cohort, and Top 10 customer name queries in the shop's configured timezone (`tenant_settings.timezone`), and returns a structured JSON payload. A server-only loader `loadOwnerAnalytics(actorId, tenantId)` in `lib/analytics/owner.ts` calls the RPC and normalizes the response for the mobile-first Server Component page at `app/staff/[slug]/settings/analytics/page.tsx`, guarded by `enforceConsolePageAccess(slug, 'owner')`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind CSS, Supabase Postgres (`SECURITY DEFINER` RPC), pgTAP, Vitest.

**Spec:** [`docs/superpowers/specs/2026-11-07-owner-retention-analytics-design.md`](file:///g:/Projects/Digital-Loyalty-Card/docs/superpowers/specs/2026-11-07-owner-retention-analytics-design.md)

## Global Constraints

- **SQL:**
  - New expand-only migration `supabase/migrations/20261107030000_owner_retention_analytics.sql`; never edit an applied migration.
  - `SECURITY DEFINER` function uses `set search_path = ''` and schema-qualified names, except SQL constructs `coalesce`, `least`, `greatest`, `nullif` which must stay unqualified.
  - `revoke all on function public.get_owner_analytics(uuid, uuid, timestamptz) from public, anon, authenticated; grant execute on function public.get_owner_analytics(uuid, uuid, timestamptz) to service_role;`.
  - Only `private.member_role(p_actor, p_tenant) = 'owner'` is permitted; `manager`, `staff`, non-members, and `null` actors receive `{"result": "unauthorized"}`.
- **App:**
  - No `admin.from(...)` calls (forbidden by ESLint per D-013); use `admin.rpc('get_owner_analytics', ...)` inside `lib/analytics/owner.ts`.
  - Page `/staff/[slug]/settings/analytics` exports `export const dynamic = 'force-dynamic'` and enforces owner access via `enforceConsolePageAccess(slug, 'owner', ROUTES.staff.analytics(slug))`.
  - Mobile-first single-scroll layout using flat surfaces (`bg-plug-surface`, `border-plug-border`), 1px borders, and high-contrast monochrome/amber/emerald badges.
- **Tests:**
  - TDD: write failing pgTAP / Vitest test first, run to confirm failure, implement minimal code, run to confirm green.

## Review Focus

1. **Same-day multi-stamp does not fake a return visit:** A customer who collects 2 stamps on their first visit day (same calendar date in `tenant_settings.timezone`) and never returns must have `1` distinct visit day, `0%` 14-day/30-day repeat rate, and sit in the `newFirstVisit` bucket rather than `activeRegulars`. → Task 1 pgTAP `same_day_stamps_count_as_single_visit_day`.
2. **Strict owner-only isolation across roles and shops:** A `manager` or `staff` member of Shop A, or an `owner` of Shop B, calling `get_owner_analytics` for Shop A receives `{"result": "unauthorized"}`; visiting `/staff/shop-a/settings/analytics` as a manager redirects to `/staff/login?error=forbidden`. → Task 1 pgTAP `owner_analytics_rejects_manager_staff_and_other_tenant_owner` and Task 3 unit test `analytics_page_blocks_manager_and_staff`.
3. **Customer name resolution hierarchy & privacy:** Top 10 customers resolve `raw_user_meta_data->>'full_name'`, then `'name'`, then `'display_name'`, then non-anonymous email prefix (`split_part(email, '@', 1)`), and fall back to `'Guest (Unbacked)'` for anonymous users without exposing raw email addresses. → Task 1 pgTAP `top_customers_resolves_names_and_masks_anonymous`.
4. **Zero-data shop division-by-zero safety:** A brand-new shop with `0` cards, `0` stamps, and `0` redemptions returns `0` for all counts/percentages, `null` for `medianDaysBetweenVisits` and `medianDaysToReward`, and empty arrays `[]` for `cohorts` and `topCustomers` without SQL division-by-zero errors. → Task 1 pgTAP `empty_shop_returns_zero_safe_analytics` and Task 2 unit test `normalizes_empty_and_null_analytics_payload`.
5. **Retention health buckets partition `totalCards` cleanly:** Every card in `customer_cards` (including a newly added card with `0` stamps) lands in exactly one of `activeRegulars`, `newFirstVisit`, `atRisk`, or `dormant`, so `activeRegulars + newFirstVisit + atRisk + dormant = totalCards`. → Task 1 pgTAP `retention_health_buckets_sum_to_total_cards`.

---

## File Structure

| Area | Create | Modify |
| :--- | :--- | :--- |
| Contracts & Types | — | `lib/contracts.ts`, `lib/supabase/database.types.ts` |
| Database & pgTAP | `supabase/migrations/20261107030000_owner_retention_analytics.sql`, `supabase/tests/database/20_owner_retention_analytics.test.sql` | — |
| Analytics Loader | `lib/analytics/owner.ts`, `tests/unit/owner-analytics.test.ts` | — |
| Owner Console UI | `app/staff/[slug]/settings/analytics/page.tsx`, `components/console/OwnerAnalyticsDashboard.tsx` | `components/console/ConsoleTabNav.tsx`, `app/staff/[slug]/settings/layout.tsx`, `app/staff/page.tsx` |

---

### Task 1: Contracts & Database RPC `public.get_owner_analytics`

**Files:**
- Modify: `lib/contracts.ts`
- Modify: `lib/supabase/database.types.ts`
- Create: `supabase/migrations/20261107030000_owner_retention_analytics.sql`
- Test: `supabase/tests/database/20_owner_retention_analytics.test.sql`

**Interfaces:**
- Produces in `lib/contracts.ts`:
  - `ROUTES.staff.analytics: (slug: string) => \`/staff/\${encodeURIComponent(slug)}/settings/analytics\``
  - `OwnerAnalyticsPulse`, `OwnerAnalyticsRetentionHealth`, `OwnerAnalyticsCardFunnel`, `OwnerAnalyticsCohortRow`, `OwnerAnalyticsTopCustomer`, `OwnerAnalyticsData`
  - `RpcContracts['get_owner_analytics']`
- Produces in SQL:
  - `public.get_owner_analytics(p_actor uuid, p_tenant uuid, p_now timestamptz default null) returns jsonb`

- [ ] **Step 1: Add TypeScript contract types and route helper in `lib/contracts.ts` and `lib/supabase/database.types.ts`**

Add `analytics: (slug: string) => \`/staff/\${encodeURIComponent(slug)}/settings/analytics\`` to `ROUTES.staff` in `lib/contracts.ts`, and export:
```typescript
export interface OwnerAnalyticsPulse {
  totalCards: number;
  activeMembers30d: number;
  newCards30d: number;
  repeatRate30dPct: number;
  repeatRate14dPct: number;
  medianDaysBetweenVisits: number | null;
  rewardsClaimed30d: number;
  rewardsClaimedTotal: number;
  rewardsReadyCount: number;
}

export interface OwnerAnalyticsRetentionHealth {
  activeRegulars: number;
  newFirstVisit: number;
  atRisk: number;
  dormant: number;
}

export interface OwnerAnalyticsCardFunnel {
  rewardThreshold: number;
  rewardLabel: string;
  zeroStampsCount: number;
  earlyProgressCount: number;
  halfwayPlusCount: number;
  rewardReadyCount: number;
  secondCardReturnPct: number;
  medianDaysToReward: number | null;
  backedUpRatePct: number;
}

export interface OwnerAnalyticsCohortRow {
  cohortMonth: string;
  newCustomers: number;
  returned14dPct: number;
  returned30dPct: number;
  returnedEverPct: number;
}

export interface OwnerAnalyticsTopCustomer {
  rank: number;
  customerId: string;
  cardCode: string;
  customerName: string;
  isBackedUp: boolean;
  totalStamps: number;
  availableStamps: number;
  rewardsClaimed: number;
  lastStampedAt: string | null;
}

export interface OwnerAnalyticsData {
  timezone: string;
  pulse: OwnerAnalyticsPulse;
  retentionHealth: OwnerAnalyticsRetentionHealth;
  cardFunnel: OwnerAnalyticsCardFunnel;
  cohorts: OwnerAnalyticsCohortRow[];
  topCustomers: OwnerAnalyticsTopCustomer[];
}
```

- [ ] **Step 2: Write the failing pgTAP test `supabase/tests/database/20_owner_retention_analytics.test.sql`**

Cover the 5 Review Focus items:
1. `owner_analytics_rejects_manager_staff_and_other_tenant_owner`
2. `empty_shop_returns_zero_safe_analytics`
3. `same_day_stamps_count_as_single_visit_day`
4. `retention_health_buckets_sum_to_total_cards`
5. `top_customers_resolves_names_and_masks_anonymous` (verifies Google `full_name`, email fallback, and `'Guest (Unbacked)'`, plus ordering by `total_stamps desc`).

- [ ] **Step 3: Implement `supabase/migrations/20261107030000_owner_retention_analytics.sql`**

Create `public.get_owner_analytics(p_actor uuid, p_tenant uuid, p_now timestamptz default null) returns jsonb` (`language plpgsql`, `stable`, `security definer`, `set search_path = ''`):
- Verify `p_tenant is not null` and `coalesce(private.member_role(p_actor, p_tenant), '') = 'owner'`; else return `jsonb_build_object('result', 'unauthorized')`.
- Load `v_tz`, `v_threshold`, `v_reward_label` from `public.tenant_settings where tenant_id = p_tenant`; if not found return `jsonb_build_object('result', 'not-found')`.
- Compute distinct customer visit dates `(s.created_at at time zone v_tz)::date` per `customer_id` for `p_tenant` so same-day stamps collapse into a single visit day for `repeatRate14dPct`, `repeatRate30dPct`, `medianDaysBetweenVisits`, `retentionHealth`, and `cohorts`.
- Compute `cardFunnel` from `public.card_balances`, `public.redemptions`, and `auth.users`.
- Compute `topCustomers` (`limit 10` where `total_stamps > 0`) joining `public.card_balances` to `auth.users` and `public.redemptions`.
- Revoke all from `public, anon, authenticated`; grant execute to `service_role`.

- [ ] **Step 4: Run database and unit typecheck gates**

Run: `npm run typecheck` (and `npx supabase test db` when local Supabase Docker is running).
Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add lib/contracts.ts lib/supabase/database.types.ts supabase/migrations/20261107030000_owner_retention_analytics.sql supabase/tests/database/20_owner_retention_analytics.test.sql
git commit -m "feat(db): add get_owner_analytics RPC and contracts"
```

---

### Task 2: Server-Only Analytics Loader & Normalizer (`lib/analytics/owner.ts`)

**Files:**
- Create: `lib/analytics/owner.ts`
- Test: `tests/unit/owner-analytics.test.ts`

**Interfaces:**
- Consumes: `createSupabaseAdminClient` from `@/lib/supabase/admin`, `OwnerAnalyticsData` from `@/lib/contracts`
- Produces:
  - `normalizeOwnerAnalytics(raw: unknown, fallbackTimezone?: string): OwnerAnalyticsData | null`
  - `loadOwnerAnalytics(actorId: string, tenantId: string, fallbackTimezone?: string): Promise<OwnerAnalyticsData | null>`

- [ ] **Step 1: Write the failing unit tests in `tests/unit/owner-analytics.test.ts`**

Test cases:
- `returns_null_when_rpc_returns_unauthorized_or_error`
- `normalizes_empty_and_null_analytics_payload` (Review Focus 4: handles missing arrays, null medians, numeric strings)
- `loads_and_maps_complete_owner_analytics_with_top_10_names` (verifies `admin.rpc('get_owner_analytics', { p_actor, p_tenant })` call and full `OwnerAnalyticsData` output including `topCustomers[0].customerName`).

- [ ] **Step 2: Run Vitest to verify it fails**

Run: `npx vitest run tests/unit/owner-analytics.test.ts`
Expected: FAIL with module `@/lib/analytics/owner` not found.

- [ ] **Step 3: Implement `lib/analytics/owner.ts`**

Implement `normalizeOwnerAnalytics` (pure function validating `raw.result === 'ok'` and coercing numbers, nullable medians, `cohorts`, and `topCustomers`) and `loadOwnerAnalytics(actorId, tenantId, fallbackTimezone)` calling `admin.rpc('get_owner_analytics', { p_actor: actorId, p_tenant: tenantId })`.

- [ ] **Step 4: Run Vitest to verify it passes**

Run: `npx vitest run tests/unit/owner-analytics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/analytics/owner.ts tests/unit/owner-analytics.test.ts
git commit -m "feat(analytics): add owner analytics loader and normalizer"
```

---

### Task 3: Mobile-First Owner Analytics UI & Navigation Integration

**Files:**
- Create: `components/console/OwnerAnalyticsDashboard.tsx`
- Create: `app/staff/[slug]/settings/analytics/page.tsx`
- Modify: `components/console/ConsoleTabNav.tsx`
- Modify: `app/staff/[slug]/settings/layout.tsx`
- Modify: `app/staff/page.tsx`
- Modify: `tests/unit/owner-analytics.test.ts`

**Interfaces:**
- Consumes: `loadOwnerAnalytics` from `@/lib/analytics/owner`, `enforceConsolePageAccess` from `@/lib/console/guard`, `formatDateTimeInZone` from `@/lib/rules/display`, `OwnerAnalyticsData` from `@/lib/contracts`.
- Produces:
  - `OwnerAnalyticsDashboard({ data, shopName }: { data: OwnerAnalyticsData; shopName: string })`
  - `OwnerAnalyticsPage({ params }: { params: Promise<{ slug: string }> })` (`dynamic = 'force-dynamic'`)
  - Updated `ConsoleTabNav({ slug, role }: { slug: string; role?: StaffRole })` showing `Analytics` tab when `role === 'owner'`.

- [ ] **Step 1: Extend `tests/unit/owner-analytics.test.ts` with UI, guard, and navigation tests**

Add tests:
- `analytics_page_blocks_manager_and_staff` (Review Focus 2: manager in Shop B gets redirected to `/staff/login?error=forbidden`; owner in Shop A renders `OwnerAnalyticsDashboard`).
- `dashboard_renders_retention_funnel_and_top_10_customer_names` (renders 2×2 pulse metrics, retention health buckets, card funnel bars, cohort rows, and Top 10 customers with resolved names like `Marco Santos` and `Guest (Unbacked)`).
- `console_tab_nav_shows_analytics_tab_for_owner_only` (renders `Analytics` link when `role="owner"`, hides it when `role="manager"` or `role="staff"`).

- [ ] **Step 2: Run Vitest to verify the new tests fail**

Run: `npx vitest run tests/unit/owner-analytics.test.ts`
Expected: FAIL because `OwnerAnalyticsDashboard` and `app/staff/[slug]/settings/analytics/page.tsx` do not exist yet.

- [ ] **Step 3: Implement `OwnerAnalyticsDashboard.tsx`, `app/staff/[slug]/settings/analytics/page.tsx`, and navigation updates**

1. Create `components/console/OwnerAnalyticsDashboard.tsx` implementing the mobile-first Option A layout:
   - 2×2 Headline KPI grid (`grid-cols-2 sm:grid-cols-4 gap-3`): *Repeat Rate (30d)*, *Active Members (30d)*, *Visit Cadence*, *Rewards Claimed*.
   - *Customer Retention Health* card with stacked 4-segment bar (*Active Regulars*, *New (1st Visit)*, *At-Risk (15–30d)*, *Dormant (30d+)*) + 2×2 legend + mobile-friendly *First-to-Second Visit Cohorts* table.
   - *How Your Card Is Doing* card with progress bars (*0 Stamps*, *Early Progress*, *Halfway+*, *Ready to Redeem*) and footer strip (*2nd-Card Return*, *Median Time to Reward*, *Backed-Up Cards*).
   - *Top 10 Loyal Customers* leaderboard displaying rank `#1`–`#10`, `customerName`, `#cardCode`, `Backed Up` badge when `isBackedUp === true`, `rewardsClaimed`, formatted last visit timestamp, and `totalStamps` badge.
2. Create `app/staff/[slug]/settings/analytics/page.tsx` calling `enforceConsolePageAccess(slug, 'owner', ROUTES.staff.analytics(slug))` and `loadOwnerAnalytics(staff.userId, tenantId)`.
3. Update `components/console/ConsoleTabNav.tsx` to accept `role?: StaffRole` and prepend `{ name: 'Analytics', href: \`/staff/\${slug}/settings/analytics\` }` when `role === 'owner'`. Pass `role={staff.role}` from `app/staff/[slug]/settings/layout.tsx`.
4. Update `app/staff/page.tsx` to include an **Owner Analytics & Retention** card in the Shop Management section when `staff.role === 'owner'`.

- [ ] **Step 4: Run full verification suite (`lint`, `typecheck`, `test:unit`)**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: All unit test files pass, zero lint or typecheck errors.

- [ ] **Step 5: Commit**

```bash
git add components/console/OwnerAnalyticsDashboard.tsx app/staff/[slug]/settings/analytics/page.tsx components/console/ConsoleTabNav.tsx app/staff/[slug]/settings/layout.tsx app/staff/page.tsx tests/unit/owner-analytics.test.ts
git commit -m "feat(console): add mobile-first owner analytics and top 10 customers page"
```

