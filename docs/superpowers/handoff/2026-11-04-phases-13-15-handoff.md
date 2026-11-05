# Handoff: Multi-Tenant Phases 13–15

You are picking up the conversion of the Caffeine Plug NFC loyalty card (Next.js 15 on Cloudflare Workers, Supabase Postgres) into a multi-tenant SaaS for small Philippine shops. Phases 10–12 are built and reviewed. Your job is **Phase 13 (wallet and branding)**, then **Phase 14 (owner console and operations)**, then the **code-adjacent part of Phase 15 (runbooks)**. Each phase follows the same loop: you write the plan, Sonnet sub-agents build it task by task with a review after each task, and one Opus reviewer checks the whole branch.

## Where things stand

- **Branch `feat/multi-tenant-db`**, head `0641170`. Nothing is pushed. The gate passes:
  - `npx supabase db reset && npx supabase test db`: 9 files, 300 tests;
  - `npm run lint && npm run typecheck && npm run test:unit`: 457 tests.
- **Branch `fix/sql-construct-qualification`** (off `main`): a hotfix for the legacy merge and stale-cleanup functions. It isn't merged. Phase 12's contract migration makes it unnecessary on this branch; it matters only if `main` ships first.
- **Unverified:**
  - The Playwright e2e suite has never run. It targets WebKit (iPhone 13), and only Chromium is installed; ask the owner before downloading WebKit.
  - Nothing has been exercised live with Supabase Auth CAPTCHA on, including the assumption that `updateUser` (email backup) is not CAPTCHA-gated.

## Sources of truth: read these, don't restate them

| Need | Read |
|---|---|
| Owner decisions D1–D4, the roadmap, findings, open questions | `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md`: section 1 (decisions), section 6 Phase 13/14/15 (scope and acceptance), section 9 (open questions) |
| What was built and why | `DECISIONS.md` D-012 (database) and D-013 (app switch) |
| Plan format and quality bar | `docs/superpowers/plans/2026-11-04-phase12-app-switch.md` (copy its Global Constraints style) |
| Shared types and routes | `lib/contracts.ts` |
| Deploy order, multi-tenant ops, rollback | `docs/DEPLOYMENT_AND_OPS.md` sections 8–9 |
| Schema | `supabase/migrations/2026110[45]*.sql` (tenants, tenant_settings, tenant_members, tenant_domains, customer_cards, RLS helpers, tenant-aware RPCs) |

## Steps

1. **Orient.** Read the Phase 13 section of the roadmap, D-012, D-013 and the Phase 12 plan's Global Constraints. Run the gate once to confirm the baseline is green. *Done when* both gate commands pass on a fresh `db reset`.
2. **Plan Phase 13.** Invoke the `writing-plans` skill. Save to `docs/superpowers/plans/<date>-phase13-wallet.md`.
   - Before writing tasks, change `lib/contracts.ts` yourself. Sub-agents treat it as fixed: put only additive types in your own commit, and give each breaking change to the task that implements it, verbatim (the Phase 12 pattern).
   - *Done when* every Phase 13 acceptance item in the roadmap maps to a task with named tests, and the plan has a Review Focus of 5 risky cases, each with its test.
3. **Execute Phase 13.** Invoke the `subagent-driven-development` skill.
   - Implementers and task reviewers run on **Sonnet**; the final whole-branch reviewer runs on **Opus**.
   - Keep a ledger at the workspace `progress.md`.
   - Record every decision as `Ruling: <what> — <why> — <cost if wrong>`.
   - Dispatch implementers one at a time, never in parallel.
   - *Done when* every task's review is clean (or parked with a ruling), the final review's Critical and Important findings are fixed through one fix wave plus one scoped re-review, and you ran the full gate yourself on the final tree.
4. **Plan and execute Phase 14** the same way (steps 2–3). Database changes are expand-only and follow the SQL rules below.
5. **Phase 15 runbooks.** Write:
   - a breach-response runbook;
   - a single-shop restore drill: restore a backup into a scratch project, then copy one tenant's rows back by `tenant_id`;
   - a pilot onboarding checklist (create the shop, invite the owner, create and write tags, print the counter QR).

   Put them in `docs/`. Legal documents (the processing agreement, the platform privacy notice, the wallet-controller question, the Singapore data transfer) are **drafts marked "for Philippine counsel review"**, never final text.
6. **Report and stop** after each phase. Include:
   - what shipped;
   - gate results;
   - unverified items;
   - the complete list of every `Ruling:` from the ledger, with its cost;
   - deferred minors.

   Then ask the owner before starting the next phase or pushing.

## Phase scope (summary; the roadmap holds acceptance criteria)

- **Phase 13, wallet:**
  - `/wallet` becomes a collectible stack of shop-branded cards rendered from `tenant_settings.brand` (colors, logo, card art; WCAG AA contrast), with a "cards collected" count and a history of completed cards.
  - An add-card moment animation.
  - A per-shop privacy notice generated from settings, plus a platform notice for the wallet account.
  - The backup prompt moves to wallet level.
  - Branding replaces the remaining hard-coded Caffeine Plug assets (mascot, "50% OFF" preview) with per-tenant assets; tenant #1 keeps the current look.
  - Wallet passes (Apple/Google) are LATER, not this phase.
- **Phase 14, owner console and operations:**
  - **Platform admin:** a `platform_admins` table with required MFA (Supabase TOTP), and tenant creation with a slug, settings and an owner invite.
  - **Owner console:** rules within the `tenant_settings` CHECK bounds (with a preview of what changes for customers), branding upload, tags, staff invites and roles, and CSV export.
  - **Support sessions:** time-boxed to 30 minutes, read-only by default, reason recorded in `audit_log`.
  - **Tenant status switch:** a `suspended` tenant blocks stamps while redemptions still work for 30 days.
  - **Operations:** `pg_cron` jobs in migrations with a missed-run alert, `tenant_id` in structured logs, custom SMTP, per-tenant tag-leak alerts with one-click rotate, and per-tenant rate-limit keys and quotas.
  - **Billing:** out of scope (owner decision D4).

## Rules that bind every task

- **SQL:**
  - SECURITY DEFINER functions use `set search_path = ''` and fully qualified names.
  - Leave `coalesce`, `least`, `greatest` and `nullif` unqualified: they are SQL constructs, and `pg_catalog.least(...)` is a runtime error (this broke production on `main`).
  - Every public function: `revoke all … from public, anon, authenticated; grant execute … to service_role;`.
  - New migrations only, never edits to applied ones.
  - Advisory locks use `pg_advisory_xact_lock(hashtextextended(key, ns))`, namespace 1002 = tag before 1001 = customer.
  - The tenant always comes from the database (tag, membership, slug lookup), never from a request body.
- **App:**
  - Reads go through `createSupabaseServerClient()` so RLS applies.
  - The admin client is for `.rpc(...)` only; ESLint enforces this.
  - Staff act on the active shop from `requireStaffSession()`.
  - Client IP comes from `getClientIp(request)`.
  - Shop copy, rules and branding come from `TenantContext.settings`.
- **Tests:**
  - TDD: the failing test first, and you watch it fail.
  - Every unit test that mocks `@/lib/security/ratelimit` includes `getClientIp`.
  - pgTAP files are numbered after `12_`.
- **Local database:** the Supabase containers are shared with the hotfix worktree, so run `npx supabase db reset` immediately before `npx supabase test db`. Before `supabase start`, export `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (Cloudflare's test secret; `[auth.captcha]` reads it).
- **Gate scripts:** use `set -o pipefail`. A piped gate once masked a failing database run as a pass.
- **Git:** Conventional Commits with no co-author or Claude attribution trailers. Never commit `.claude/` or `.superpowers/`. Work on the feature branch; pushing, merging and opening PRs need the owner's yes.

## Deferred minors to fold into Phase 13/14 tasks

- "Member Since" and the staff tag times still use Manila time instead of the shop timezone.
- The signed-out shop page without a tag says "GET MY CARD & CLAIM STAMP".
- The active shop can drift between browser tabs.
- An add-card loop at a suspended shop loses its status message.
- The empty `/wallet` lost the mascot.
- Repeated body-parse and tenant-resolve code in the reward-token routes.
- `lib/security/turnstile.ts` and the `captcha_failed` code are unused.
- The `merge_wallets` result cast is unchecked and duplicated.
- No tests assert the `tenant_id` filters on tag and dashboard queries.
- `getTenantSlugForHost` mangles IPv6 hosts.
- `formatDateTimeInZone` builds a new formatter per call.

## Questions only the owner can answer (ask before the phase they block)

- **Platform name and domain:** it blocks printed QR codes and tags for new shops. Phase 12 reads it from `NEXT_PUBLIC_SITE_URL` or a `tenant_domains` alias.
- **Cross-shop use of wallet data:** this decides the data-controller wording in Phase 13's privacy notices.
- **Single cafés or multi-branch chains first:** chains need `locations` inside a tenant (Phase 14 schema).
- **Hardware:** who supplies and writes the NFC tags, and whether NTAG 424 DNA is a premium tier.
- **Support:** hours and response time you can honestly promise; this shapes Phase 14 support sessions and the runbooks.
