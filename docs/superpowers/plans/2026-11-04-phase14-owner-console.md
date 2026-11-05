# Phase 14: Owner Console and Platform Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform admin can onboard and support a shop, and a shop owner can run it (rules, branding, tags, staff, export), with no SQL.

**Architecture:** All writes are new `service_role` SECURITY DEFINER RPCs that take the actor and derive the tenant from the database (membership, slug or support session), the pattern of Phase 11. Reads go through the session client and RLS. Platform access is a `platform_admins` table plus a required Supabase TOTP (`aal2`) session; support is a time-boxed, read-only session recorded in `audit_log`, never an impersonated staff login. Ops work (cron, heartbeat, tenant-keyed logs and rate limits, tag-leak signals) lands as migrations and small app changes.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind, Supabase (Postgres, Auth TOTP, Storage), pgTAP, Vitest, Upstash rate limiting.

**Spec:**
- `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md`: section 6 Phase 14 (scope, acceptance), findings F-12, F-13, F-16, F-20, section 9 (open questions).
- `docs/superpowers/handoff/2026-11-04-phases-13-15-handoff.md`: Phase 14 scope, binding rules, deferred minors.
- `DECISIONS.md`: D-009, D-012, D-013. `lib/contracts.ts`: shared types. `docs/DEPLOYMENT_AND_OPS.md` sections 7-9.

**Base:** branch `feat/multi-tenant-db`, commit `8b1f55f` (Phase 13 final fix wave). Gate baseline at that commit: pgTAP 9 files / 300 tests; `npm run lint && npm run typecheck && npm run test:unit` 24 files / 506 tests.

## Global Constraints

- **SQL:**
  - New migrations only (`20261106NNNNNN_phase14_<topic>.sql`), expand-only; never edit an applied one.
  - SECURITY DEFINER functions use `set search_path = ''` and fully qualified names, except `coalesce`, `least`, `greatest`, `nullif` which stay unqualified (`pg_catalog.least(...)` is a runtime error).
  - Every public function: `revoke all ... from public, anon, authenticated; grant execute ... to service_role;`.
  - Advisory locks: `pg_advisory_xact_lock(hashtextextended(key, ns))`, namespace 1002 (tag) taken before 1001 (customer).
  - The tenant always comes from the database (membership, tag, slug lookup, support session), never from a request body.
- **App:**
  - Reads use `createSupabaseServerClient()` so RLS applies; the admin client is for `.rpc(...)` only (ESLint enforces it).
  - Client IP from `getClientIp(request)`; every state-changing route starts with `verifySameOriginRequest(request)`; `ApiResponse<T>` bodies; `Cache-Control: no-store` on console and platform pages and routes.
  - Shop copy, rules and branding come from `TenantContext.settings`.
- **Tests:** TDD, failing test first and watch it fail. Unit tests that mock `@/lib/security/ratelimit` include `getClientIp`. New unit files `tests/unit/phase14-<topic>.test.ts`; pgTAP files numbered from `13_`. pgTAP runs only after `npx supabase db reset`; export `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` before `supabase start`; gate scripts use `set -o pipefail`.
- **Design:** flat surfaces, 1px borders, no shadows or backdrop blur (review constraint from Phase 13); WCAG AA on every new screen.
- **Git:** Conventional Commits, no co-author or Claude trailers; never commit `.claude/`, `.superpowers/`, `pnpm-lock.yaml` or `pnpm-workspace.yaml`; no push, merge or PR without the owner's yes. Billing is out of scope (D4). Wallet passes are out of scope.
- **Contracts:** additive types and routes go in one orchestrator commit before Task 1; sub-agents treat `lib/contracts.ts` as fixed.

## Open owner questions (ask before the task they block)

| Question | Blocks | Default used if unanswered |
|---|---|---|
| Support hours and response time you can promise | Task 4 copy only | 30-minute read-only sessions; no promise text in the UI |
| Do branches share a card by default | Task 2A | Shared by default; owner can switch a branch to its own card (R-3) |
| Platform name and domain | Printing tag/QR URLs for new shops (Task 9 docs) | URLs come from `NEXT_PUBLIC_SITE_URL` or a `tenant_domains` alias |

## Proposed rulings (orchestrator-reserved items; record in `progress.md` as `Ruling:` lines on adoption)

- **R-1 Impersonation:** support never logs in as staff and never widens RLS. A support session lets a platform admin call read-only `support_*` RPCs for one tenant for 30 minutes. A write mode is not built. Cost if wrong: fixes to a shop's data need SQL until a later phase.
- **R-2 Suspension:** `suspended` blocks new stamps immediately (perk claims keep their current behaviour; `claim_card_perk` is not touched). Customers keep seeing the card and may redeem for 30 days from `tenants.suspended_at`; after that `redeem_card_reward` returns `tenant-unavailable`. A BEFORE UPDATE trigger on `public.tenants` stamps `suspended_at = now()` on any transition into `suspended` (including direct SQL, which the existing pgTAP files use) and clears it on any other status; `redeem_card_reward` treats a null `suspended_at` as inside the window. Cost if wrong: a shop suspended by mistake for more than 30 days strands redeemable rewards until reactivated.
- **R-3 Multi-branch via `locations` inside a tenant (replaces the earlier "no locations" default):** one tenant is one brand, with one or more branches. The card, stamps, rules, branding, staff and privacy notice stay per tenant, so a customer holds **one card per brand** that earns at every branch and shares one cooldown and daily cap. A branch only labels where a tag lives and where a stamp happened. An owner can switch a branch to **its own card** (`card_mode = 'separate'`): the branch is then promoted to a child tenant (`tenants.parent_tenant_id`) with its own cards, rules, branding and privacy notice, so the stamping engine and wallet keep the one-card-per-tenant model (D-012 D1). Promotion is one-way and not retroactive: stamps already earned stay on the parent card, the branch's tags move to the child, and customers start a new card there. The parent's owners and managers are copied as members of the child. Branch-restricted staff are not built: members are tenant-wide. Cost if wrong: a chain whose branches need separate cards, rules or staff must still onboard as separate tenants.
- **R-4 Owner settings bounds = the table CHECK bounds** (cooldown 0-1440, daily cap 1-20, reward threshold 3-50, tag throttle 0-60, reward label 1-40). Only `owner` changes rules; `manager` manages tags. Cost if wrong: an owner can pick a legal but unwise value; the preview in Task 6 is the mitigation.
- **R-5 Invites without the Auth admin API:** an invite is a `tenant_invites` row; the invitee signs in on the existing staff login and an `accept_invite` RPC links the verified email. Cost if wrong: the invitee must know to sign in with the invited email.
- **R-6 Tag-leak signal thresholds** (Task 8) start as constants: a tag is flagged when more than 8 distinct customers stamp it within 15 minutes, or it has more than 25 `tag-throttled` rejections in an hour. Cost if wrong: false alarms or missed leaks; constants are one file to tune.

## Review Focus

1. **Suspension window edges:** a shop suspended 29 days 23 hours ago still redeems; at 30 days 1 minute it does not; stamping is blocked from the first second; re-activation restores stamping and clears the window. → Task 1 pgTAP `suspended_redeem_window_edges`.
2. **Cross-tenant owner writes:** an owner of shop A calls rules, brand, invite and role RPCs naming shop B's tenant and gets `unauthorized` with no row changed. → Task 2 pgTAP `owner_cannot_write_other_tenant`.
3. **Last owner invariant:** demoting or deactivating the only active owner is refused; a second owner makes it legal. → Task 2 pgTAP `last_owner_cannot_be_removed`.
4. **Support session expiry and scope:** a support RPC at 30 minutes 1 second, after `end_support_session`, for another tenant, or or by a non-admin returns `unauthorized` (the `aal2` requirement is enforced in the app guard, Task 5 test `platform_guard_requires_aal2`); start and end both appear in `audit_log` with the tenant and reason. → Task 4 pgTAP `support_session_expiry_and_scope`.
5. **CSV formula injection and tenant scope:** a card label or shop-entered text starting with `=`, `+`, `-` or `@` is exported with a leading `'`; an owner of shop A cannot export shop B by editing the slug. → Task 7 tests `csv_export_neutralizes_formulas`, `csv_export_is_slug_member_scoped`.

6. **Multi-branch stamping:** a brand with branches Downtown and Mall; the customer stamps at Downtown, then taps the Mall tag inside the cooldown and is blocked by the shared cooldown; after the cooldown the Mall stamp is recorded with the Mall `location_id`. After the owner switches Mall to its own card, tapping a Mall tag stamps a new Mall card (shown as a separate card in `/wallet`) and leaves the brand's card untouched. A Mall tag cannot be created under a Downtown-only owner of another brand, and a tag cannot point at another tenant's location. → Task 2A pgTAP `branch_stamps_share_card_and_cooldown`, `tag_location_must_belong_to_tenant`.

---

## File Structure

| Area | Create | Modify |
|---|---|---|
| Migrations | `supabase/migrations/20261106000000_phase14_platform_and_suspension.sql`, `20261106010000_phase14_tenant_admin.sql`, `20261106015000_phase14_locations.sql`, `20261106030000_phase14_support_sessions.sql`, `20261106040000_phase14_ops.sql`, `20261106020000_phase14_brand_storage.sql` | none |
| pgTAP | `supabase/tests/database/13_platform_and_suspension.test.sql`, `14_tenant_admin.test.sql`, `15_support_sessions.test.sql`, `16_ops_and_leak_signals.test.sql`, `17_locations.test.sql` | none |
| Platform app | `lib/auth/platform.ts`, `app/platform/**` (tenants list, new, `[slug]`, support), `app/api/platform/**` | `lib/contracts.ts` |
| Owner console | `app/staff/[slug]/settings/**` (rules, brand, staff, tags, export), `app/api/staff/[slug]/**`, `lib/console/*.ts` | `lib/auth/staff.ts`, `app/staff/page.tsx` (link) |
| Ops | `lib/ops/tag-leak.ts`, `lib/ops/csv.ts` | `lib/security/logger.ts`, `lib/security/ratelimit.ts`, `app/api/health/route.ts`, `supabase/config.toml`, `docs/DEPLOYMENT_AND_OPS.md` |

## Task 0: Contracts and verification (orchestrator, no sub-agent)

- [ ] **Step 1: Verify the assumptions this plan makes** and record each result in `progress.md`; adjust the owning task if one is false:
  - the staff sign-in method on `app/staff/login/page.tsx` (plan assumes email link or OTP);
  - where the ESLint rule banning `admin.from(...)` lives and whether it also bans `admin.storage`/`admin.auth`;
  - `pg_cron` is available in local Supabase (the pgTAP runs print `grant_pg_cron_access` warnings, so likely);
  - `redeem_card_reward` and `claim_card_perk` each check `status in ('trial','active','suspended')` (`20261104040000_phase11_staff_card_actions.sql` ~149 and ~255);
  - `lib/tenants/context.ts` does not cache settings (grep found no cache; a settings change must apply on the next tap).
- [ ] **Step 2: Add additive contracts** in one commit `feat(contracts): additive contracts for Phase 14 console`: `ROUTES.platform`, `ROUTES.staff.settings(slug)`, `TENANT_STATUS_SUSPENDED_REDEEM_DAYS = 30`, `SUPPORT_SESSION_MINUTES = 30`, types `PlatformAdminSession`, `SupportSession`, `TenantRulesPatch`, `TenantRulesPreview`, `TenantInvite`, `TagLeakSignal`, `Location`, and the `RpcContracts` entries for every RPC named below.
- [ ] **Step 3: Gate** (`lint`, `typecheck`, `test:unit`) is green; commit.

## Task 1: Platform admins, MFA helper, suspension window (database)

**Files:** Create `20261106000000_phase14_platform_and_suspension.sql`, `13_platform_and_suspension.test.sql`.

**Interfaces:**
- Produces tables: `public.platform_admins (user_id uuid primary key references auth.users on delete cascade, created_at timestamptz default now())`, with RLS enabled and no policies for `anon`/`authenticated` (service role only); `public.tenants.suspended_at timestamptz null`.
- Produces `private.is_platform_admin(p_user uuid) returns boolean` (service_role only), its public wrapper `public.is_platform_admin_user(p_user uuid) returns boolean` (service_role only, used by Task 5's guard), and `public.set_tenant_status(p_actor uuid, p_tenant uuid, p_status text, p_reason text) returns text` with results `updated | unauthorized | invalid-status | invalid-reason | not-found`. Allowed statuses `trial | active | suspended`; `closed` is not settable here.
- Modifies `public.redeem_card_reward(...)` (new migration, `create or replace`) so `suspended` redeems only while `suspended_at + interval '30 days' > now()`.

- [ ] **Step 1: Write pgTAP** `13_*`: `platform_admin_required_for_set_tenant_status` (non-admin and unknown user get `unauthorized`), `set_tenant_status_audits_with_tenant_and_reason`, `suspended_stamp_blocked`, `suspended_redeem_window_edges` (Review Focus 1, using `update public.tenants set suspended_at = now() - interval '29 days 23 hours'` style fixtures), `reactivation_clears_suspended_at`, `platform_admins_not_readable_by_authenticated`.
- [ ] **Step 2: Run** `npx supabase db reset` then `npx supabase test db`; expect the new file to fail.
- [ ] **Step 3: Implement the migration.** `set_tenant_status` sets `suspended_at = now()` on a transition into `suspended`, clears it otherwise, requires `btrim(p_reason)` of at least 5 characters, and writes `audit_log (tenant_id, actor, action 'tenant_status_changed', target = new status, detail {from, reason})` through the existing audit insert pattern. Add the trigger `tenants_suspended_at` as described in R-2. The `aal2` check is enforced in the app (Task 5) because SQL cannot see the caller's session through `service_role`; `is_platform_admin` only checks the table.
- [ ] **Step 4: Run** `db reset` then `test db`; expect all green including the 300 baseline.
- [ ] **Step 5: Commit** `feat(db): add platform admins and suspension redemption window`.

## Task 2: Tenant admin RPCs (database)

**Files:** Create `20261106010000_phase14_tenant_admin.sql`, `14_tenant_admin.test.sql`.

**Interfaces (all `service_role`, all return text unless noted):**
- `public.platform_create_tenant(p_actor uuid, p_slug text, p_name text, p_owner_email text) returns jsonb` → `{result:'created'|'unauthorized'|'invalid-slug'|'duplicate-slug'|'invalid-email', tenantId?, inviteId?}`. Creates `tenants` (status `trial`), default `tenant_settings`, an owner `tenant_invites` row, audit row.
- Table `public.tenant_invites (id uuid pk, tenant_id uuid fk, email text lower-cased, role text check in ('owner','manager','staff'), invited_by uuid, expires_at timestamptz default now()+interval '14 days', accepted_at timestamptz null, created_at)`, RLS on, owner/manager of the tenant can `select` via `private.staff_tenant_ids()` plus role check.
- `public.invite_member(p_actor, p_tenant, p_email, p_role) → 'invited'|'unauthorized'|'already-member'|'invalid-email'|'invalid-role'` (owner only; only an owner can invite an `owner`).
- `public.accept_invite(p_user uuid, p_invite uuid, p_display_name text) → 'accepted'|'invalid-invite'|'expired'|'email-mismatch'` (matches `auth.users.email` of `p_user`, which must be confirmed and non-anonymous).
- `public.set_member_role(p_actor, p_tenant, p_user, p_role)` and `public.set_member_active(p_actor, p_tenant, p_user, p_active boolean)`: owner only, refuse removing the last active owner (`last-owner`).
- `public.update_tenant_rules(p_actor, p_tenant, p_patch jsonb) → text` (`updated|unauthorized|invalid-patch`), owner only, accepts only the keys `cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, reward_label`, relies on the table CHECKs for bounds and maps a check violation to `invalid-patch`.
- `public.preview_tenant_rules(p_actor, p_tenant, p_patch jsonb) returns jsonb` → `{cardsNewlyRedeemable int, cardsWithPartialProgress int, currentThreshold int, newThreshold int}` computed from `public.card_balances`; read-only; owner or manager.
- `public.update_tenant_brand(p_actor, p_tenant, p_brand jsonb) → text`, owner or manager: keeps keys `primaryColor, accentColor, tagline, logoUrl, cardArtUrl`; colors must match `^#[0-9A-Fa-f]{6}$`; image URLs must be `https://` on the project storage host or root-relative; tagline at most 60 characters.

- [ ] **Step 1: Write pgTAP** `14_*` named tests: `owner_cannot_write_other_tenant` (Review Focus 2, covers rules, brand, invite and role RPCs), `last_owner_cannot_be_removed` (Review Focus 3), `manager_cannot_change_rules`, `invite_accept_requires_matching_confirmed_email`, `expired_invite_rejected`, `rules_patch_rejects_out_of_bounds_and_unknown_keys`, `rules_change_applies_on_next_stamp` (update `cooldown_minutes`, then `stamp_card_nfc` obeys it; this is the "next tap" acceptance), `preview_counts_newly_redeemable`, `brand_rejects_bad_color_and_foreign_url`, `platform_create_tenant_makes_settings_and_invite`.
- [ ] **Step 2: Run** reset plus `test db`; expect failures.
- [ ] **Step 3: Implement the migration** following `20261104050000_phase11_tag_management.sql` (`private.member_role(p_actor, p_tenant)` gate first, audit rows with `tenant_id`, revoke/grant block per function).
- [ ] **Step 4: Run** reset plus `test db`; expect green.
- [ ] **Step 5: Commit** `feat(db): add tenant admin, invite, rules and brand RPCs`.

## Task 2A: Branches / locations (database)

**Files:** Create `20261106015000_phase14_locations.sql`, `17_locations.test.sql`.

**Interfaces:**
- Table `public.locations (id uuid pk default gen_random_uuid(), tenant_id uuid not null fk, name text check (1-80 chars), address text null check (<= 200), active boolean default true, created_at)`, unique `(tenant_id, name)` and unique `(id, tenant_id)`; RLS: staff of the tenant `select` via `private.staff_tenant_ids()`; customers may `select` only active locations of tenants where they hold a card (shop page can list branches); writes service role only.
- Expand-only columns: `public.tags.location_id uuid null`, `public.stamps.location_id uuid null`, each with composite FK `(location_id, tenant_id)` → `locations (id, tenant_id)` so a row can never point at another tenant's branch. Backfill: one default location per existing tenant named after the tenant; existing tags and stamps stay null-safe (null means "unassigned").
- `public.create_location(p_actor, p_tenant, p_name, p_address) → jsonb {result:'created'|'unauthorized'|'duplicate'|'invalid-name', locationId?}`, `public.update_location(p_actor, p_tenant, p_location, p_name, p_address, p_active) → text`, owner only; deactivating a branch deactivates nothing automatically but its tags are listed for the owner. `public.platform_create_tenant` (Task 2) is amended in a follow-up `create or replace` inside this migration to also create the default location.
- Card-mode toggle: `public.locations.card_mode text not null default 'shared' check (card_mode in ('shared','separate'))`, `public.locations.child_tenant_id uuid null`, `public.tenants.parent_tenant_id uuid null fk` (expand-only). `public.set_location_card_mode(p_actor, p_tenant, p_location, p_mode text, p_child_slug text default null, p_confirm_name text default null) → jsonb {result:'updated'|'unauthorized'|'invalid-mode'|'invalid-slug'|'duplicate-slug'|'already-separate'|'cannot-revert'|'confirmation-mismatch', childTenantId?}` (promotion requires `p_confirm_name` to equal the branch name exactly; a read-only `public.preview_location_separation(p_actor, p_tenant, p_location) → jsonb` feeds the Task 7 dialog), owner only, one transaction under the tag-then-customer lock order (1002 then 1001): creates the child tenant (status copied from the parent, settings and brand copied), moves the branch's tags (`tags.tenant_id`, `tags.location_id` to the child's default location), copies parent owner/manager memberships, sets `card_mode = 'separate'` and `child_tenant_id`, and audits on both tenants. Setting `shared` on a separate branch returns `cannot-revert`. Suspending the parent does not suspend the child (separate cards, separate status).
- `create_tag` and `rotate_tag` gain a `p_location uuid default null` argument via **new function names** (`create_tag_at(p_actor, p_tenant, p_tag_id, p_label, p_location)`, `rotate_tag_at(...)`), not overloads (ambiguity rule from D-012); the old names keep working. `stamp_card_nfc` and `stamp_card_manual` record `location_id` from the tag (manual stamps: null) via `create or replace`, leaving all rule logic unchanged. Verify first which migration last defines each function.
- App-facing: `ROUTES.staff.settingsLocations(slug)`, `Location` type (added in Task 0).

- [ ] **Step 1: Write pgTAP** `17_*`: `branch_stamps_share_card_and_cooldown` (Review Focus 6: Downtown then Mall inside the cooldown is blocked, afterwards recorded with the Mall id), `tag_location_must_belong_to_tenant` (composite FK and RPC both refuse another tenant's location), `owner_cannot_manage_other_tenant_locations`, `manager_cannot_create_location`, `location_names_unique_per_tenant`, `existing_tenants_get_default_location`, `legacy_tag_and_stamp_functions_still_work`, `customer_cannot_read_locations_of_tenants_without_a_card`, `separate_card_mode_promotes_branch_to_child_tenant` (child exists with copied settings, tags moved, owners copied, parent stamps untouched), `separate_branch_tap_stamps_child_card_not_parent`, `card_mode_change_owner_only_and_audited_on_both_tenants`, `separate_mode_cannot_revert`, `child_slug_must_be_valid_and_unique`, `promotion_requires_exact_branch_name_confirmation`, `preview_location_separation_counts_branch_stamps_only`.
- [ ] **Step 2: Run** `npx supabase db reset` then `npx supabase test db`; expect `17_*` to fail.
- [ ] **Step 3: Implement the migration**, following the Phase 11 RPC pattern (`private.member_role` gate, audit rows with `tenant_id`, revoke/grant block).
- [ ] **Step 4: Run** reset plus `test db`; expect green including all earlier files.
- [ ] **Step 5: Commit** `feat(db): add branches (locations) within a tenant with location-aware tags and stamps`.

## Task 3: Brand storage bucket and policy (database)

**Files:** Create `20261106020000_phase14_brand_storage.sql`, extend `14_tenant_admin.test.sql`.

**Interfaces:** bucket `tenant-brand` (public read, 512 KB limit, mime `image/png | image/jpeg | image/webp`; **no SVG**); `private.manager_tenant_ids() returns setof uuid` granted to `authenticated` (tenants where `auth.uid()` is an active `owner` or `manager`); storage policy allowing `insert/update/delete` on `bucket_id = 'tenant-brand'` only when `(storage.foldername(name))[1]::uuid in (select private.manager_tenant_ids())`.

- [ ] **Step 1: Write pgTAP** `brand_upload_scoped_to_own_tenant_folder` (owner uploads to own folder; staff role and other-tenant folder denied), `brand_bucket_rejects_svg`.
- [ ] **Step 2: Run** and watch fail. **Step 3: Implement.** **Step 4: Run** green.
- [ ] **Step 5: Commit** `feat(db): add tenant brand storage bucket with manager-scoped policy`.

## Task 4: Support sessions (database)

**Files:** Create `20261106030000_phase14_support_sessions.sql`, `15_support_sessions.test.sql`.

**Interfaces:**
- Table `public.support_sessions (id uuid pk, tenant_id uuid fk, admin_id uuid, reason text, mode text default 'read_only' check (mode = 'read_only'), started_at, expires_at default now()+interval '30 minutes', ended_at null)`; RLS on, service role only.
- `public.start_support_session(p_admin, p_tenant, p_reason) returns jsonb` → `{result:'started'|'unauthorized'|'invalid-reason'|'not-found', sessionId?, expiresAt?}`, reason at least 10 characters; writes `audit_log` action `support_session_started` with tenant and reason.
- `public.end_support_session(p_admin, p_session) → 'ended'|'unauthorized'|'not-found'`, audit `support_session_ended`.
- `public.support_get_tenant_overview(p_admin, p_session) returns jsonb` and `public.support_list_recent_activity(p_admin, p_session, p_limit int) returns jsonb`: each re-checks admin, unexpired, unended, and derives the tenant from the session row, never from a parameter. They return counts and shop-level rows only (no customer emails).

- [ ] **Step 1: Write pgTAP** `support_session_expiry_and_scope` (Review Focus 4), `support_reason_required`, `support_rpcs_take_tenant_from_session`, `support_reads_exclude_personal_data`.
- [ ] **Step 2-4:** run to fail, implement, run to green. **Step 5: Commit** `feat(db): add time-boxed read-only support sessions`.

## Task 5: Platform admin app (guard, tenants, create, status, support)

**Files:** Create `lib/auth/platform.ts`, `app/platform/page.tsx` (tenant list), `app/platform/new/page.tsx`, `app/platform/[slug]/page.tsx`, `app/platform/[slug]/support/page.tsx`, `app/api/platform/tenants/route.ts`, `app/api/platform/tenants/[slug]/status/route.ts`, `app/api/platform/support/route.ts`; test `tests/unit/phase14-platform-admin.test.ts`.

**Interfaces:**
- Produces `requirePlatformAdmin(): Promise<PlatformAuthResult>` in `lib/auth/platform.ts`: verified user, not anonymous, row in `platform_admins` (read through a service RPC `public.is_platform_admin_user(p_user)` exposed in Task 1), and `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` returns `currentLevel === 'aal2'`; otherwise reasons `unauthenticated | forbidden | mfa-required`. Produces `enforcePlatformPageAccess()` that redirects `mfa-required` to `/platform/mfa` (TOTP enroll or challenge page).
- Consumes the Task 1-2 and 4 RPCs through `.rpc(...)` only.

- [ ] **Step 1: Write failing tests:** `platform_guard_rejects_non_admin`, `platform_guard_requires_aal2`, `create_tenant_route_validates_slug_and_csrf`, `status_route_requires_reason`, `support_start_route_returns_session_and_never_a_tenant_from_body`, `platform_pages_set_no_store`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/phase14-platform-admin.test.ts`; expect failures.
- [ ] **Step 3: Implement** the guard, the routes (zod bodies, same-origin check, rate limit keyed with `getClientIp`) and flat pages: tenant table with status badges, create form (slug, name, owner email), status switch with a required reason field, support start form with required reason and a live countdown of `expiresAt`. The `/platform/mfa` page uses Supabase `mfa.enroll` / `mfa.challenge` / `mfa.verify`.
- [ ] **Step 4: Run** the new test plus the full unit suite; expect green. **Step 5: Commit** `feat(platform): add platform admin console with MFA, tenant creation, status and support`.

## Task 6: Owner console shell, rules with preview, staff and invites

**Files:** Create `app/staff/[slug]/settings/layout.tsx` (tab nav), `.../page.tsx` (rules), `.../staff/page.tsx`, `lib/console/guard.ts`, `app/api/staff/[slug]/rules/route.ts`, `.../rules/preview/route.ts`, `.../members/route.ts`, `.../invites/route.ts`, `app/auth/accept-invite/route.ts`; test `tests/unit/phase14-owner-console.test.ts`.

**Interfaces:**
- Produces `requireConsoleAccess(slug: string, minRole: StaffRole): Promise<{staff: StaffSession; tenantId: string}>`: runs `requireStaffSession()`, resolves the membership **by slug from the session's memberships** (404 if absent) so the URL, not the shared cookie, picks the shop. This folds in deferred minor #3 (active shop drifting between tabs) for the console.
- Consumes `update_tenant_rules`, `preview_tenant_rules`, `invite_member`, `set_member_role`, `set_member_active`, `accept_invite`.

- [ ] **Step 1: Write failing tests:** `console_guard_resolves_tenant_from_slug_not_cookie`, `console_guard_404s_for_non_member_slug`, `rules_route_owner_only`, `rules_preview_shows_newly_redeemable_count`, `rules_route_rejects_unknown_keys`, `invite_route_creates_invite_and_audits`, `accept_invite_requires_signed_in_matching_email`, `members_route_refuses_last_owner_removal`.
- [ ] **Step 2: Run** and watch fail. **Step 3: Implement.** The rules form shows each bound from `contracts` and a **Preview** button that calls the preview route and renders the customer-visible effect before **Save**; roles are shown but only owners see edit controls (server enforcement is the RPC). **Step 4: Run** green. **Step 5: Commit** `feat(console): add owner settings shell, rules preview, staff invites and roles`.

## Task 7: Branding upload, tags tab, CSV export

**Files:** Create `app/staff/[slug]/settings/brand/page.tsx`, `.../tags/page.tsx`, `app/api/staff/[slug]/brand/route.ts`, `app/api/staff/[slug]/export/route.ts`, `lib/ops/csv.ts`; test `tests/unit/phase14-brand-tags-export.test.ts`.

**Interfaces:**
- Produces `toCsv(rows: Array<Record<string, string | number | null>>, columns: string[]): string` in `lib/ops/csv.ts` (RFC 4180 quoting; a cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`).
- Brand upload: the browser uploads to `tenant-brand/<tenantId>/logo.<ext>` and `card-art.<ext>` with the **session** client (Task 3 policy); the brand route then calls `update_tenant_brand` with the resulting public URL. The page previews the result with `resolveCardTheme`, including the contrast warning.
- Tags tab reuses `getStaffTagsList`, `decorateTagWithUrls`, `generateRandomTagId` and the RPCs `create_tag_at`, `rotate_tag_at`, `deactivate_tag` behind the slug guard, lets the owner pick a branch per tag, and shows the printable tag URL grouped by branch.
- Branches tab (`app/staff/[slug]/settings/locations/page.tsx`, `app/api/staff/[slug]/locations/route.ts`): add, rename, deactivate branches and a per-branch **"Give this branch its own card"** toggle (owner only; consumes `create_location`, `update_location`, `set_location_card_mode`). The toggle opens a guarded confirmation flow, never a bare switch:
  - **Impact summary first**, computed by a read-only `preview_location_separation(p_actor, p_tenant, p_location) → jsonb {tagCount, customersWithStampsAtBranch, stampsAtBranch, cardsWithPartialProgress, customersAlsoStampedElsewhere}` (owner or manager), shown as plain numbers ("N customers have stamps from this branch; they keep them on the brand card and start a new card here").
  - **Warnings, each in its own labelled block, none collapsed:** (1) one-way, cannot be undone from the console; (2) not retroactive, existing stamps do not move; (3) customers will hold two cards and may be confused, so staff should tell them; (4) rewards, rules, branding and privacy notice are now independent and changes to the brand no longer apply to this branch; (5) the brand's staff are copied once, later staff changes on the brand do not propagate; (6) the branch's tags change shop, so printed tag URLs keep working but now stamp the new card; (7) the child starts with the brand's current status and is suspended or billed separately.
  - **Precautions:** the confirm button stays disabled until the owner (a) types the branch name exactly, (b) types the new shop slug, (c) ticks a checkbox "I understand this cannot be undone and customers will start a new card", and (d) the preview has loaded without error; a 5 second delay before the button enables; focus lands on the Cancel button by default; Escape and click-outside cancel; the server re-validates owner role, the typed branch name and the slug, and returns `confirmation-mismatch` otherwise (the RPC takes `p_confirm_name text` for this).
  - **After success:** a result screen links to the child's console and shows the tag URLs that moved; the action is audited on both tenants with the preview counts in `detail`.
  - A "shared" branch row also carries a short neutral explainer ("Shares the brand's card, rules and cooldown") so the trade-off is visible before the owner opens the toggle. The export gains a `branch` column and the activity dashboard filters by branch.
- Export route: `GET /api/staff/[slug]/export?kind=cards|stamps`, `requireConsoleAccess(slug, 'manager')`, reads through the session client (RLS), returns `text/csv` with filename `<slug>-<kind>-<date>.csv`, includes pseudonymous card ids and counts only (no emails), writes an audit row `export_csv` via `log_audit_event` with the tenant.

- [ ] **Step 1: Write failing tests:** `csv_export_neutralizes_formulas`, `csv_export_is_slug_member_scoped` (Review Focus 5), `csv_export_omits_email_columns`, `brand_route_rejects_svg_and_oversize_metadata`, `brand_preview_flags_failed_contrast`, `tags_tab_rotate_uses_generated_id`, `tags_tab_assigns_branch_and_groups_by_it`, `locations_route_owner_only`, `card_mode_toggle_requires_confirmation_and_slug`, `separation_dialog_lists_all_seven_warnings`, `separation_confirm_disabled_until_name_slug_checkbox_and_preview`, `separation_route_rejects_name_mismatch`, `separation_dialog_defaults_focus_to_cancel`, `export_includes_branch_column`.
- [ ] **Step 2: Run** and watch fail. **Step 3: Implement.** **Step 4: Run** green. **Step 5: Commit** `feat(console): add brand upload, tag management tab and CSV export`.

## Task 8: Operations (cron, heartbeat, tenant-keyed logs and limits, leak signals, SMTP)

**Files:** Create `20261106040000_phase14_ops.sql`, `16_ops_and_leak_signals.test.sql`, `lib/ops/tag-leak.ts`; Modify `app/staff/[slug]/settings/tags/page.tsx` (leak banner), `lib/security/logger.ts`, `lib/security/ratelimit.ts`, `app/api/health/route.ts`, `supabase/config.toml`, `docs/DEPLOYMENT_AND_OPS.md`; tests `tests/unit/phase14-ops.test.ts`.

**Interfaces:**
- SQL: `create extension if not exists pg_cron`; `cron.schedule('weekly-stale-anonymous-cleanup', '0 3 * * 0', ...)` idempotent via `cron.unschedule` guard; `public.ops_cleanup_status() returns jsonb` → `{lastRunAt timestamptz|null, stale boolean}` reading `cron.job_run_details` for that job, `stale = lastRunAt is null or lastRunAt < now() - interval '8 days'`; `public.tag_leak_signals(p_actor, p_tenant, p_window_minutes int default 15) returns jsonb` listing `{tagId, distinctCustomers, throttleRejections}` for tags crossing the R-6 thresholds, owner or manager only.
- App: `logSecurityEvent` context gains a first-class `tenantId` (shop id only, never the redaction-exempt personal data); `RateLimitCheckInput.tenantId?: string` adds a third bucket `${endpoint}:tenant:${tenantId}` with a per-tenant quota constant per endpoint (start: new cards per day per tenant); `/api/health` additionally returns `cleanup: {lastRunAt, stale}` and status `degraded` (HTTP 200) when stale so an external uptime monitor can alert on the body; `lib/ops/tag-leak.ts` exports `evaluateTagLeakSignals(raw): TagLeakSignal[]`.
- Console: a banner on the tags tab when signals exist, each with a one-click **Rotate** that calls the existing `rotate_tag` with `generateRandomTagId()`; the signal also emits a `warn` log line with `tenantId`.
- Config: add a commented `[auth.email.smtp]` template to `supabase/config.toml` driven by env vars, and a `DEPLOYMENT_AND_OPS.md` section for custom SMTP (provider, SPF/DKIM, Supabase dashboard steps, test send) and for the uptime monitor on `/api/health`; raising the anonymous sign-in limit is a documented dashboard step with the CAPTCHA caveat. SMTP and the monitor are owner actions and stay **unverified** in the report.

- [ ] **Step 1: Write failing tests:** pgTAP `cron_job_is_scheduled_by_migration`, `ops_cleanup_status_flags_stale_after_8_days`, `tag_leak_signals_scoped_to_tenant`, `tag_leak_signals_thresholds`; unit `log_events_carry_tenant_id_and_stay_redacted`, `ratelimit_tenant_bucket_blocks_one_tenant_only`, `health_reports_degraded_when_cleanup_stale`, `leak_banner_rotates_with_generated_tag_id`.
- [ ] **Step 2: Run** reset plus `test db` and the unit file; expect failures. **Step 3: Implement.** **Step 4: Run** green.
- [ ] **Step 5: Commit** `feat(ops): schedule cleanup in a migration, tenant-keyed logs and limits, tag-leak signals`.

## Task 9: Deferred minors, suspended-shop UX, docs

**Files:** Modify `app/s/[slug]/page.tsx`, `lib/auth/customer.ts` or the add-card route as found, the reward-token routes under `app/api/redeem-token/**` and `app/api/staff/redeem/route.ts`, `DECISIONS.md`, `docs/DEPLOYMENT_AND_OPS.md`; test `tests/unit/phase14-minors.test.ts`.

- [ ] **Step 1: Write failing tests:** `suspended_shop_card_shows_paused_message_and_blocks_add_loop` (deferred minor #4: the add-card loop at a suspended shop keeps its status message), `suspended_redeem_expired_shows_closed_message`, `tenant_id_filters_on_tag_and_dashboard_queries` (deferred minor #9: assert the `.eq('tenant_id', ...)` filters on `getStaffTagsList` and the activity dashboard queries), `reward_token_routes_share_body_parse_and_tenant_resolve` (deferred minor #6).
- [ ] **Step 2: Run** and watch fail. **Step 3: Implement:** extract the repeated body-parse and tenant-resolve into one helper used by both routes; add the suspended-shop messaging. **Step 4: Run** green.
- [ ] **Step 5: Write `DECISIONS.md` D-014** (platform admins, support sessions, suspension window, invites, ops), update `DEPLOYMENT_AND_OPS.md` (platform admin bootstrap by SQL insert into `platform_admins`, enrolling TOTP, onboarding a shop in the console, support session policy). **Step 6: Commit** `fix(shop): suspended-shop messaging, shared reward-token helpers, tenant filter tests, D-014`.

## Final gate (executor, after all tasks)

- [ ] Whole-branch review of `git diff 8b1f55f..HEAD` by the strongest available model; Critical and Important findings fixed in **one** wave with tests; one scoped re-review of the fix diff.
- [ ] Run on the final tree: `export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`, `npx supabase db reset`, `npx supabase test db` (expect 9 baseline files plus `13_` to `17_`), then `npm run lint && npm run typecheck && npm run test:unit`.
- [ ] **Acceptance check against the roadmap:**
  - a new shop goes live with no SQL: manual walk-through (create tenant, accept invite, set rules, upload logo, create two tags) timed under 30 minutes;
  - a settings change applies on the next tap: pgTAP `rules_change_applies_on_next_stamp`;
  - every support session is in `audit_log`: pgTAP `support_session_expiry_and_scope`.
- [ ] Report: shipped items, gate results, **unverified** (TOTP enrolment live, Storage upload live, SMTP, uptime monitor, `pg_cron` on hosted Supabase, Playwright e2e, accessibility audit, any browser pass), every `Ruling:` with cost, deferred minors. Stop; ask before Phase 15 runbooks, pushing or a PR.

## Self-review

- **Spec coverage:** platform admins + MFA (Tasks 1, 5); tenant creation with owner invite (2, 5); owner rules with preview (2, 6); branding upload (2, 3, 7); tags with printable URL (7); staff invites and roles (2, 6); CSV export (7); support sessions (4, 5); tenant status switch and 30-day redemption (1, 5, 9); pg_cron in a migration with missed-run alert (8); `tenant_id` in logs and audit rows (audit rows were done in Phase 12, logs in 8); custom SMTP (8, documented, unverified); tag-leak alerts with one-click rotate (8); per-tenant rate-limit keys and quotas (8). Billing stays out. Deferred minors #3, #4, #6, #9 map to Tasks 6 and 9.
- **Multi-branch coverage:** Task 2A (schema, tag and stamp branch labels), Task 7 (branches tab, tag assignment, export), Task 8 (leak signals report the tag's branch), Review Focus 6. Task 2's `platform_create_tenant` also seeds a default branch.
- **Gaps the executor must close, not assume:** the Task 0 verifications; the exact `RpcContracts` shapes; whether `auth.users.email` confirmation fields support the `accept_invite` check on the installed Supabase version.
- **Proportion:** nine tasks plus a gate for a roadmap phase estimated at 2-3 developer-weeks; tasks 1-4 are database-only so their reviewers can reject without blocking UI work.
