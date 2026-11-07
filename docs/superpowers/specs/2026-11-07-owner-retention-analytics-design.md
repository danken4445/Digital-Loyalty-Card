# Owner Retention & Loyalty Card Analytics — Design Specification

- **Date:** 2026-11-07
- **Status:** Draft for Owner Review
- **Audience:** Shop Owners (`role = 'owner'`)
- **Surface:** `/staff/[slug]/settings/analytics` (plus Owner shortcut card on `/staff`)

---

## 1. Intent & Why

Shop owners need a fast, mobile-first screen to answer two core business questions without writing SQL or exporting spreadsheets:
1. **Customer Retention:** Are first-time customers coming back on another day, how often do regulars visit, and how many members are active vs. slipping away?
2. **How the Loyalty Card Is Doing:** How are customers progressing toward their reward, are they returning for a second card after redeeming, how many cards are backed up, and who are the **Top 10 most loyal customers** by name?

This view is strictly **owner-only** (`role = 'owner'`). Managers and counter baristas cannot access it.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Zero-schema-change ledger analytics:** Compute all retention, card funnel, cohort, and Top 10 customer metrics directly from existing tables (`customer_cards`, `stamps`, `redemptions`, `tenant_settings`, and `auth.users`) in the shop's configured timezone (`tenant_settings.timezone`).
- **Strict Owner-Only Authorization:** Enforce `role = 'owner'` both in the Next.js Server Component guard (`enforceConsolePageAccess(slug, 'owner')`) and inside the Postgres `SECURITY DEFINER` RPC (`private.member_role(p_actor, p_tenant) = 'owner'`).
- **Mobile-First Single-Scroll UI ("Owner Pulse"):** Present a thumb-friendly vertical feed designed for 375px–430px phone screens first, scaling cleanly to desktop (`max-w-5xl`).
- **Top 10 Customers with Name Resolution:** Display the shop's Top 10 customers by lifetime stamps, showing their resolved name from `auth.users` (Google full name / display name / email handle, or `Guest (Unbacked)` for anonymous sessions), short card code (`#XXXXXXXX`), lifetime stamps, rewards claimed, and last visit timestamp.
- **Distinct Visit-Day Accuracy:** Count retention return visits across **distinct calendar dates** in the shop's timezone (`(created_at at time zone timezone)::date`) so a customer collecting 2 stamps on their first day is not miscounted as returning on a second visit.

### Non-Goals
- No new database tables or columns on `stamps`, `redemptions`, or `customer_cards` (only a new read-only `SECURITY DEFINER` RPC migration).
- No chart libraries or heavy client-side JS bundles (pure server-rendered Tailwind CSS bars, badges, and tables).
- No customer email addresses or raw phone numbers exposed in the UI (names and `#XXXXXXXX` card codes only, preserving RA 10173 data minimization).

### Anti-Goals (Failure Modes to Avoid)
- Letting a `manager` or `staff` barista view `/staff/[slug]/settings/analytics` or call the analytics RPC.
- Allowing an owner of Shop A to view Shop B's analytics by changing `[slug]` in the URL.
- Counting two same-day stamps as a "repeat visit" in 14-day/30-day retention or visit cadence calculations.
- Using `admin.from(...)` in Next.js application code (violates D-013 ESLint rule; all service-role access must go through `.rpc(...)`).

---

## 3. Architecture & Data Contract

### 3.1 Database RPC (`public.get_owner_analytics`)
New migration: `supabase/migrations/20261107030000_owner_retention_analytics.sql`

Signature:
```sql
public.get_owner_analytics(
  p_actor uuid,
  p_tenant uuid,
  p_now timestamptz default null
) returns jsonb
```
- `SECURITY DEFINER`, `set search_path = ''`, executable only by `service_role`.
- **Authorization check:** Verifies `coalesce(private.member_role(p_actor, p_tenant), '') = 'owner'`. Otherwise returns `{"result": "unauthorized"}`.
- **Tenant & timezone lookup:** Reads `timezone`, `reward_threshold`, and `reward_label` from `public.tenant_settings` for `p_tenant`. Returns `{"result": "not-found"}` if the tenant does not exist.
- **Effective clock:** `v_now := coalesce(p_now, pg_catalog.clock_timestamp())`.

#### Returned JSON Payload (`result = 'ok'`):
1. **`pulse`:**
   - `totalCards` (`integer`): Total `customer_cards` in the shop.
   - `activeMembers30d` (`integer`): Distinct `customer_id` with $\ge 1$ stamp in the last 30 days (`created_at >= v_now - interval '30 days'`).
   - `newCards30d` (`integer`): Cards added in the last 30 days (`added_at >= v_now - interval '30 days'`).
   - `repeatRate30dPct` (`numeric`): Percentage (`0`–`100`, 1 decimal) of stamped customers whose 2nd distinct visit date occurred within 30 days of their 1st visit date.
   - `repeatRate14dPct` (`numeric`): Percentage (`0`–`100`, 1 decimal) of stamped customers whose 2nd distinct visit date occurred within 14 days of their 1st visit date.
   - `medianDaysBetweenVisits` (`numeric | null`): Median (`percentile_cont(0.5)`) days between consecutive distinct visit dates per customer in shop timezone (`null` if no customer has $\ge 2$ visit days).
   - `rewardsClaimed30d` (`integer`): Redemptions in the last 30 days.
   - `rewardsClaimedTotal` (`integer`): Lifetime redemptions for the shop.
   - `rewardsReadyCount` (`integer`): Cards currently holding `available_stamps >= reward_threshold`.

2. **`retentionHealth`** (partitions all `totalCards` into 4 mutually exclusive buckets based on `last_activity = coalesce(last_stamped_at, added_at)` and distinct visit days):
   - `activeRegulars` (`integer`): $\ge 2$ distinct visit days AND `last_stamped_at >= v_now - interval '14 days'`.
   - `newFirstVisit` (`integer`): $\le 1$ distinct visit day AND `last_activity >= v_now - interval '14 days'`.
   - `atRisk` (`integer`): `last_activity < v_now - interval '14 days'` AND `last_activity >= v_now - interval '30 days'`.
   - `dormant` (`integer`): `last_activity < v_now - interval '30 days'`.

3. **`cardFunnel`:**
   - `rewardThreshold` (`integer`)
   - `rewardLabel` (`text`)
   - `zeroStampsCount` (`integer`): Cards with `available_stamps = 0`.
   - `earlyProgressCount` (`integer`): Cards with `1 <= available_stamps < ceil(reward_threshold / 2.0)`.
   - `halfwayPlusCount` (`integer`): Cards with `ceil(reward_threshold / 2.0) <= available_stamps < reward_threshold`.
   - `rewardReadyCount` (`integer`): Cards with `available_stamps >= reward_threshold`.
   - `secondCardReturnPct` (`numeric`): Percentage (`0`–`100`, 1 decimal) of redeemers who earned $\ge 1$ stamp after their first redemption (`stamps.created_at > first_redemption_at`).
   - `medianDaysToReward` (`numeric | null`): Median days from a customer's first stamp to their first redemption (`null` if 0 redemptions).
   - `backedUpRatePct` (`numeric`): Percentage (`0`–`100`, 1 decimal) of shop cardholders whose `auth.users.is_anonymous` is `false`.

4. **`cohorts`** (up to 6 most recent acquisition months in shop timezone, newest first):
   - `cohortMonth` (`text`, e.g. `'2026-11'`)
   - `newCustomers` (`integer`: customers whose 1st stamp fell in that month)
   - `returned14dPct` (`numeric`)
   - `returned30dPct` (`numeric`)
   - `returnedEverPct` (`numeric`)

5. **`topCustomers`** (top 10 cardholders with `total_stamps > 0`, ordered by `total_stamps desc, rewards_claimed desc, last_stamped_at desc nulls last, customer_id asc`):
   - `rank` (`integer`, `1..10`)
   - `customerId` (`text`)
   - `cardCode` (`text`: `upper(left(customer_id::text, 8))`)
   - `customerName` (`text`): Resolved in SQL from `auth.users`:
     1. `nullif(btrim(u.raw_user_meta_data->>'full_name'), '')`
     2. `nullif(btrim(u.raw_user_meta_data->>'name'), '')`
     3. `nullif(btrim(u.raw_user_meta_data->>'display_name'), '')`
     4. If `not coalesce(u.is_anonymous, true)` and `u.email is not null`: `nullif(btrim(split_part(u.email, '@', 1)), '')`
     5. Fallback: `'Guest (Unbacked)'`
   - `isBackedUp` (`boolean`: `not coalesce(u.is_anonymous, true)`)
   - `totalStamps` (`integer`)
   - `availableStamps` (`integer`)
   - `rewardsClaimed` (`integer`)
   - `lastStampedAt` (`text | null`: ISO timestamp)

---

## 4. UI & Navigation Layout (Mobile-First Option A)

1. **Navigation Entry Points:**
   - [`ConsoleTabNav.tsx`](file:///g:/Projects/Digital-Loyalty-Card/components/console/ConsoleTabNav.tsx): Accepts optional `role?: StaffRole` (passed from [`app/staff/[slug]/settings/layout.tsx`](file:///g:/Projects/Digital-Loyalty-Card/app/staff/%5Bslug%5D/settings/layout.tsx)). When `role === 'owner'`, renders the **`Analytics`** tab pointing to `/staff/${slug}/settings/analytics`.
   - [`app/staff/page.tsx`](file:///g:/Projects/Digital-Loyalty-Card/app/staff/page.tsx): When `staff.role === 'owner'`, renders an **Owner Analytics & Retention** card in the Shop Management grid linking to `/staff/${staff.tenantSlug}/settings/analytics`.

2. **Mobile-First Single-Scroll Page (`/staff/[slug]/settings/analytics`):**
   - **Section 1 — 2×2 Headline Pulse Grid (`grid-cols-2 sm:grid-cols-4`):**
     - *Repeat Rate (30d)* (`repeatRate30dPct%`, subtext: `${repeatRate14dPct}% within 14d`)
     - *Active Members (30d)* (`activeMembers30d`, subtext: `+${newCards30d} new cards (30d)`)
     - *Visit Cadence* (`${medianDaysBetweenVisits} days` or `—`, subtext: `Median between visits`)
     - *Rewards Claimed* (`rewardsClaimedTotal`, subtext: `${rewardsReadyCount} ready in wallets`)
   - **Section 2 — Customer Retention Health:**
     - Stacked horizontal progress bar + 2×2 legend showing counts for *Active Regulars*, *New (1st Visit)*, *At-Risk (15–30d)*, and *Dormant (30d+)*, plus the compact Monthly First-to-Second Visit Cohort table (`Month`, `New`, `≤14d`, `≤30d`, `Ever`).
   - **Section 3 — How Your Loyalty Card Is Doing:**
     - Horizontal progress bars for *0 Stamps (Enrolled)*, *Early Progress (`1..halfway-1`)*, *Halfway+ (`halfway..threshold-1`)*, and *Ready to Redeem (`threshold+`)*.
     - Footer strip with 3 key card health indicators: *2nd-Card Return After Redeem (`secondCardReturnPct%`)*, *Median Time to Reward (`medianDaysToReward` days)*, and *Backed-Up Cards (`backedUpRatePct%`)*.
   - **Section 4 — Top 10 Loyal Customers Leaderboard:**
     - Mobile-first stacked cards (with rank badge `#1`–`#10`, **Customer Name**, `#XXXXXXXX` card code, `Backed Up` pill if linked, rewards claimed count, formatted last visit date in shop timezone, and total lifetime stamps pill).
     - Graceful empty state when no customers have earned stamps yet.

