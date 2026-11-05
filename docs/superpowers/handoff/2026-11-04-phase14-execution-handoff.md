# Handoff prompt: execute Phase 14 (owner console and platform operations) with sub-agents

You are the **controller** for Phase 14 of the Caffeine Plug multi-tenant loyalty app (Next.js 15 on Cloudflare Workers, Supabase Postgres, Vitest, pgTAP). Execute the plan task by task with fresh sub-agents (an implementer, then a reviewer, per task), then a whole-branch review. Do not implement tasks yourself.

## Start here

1. Repo `C:\dev\DigitalLoyalty` (Windows; use Git Bash for scripts), branch `feat/multi-tenant-db`. Do not switch branches. Nothing is pushed; **do not push, merge or open a PR without the owner's explicit yes.**
2. Read, in order:
   - `docs/superpowers/plans/2026-11-04-phase14-owner-console.md` (the plan: Global Constraints, proposed rulings R-1..R-6, Review Focus, Tasks 0-9, final gate)
   - `.superpowers/sdd/2026-11-04-phase14-owner-console/progress.md` (the ledger: preflight table, rulings, task log; trust it and `git log` over memory)
   - `.superpowers/sdd/2026-11-04-phase14-owner-console/constraints.md` (shared constraints to hand every sub-agent)
   - `docs/superpowers/handoff/2026-11-04-phases-13-15-handoff.md` (rules that bind every task) and `DECISIONS.md` D-012, D-013
3. Invoke the `subagent-driven-development` skill and follow it (briefs via its `scripts/task-brief`, review packages via `scripts/review-package`, `references/fix-loop.md` before every fix round, `references/final-review.md` at the end). The workspace is `.superpowers/sdd/2026-11-04-phase14-owner-console/` (briefs `task-N-brief.md` already exist for Tasks 0-9).

## State at handoff

- Last commit: `00a0ee8 feat(contracts): additive contracts for Phase 14 console` (on top of `8b1f55f`). **Task 0 is complete.** Phase 13 is finished and gated (pgTAP 9 files / 300 tests; lint, typecheck, `test:unit` 24 files / 506 tests).
- **Task 1 was dispatched and may be mid-flight.** An implementer sub-agent from the previous controller session was building `supabase/migrations/20261106000000_phase14_platform_and_suspension.sql` and `supabase/tests/database/13_platform_and_suspension.test.sql`; both exist **uncommitted**. Before doing anything: run `git status` and `git log --oneline -5`.
  - If Task 1's commit (`feat(db): add platform admins and suspension redemption window`) exists, review it: `bash <skill>/scripts/review-package <plan> 00a0ee8 HEAD`, then dispatch the task reviewer (BASE is `00a0ee8`).
  - If the files are uncommitted, wait: that implementer may still be writing. Do not edit those files or start another implementer on Task 1 until the owner confirms the old agent has stopped. If it is gone, discard nothing; re-dispatch a new Task 1 implementer and tell it which uncommitted files exist so it can reuse them after checking them against the brief.
- Untracked files you must **never** commit: `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.claude/`, `.superpowers/`. `progress.md` and `docs/superpowers/` are untracked; ask the owner before committing them.

## Rules (binding; the plan and constraints.md hold the full text)

- **SQL:** new migrations only, expand-only. SECURITY DEFINER with `set search_path = ''` and fully qualified names, except `coalesce`, `least`, `greatest`, `nullif` (unqualified; `pg_catalog.least(...)` is a runtime error). Every public function: `revoke all ... from public, anon, authenticated; grant execute ... to service_role;`. The tenant always comes from the database (membership, tag, slug lookup, support session), never from a request body. Advisory locks `hashtextextended(key, ns)`, 1002 before 1001.
- **App:** reads via `createSupabaseServerClient()` (RLS); the admin client is for `.rpc(...)` only. `verifySameOriginRequest` first on state-changing routes, `getClientIp(request)`, `ApiResponse<T>`, `Cache-Control: no-store`. Unit tests that mock `@/lib/security/ratelimit` include `getClientIp`. Flat UI: no shadows, backdrop blur or `border-2`; WCAG AA.
- **Tests:** TDD with a watched failing test first. pgTAP files numbered from `13_`. Run `npx supabase db reset` **immediately before** `npx supabase test db`, with `export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` set first; use `set -o pipefail` in gate scripts. The Supabase containers are shared with another worktree. After a migration, regenerate types with `npm run db:types` and commit `lib/supabase/database.types.ts` with that task.
- **Git:** Conventional Commits, **no co-author or Claude attribution trailers** (the owner's rule overrides any default). Commit message per task is given in the plan.
- **Models:** pass `model` explicitly on every Agent call. Implementers and task reviewers: `sonnet` (use a stronger tier for the security-sensitive SQL in Tasks 2 and 4 reviews). The final whole-branch review: the most capable model (`opus`). One implementer at a time, never in parallel. Sub-agents never dispatch sub-agents.

## Task order

0 contracts (done) -> 1 platform admins and suspension (DB) -> 2 tenant admin RPCs (DB) -> 3 brand storage (DB) -> 4 support sessions (DB) -> 5 platform admin app -> 6 owner console shell, rules, staff -> 7 branding, tags, CSV -> 8 ops (cron, heartbeat, tenant-keyed logs and limits, tag-leak signals, SMTP docs) -> 9 deferred minors, suspended-shop UX, docs and D-014 -> final gate.

Decide conflicts yourself and record each as `Ruling: <what> — <why> — <cost if wrong>` in the ledger (rulings R-1..R-6 and the four preflight rulings are already adopted). Stop only for: an irreversible or destructive operation, a security-sensitive action, an outside-worktree side effect (push, merge, publish), or a plan so broken every path is a guess.

## Finish

After all tasks: the whole-branch review of `git diff 8b1f55f..HEAD` (one fix wave plus one scoped re-review), then run the full gate yourself on the final tree: `export TURNSTILE_SECRET_KEY=...`, `npx supabase db reset`, `npx supabase test db` (expect the 9 baseline files plus `13_` to `16_`), then `npm run lint && npm run typecheck && npm run test:unit`. On Windows PowerShell use `;` and check `$LASTEXITCODE`, or use Git Bash.

Then report and stop: what shipped, gate results, unverified items (TOTP enrolment live, Storage upload live, SMTP, uptime monitor, `pg_cron` on hosted Supabase, Playwright e2e which has never run, accessibility audit, any browser pass), every `Ruling:` with its cost, deferred minors. Copy the Phase 14 `Ruling:` lines into the repo-root `progress.md`. Ask the owner before Phase 15 runbooks or any push or PR.

## Open owner questions (defaults are in the plan)

Support hours and response time, single cafés versus chains (no `locations` table in this phase), platform name and domain (affects printed tag and QR URLs only).
