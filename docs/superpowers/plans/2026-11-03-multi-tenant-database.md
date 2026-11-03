# Multi-Tenant Database (Phases 10–11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Supabase database multi-tenant (shops, per-shop settings, staff memberships, wallet cards, tenant-scoped RLS and tenant-aware SQL functions) while the current single-shop app keeps working unchanged.

**Architecture:**
- **Shared schema with `tenant_id` on every business table.** Phase 10 is expand-only: new tables, plus new columns that default to Caffeine Plug (tenant #1), so the deployed app and the legacy functions keep working.
- **New functions alongside the legacy ones.** Phase 11 adds tenant-aware SECURITY DEFINER functions under **new names** and rewrites RLS to use staff memberships.
- **Tenant comes from the database, never the caller.** NFC stamps take the tenant from `tags.tenant_id`. Staff actions check the acting user's membership.
- **The app is not touched here.** Switching it over, plus removing legacy objects, is the Phase 12 plan.

**Tech Stack:** Supabase Postgres 15, plpgsql, RLS, pgTAP (`supabase test db`), Supabase CLI migrations.

**Spec:** `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md` — section 1 "Owner decisions" (D1–D4), section 6 "Target data model", Phase 10, Phase 11, and findings F-01–F-06, F-10, F-17, F-18.

## Global Constraints

- **Function boilerplate:** every new function is `security definer`, `set search_path = ''`, and uses fully qualified names (`public.`, `pg_catalog.`, `private.`). Each is followed by `revoke all on function … from public, anon, authenticated;` and `grant execute … to service_role;`. The exception is the `private.*` RLS helpers in Task 3, which `authenticated` must be able to execute.
- **Advisory locks:** always the one-argument form `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(<key text>, <ns>))`.
  - Namespaces: `1002` = tag, `1001` = customer.
  - Order: tag before customer. Two customers are locked in `least`/`greatest` UUID-text order (D-005, D-009).
- **New names, not overloads.** Legacy functions have defaulted parameters, so an overload such as `record_stamp(uuid, text)` would make calls ambiguous ("function is not unique" in SQL, "could not choose the best candidate" in PostgREST).
- **Production keeps working.** No legacy table, column, function or view is dropped or changes behaviour, with exactly two exceptions:
  - Task 7 drops `public.redeem_reward(uuid, uuid)` (F-18).
  - Task 7 fixes the lock form inside `public.delete_customer_data` (F-17).
- **Tenant #1:**

  | Field | Value |
  |---|---|
  | `id` | `7c1f0000-0000-4000-8000-000000000001` |
  | `slug` | `caffeine-plug` |
  | `name` | `The Caffeine Plug` |
  | `status` | `active` |
  | `cooldown_minutes` | 30 |
  | `daily_cap` | 2 |
  | `reward_threshold` | 10 |
  | `tag_throttle_seconds` | 5 |
  | `timezone` | `Asia/Manila` |
  | `currency` | `PHP` |
  | `reward_label` | `FREE COFFEE` |
  | `perks` | `{"instagram_follow_upsize": {"label": "Free upsize on any drink", "handle": "@thecaffeineplug8400"}}` |
  | Domain alias | `card.thecaffeineplug.ph` |

- **Settings bounds (CHECK constraints):**
  - `cooldown_minutes` 0–1440
  - `daily_cap` 1–20
  - `reward_threshold` 3–50
  - `tag_throttle_seconds` 0–60
  - `currency` `^[A-Z]{3}$`
  - `reward_label` 1–40 chars
  - `timezone` must exist in `pg_catalog.pg_timezone_names`
- **Slug format:** `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`.
- **Status semantics:**
  - `add_card` and stamping need `trial` or `active`.
  - Redeeming and perk claims need `trial`, `active` or `suspended`.
  - `closed` blocks everything (`tenant-unavailable`).
- **Roles:** `owner`, `manager`, `staff`. Tag management needs `owner` or `manager`. Stamping and redeeming need any active role.
- **pgTAP files:** new files `06`–`11` in `supabase/tests/database/`, following the existing shape:
  - `begin;`
  - `create extension if not exists pgtap with schema extensions;`
  - `select plan(N);`
  - fixtures inserted inside the file (never depend on `seed.sql`)
  - `select * from finish(); rollback;`
  - Impersonate users with `set local role authenticated` plus `set local "request.jwt.claims" = '{"sub":"…","role":"authenticated"}'` (see `01_rls_and_functions.test.sql:377-380`).
- **Commits:** Conventional Commits; no co-author trailers; never commit `.claude/` files.

## Review Focus

1. **Cooldown is per shop.** A customer with cards at shop A and shop B who stamps at A, then taps B 5 minutes later, gets `stamped` at B. → Task 4, test `cooldown_is_per_tenant`.
2. **Daily cap follows the shop's timezone.** A shop with timezone `Asia/Tokyo` resets its cap at Tokyo midnight, not Manila midnight. → Task 4, test `daily_cap_uses_tenant_timezone`.
3. **Threshold changes are safe.** An owner changes `reward_threshold` from 10 to 8 while a customer holds 9 stamps: redemption succeeds, uses 8 stamps and leaves 1, and the balance never goes negative. → Task 5, test `redeem_uses_current_threshold`.
4. **Dual-shop staff can't cross shops.** A person on staff at both A and B, acting for A, can't stamp or redeem a customer who holds only a B card: the result is `no-card`, and no row is written at B. → Task 5, test `dual_member_cannot_cross_tenants`.
5. **Same-shop merge combines cards.** Two wallets both hold a shop-A card and both claimed the Instagram perk; after merging, the target has one A card, summed stamps, and exactly one perk claim. → Task 7, test `merge_combines_same_tenant_cards`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261104000000_phase10_tenant_foundation.sql` | `private` schema, `tenants`, `tenant_settings`, `tenant_members`, `tenant_domains`, `customer_cards`, tenant #1 rows, settings validation |
| `supabase/migrations/20261104010000_phase10_tenant_columns_backfill.sql` | `tenant_id` on legacy tables, backfill of cards and memberships, `staff` → `tenant_members` mirror trigger, tenant-leading indexes, `perk_claims` unique key change |
| `supabase/migrations/20261104020000_phase11_tenant_rls.sql` | `private.staff_tenant_ids()`, `private.member_role()`, rewritten SELECT policies, `card_balances` view |
| `supabase/migrations/20261104030000_phase11_card_stamping.sql` | `add_card`, `stamp_card_nfc` |
| `supabase/migrations/20261104040000_phase11_staff_card_actions.sql` | `stamp_card_manual`, `redeem_card_reward`, `claim_card_perk` |
| `supabase/migrations/20261104050000_phase11_tag_management.sql` | `create_tag`, `rotate_tag`, `deactivate_tag` |
| `supabase/migrations/20261104060000_phase11_wallet_lifecycle.sql` | `remove_card`, `delete_wallet`, `merge_wallets`; F-17 and F-18 fixes |
| `supabase/tests/database/06_tenant_foundation.test.sql` | Tasks 1–2 |
| `supabase/tests/database/07_tenant_isolation.test.sql` | Task 3 |
| `supabase/tests/database/08_card_stamping.test.sql` | Task 4 |
| `supabase/tests/database/09_staff_card_actions.test.sql` | Task 5 |
| `supabase/tests/database/10_tag_management.test.sql` | Task 6 |
| `supabase/tests/database/11_wallet_lifecycle.test.sql` | Task 7 |
| `supabase/seed.sql`, `lib/supabase/database.types.ts`, `DECISIONS.md`, `docs/DEPLOYMENT_AND_OPS.md` | Task 8 |

**Shared pgTAP fixture IDs** (used in files 07–11 so tests read alike):
- Tenant A = tenant #1 (`7c1f…0001`).
- Tenant B = `7c1f0000-0000-4000-8000-00000000000b`, slug `bean-there`, timezone `Asia/Tokyo`, `reward_threshold` 8, `cooldown_minutes` 60, `daily_cap` 1.
- Tags: `tag_tenant_a_0001` (A) and `tag_tenant_b_0001` (B).
- Users (all inserted into `auth.users` by the test):
  - `staffA` `5a000000-0000-4000-8000-00000000000a`
  - `staffB` `5b000000-0000-4000-8000-00000000000b`
  - `dualStaff` `5d000000-0000-4000-8000-00000000000d` (member of A and B)
  - `managerA` `5e000000-0000-4000-8000-00000000000a`
  - `custA` `ca000000-0000-4000-8000-00000000000a` (card at A only)
  - `custB` `cb000000-0000-4000-8000-00000000000b` (card at B only)
  - `custAB` `cc000000-0000-4000-8000-0000000000ab` (cards at both)

---

## Phase 10: Tenant foundation

### Task 1: Tenant tables and tenant #1

**Files:**
- Create: `supabase/migrations/20261104000000_phase10_tenant_foundation.sql`
- Test: `supabase/tests/database/06_tenant_foundation.test.sql` (first half)

**Interfaces:**
- Produces these tables:
  - `public.tenants(id uuid pk default gen_random_uuid(), slug text unique not null, name text not null check 1–80 chars, status text not null default 'trial' check in ('trial','active','suspended','closed'), created_at timestamptz)`
  - `public.tenant_settings(tenant_id uuid pk references tenants on delete cascade, cooldown_minutes int, daily_cap int, reward_threshold int, tag_throttle_seconds int, timezone text, currency text, reward_label text, brand jsonb not null default '{}', perks jsonb not null default '{}', updated_at timestamptz)`
  - `public.tenant_members(tenant_id uuid references tenants on delete cascade, user_id uuid references auth.users on delete cascade, role text check in ('owner','manager','staff'), display_name text not null check 1–120 chars, active boolean default true, created_at, primary key (tenant_id, user_id))`
  - `public.tenant_domains(host text pk check lowercase, tenant_id uuid not null references tenants on delete cascade)`
  - `public.customer_cards(tenant_id uuid references tenants on delete cascade, customer_id uuid references public.customers on delete cascade, added_at timestamptz default now(), consent_version text not null default 'v1', primary key (tenant_id, customer_id))`, plus index `(customer_id)`
- Produces schema `private`: no grants to `anon`; `usage` granted to `authenticated` and `service_role`.

- [ ] **Step 1: Write the failing tests** in `06_tenant_foundation.test.sql`:
  - `has_table('public','tenants')` and the same for `tenant_settings`, `tenant_members`, `tenant_domains`, `customer_cards`.
  - `is((select slug from public.tenants where id = '7c1f0000-0000-4000-8000-000000000001'), 'caffeine-plug', …)`.
  - `results_eq` on tenant #1 settings: `(30, 2, 10, 5, 'Asia/Manila', 'PHP', 'FREE COFFEE')`.
  - `is((select tenant_id from public.tenant_domains where host = 'card.thecaffeineplug.ph'), '7c1f…0001'::uuid, …)`.
  - `throws_ok` on update to `timezone = 'Mars/Olympus'` (error raised by the validation trigger).
  - `throws_ok` on `reward_threshold = 2`, `daily_cap = 0`, `cooldown_minutes = 1441` (check violations, SQLSTATE `23514`).
  - `throws_ok` on inserting slug `'Bad Slug!'` (`23514`).
  - Inside `set local role anon`: `select count(*) from public.tenant_members` throws `42501`.

- [ ] **Step 2: Run to verify failure.** Run `supabase db reset && npm run test:db`. Expected: FAIL in `06_tenant_foundation.test.sql` (relation `public.tenants` does not exist).

- [ ] **Step 3: Implement the migration.**
  - Create the tables above, with the bounds from Global Constraints.
  - Timezone check: a `before insert or update` trigger function `private.validate_tenant_settings()` that raises `invalid timezone` when `new.timezone` isn't in `pg_catalog.pg_timezone_names` (CHECK constraints can't run subqueries).
  - RLS:
    - Enable it on all 5 tables.
    - `revoke all … from public, anon, authenticated`, then `grant select` to `authenticated` and `anon` on `tenants`, `tenant_settings` and `tenant_domains` only (public branding).
    - `grant select` to `authenticated` on `tenant_members` and `customer_cards`.
    - `grant all` to `service_role`.
    - Policies: `tenants`, `tenant_settings`, `tenant_domains` are `for select using (true)`; `tenant_members` is `using (user_id = (select auth.uid()))`; `customer_cards` is `using (customer_id = (select auth.uid()))`. Task 3 widens the last two for staff.
  - Insert tenant #1, its settings and its domain, with the exact values from Global Constraints.

- [ ] **Step 4: Run to verify pass.** Run `supabase db reset && npm run test:db`. Expected: `06` passes, and `01`–`05` still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104000000_phase10_tenant_foundation.sql supabase/tests/database/06_tenant_foundation.test.sql
git commit -m "feat(db): add tenants, settings, members, domains and wallet cards"
```

### Task 2: `tenant_id` on legacy tables and backfill

**Files:**
- Create: `supabase/migrations/20261104010000_phase10_tenant_columns_backfill.sql`
- Modify: `supabase/tests/database/06_tenant_foundation.test.sql` (second half; raise `plan(N)`)

**Interfaces:**
- Consumes: Task 1 tables and tenant #1 ID.
- Produces:
  - `tenant_id uuid not null default '7c1f0000-0000-4000-8000-000000000001' references public.tenants(id)` on `tags`, `stamps`, `redemptions`, `perk_claims`.
  - On `audit_log`, `tenant_id` is **nullable**, with the same default (null = platform event).
  - Indexes:
    - `stamps_tenant_customer_created_idx (tenant_id, customer_id, created_at desc)`
    - `stamps_tenant_tag_created_idx (tenant_id, tag_id, created_at desc)`
    - `redemptions_tenant_customer_idx (tenant_id, customer_id, created_at desc)`
    - `tags_tenant_idx (tenant_id)`
    - `audit_log_tenant_created_idx (tenant_id, created_at desc)`
  - `perk_claims`: unique key changes from `(customer_id, perk)` to `perk_claims_tenant_customer_perk_key unique (tenant_id, customer_id, perk)`. The `check (perk in (…))` is replaced by `check (perk ~ '^[a-z0-9_]{3,64}$')`.
  - Trigger `staff_mirror_to_tenant1` (after insert or update on `public.staff`) upserts into `tenant_members` for tenant #1 with the same `user_id`, `role`, `display_name` and `active`. **This is transition-only; Phase 12 drops it.**
  - `private.backfill_tenant1() returns void` (SECURITY DEFINER, execute to `service_role` only). Idempotent: it creates a tenant #1 card for every customer without one, and a tenant #1 membership for every `staff` row. The migration calls it once; the Phase 12 contract migration calls it again to catch customers created in between.

- [ ] **Step 1: Write the failing tests** (append to `06`):
  - **Schema guard:** `is_empty` over base tables in `public` (from `information_schema.tables`, `table_type = 'BASE TABLE'`) that lack a `tenant_id` column, excluding only `tenants`, `customers` and `staff` (legacy). Message: `every business table has tenant_id`.
  - **RLS guard:** `is_empty` over `pg_class` joined to `pg_namespace`, for `nspname = 'public'`, `relkind = 'r'` and `not relrowsecurity`. Message: `RLS enabled on every public table`.
  - **Backfill:** after inserting a customer, a staff row and a tag, then calling the **legacy** `public.record_stamp(<cust>, <tag>, 'nfc', null, null, '2026-11-04 10:00+08')`:
    - `is(…, 'stamped')`
    - `is((select tenant_id from public.stamps where customer_id = <cust>), '7c1f…0001'::uuid)`
  - **Mirror trigger:** after `insert into public.staff (user_id, display_name, role) values (<u>, 'T', 'staff')`, `is((select role from public.tenant_members where tenant_id = '7c1f…0001' and user_id = <u>), 'staff')`.
  - **Backfill function:** insert a customer directly into `public.customers` (no card), then `select private.backfill_tenant1()`.
    - `is((select count(*) from public.customers c where not exists (select 1 from public.customer_cards cc where cc.customer_id = c.id and cc.tenant_id = '7c1f…0001')), 0::bigint, 'every customer has a tenant 1 card')`
    - Calling it a second time: `lives_ok`, and the `customer_cards` count is unchanged.

- [ ] **Step 2: Run to verify failure.** Run `supabase db reset && npm run test:db`. Expected: FAIL on `every business table has tenant_id`.

- [ ] **Step 3: Implement the migration.**
  - Add the columns. Postgres 11+ adds a constant default without rewriting the table; the FK validation scans tables that are still small.
  - Create the indexes.
  - Swap the `perk_claims` constraints. The legacy `claim_instagram_upsize` uses `exists`, not `on conflict`, so this is safe.
  - `private.backfill_tenant1()` is two `insert … select … on conflict do nothing` statements: customers into `customer_cards`; `staff` into `tenant_members`, upserting `role`, `display_name` and `active`. Call it at the end of the migration.
  - Create the mirror trigger function `private.mirror_staff_to_tenant1()` (SECURITY DEFINER, `search_path = ''`).
  - Legacy `record_stamp` doesn't create cards. Customers created between this deploy and Phase 12 get their cards from the Phase 12 contract backfill; note this in `DECISIONS.md` in Task 8.

- [ ] **Step 4: Run to verify pass.** Run `supabase db reset && npm run test:db`. Expected: all files `01`–`06` pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104010000_phase10_tenant_columns_backfill.sql supabase/tests/database/06_tenant_foundation.test.sql
git commit -m "feat(db): add tenant_id to ledgers and backfill Caffeine Plug as tenant 1"
```

---

## Phase 11: Tenant-aware RLS and functions

### Task 3: Membership helpers, tenant-scoped RLS, `card_balances`

**Files:**
- Create: `supabase/migrations/20261104020000_phase11_tenant_rls.sql`
- Test: `supabase/tests/database/07_tenant_isolation.test.sql`

**Interfaces:**
- Produces:
  - `private.staff_tenant_ids() returns setof uuid`: language sql, stable, security definer. Returns the active memberships of `(select auth.uid())`. `grant execute` to `authenticated`.
  - `private.member_role(p_user uuid, p_tenant uuid) returns text`: stable, security definer. Returns the role of an **active** membership, or null. Execute granted to `service_role` only.
  - `public.card_balances` view, `with (security_invoker = true)`: columns `tenant_id, customer_id, total_stamps int, stamps_redeemed int, available_stamps int, last_stamped_at timestamptz`, one row per `customer_cards` row. Select granted to `authenticated` and `service_role`.
- Policy changes: every SELECT policy on `tags`, `stamps`, `redemptions`, `perk_claims`, `audit_log`, `customer_cards` and `tenant_members` becomes:
  - own rows: `customer_id = (select auth.uid())`, or `user_id` on `tenant_members`; tags and audit have no own-rows clause;
  - **or** `tenant_id in (select private.staff_tenant_ids())`.
- `customers` policy: `id = (select auth.uid()) or exists (select 1 from public.customer_cards cc where cc.customer_id = customers.id and cc.tenant_id in (select private.staff_tenant_ids()))`.
- **Untouched:** the legacy `staff` table policy, the `customer_balances` view and `public.is_staff()`. The deployed app still calls these.

- [ ] **Step 1: Write the failing tests.** Create the shared fixtures (tenant B, tags, users, memberships, cards). Insert one stamp per card via direct `insert` as superuser.
  - As `staffB`: count of `public.stamps` where `tenant_id = '7c1f…0001'` is `0`. Repeat for `redemptions`, `perk_claims`, `audit_log`, `tags`, `customer_cards`, `tenant_members`.
  - As `staffB`: count of `public.customers` where `id = <custA>` is `0`, and where `id = <custAB>` is `1`.
  - As `staffA`: sees only tenant A rows in `stamps` (`results_eq` on `select distinct tenant_id`).
  - As `dualStaff`: `select distinct tenant_id from public.stamps order by 1` returns both tenants.
  - As `custAB`: `select count(*) from public.card_balances` is `2`. As `custA`: it's `1`.
  - As `custA`: `select count(*) from public.stamps where customer_id = <custAB>` is `0`.
  - As a member whose membership is `active = false`: sees 0 tenant rows.
  - Every function in schema `private` is not executable by `anon`: `is_empty` over `information_schema.routine_privileges` with `grantee = 'anon'` and `routine_schema = 'private'`.

- [ ] **Step 2: Run to verify failure.** Run `npm run test:db`. Expected: FAIL in `07`, because `staffB` sees tenant A rows through `is_staff()`.

- [ ] **Step 3: Implement.** Write the helpers and the view. Use `drop policy if exists` plus `create policy` for each table listed. Wrap the helper calls as `(select …)` so Postgres caches them per query instead of per row.

- [ ] **Step 4: Run to verify pass.** Run `npm run test:db`. Expected: all files pass. In particular, `01` still passes, because the seed owner is mirrored into tenant #1.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104020000_phase11_tenant_rls.sql supabase/tests/database/07_tenant_isolation.test.sql
git commit -m "feat(db): scope RLS to tenant memberships and add card_balances view"
```

### Task 4: `add_card` and `stamp_card_nfc`

**Files:**
- Create: `supabase/migrations/20261104030000_phase11_card_stamping.sql`
- Test: `supabase/tests/database/08_card_stamping.test.sql`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 columns.
- Produces:
  - `public.add_card(p_customer uuid, p_tenant uuid, p_consent_version text default 'v1') returns text`
    - Results: `'added' | 'already-added' | 'tenant-unavailable'`.
    - Takes the customer lock. Ensures a `public.customers` row. Status must be `trial` or `active`.
  - `public.stamp_card_nfc(p_customer uuid, p_tag text, p_now timestamptz default null) returns jsonb`
    - Returns `{"result": <code>, "tenant_slug": <slug or null>}`.
    - Codes: `'stamped' | 'cooldown' | 'daily-limit' | 'tag-throttled' | 'invalid-tag' | 'no-card' | 'tenant-unavailable'`.
    - `tenant_slug` is null only for `invalid-tag`.
    - `p_now` is for tests only (D-006 rule).
- **Rule order** inside `stamp_card_nfc`, after btrim of `p_tag`:
  1. Tag lock, then customer lock.
  2. `v_now := coalesce(p_now, clock_timestamp())`.
  3. Tag must exist with `active and deactivated_at is null`, else `invalid-tag`.
  4. Tenant status must be `trial` or `active`, else `tenant-unavailable`.
  5. The customer must have a card in the tag's tenant, else `no-card`.
  6. Cooldown: the last stamp **in this tenant** within `cooldown_minutes`.
  7. Daily cap: same-day count in `tenant_settings.timezone`.
  8. Tag throttle: `tag_throttle_seconds`, skipped when 0.
  9. Insert the stamp with `tenant_id`.

- [ ] **Step 1: Write the failing tests** in `08`, using the shared fixtures. `->>'result'` means the result key:
  - `add_card_is_idempotent`: `add_card(custA, B)` returns `'added'`, then `'already-added'`.
  - `add_card_rejects_closed_tenant`: after `update tenants set status='closed'` on a scratch tenant, returns `'tenant-unavailable'`.
  - `nfc_credits_tag_tenant`: `stamp_card_nfc(custAB, 'tag_tenant_b_0001', '2026-11-04 10:00+09')` returns `stamped`, and the new stamp row has `tenant_id = B`.
  - `nfc_no_card`: `stamp_card_nfc(custA, 'tag_tenant_b_0001', …)` returns `no-card` with `tenant_slug = 'bean-there'`, and no stamp row is written.
  - `nfc_invalid_tag`: an unknown tag returns `invalid-tag` with `tenant_slug` null. A deactivated tag returns `invalid-tag`.
  - `nfc_suspended_tenant`: with tenant B `suspended`, returns `tenant-unavailable`.
  - `cooldown_is_per_tenant` (Review Focus 1): `custAB` stamps at A at 10:00+08, then at B at 10:05+08. Both are `stamped`. A second A tap at 10:20+08 is `cooldown`.
  - `cooldown_uses_tenant_setting`: set B's `daily_cap = 2` for this test. A B stamp at 10:00+09, then a tap at 10:59:59.999+09 is `cooldown`, and one at 11:00:00+09 is `stamped`.
  - `daily_cap_uses_tenant_timezone` (Review Focus 2): B is `Asia/Tokyo`, cap 1, cooldown 60.
    - Stamp at `2026-11-04 22:30+09`: `stamped`.
    - Tap at `2026-11-05 00:00+09`: `stamped`. That's still 4 Nov in Manila (23:00+08), so a Manila-based check would wrongly return `daily-limit`.
    - Tap at `2026-11-05 01:30+09`: `daily-limit`.
  - `throttle_zero_disables`: with `tag_throttle_seconds = 0` on A, two different customers 1 second apart on the same tag are both `stamped`.
  - `nfc_not_callable_by_clients`: `throws_ok` for `set local role authenticated` calling `public.stamp_card_nfc(...)`, SQLSTATE `42501`.

- [ ] **Step 2: Run to verify failure.** Run `npm run test:db`. Expected: FAIL in `08` (function `public.add_card` does not exist).

- [ ] **Step 3: Implement both functions** with the rule order and result codes above. Read settings with one `select … into` from `public.tenant_settings` joined to `public.tenants` on the tag's `tenant_id`.

- [ ] **Step 4: Run to verify pass.** Run `npm run test:db`. Expected: all files pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104030000_phase11_card_stamping.sql supabase/tests/database/08_card_stamping.test.sql
git commit -m "feat(db): add wallet cards and tenant-aware NFC stamping"
```

### Task 5: Staff card actions (manual stamp, redeem, perk)

**Files:**
- Create: `supabase/migrations/20261104040000_phase11_staff_card_actions.sql`
- Test: `supabase/tests/database/09_staff_card_actions.test.sql`

**Interfaces:**
- Consumes: `private.member_role(p_user, p_tenant)` (Task 3), `customer_cards` (Task 1).
- Produces:
  - `public.stamp_card_manual(p_actor uuid, p_tenant uuid, p_customer uuid, p_reason text, p_now timestamptz default null) returns text`
    - Codes: `'stamped' | 'cooldown' | 'daily-limit' | 'no-card' | 'unauthorized' | 'tenant-unavailable'`.
    - Raises `invalid manual stamp reason` when `btrim(p_reason)` isn't 1–500 chars.
    - Applies the same cooldown and cap as Task 4, with no tag throttle.
    - Writes `audit_log (tenant_id, actor, action 'manual_stamp', target customer, detail {reason})`.
  - `public.redeem_card_reward(p_actor uuid, p_tenant uuid, p_customer uuid, p_nonce text) returns text`
    - Codes: `'redeemed' | 'insufficient-stamps' | 'invalid-token' | 'no-card' | 'unauthorized' | 'tenant-unavailable'`.
    - Uses the **current** `reward_threshold` as both the minimum and `stamps_used`.
    - The nonce check and consumption sit inside the customer lock, backed by the existing `audit_log_redeem_nonce_uidx`.
    - Audit rows carry `tenant_id`.
  - `public.claim_card_perk(p_actor uuid, p_tenant uuid, p_customer uuid, p_perk text) returns text`
    - Codes: `'redeemed' | 'already-claimed' | 'invalid-perk' | 'no-card' | 'unauthorized' | 'tenant-unavailable'`.
    - `p_perk` must be a key of `tenant_settings.perks`.
- **Check order for all three:**
  1. Customer lock.
  2. Actor role: null gives `unauthorized`.
  3. Tenant status: stamping needs `trial`/`active`; redeem and perk accept `suspended` too.
  4. Card exists, else `no-card`.
  5. Then the action's own rules.

- [ ] **Step 1: Write the failing tests** in `09`:
  - `manual_stamp_requires_membership`: `stamp_card_manual(staffB, A, custA, 'x')` is `unauthorized`, and the count of A stamps is unchanged.
  - `manual_stamp_requires_card_in_tenant`: `stamp_card_manual(staffA, A, custB, 'x')` is `no-card`.
  - `dual_member_cannot_cross_tenants` (Review Focus 4): `stamp_card_manual(dualStaff, A, custB, 'x')` and `redeem_card_reward(dualStaff, A, custB, 'n-1')` are both `no-card`; the count of B stamps and redemptions is unchanged.
  - `redeem_threshold_per_tenant`: `custAB` with 8 B stamps (direct insert) gives `redeem_card_reward(staffB, B, custAB, 'n-2')` = `redeemed` and `stamps_used = 8`. With 8 A stamps, `redeem_card_reward(staffA, A, custAB, 'n-3')` = `insufficient-stamps`.
  - `redeem_balance_is_per_tenant`: 10 A stamps and 0 B stamps gives `redeem_card_reward(staffB, B, custAB, 'n-4')` = `insufficient-stamps` (the cross-shop fraud case, F-03).
  - `redeem_uses_current_threshold` (Review Focus 3): 9 A stamps, then `update tenant_settings set reward_threshold = 8` on A, gives `redeemed`; `card_balances.available_stamps` is `1`.
  - `redeem_nonce_single_use`: a second call with the same nonce returns `invalid-token`.
  - `redeem_allowed_when_suspended`: B `suspended` still gives `redeemed`; `stamp_card_manual` on B gives `tenant-unavailable`.
  - `perk_must_be_configured`: `claim_card_perk(staffB, B, custAB, 'instagram_follow_upsize')` is `invalid-perk` (B has no perks); on A it's `redeemed`, then `already-claimed`.
  - `inactive_member_unauthorized`: after `update tenant_members set active = false` for `staffA`, every function returns `unauthorized`.

- [ ] **Step 2: Run to verify failure.** Run `npm run test:db`. Expected: FAIL in `09` (function `public.stamp_card_manual` does not exist).

- [ ] **Step 3: Implement the three functions** following the check order and codes above.

- [ ] **Step 4: Run to verify pass.** Run `npm run test:db`. Expected: all files pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104040000_phase11_staff_card_actions.sql supabase/tests/database/09_staff_card_actions.test.sql
git commit -m "feat(db): add tenant-checked manual stamp, redemption and perk functions"
```

### Task 6: Tag management functions

**Files:**
- Create: `supabase/migrations/20261104050000_phase11_tag_management.sql`
- Test: `supabase/tests/database/10_tag_management.test.sql`

**Interfaces:**
- Consumes: `private.member_role` (Task 3).
- Produces:
  - `public.create_tag(p_actor uuid, p_tenant uuid, p_tag_id text, p_label text default null) returns text`
    - Codes: `'created' | 'duplicate' | 'invalid-tag-id' | 'unauthorized'`.
    - `p_tag_id` must match `^[A-Za-z0-9_-]{8,128}$`, the same rule as `lib/nfc/verifyTap.ts`. The app keeps generating IDs with `generateRandomTagId()`.
  - `public.deactivate_tag(p_actor uuid, p_tenant uuid, p_tag_id text) returns text`
    - Codes: `'deactivated' | 'not-found' | 'unauthorized'`.
  - `public.rotate_tag(p_actor uuid, p_tenant uuid, p_old_tag_id text, p_new_tag_id text, p_label text default null) returns text`
    - Codes: `'rotated' | 'not-found' | 'duplicate' | 'invalid-tag-id' | 'unauthorized'`. Atomic.
- **Rules:**
  - The role must be `owner` or `manager`; `staff` gets `unauthorized`.
  - A tag in another tenant returns `not-found`, never revealing it exists.
  - Takes the tag lock (ns 1002) on the old ID.
  - Every success writes `audit_log` with `tenant_id`.

- [ ] **Step 1: Write the failing tests** in `10`:
  - `staff_cannot_manage_tags`: `create_tag(staffA, A, 'tag_new_000001', null)` is `unauthorized`.
  - `manager_creates_tag_in_own_tenant`: `create_tag(managerA, A, 'tag_new_000001', 'Bar')` is `created`, and the row's `tenant_id` is A.
  - `duplicate_tag_id_rejected`: the same ID again (even from tenant B's owner) is `duplicate`.
  - `cannot_touch_other_tenant_tag`: `deactivate_tag(managerA, A, 'tag_tenant_b_0001')` is `not-found`, and B's tag stays active.
  - `rotate_is_atomic`: `rotate_tag(managerA, A, 'tag_tenant_a_0001', 'tag_new_000002', null)` is `rotated`; the old tag is inactive with `deactivated_at` set, and the new tag is active.
  - `invalid_tag_id_rejected`: `'bad id!'` is `invalid-tag-id`.

- [ ] **Step 2: Run to verify failure.** Run `npm run test:db`. Expected: FAIL in `10`.

- [ ] **Step 3: Implement the three functions.**

- [ ] **Step 4: Run to verify pass.** Run `npm run test:db`. Expected: all files pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104050000_phase11_tag_management.sql supabase/tests/database/10_tag_management.test.sql
git commit -m "feat(db): add owner and manager tag management functions"
```

### Task 7: Wallet lifecycle (remove card, delete wallet, merge) and legacy fixes

**Files:**
- Create: `supabase/migrations/20261104060000_phase11_wallet_lifecycle.sql`
- Test: `supabase/tests/database/11_wallet_lifecycle.test.sql`

**Interfaces:**
- Produces:
  - `public.remove_card(p_customer uuid, p_tenant uuid) returns boolean`
    - Deletes, in that tenant only: the customer's `stamps`, `redemptions`, `perk_claims`, the `customer_cards` row, and `audit_log` rows where `tenant_id = p_tenant and (actor = p_customer or target = p_customer::text)`.
    - Inserts one audit row: `(tenant_id = p_tenant, actor null, action 'customer_card_removed', target md5(p_customer::text))`.
    - Returns false when there was no card.
  - `public.delete_wallet(p_customer uuid) returns boolean`
    - Same semantics as legacy `delete_customer_data`, using the correct lock form.
    - Its audit row has `tenant_id = null`, `action = 'customer_wallet_deleted'`.
  - `public.merge_wallets(p_source uuid, p_target uuid) returns jsonb`
    - Returns `{"result": 'merged'|'noop-same-user'|'source-not-found'|'target-not-found', "cards_moved": int, "cards_combined": int}`.
- **Merge order** (keep it this way: Phase 12 adds a composite FK `(tenant_id, customer_id)` → `customer_cards` that depends on it):
  1. Lock both customers in least/greatest order.
  2. For each source card: insert a target card if it's missing (counts as `cards_moved`; otherwise `cards_combined`).
  3. Delete source perk claims whose `(tenant_id, perk)` the target already holds.
  4. Update `stamps`, `redemptions` and `perk_claims` from source to target.
  5. Delete the source cards, then the source `customers` row.
  6. Write one audit row with `tenant_id = null`.
- **Legacy fixes in the same migration:**
  - `create or replace function public.delete_customer_data` with the lock line changed to `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001))`; nothing else changes (F-17).
  - `drop function public.redeem_reward(uuid, uuid)` (F-18). The app calls only the 3-argument version (`app/api/staff/redeem/route.ts`).

- [ ] **Step 1: Write the failing tests** in `11`:
  - `remove_card_is_tenant_scoped`: `custAB` has stamps at A and B; `remove_card(custAB, A)` returns true. A stamps and the A card are 0; B stamps are unchanged; `auth.users` still has `custAB`.
  - `remove_card_missing_returns_false`: `remove_card(custA, B)` is false.
  - `delete_wallet_removes_everything`: after `delete_wallet(custAB)`, the counts of cards, stamps, `customers` and `auth.users` rows for `custAB` are all 0.
  - `merge_moves_distinct_cards`: source has a B card and target has an A card; the result is `merged` with `cards_moved = 1`, and the target has 2 cards.
  - `merge_combines_same_tenant_cards` (Review Focus 5): source and target each have an A card with 3 and 4 stamps, and both claimed `instagram_follow_upsize`. The result is `cards_combined = 1`; the target's A balance is 7; target A perk claims count is 1; the source `customers` row is gone.
  - `merge_noop_same_user`: `merge_wallets(x, x)->>'result'` is `noop-same-user`.
  - `legacy_two_arg_redeem_dropped`: `hasnt_function('public', 'redeem_reward', array['uuid','uuid'])`.
  - `legacy_delete_uses_shared_lock`: `ok(pg_get_functiondef('public.delete_customer_data(uuid)'::regprocedure) like '%hashtextextended(p_customer::text, 1001)%')`.

- [ ] **Step 2: Run to verify failure.** Run `npm run test:db`. Expected: FAIL in `11`.

- [ ] **Step 3: Implement** the three functions and the two legacy fixes.

- [ ] **Step 4: Run to verify pass.** Run `npm run test:db`. Expected: all files pass, including `04_phase7_compliance_and_cleanup` (legacy erasure) and `03_phase6_merge_anonymous_customer` (legacy merge, untouched).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104060000_phase11_wallet_lifecycle.sql supabase/tests/database/11_wallet_lifecycle.test.sql
git commit -m "feat(db): add per-tenant card removal, wallet deletion and wallet merge"
```

### Task 8: Seed, generated types, decision record, runbook

**Files:**
- Modify: `supabase/seed.sql` (add tenant B `bean-there`, owner `owner@beanthere.test` / local-only password, tag `tcp_tag_demo_beanthere01`, and a `tenant_members` row for the existing seed owner at B as `manager` so dual-tenant staff can be tested locally)
- Modify: `lib/supabase/database.types.ts` (regenerated)
- Modify: `DECISIONS.md` (append D-012)
- Modify: `docs/DEPLOYMENT_AND_OPS.md` (add the transition rules below; also correct the Vercel references to Cloudflare Workers, F-19)

**Interfaces:**
- Consumes: everything above.
- Produces: generated types for the new tables, functions and view, which the Phase 12 plan builds on.

- [ ] **Step 1: Update `seed.sql`**, then run `supabase db reset`. Expected: completes without errors, and `select count(*) from public.tenants` returns 2.

- [ ] **Step 2: Regenerate types.** Run `npm run db:types`. Expected: `lib/supabase/database.types.ts` now contains `tenants`, `customer_cards`, `card_balances`, `stamp_card_nfc` and `redeem_card_reward`.

- [ ] **Step 3: Run the full gate.** Run `npm run lint && npm run typecheck && npm run test:unit && npm run test:db`. Expected: all pass. The app doesn't use the new types yet, so nothing else changes.

- [ ] **Step 4: Append D-012 to `DECISIONS.md`.** Status Accepted, date 2026-11-04. Cover:
  - D1–D4 (wallet, path routing, per-shop rules, billing deferred);
  - "new function names instead of overloads", and why;
  - the transition rules:
    - legacy functions write tenant #1 through column defaults;
    - the `staff` → `tenant_members` mirror trigger is transition-only;
    - customers created before Phase 12 get cards when the Phase 12 contract migration re-runs `private.backfill_tenant1()`;
    - the composite FK, `is_staff()`, `staff`, `customer_balances`, legacy functions and column defaults are removed in Phase 12.
  - Add the transition rules to `docs/DEPLOYMENT_AND_OPS.md` as a short "Multi-tenant transition (Phases 10–12)" section.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql lib/supabase/database.types.ts DECISIONS.md docs/DEPLOYMENT_AND_OPS.md
git commit -m "chore(db): seed two tenants, regenerate types, record D-012"
```

---

## Out of scope (next plans)

- **Phase 12 (app switch and contract):**
  - Route handlers call the new functions; `/s/<slug>`; `/staff/<slug>`; v2 tokens with `tenantId`; `cf-connecting-ip`; Turnstile fix; ESLint ban on `admin.from(`.
  - Then the contract migration: backfill missing cards and memberships, add the composite FK `(tenant_id, customer_id)` → `customer_cards`, drop the legacy functions, `is_staff()`, `staff`, the mirror trigger, `customer_balances` and the column defaults.
- **Phase 13:** wallet UI and branding.
- **Phase 14:** owner console and platform ops.
- **Phase 15:** legal and pilots.
