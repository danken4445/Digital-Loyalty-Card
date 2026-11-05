# Handoff: Phase 13 final review and fix wave (for Opus)

You are the whole-branch reviewer for **Phase 13 (wallet and per-shop branding)** on branch `feat/multi-tenant-db`. Review the whole Phase 13 diff, fix Critical and Important findings in **one fix wave**, then run **one scoped re-review**. Then run the full gate yourself and stop. Do not start Phase 14. Do not push, merge or open a PR; those need the owner's yes.

## State at handoff (read this first)

- **Phase 13 base:** `0641170` (end of Phase 12). **Last commit:** `a11c5a5`. Tasks 1–5 are committed and each passed its task review (Tasks 4 and 5 after one fix round each). The working tree is clean apart from the untracked files listed below.
- **Task 5's fix round is done.** `a11c5a5` (`fix(privacy): mark notices as counsel drafts, correct claims and retention copy, flatten styling`) fixed all seven findings from the failed review and passed a scoped re-review (reviewer on the `pro` tier). The "Open Task 5 findings" section below is kept as history so you can spot-check that the fixes hold; it is no longer a to-do list.
- **Task 6 was deliberately not written.** All 5 Review Focus cases already have named tests (see the ruling in `progress.md`). If you find a cross-task flow no test covers, add a test for it in your fix wave instead of a duplicate integration file.
- **Untracked files that must NOT be committed:** `pnpm-lock.yaml` and `pnpm-workspace.yaml` reappeared in the repo root. D-010 deliberately removed them (`package-lock.json` is the only lockfile, CI uses `npm ci`). Delete them or leave them untracked; never `git add` them. Also never commit `.claude/` or `.superpowers/`. `progress.md` and `docs/superpowers/` are untracked; ask the owner before committing them.

## Read these

| Need | File |
|---|---|
| Rules that bind every task (SQL, app, tests, git) | `docs/superpowers/handoff/2026-11-04-phases-13-15-handoff.md` ("Rules that bind every task") |
| Phase 13 scope and acceptance | `docs/assessments/MULTI_TENANT_READINESS_2026-11-03.md`, section 6, Phase 13 |
| The plan and its Review Focus (5 cases, each with a test name) | `docs/superpowers/plans/2026-11-04-phase13-wallet.md` |
| Ledger: rulings, deferred minors, fix rounds | `progress.md` |
| Per-task briefs, reports, diffs | `.superpowers/sdd/2026-11-04-phase13-wallet/` (`task-N-brief.md`, `task-N-report.md`, `review-*.diff`) |
| Shared types (additive Phase 13 commit `4283ac2`) | `lib/contracts.ts` |
| CSP and security headers | `next.config.ts`, DECISIONS D-010 |

## What was built (commits after `0641170`)

| Commit | Task | Summary |
|---|---|---|
| `4283ac2` | contracts | `WalletCardSummary.cardsCompleted?`, `MergeWalletsOutcome` + `isMergeWalletsOutcome`, `ROUTES.shopPrivacy` |
| `de4a7c7` | 1 | `lib/brand/contrast.ts` (WCAG luminance/contrast, `resolveCardTheme`), cached `Intl.DateTimeFormat` in `lib/rules/display.ts` |
| `96a5b93` | 2 | IPv6-safe `normalizeHost` in `lib/tenants/context.ts`, runtime-validated `merge_wallets` result, dead `verifyTurnstileToken` removed |
| `aafd8a2` | 3 | Branded `/s/[slug]`, member-since in shop timezone, "GET MY CARD" without a tag, `AddCardCelebrationBanner`, privacy link in `AddCardPanel` |
| `a7ed138`, `7c6a36f` | 4 | `components/wallet/WalletCardStack.tsx`, `WalletBackupModal.tsx`, `/wallet` rewrite, empty-state mascot; fix round 1 (image path, in-modal consent) |
| `ba16bb1`, `a11c5a5` | 5 | `app/s/[slug]/privacy/page.tsx`, platform notice rewrite, `DeleteCardButton` scope; fix round: counsel-draft banners, claims and retention copy corrected, flat styling, card-existence check, platform naming |

Deferred minors from the Phase 13 handoff that Phase 13 resolved: #1 (member-since timezone), #2 (signed-out CTA copy), #5 (empty wallet mascot), #7 (dead turnstile code), #8 (merge cast), #10 (IPv6 host), #11 (formatter per call). Left for Phase 14: #3, #4, #6, #9.

## Task 5 findings from the first review of `ba16bb1` (all fixed in `a11c5a5`; spot-check that they hold)

Critical:
1. Neither privacy page carries a "draft, pending Philippine counsel review" marker, and both state controller/processor roles as settled fact. The handoff requires legal text to be a marked draft. Needs a visible banner on both pages, softer role wording, and a test pinning the marker.
2. The platform page makes unverified technical claims: "isolated cryptographic partition" (isolation is RLS, not cryptography), cryptographic keys hosted in Singapore, TLS 1.3 and AES-256 at rest. Remove or attribute them (e.g. "hosted on Supabase in AWS ap-southeast-1").

Important:
3. Shop retention copy is wrong. The 30-day cleanup removes zero-stamp anonymous accounts platform-wide; it does not purge cards from a shop's ledger.
4. Shop notice lists only some RA 10173 rights and has no controller/DPO contact.
5. New pages use `shadow-[…]`, `backdrop-blur-md`, `border-2`, `shadow-inner`, against the flat, 1px-border rule applied as a review constraint.
6. The "connected card" badge and "Remove this card" button render even when the customer has no card at that shop.
7. The platform notice is labelled with `SHOP_CONFIG.name` (the Caffeine Plug) instead of the platform operator.

Minor (deferred, see `progress.md`): weak regex assertions in the privacy tests, `(globalThis as any).React` in a test, decorative corner tick using `#000` on `accentColor`, and a section-numbering typo in `app/privacy/page.tsx` (Section 7 heading reads "5.").

## Things I suspect but have not verified (check these)

These come from reading diffs and reports, not from running the app. Treat them as leads.

1. **CSP versus tenant image URLs.** D-010 sets `img-src 'self' data:`. `resolveCardTheme` passes tenant-controlled `logoUrl` and `cardArtUrl` straight into `<Image unoptimized>` on `/s/[slug]`, `/wallet` and `OnboardingCard`. An external logo URL would be blocked by the CSP and render broken. Also confirm what URL schemes `resolveCardTheme` accepts (no scheme check was seen). Decide: constrain to root-relative or same-origin paths, or widen CSP deliberately and record a ruling.
2. **Roadmap says "a history of completed cards".** The code shows a `cardsCompleted` count per shop and a total, not a history list. Check this against the Phase 13 acceptance text and decide whether it is a gap or an acceptable reading.
3. **"Accessibility checks pass" (acceptance criterion).** The only accessibility work is the contrast math. No axe or browser check was run. Report this as unverified unless you run one.
4. **`WalletBackupModal.tsx` (about 470 lines).** Likely duplicates the Google and email backup logic in `components/card/BackupCardPanel.tsx` (about 490 lines). Check for verbatim duplication and whether the two can drift. A merge-intent call (`prepareMergeIntent`) is used; confirm it follows the D-009 flow and that the Turnstile token is sent on every CAPTCHA-gated call (D-013 deploy note).
5. **Review Focus #3 (`wallet_backup_preserves_all_cards`) is a mock-based test.** It does not run a real merge. Real coverage of "same-shop cards combine, stamps summed" is in pgTAP (`supabase/tests/database/11_wallet_lifecycle.test.sql`). Confirm that file actually asserts it.
6. **Review Focus #2 (`remove_card_preserves_other_shop_cards`)** only checks RPC call arguments. Confirm real isolation in pgTAP.
7. **Reviewer independence.** Implementers and reviewers all ran on the same session model (the harness has no named Sonnet/Opus tier), so no review had a stronger model. Your review is the first one that does.
8. **`formatMemberSince(timestamp, timeZone)`** changed signature in `lib/rules/display.ts` (Task 3). Check every other caller, including staff pages.
9. **`mix-blend-lighten`** on the mascot and inline brand colours: confirm the empty wallet is legible on the tenant-neutral dark background.

## What to do

1. **Orient.** `git status`, `git log --oneline 0641170..HEAD` (the last commit should be `a11c5a5`), read `progress.md`.
2. **Review the whole Phase 13 diff** (`git diff 0641170..HEAD`). Check against the Phase 13 acceptance criteria, the binding rules, and the leads above. Look for cross-task problems that per-task reviewers could not see: shared types, the `?added=1` flow from `AddCardPanel` through `/api/cards` to `/s/[slug]`, `DeleteCardButton` scopes against `/api/cards` and `/api/customers`, and `listWalletCards` consumers.
3. **Classify findings** Critical / Important / Minor with `file:line` evidence. Do not fix Minor items; add them to the `progress.md` deferred list.
4. **One fix wave** for Critical and Important. Follow TDD (write the failing test, watch it fail). No fix without a covering test. Commit with Conventional Commits and no co-author or Claude attribution trailers.
5. **One scoped re-review** of the fix diff only. New Critical or Important breakage in the fix diff joins the wave; out-of-scope observations go to the ledger.
6. **Run the full gate yourself on the final tree**, with `set -o pipefail` in any script:
   - `export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (before `supabase start`)
   - `npx supabase db reset` immediately before `npx supabase test db` (containers are shared with the hotfix worktree). Baseline was 9 files, 300 tests.
   - `npm run lint && npm run typecheck && npm run test:unit`. Last green count seen: 494 tests across 23 files at `a11c5a5` (the Task 5 implementer's run; I have not re-run it myself). Your run is the one that counts.
   - On Windows PowerShell, `&&` is not a valid separator; chain with `;` and check `$LASTEXITCODE`, or use Git Bash at `C:\Program Files\Git\bin\bash.exe`.
7. **Report and stop.** Include: what shipped, gate results, unverified items, the complete list of `Ruling:` entries with their cost, deferred minors. Then ask the owner before starting Phase 14 or pushing.

## Known unverified at handoff (carry into your report unless you verify)

- Playwright e2e has never run (targets WebKit; only Chromium is installed; ask the owner before downloading WebKit).
- Nothing has been exercised live with Supabase Auth CAPTCHA on, including whether `updateUser` (email backup) is CAPTCHA-gated.
- pgTAP was last run on `0641170` (green, 9 files, 300 tests). Phase 13 added no migrations, but it has not been re-run since.
- No manual browser pass of `/wallet`, `/s/[slug]` or the privacy pages has been done. Subagent output reports unit tests, typecheck, lint and one `next build` (Task 4) only.

## Owner questions that block Phase 13 wording

- **Cross-shop use of wallet data** decides the data-controller wording in both privacy notices. Until the owner answers, the notices must stay marked as drafts for counsel and must not assert final roles.
- **Platform name and domain** is still unanswered; the platform notice should name the operator consistently and not the Caffeine Plug.
