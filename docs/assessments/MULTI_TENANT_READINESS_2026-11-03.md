# Multi-Tenant SaaS Readiness Assessment: Caffeine Plug NFC Loyalty Card

- **Date:** 2026-11-03
- **Scope:** Read-only review of the `main` branch at commit `47ddd34`. No code or design was changed.
- **Inputs actually reviewed:** all 6 files in `supabase/migrations/`; route handlers `app/t/[tagId]/route.ts`, `app/api/claim`, `app/api/customers` (POST path), `app/api/customers/merge`, `app/api/staff/stamp`, `app/api/staff/redeem`, `app/api/staff/tags` (partial); `app/auth/callback/route.ts`; `lib/auth/staff.ts`, `lib/auth/customer.ts`, `lib/supabase/{admin,middleware}.ts`, `middleware.ts`, `lib/security/{ratelimit,turnstile}.ts`, `lib/nfc/verifyTap.ts`, `lib/config.ts`; `components/card/GetCardButton.tsx`; `.env.example`, `wrangler.jsonc`, `supabase/config.toml` (auth section), `.github/workflows/ci.yml`, `DECISIONS.md`, `BACKLOG.md`, and parts of `docs/DEPLOYMENT_AND_OPS.md`.
- **Not provided or not read:** see section 10. In particular, **no master spec was provided** (the `[PASTE: ...]` placeholder was empty), so where this report says "spec" it means the context paragraph in the request plus `DECISIONS.md`.
- **Evidence labels:** **[Verified]** = seen in the repo or an official source; **[Inferred]** = reasoned from what was seen; **[Unknown]** = needs input or a test.

> **Stack correction [Verified].** The request says the app runs on Vercel. The repo is deployed to **Cloudflare Workers via OpenNext**: see `wrangler.jsonc`, `open-next.config.ts`, and commits `b068172`, `d1c2da0`, `864a7ab`. `docs/DEPLOYMENT_AND_OPS.md` still describes Vercel (lines 28–30, 181–230, 298–314). This matters for finding F-07 (client IP spoofing) and for the ops runbook.

---

## 1. Executive summary

**Verdict: NOT READY.** Don't onboard shop #2 on the current schema. The single-shop core is well built: append-only ledgers, SECURITY DEFINER functions with `search_path = ''`, advisory locks, signed single-use tokens, pgTAP tests in CI. The problem is that nothing in it knows what a shop is. No table has a tenant key (a column saying which shop a row belongs to), and "staff" means staff of the whole system.

**Top 5 blockers**
1. **No `tenant_id` anywhere, and `is_staff()` is global.** Any staff member of any shop could read every shop's customers, stamps and audit log (F-01, F-02).
2. **Redemptions and manual stamps aren't tied to a shop.** A shop-A reward QR redeems at shop B, and staff can stamp any customer UUID (F-03, F-04).
3. **Business rules and branding are hard-coded** in SQL (30 min, 2 per day, Asia/Manila, 5 s, 10 stamps) and in `lib/config.ts` (F-05).
4. **The staff model allows one shop per person.** The `owner` role is never enforced, and any staff member can create or rotate tags (F-06).
5. **No processor agreement or per-shop privacy notice exists**, and the erasure and merge functions act on every shop's data at once (F-10, F-11).

**Recommendation:** Keep one Supabase project with a shared schema. Add `tenant_id`, enforced by RLS (Row Level Security: Postgres rules that filter rows per user) and by SQL functions that work out the tenant themselves. Migrate Caffeine Plug in place as tenant #1, then run 3 paid pilots before building self-serve features.

### Owner decisions (2026-11-03)

These answer open questions 1, 4 and part of 7 from the first draft. The roadmap in section 6 is built on them.

| # | Decision | Consequence |
|---|---|---|
| D1 | **One login with a separate card per shop, collected in a wallet** (like Apple Wallet) | `customers` stays the global identity. A new `customer_cards (tenant_id, customer_id)` table is the "card in the wallet". Customers see all of their own cards; shops see only theirs. The platform likely becomes a controller of the wallet account (lawyer to confirm). |
| D2 | **Path routing on one domain**: `/s/<slug>` for shop pages, `/t/<tagId>` unchanged, `/wallet` for the collection | One cookie and one session across shops, one Supabase redirect URL, one Turnstile hostname. The shop is looked up from the tag in SQL. `card.thecaffeineplug.ph` stays an alias for tenant #1. |
| D3 | **Stamp rules configurable per shop from launch** | `tenant_settings` with CHECK bounds, read by the SQL functions inside the locked transaction |
| D4 | **Payment gateway and billing are out of scope for now** | Billing work is removed from the roadmap. Tenant `status` (trial, active, suspended) is still built so a shop can be switched off by hand. |

---

## 2. Readiness scorecard

| # | Dimension | Score (0–5) | Verdict | One-line reason |
|---|---|---|---|---|
| 1 | Tenancy model | 0 | Not ready | Single-tenant schema with no tenants table [Verified] |
| 2 | Data isolation | 1 | Not ready | RLS and DEFINER hygiene are good, but no tenant key exists and `is_staff()` is global |
| 3 | Customer identity across tenants | 1 | Not ready | `customers.id = auth.users.id` with no membership concept; erasure and merge are global |
| 4 | Tag, URL, routing | 1 | Not ready | Random tag IDs are good, but tags carry no tenant and the static NTAG215 URL can be replayed |
| 5 | AuthN/AuthZ | 1 | Not ready | Staff limited to one shop, `owner` role unused, no super-admin, service role used for reads |
| 6 | Per-tenant configuration | 1 | Not ready | Rules hard-coded in SQL; TS constants are centralized but single-shop |
| 7 | Abuse resistance and fair use | 2 | Partial | Solid per-customer and DB throttles; no tenant dimension; IP can probably be spoofed; Turnstile wiring unclear |
| 8 | Scalability and performance | 3 | Fine to ~100 tenants | Sound locking and indexes; needs tenant-leading indexes and ledger growth planning |
| 9 | Billing and plans | 0 | Absent | Nothing exists |
| 10 | Onboarding and operations | 1 | Not ready | Good single-shop runbook, but every step is manual SQL or dashboard work |
| 11 | Privacy, compliance, legal | 2 | Partial | Erasure, retention and PII-free logs exist; controller/processor model is absent |
| 12 | Observability and reliability | 2 | Partial | Audit log and redacting logger exist; no tenant dimension; backups are the plan default |
| 13 | Developer workflow and testing | 3 | Good base | CI runs lint, typecheck, unit and pgTAP; no isolation tests; e2e not in CI |
| 14 | Business viability | 1 | Unproven | No market, pricing or pilot evidence provided [Unknown] |

---

## 3. Tenancy model recommendation

| Criterion | A. Shared schema + `tenant_id` + RLS | B. Schema per tenant | C. Supabase project per tenant |
|---|---|---|---|
| Infra cost per extra tenant | ~₱0 until shared limits are hit | ~₱0 | Each project has its own compute. Pro's $10 credit covers **one** Micro instance ([Supabase pricing](https://supabase.com/pricing), checked 2026-11-03). The per-extra-project cost wasn't verified. |
| Isolation strength | Logical, via RLS plus function checks. One bug can leak data. | Better, but `search_path` mistakes still leak | Strongest (separate database) |
| Migrations | Once | N times, with drift risk | N times, plus N sets of auth settings, secrets and cron jobs |
| Supabase fit | Native: RLS, PostgREST, one Auth | Poor: each schema must be exposed to the Data API and RLS/grants copied | Fine, but auth (anonymous users, OAuth redirects, SMTP) is configured per project |
| Cross-shop customer wallet | Easy | Hard | Very hard |
| Support burden for one founder | Low | High | Highest |
| Noisy neighbors | Shared DB and shared Auth rate limits (see dimension 7) | Same DB | None |
| Restore one tenant | Restore to a scratch project and copy rows by `tenant_id` | Dump one schema | Native |

**Choice: A, shared schema + `tenant_id` + RLS, in one Supabase project.** A shop paying a few hundred to a thousand pesos a month can't carry its own Postgres instance, migration fan-out or auth config. The current design already routes every write through SECURITY DEFINER functions, which is the right place to enforce tenancy: the functions can work out the tenant from the tag or staff membership instead of trusting the caller.

**What would change my mind:**
- A chain or enterprise customer contractually demands physical isolation or its own region. Give that customer option C as a priced add-on.
- One tenant's load degrades others: sustained lock contention, or a single tenant taking more than ~30% of database CPU. [Inferred threshold]
- A legal opinion says processor isolation requires separate databases. [Unknown; lawyer]

---

## 4. Findings register

Severity: **Blocker** = before tenant #2; **High** = before ~10 tenants; **Medium**; **Low**. Effort: S ≤ 1 day, M ≤ 1 week, L > 1 week.

| ID | Dim | Severity | Evidence | Impact | Recommended fix | Effort |
|---|---|---|---|---|---|---|
| F-01 | 1, 2 | Blocker | [Verified] No `tenant_id` on `customers`, `tags`, `staff`, `stamps`, `redemptions`, `audit_log` (`…phase1….sql:9-64`) or `perk_claims` (`…instagram_follow_upsize_perk.sql:13-20`). Indexes such as `stamps_customer_created_idx` aren't tenant-aware (`phase1:70-76`). | Rows can't be attributed to a shop, so isolation, export, deletion and billing per shop are impossible | Add `tenants` plus `tenant_id uuid not null` on every business table, composite FKs `(tenant_id, customer_id)`, and tenant-leading indexes. Migration path in section 6. | M |
| F-02 | 2, 5 | Blocker | [Verified] `is_staff()` checks only `staff.user_id = auth.uid()` (`phase1:99-112`). Every SELECT policy grants staff all rows (`phase1:121-161`, `perk:30-35`). Table SELECT is granted to `authenticated` (`phase1:92`). | Shop B staff can run `supabase.from('stamps').select('*')` in the browser console with their own session and read every shop's data | Replace with `tenant_id in (select private.staff_tenant_ids())`, where the helper is SECURITY DEFINER, stable, and in a non-exposed schema. Add pgTAP isolation tests (F-14). | M |
| F-03 | 2, 4 | Blocker | [Verified] Redeem tokens carry only `customerId, iat, exp, nonce` (`lib/security/redeemToken.ts` schema). `redeem_reward` counts **all** of a customer's stamps (`phase5:77-86`). The staff route passes the token's customer straight in (`app/api/staff/redeem/route.ts`). | A customer earns 10 stamps at shop A and redeems a free drink at shop B, so shop B pays for shop A's loyalty | Put `tenantId` inside the signed payload. Pass `p_tenant` from the **staff's** membership, reject if they differ, and compute balances `where tenant_id = p_tenant`. Do the same for `claim_instagram_upsize`. | S–M |
| F-04 | 2, 5 | Blocker | [Verified] The manual stamp route takes any UUID and checks only that the customer exists globally (`app/api/staff/stamp/route.ts`, `admin.from('customers')…eq('id', …)`). `record_stamp` checks only `staff.active` (`phase3:58-70`). | Staff at any shop can stamp, and so create value for, any customer at any shop | `record_stamp` derives the tenant from the tag (NFC) or the staff membership (manual) and creates or uses a per-tenant membership. Never accept the tenant from the client. | S |
| F-05 | 6 | Blocker | [Verified] Hard-coded rules: cooldown `interval '30 minutes'` and daily cap `>= 2` in `Asia/Manila` (`phase3:80-97`); throttle `'5 seconds'` (`phase3:100-107`); threshold `< 10` and `stamps_used 10` (`phase5:88, 109`). Single-shop identity: `SHOP_CONFIG`, `BRAND_THEME` (`lib/config.ts:7-87`). Perk is `check (perk in ('instagram_follow_upsize'))` with a hard-coded handle (`perk:16`, `lib/config.ts:31-35`). | Every shop gets Caffeine Plug's rules, name, brand and Instagram handle | Add a `tenant_settings` table with CHECK bounds. Have `record_stamp`, `redeem_reward` and display code read it, so the database stays the single authority for rules. | M |
| F-06 | 5 | Blocker | [Verified] `staff.user_id` is the PK (`phase1:24-30`), so a person can be staff at only one shop. `'owner'` is defined (`lib/contracts.ts:23`) but never checked; grep found no role checks in `app/` or `lib/`. Tag create, rotate and deactivate are direct `admin.from('tags').insert/update` calls open to any staff (`app/api/staff/tags/route.ts`, POST branch). | Baristas can mint or rotate tags. A person can't work at two shops. Owners can't be told apart from staff. | Add `tenant_members(tenant_id, user_id, role in ('owner','manager','staff'), active)` with PK `(tenant_id, user_id)`. Move tag mutations into SECURITY DEFINER functions that require `owner`/`manager`. | M |
| F-07 | 7 | High | [Verified] Rate limits use the **first** `x-forwarded-for` value (`lib/security/ratelimit.ts`, `normalizedIp = input.ip?.split(',')[0]`). Cloudflare **appends** to an existing XFF header rather than replacing it ([Cloudflare HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/), checked 2026-11-03). [Inferred] On Workers the first value is client-controlled, so every per-IP limit can be bypassed by rotating a fake header. | Per-IP limits on `/t/*`, `/api/claim` and `/api/customers` are ineffective. Matters more once many shops depend on them. | Use `cf-connecting-ip` on Cloudflare. Confirm with a test: send 61 requests with a rotating `X-Forwarded-For` and check whether any get a 429. | S |
| F-08 | 7 | High | [Verified] The same Turnstile token goes to `supabase.auth.signInAnonymously({captchaToken})` **and** to `/api/customers` (`components/card/GetCardButton.tsx:42-60`), where verification only runs if a token is present (`app/api/customers/route.ts:106`). Turnstile tokens are single-use. [Inferred] Either Supabase CAPTCHA is **off**, so anonymous sign-up can be scripted straight against Supabase Auth with the public key in `wrangler.jsonc`, or it's **on**, so the second verification should fail for new users. | Bot-driven anonymous-user inflation, which counts against shared Auth limits and possibly MAU billing | Enable CAPTCHA in Supabase Auth (the [Supabase anonymous-auth docs](https://supabase.com/docs/guides/auth/auth-anonymous) "strongly recommend" it) and drop the duplicate server verification. [Unknown] current dashboard setting. | S |
| F-09 | 5 | High | [Verified] The service-role admin client is used for **reads** that RLS could handle: the dashboard reads the last 50 stamps, redemptions and audit rows unfiltered (`lib/auth/staff.ts`, `getStaffActivityDashboardData`); tag listing is unfiltered (`getStaffTagsList`, `GET /api/staff/tags`); balance previews too. | After multi-tenancy, any route that forgets `.eq('tenant_id', …)` leaks across shops, and RLS can't catch it because the service role bypasses RLS | Staff reads go through the **user-session** client so RLS applies. Keep the service role for SECURITY DEFINER RPCs only. Add an ESLint `no-restricted-syntax` rule banning `.from(` on the admin client outside an allowlist. | M |
| F-10 | 3, 11 | Blocker (design) | [Verified] `delete_customer_data` deletes the `auth.users` row and every ledger row (`phase7:8-62`). `merge_anonymous_customer` moves every stamp, redemption and perk claim (`perk:104-205`). | Once shops share an identity, a deletion request made to shop A wipes the customer's card at shop B. A merge also crosses shops. | Decide the identity model (section 5, A5) **before** tenant #2 data exists. Split "leave this shop" (per-tenant erasure) from "delete my account" (global). | M |
| F-11 | 11 | Blocker (legal) | [Verified] `app/privacy/page.tsx` names no controller, DPO or contact (grep found none) and is branded "THE CAFFEINE PLUG". No processor or data-sharing agreement exists in the repo. | Each new shop would be processing customer data with no notice naming it and no contract with the platform | A lawyer-drafted processing agreement (shop = controller, platform = processor), a per-tenant privacy notice built from tenant settings, and a platform privacy notice. See dimension 11. | M (plus legal time) |
| F-12 | 7 | High | [Verified] Upstash keys are `caffeine_plug_rl:{endpoint}:ip` or `:cust` with no tenant (`ratelimit.ts`). Supabase limits anonymous sign-ins to **30/hour per IP** by default, and the built-in mailer to 2 emails/hour **per project** ([Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits), checked 2026-11-03); local config matches (`supabase/config.toml:203-213`). | [Inferred] Philippine mobile carriers widely use CGNAT (many phones share one public IP), so a busy shop or event can hit the anonymous-sign-in cap for other users on the same carrier IP. Email backup for every tenant shares 2 emails/hour unless custom SMTP is set ([Unknown] whether it is). | Raise the anonymous limit and lean on CAPTCHA. Configure custom SMTP. Add per-tenant quotas, e.g. new cards per day per plan. | S |
| F-13 | 4 | High | [Verified] NTAG215 URLs are static (`lib/nfc/verifyTap.ts`). `/api/claim` accepts any well-formed tag ID in the request body (`app/api/claim/route.ts`). | A leaked tag URL allows remote stamping (capped at 2/day) at a **paying** shop, and one person can farm several shops. | Per-tenant anomaly alerts plus one-click rotation in the owner console now. Offer NTAG 424 DNA (SUN) as a paid tier before ~10 tenants (BACKLOG Phase 9 already designs it). | S now / L for 424 |
| F-14 | 13 | High | [Verified] Five pgTAP files cover the single-tenant rules (`supabase/tests/database/01-05`). CI runs them (`.github/workflows/ci.yml`). Playwright exists (`package.json` `test:e2e`) but CI doesn't run it. | No safety net for cross-tenant leaks | Seed 2 tenants. Add an isolation matrix test (role × table × tenant). Add a pgTAP "schema guard" test that fails if any `public` table lacks `tenant_id` or RLS. | M |
| F-15 | 8 | Medium | [Verified] A 5-second per-tag throttle applies across **all** customers (`phase3:100-107`). | A busy counter with one tag rejects the second customer within 5 s ("tag-throttled"). Shops with queues will feel this. | Make it a tenant setting, encourage 2+ tags per counter, and later key the throttle on (tag, customer) once 424 DNA counters exist | S |
| F-16 | 12 | Medium | [Verified] The stale-anonymous cleanup is scheduled by hand with `pg_cron` from the runbook (`docs/DEPLOYMENT_AND_OPS.md:276-290`), not in a migration. Supabase states automatic anonymous-user cleanup isn't available. | [Unknown] whether it runs in production. Anonymous users pile up across all tenants. | Put the `cron.schedule` in a migration, log the result per tenant, and alert if it hasn't run in 8 days | S |
| F-17 | 2 | Medium | [Verified] `delete_customer_data` locks with `pg_advisory_xact_lock(1001, hashtext(...))` (`phase7:23`), but every other function uses `pg_advisory_xact_lock(hashtextextended(..., 1001))`. Those are **different lock keys**, so erasure doesn't serialize with stamping or redemption. | A stamp or redeem running concurrently with erasure isn't ordered. [Inferred] Low impact today because FKs make a late insert fail, but the inconsistency will be copied into tenant-aware versions. | Use the same one-argument form everywhere and add a pgTAP check | S |
| F-18 | 2 | Low | [Verified] The legacy `redeem_reward(uuid, uuid)` without a nonce still exists (`phase1:385-457`) next to the 3-argument version (`phase5`). | Unused attack surface that a future bug could call | Drop it during the tenant migration | S |
| F-19 | 10, 12 | Medium | [Verified] Docs describe Vercel; production is Cloudflare Workers. `NEXT_PUBLIC_SITE_URL` is a `workers.dev` host (`wrangler.jsonc:20`), while tag URLs are generated for `card.thecaffeineplug.ph` (`lib/config.ts:12`, `lib/auth/staff.ts` `decorateTagWithUrls`). | Rollback and runbook steps are wrong. [Unknown] whether printed tags point to a live domain. | Update the runbook. Confirm the canonical domain before printing any more tags. | S |
| F-20 | 12 | Medium | [Verified] `audit_log` and the structured logs (`lib/security/logger.ts`) carry no tenant. Backups are the plan default: Pro has 7-day daily backups, and PITR is a separate $100/month per 7 days ([Supabase pricing](https://supabase.com/pricing), checked 2026-11-03). | You can't answer "what happened at shop X" or restore one shop | Add `tenant_id` to audit rows and log lines (shop ID only, no personal data). Decide on PITR at around 10 paying tenants. | S |

---

## 5. Top attack scenarios (cross-tenant)

**A1. Staff reads other shops' data through RLS.**
1. Shop B's owner invites a barista. The barista logs in at `/staff/login`.
2. In the browser console they run `supabase.from('stamps').select('*')` with their own session.
3. `stamps_select_policy` passes because `is_staff()` is true (`phase1:135-140`), so every shop's ledger comes back. The same works for `customers`, `audit_log` and `perk_claims`.

*Control:* tenant-scoped policies (snippet below) plus a pgTAP test that logs in as tenant-B staff and asserts zero tenant-A rows.

```sql
-- illustrative only
create function private.staff_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.tenant_members m
  where m.user_id = (select auth.uid()) and m.active
$$;
create policy stamps_staff_select on public.stamps for select to authenticated
  using (tenant_id in (select private.staff_tenant_ids()));
```

The `(select …)` wrapper lets Postgres evaluate the function once per query instead of once per row, which is the main RLS performance concern.

**A2. Cross-shop reward redemption.**
1. A customer collects 10 stamps at shop A.
2. At shop B they open the reward QR. Its token has no tenant.
3. Shop B's barista scans it. `redeem_reward` counts all stamps globally (`phase5:77-86`) and returns `redeemed`, so B gives away a free drink that A's stamps paid for.

*Control:* `tenantId` inside the HMAC payload; `p_tenant` taken from the scanning staff's membership; reject on mismatch; balances computed per tenant.

**A3. Wrong-tenant stamp from routing.**
1. The tap route resolves the tenant from the hostname or path and passes `p_tenant` to `record_stamp`.
2. A routing bug, or an attacker who edits the path, pairs shop A's tag with shop B's tenant.
3. The stamp lands at B.

*Control:* `record_stamp` never accepts a tenant for NFC stamps. It reads `tags.tenant_id` under the tag lock and uses that. The host or path is only checked for consistency, and a mismatch returns `invalid-tag`. Leaked-URL replay (F-13) is handled with per-tenant anomaly alerts, rotation, and NTAG 424 DNA as an upsell.

**A4. Service-role query without a tenant filter.**
1. A new endpoint is added, for example "export my customers": `admin.from('customers').select()`.
2. The developer forgets `.eq('tenant_id', …)`. The service role bypasses RLS.
3. The endpoint exports every shop's customers.

*Controls:*
- Staff reads use the RLS-bound session client.
- The service role is limited to RPCs taking `p_actor`, which check membership inside SQL.
- An ESLint rule bans `admin.from(` outside an allowlist.
- An isolation test runs each API route as tenant-B staff against tenant-A fixtures.

**A5. Cross-tenant destructive action through shared identity.**
1. A customer who holds cards at shops A and B asks shop A to delete their data.
2. Shop A's owner (or support) triggers `delete_customer_data`.
3. The `auth.users` row and every ledger are deleted, including shop B's active card, without B's instruction. Merge has the same reach (`perk:104-205`).

*Control:* per-tenant erasure (`delete_customer_membership(p_tenant, p_customer)`) for shop-initiated requests. Global deletion only when the customer requests it from their own session. Merge operates per membership. Support impersonation is time-boxed and audited (dimension 5).

---

## 6. Migration roadmap (Phases 10–15)

Updated 2026-11-03 for owner decisions D1–D4 (wallet, path routing, per-shop rules, billing deferred).

[Unknown] The project's orchestrator and sub-agent process documents weren't provided. The only evidence is `SEC-REVIEW-AGENT` in `DECISIONS.md` (D-006, D-008). The role names below (DB-AGENT, API-AGENT, UI-AGENT, TEST-AGENT, SEC-REVIEW-AGENT) are assumed; rename them to match yours.

### Target data model

| Table | Purpose | Change |
|---|---|---|
| `tenants` | `id`, `slug` (unique, URL-safe), `name`, `status` (`trial`, `active`, `suspended`, `closed`), `created_at` | New |
| `tenant_settings` | One row per tenant (see the field list below) | New |
| `tenant_members` | `(tenant_id, user_id)` PK, `role` (`owner`, `manager`, `staff`), `active`, `display_name` | New; replaces `staff` |
| `tenant_domains` | `host` → `tenant_id`, for aliases such as `card.thecaffeineplug.ph` | New |
| `customers` | Global wallet identity, `id = auth.users.id` | Unchanged |
| `customer_cards` | `(tenant_id, customer_id)` PK, `added_at`, `consent_version`. One card in the wallet. | New |
| `tags` | `+ tenant_id`; tag ID stays globally unique | Altered |
| `stamps`, `redemptions`, `perk_claims` | `+ tenant_id`; composite FK `(tenant_id, customer_id)` → `customer_cards` | Altered |
| `audit_log` | `+ tenant_id` (nullable for platform-level events) | Altered |
| `customer_balances` | Grouped by `(tenant_id, customer_id)`, `security_invoker = true` | Altered |

`tenant_settings` fields:
- **Rules:** `cooldown_minutes`, `daily_cap`, `reward_threshold`, `tag_throttle_seconds`, `timezone`.
- **Display:** `currency`, `reward_label`.
- **Branding:** `brand` (jsonb: colors, logo URL, card art).
- **Perks:** `perks` (jsonb, e.g. an Instagram handle).

**Wallet rule (orchestrator-reserved, proposed):** a card is added only by an explicit "Add *Shop* to your wallet" tap. If a customer taps a shop's NFC tag before they hold that shop's card, `record_stamp` returns `no-card`. The app shows the add-card screen, which calls `add_card` and then retries the stamp, the same way `/start` claims a tag today. This gives a clear consent record per shop and the "new card collected" moment.

### Phase 10: Tenant foundation and zero-downtime migration of Caffeine Plug to tenant #1

- **Goal:** Every row belongs to a tenant. Production keeps working unchanged throughout.
- **Orchestrator-reserved design:**
  - The fixed UUID and slug for tenant #1.
  - `tenant_settings` bounds.
  - The final column list above.
- **Tasks (expand only; nothing is removed yet):**
  1. Create `tenants`, `tenant_settings`, `tenant_members`, `tenant_domains` and `customer_cards`, with RLS enabled and no client grants beyond SELECT.
  2. Insert Caffeine Plug as tenant #1. Its settings equal today's rules (30, 2, 10, 5, `Asia/Manila`), and its domain row is `card.thecaffeineplug.ph`.
  3. `alter table … add column tenant_id uuid not null default '<tenant1-uuid>' references public.tenants`. Since Postgres 11, adding a column with a constant default is metadata-only: no table rewrite, and existing rows read the default. Current code keeps working.
  4. Backfill:
     - one `customer_cards` row for every existing customer;
     - one `tenant_members` row for every `staff` row, keeping the role.
  5. Add composite FKs `(tenant_id, customer_id)` and tenant-leading indexes, e.g. `stamps (tenant_id, customer_id, created_at desc)` and `stamps (tenant_id, tag_id, created_at desc)`.
  6. Seed: 2 tenants with different settings, a staff member at each, one person who is staff at both, and one customer with cards at both.
- **Acceptance criteria:**
  - Deploying to production changes nothing visible.
  - All 5 existing pgTAP suites pass unchanged.
  - A new schema-guard test fails if any `public` table lacks `tenant_id` (except `tenants` and `customers`) or has RLS disabled.
- **Roles:** DB-AGENT (migration), TEST-AGENT (schema guard and seed), SEC-REVIEW-AGENT (review).

### Phase 11: Tenant-aware SQL functions and RLS

- **Goal:** The database alone prevents cross-shop reads and writes, whatever the app does.
- **Tasks:**
  1. Write `private.staff_tenant_ids()` and `private.staff_role(p_tenant)`: SECURITY DEFINER, stable, in a schema the API doesn't expose.
  2. Rewrite every SELECT policy:
     - **customers** see rows where `customer_id = auth.uid()`, across all tenants (this is what the wallet reads);
     - **staff** see rows where `tenant_id in (select private.staff_tenant_ids())`.
     - `tenants` and `tenant_settings` (public fields only) are readable for branding.
  3. New function versions, added as overloads next to the old ones:
     - `record_stamp(p_customer, p_tag)`: takes the tenant from `tags.tenant_id` under the tag lock, loads `tenant_settings`, and returns `no-card` when there's no card.
     - `add_card(p_customer, p_tenant)`: idempotent; records the consent version.
     - `record_manual_stamp(p_actor, p_tenant, p_customer, p_reason)`: the actor must be a member of the tenant; the card must exist in that tenant.
     - `redeem_reward(p_actor, p_tenant, p_customer, p_nonce)`: per-tenant balance and the tenant's own threshold.
     - `claim_perk(p_actor, p_tenant, p_customer, p_perk)`: replaces `claim_instagram_upsize`; perks come from `tenant_settings`.
     - `remove_card(p_customer, p_tenant)`: per-shop erasure.
     - `delete_wallet(p_customer)`: global erasure, only from the customer's own session.
     - `merge_wallets(p_source, p_target)`: moves all cards; when both wallets hold a card at the same shop, it combines them into one.
     - Tag mutations (`create_tag`, `rotate_tag`, `deactivate_tag`): owner or manager only.
  4. Use one advisory-lock form everywhere (fixes F-17). Add a tenant-scoped lock namespace where needed.
  5. Keep `is_staff()` until Phase 12 switches the app over, then drop it together with the legacy `redeem_reward(uuid, uuid)` (F-18).
- **Acceptance criteria:**
  - A pgTAP isolation matrix covering {customer, staff, manager, owner} × {own tenant, other tenant} × every table and RPC, with 0 cross-tenant rows or writes.
  - A test that two tenants with different settings get different cooldown, cap and threshold outcomes.
  - A test that merging wallets that both hold a card at the same shop leaves one card with the stamps summed.
- **Roles:** DB-AGENT, TEST-AGENT, SEC-REVIEW-AGENT (mandatory sign-off).
- **Orchestrator-reserved:** whether a merged same-shop card keeps both perk claims, and the semantics of `remove_card` vs `delete_wallet`.

### Phase 12: App layer (routing, staff, tokens, abuse limits)

- **Goal:** The Next.js app uses the tenant-aware functions, and no code path can skip them.
- **Tasks:**
  1. **Routes:**
     - `/s/<slug>`: shop landing page, add-card screen and card view;
     - `/t/<tagId>`: unchanged URL, now handling `no-card`;
     - `/card` redirects to `/wallet`.
     - Middleware maps alias hosts (`tenant_domains`) to the right slug.
  2. **Staff area** moves to `/staff/<slug>/…`. A shop switcher appears for people with more than one membership. Membership is checked on every request.
  3. **Staff reads** use the logged-in session client, so RLS applies. The service-role client may only call RPCs. Add an ESLint `no-restricted-syntax` rule banning `.from(` on the admin client (F-09).
  4. **Redeem and perk tokens v2** (`tcp2`, `tcpig2`) carry `tenantId` in the signed payload. The staff route passes the staff member's own tenant, and the SQL rejects a mismatch. v1 tokens expire within 5 minutes of the deploy.
  5. **Rate limits:**
     - Use `cf-connecting-ip` for the client IP (F-07).
     - Upstash keys include the tenant.
     - Add per-tenant quotas (e.g. new cards per day).
  6. **Turnstile:** enable CAPTCHA in Supabase Auth and remove the duplicate server verification (F-08).
  7. **Contract step:** once production runs on the new functions, drop the old function signatures, `is_staff()`, the `staff` table and the `tenant_id` column defaults.
  8. **CI:** add Playwright e2e to CI.
- **Acceptance criteria:**
  - Playwright: a shop-A reward QR is rejected at shop B.
  - Playwright: a first tap at a new shop shows the add-card screen, then stamps.
  - Playwright: staff of shop A get a 403 on `/staff/<shop-b>`.
  - Existing Caffeine Plug tags and `card.thecaffeineplug.ph` still work.
- **Roles:** API-AGENT, UI-AGENT, TEST-AGENT, SEC-REVIEW-AGENT.
- **Orchestrator-reserved:**
  - the token v2 format;
  - the staff URL structure;
  - the order of the contract step.

### Phase 13: Wallet and per-shop branding (the collectible experience)

- **Goal:** Customers feel they are collecting cards. Each shop's card looks like that shop.
- **Tasks:**
  1. `/wallet`: a stack of shop-branded cards ordered by last visit, a "cards collected" count, and a history of completed cards. Opening a card goes to `/s/<slug>`.
  2. **Card rendering** from `tenant_settings.brand`: colors, logo and card art, with safe defaults. Contrast is checked against WCAG AA.
  3. **Add-card moment:** a short animation when a new card joins the wallet.
  4. **Per-card actions:** "Remove this card" (`remove_card`) and "Delete my wallet" (`delete_wallet`) in settings.
  5. **Privacy notices:**
     - a platform notice for the wallet account;
     - a per-shop notice generated from tenant settings, linked from the add-card screen.
  6. **Backup prompt:** move it to the wallet level ("Back up all your cards with Google or email").
- **Acceptance criteria:**
  - A customer holding 3 cards sees 3 distinct branded cards.
  - Removing one card leaves the others intact.
  - Accessibility checks pass.
- **Roles:** UI-AGENT, TEST-AGENT.
- **Orchestrator-reserved:**
  - wallet visual design;
  - what a shop sees about a customer (never their other cards);
  - privacy notice copy, after the lawyer reviews it.
- **Later:** Apple and Google Wallet passes as a display layer over `customer_cards`.

### Phase 14: Owner console and platform operations

- **Goal:** You can onboard and support a shop without touching SQL.
- **Tasks:**
  1. **Platform admins:** a `platform_admins` table with MFA (Supabase TOTP) required, and a screen to create a tenant with its slug, settings and first owner invite.
  2. **Owner console** at `/staff/<slug>/settings`:
     - rules within the CHECK bounds, with a preview of what changes for customers;
     - branding upload;
     - tags (create, rotate, deactivate, print the tag URL);
     - staff invites and roles;
     - CSV export of the shop's cards and stamps.
  3. **Support sessions:** time-boxed to 30 minutes, read-only by default, the reason recorded in `audit_log` with the tenant.
  4. **Tenant status switch** (`trial`, `active`, `suspended`), set by hand. `suspended` blocks new stamps; customers can still see the card and redeem for 30 days.
  5. **Ops:**
     - move the `pg_cron` jobs (stale anonymous cleanup) into migrations, with an alert if a run is missed (F-16);
     - add `tenant_id` to structured logs and audit rows (F-20);
     - set up custom SMTP (F-12).
  6. **Per-tenant anomaly alerts** for leaked tag URLs (F-13), with one-click rotate.
- **Acceptance criteria:**
  - A new shop is live in under 30 minutes with no SQL.
  - A settings change is reflected in the SQL outcome on the next tap.
  - Every support session appears in the audit log.
- **Roles:** API-AGENT, UI-AGENT, SEC-REVIEW-AGENT.
- **Orchestrator-reserved:**
  - the impersonation policy;
  - the suspension behaviour;
  - the settings bounds shown to owners.

### Phase 15: Pilot readiness

- **Goal:** 3 real shops running safely, with paperwork in place.
- **Tasks:**
  - A Philippine lawyer reviews:
    - the processing agreement (shop = controller of its card data);
    - the platform's role as controller of the wallet account;
    - the platform terms and privacy notice;
    - the Singapore-region transfer.
  - Write a breach runbook.
  - Rehearse a single-tenant restore: restore a backup into a scratch project, then copy one tenant's rows back.
  - Onboard 3 pilot shops by hand.
  - NFC kit (2 tags + counter QR) per shop.
- **Billing is out of scope** (decision D4). Pilots are free or invoiced by hand.
- **Acceptance criteria:**
  - Processing agreements signed.
  - Restore drill completed once.
  - Each pilot shop has stamped and redeemed at least once.
  - Zero cross-tenant findings from SEC-REVIEW-AGENT.

### Order of work

1. **Phases 10 and 11 are the safety-critical path.** Nothing reaches a second shop until both are done.
2. **Phase 12** follows.
3. **Phases 13 and 14** can run in parallel: different files, and both depend only on Phase 12.
4. **Phase 15's legal work** can start now, alongside the engineering.

Rough size [assumption]: 4–7 developer-weeks for one developer working with agents. The wallet UI (Phase 13) is the most variable part.

---

## 7. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Cross-tenant data leak through RLS or service-role bug | High without Phase 11 | Severe (NPC breach, loss of trust) | F-02, F-09, isolation tests, ESLint ban | Dev + SEC-REVIEW |
| R2 | Cross-shop reward fraud | High | Medium (shops' money) | F-03 tenant-bound tokens | Dev |
| R3 | Leaked static tag URL used for remote stamping | Medium | Medium per shop | Alerts, rotation, 424 DNA tier | Dev / Founder (hardware) |
| R4 | Shared Supabase Auth limits throttle many shops at once (CGNAT, bots) | Medium | High (cards can't be created) | CAPTCHA at Auth, raised limits, per-tenant quotas, monitoring | Dev |
| R5 | Shops don't renew (they see paper cards as "free") | High [assumption] | Fatal | Pilot with paid commitment; show a repeat-visit report | Founder |
| R6 | Processor obligations unmet (no agreement, unclear controller) | High today | High (regulatory, contractual) | Lawyer-drafted agreement and notices before tenant #2 | Founder + PH lawyer |
| R7 | Lapsed tenant's customers lose stamps, causing public complaints | Medium | Medium (reputation) | Read-only grace period, export, notice before deletion | Founder |
| R8 | Founder support load grows faster than revenue | High | High | Self-serve console, honest SLA (business hours, best effort), cheat sheets | Founder |
| R9 | Bad migration on shared DB breaks every shop at once | Medium | High | Staging project, expand/contract, PITR at ~10 tenants, rollback rehearsed | Dev |
| R10 | Vendor or price changes (Supabase MAU, Cloudflare, payment fees) | Medium | Medium | Track the MAU metric monthly; avoid lock-in on payment provider; review annually | Founder |

---

## 8. Business model sketch

**Every number here is an assumption unless a source is given. FX is assumed at ₱58 = US$1.**

**Target customer [assumption]:** independent cafés, milk-tea shops and bakeries with 1–3 branches, 50–300 transactions a day, already using paper stamp cards or nothing, and no POS with built-in loyalty.

**Pain solved:** lost or forged paper cards, no customer count or repeat-visit data, no app download for customers.

**Competitor landscape [Unknown; not researched in this review]:** paper cards (₱0 software), loyalty add-ons in the POS systems shops already use, and generic digital stamp-card apps. Validate in pilots by asking each shop what it uses today and what it would replace.

**Pricing hypothesis:** ₱799/month per location (or ₱7,990/year), plus a ₱1,500 one-time starter kit (2 NFC tags, counter QR standee). A 30-day free trial for pilots. A premium tier at about ₱1,499 with NTAG 424 DNA tags, custom branding and analytics.

**Unit economics (monthly):**

| Item | 10 tenants | 100 tenants | Basis |
|---|---|---|---|
| Supabase | $25 | $25 + compute upgrade [Unknown] + optional PITR $100 | Pro $25, $10 compute credit, 100k MAU included, then $0.00325/MAU ([pricing](https://supabase.com/pricing), checked 2026-11-03) |
| MAU overage | $0 | $0 if under 100k | Assumes 300 active customers per shop gives 30k MAU at 100 tenants. [Unknown] whether anonymous users count as MAU; the docs don't say. |
| Cloudflare Workers, Upstash, SMTP, domain | ~$15 | ~$40 | [Assumption, not verified] |
| Infra per tenant | ≈ ₱230 | ≈ ₱100–150 | — |
| Payment fees | ~3% ≈ ₱24 | same | [Assumption; PayMongo rates not verified] |
| Support (1 h/tenant/month at ₱300/h of your time) | ₱300 | ₱300 | [Assumption] Dominant cost |
| **Gross margin at ₱799** | **≈ 30%** | **≈ 45–55%** | Mostly a function of support time |

NFC hardware [assumption]: NTAG215 cards cost tens of pesos each, so the kit fee covers them. 424 DNA tags cost several times more and need per-tag key management, so keep them in the premium tier.

**Billing for the Philippines (deferred by decision D4; kept for reference only):**
- PayMongo's developer docs describe recurring billing on cards, and list Maya.
- GCash recurring is claimed on PayMongo's marketing page, but a Maya developer forum post says GCash doesn't support recurring payments, so treat it as unconfirmed ([PayMongo subscriptions](https://www.paymongo.com/products/accept-payments/subscriptions), [PayMongo docs](https://developers.paymongo.com/docs/subscriptions); checked 2026-11-03).
- For pilots, use **prepaid quarterly or annual payment links (GCash/Maya/card) and manual invoices**. Build subscription automation after about 10 tenants.
- Ask a PH accountant about BIR registration, invoicing and VAT obligations.

**Suspension behaviour (recommended):**
1. `past_due` with a 14-day grace period.
2. `suspended`: no new stamps; customers can still view their cards and redeem rewards for 30 days.
3. Export offered to the shop.
4. Deletion after the agreed retention period.

**Key assumption to test first with 3 pilot shops:** *Will a small shop pay ₱799/month after 60 days because it can see more repeat visits?*
- Measure each shop's repeat-visit rate from the ledger and their stated willingness to pay before the trial ends.
- Ask for payment up front for months 2–3.
- If 2 of 3 won't pay, stop building platform features.

---

## 9. Open questions for the owner (ordered by impact on the plan)

Answered on 2026-11-03: shared wallet vs separate shops (D1), routing (D2), per-shop rules at launch (D3), billing (D4). The questions still open:

1. **What is the platform's name and domain?** Path routing (D2) puts every shop under it (`<domain>/s/<slug>`, `<domain>/wallet`), and new shops' tags and QR codes will be printed with it. Also confirm whether `card.thecaffeineplug.ph` is live (F-19). This blocks Phase 12.
2. **Will the platform ever use wallet data across shops**, for example "you might like this café" suggestions or aggregate analytics? The wallet already makes you a likely controller of the wallet account. Cross-shop use widens that and needs explicit consent (lawyer question).
3. **Can a shop see that a customer holds other shops' cards?** Recommended: never. The plan assumes no.
4. **Who is the first buyer:** single cafés, or a multi-branch chain? Chains need `locations` within a tenant (tags and staff per branch).
5. **Hardware:** will you supply and write the NFC tags yourself, and are you willing to stock NTAG 424 DNA?
6. **What support can you honestly offer:** hours, response time, and who covers when you're unavailable?

---

## 10. What I could not assess, and why

- **Master spec:** not provided. Design intent comes from the request text, `DECISIONS.md` and `BACKLOG.md`.
- **Orchestrator and sub-agent process docs:** not in the repo. The roadmap's agent roles are assumed.
- **Hosted configuration** (needs dashboard access):
  - Supabase: CAPTCHA, rate limits, MFA, custom SMTP, PITR, region (the runbook says Singapore), whether `pg_cron` cleanup is scheduled, OAuth redirect URLs.
  - Cloudflare: Workers plan, WAF rules.
  - Upstash: plan.
- **Code read only partly or not at all:**
  - Pages and components other than `GetCardButton`.
  - `app/api/customers/merge-intent`, `app/api/redeem-token`, `app/api/perks/instagram-upsize`.
  - `lib/security/{csrf,logger,mergeToken}.ts`, most of `lib/contracts.ts`.
  - `docs/FUTURE_UPGRADES.md`, `docs/NFC_AND_QR_PROVISIONING.md`.
  - The bodies of the pgTAP and unit tests (counted, not audited).
- **No dynamic testing was run.** F-07 (XFF spoofing) and F-08 (Turnstile double use) are inferred from code plus vendor docs and need a live test.
- **Third-party facts not verified:** Cloudflare Workers pricing, cost of extra Supabase projects, PayMongo fees, competitor pricing, NFC tag prices, BIR/VAT rules.
- **Legal (needs a Philippine lawyer):**
  - Controller/processor roles.
  - Required contract clauses for subcontracted processing.
  - Whether loyalty data counts as "sensitive personal information" for NPC registration. NPC Circular 2022-04 triggers include 250+ employees or processing sensitive personal information of 1,000+ people, but an NPC reminder words the 1,000 figure as "customers" ([Baker McKenzie summary](https://insightplus.bakermckenzie.com/bm/data-technology/philippines-new-npc-circular-on-registration-of-data-protection-officers-and-data-processing-systems-takes-effect_1), [NPC reminder](https://privacy.gov.ph/?p=43514); checked 2026-11-03).
  - Cross-border transfer to a Singapore region.
  - Breach notification timelines.
  - Consumer-protection duties when a shop's subscription lapses.
- **Business viability:** no market, pricing or customer-interview data was provided. Section 8 is a hypothesis to test, not a forecast.

### Capacity estimate (supports dimension 8)

**Assumptions [all assumptions]:**
- 150 stamps/day per shop, peaking at 3× the average during a 2-hour morning rush.
- Each tap is one PostgREST RPC: 2 advisory locks and about 4 indexed lookups, roughly 5 ms of database time.

| Tenants | Stamps/day | Peak writes/s | Ledger growth/yr (rows) | Expected fit |
|---|---|---|---|---|
| 10 | 1.5k | < 1 | ~0.5M | Pro + Micro, no changes |
| 100 | 15k | ~5 | ~5.5M | Micro or Small; tenant-leading indexes are enough |
| 1,000 | 150k | ~50 | ~55M (≈ 15–25 GB including indexes) | Larger compute; archive or partition ledgers older than 2 years; rollup tables for dashboards; possibly split off the largest tenants |

**Notes:**
- Advisory locks are per customer and per tag, so contention stays within one shop's counter, not across tenants.
- The serverless runtime talks to Postgres over HTTP through PostgREST (`supabase-js`), so Workers don't exhaust database connections. [Verified: the client is `@supabase/supabase-js`, see `lib/supabase/admin.ts`]
