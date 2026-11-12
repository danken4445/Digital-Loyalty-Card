# Milestone Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a configurable, cycle-based Milestone Reward system where shop owners can define an interim reward (e.g., at 5 of 10 stamps, get 50% off next purchase) that customers redeem via QR code without deducting stamps, and which expires if the full card is completed before claiming.

**Architecture:** A new PostgreSQL migration adds `milestone_step` and `milestone_reward_label` to `public.tenant_settings` and provisions `public.milestone_claims` tracking claims per `(tenant_id, customer_id, cycle_index)`. A dedicated transactional RPC `public.redeem_milestone_reward` validates cycle eligibility, enforces advisory locking, and burns single-use nonces. The cryptographic token layer mints 5-minute signed `tcpmilestone2` tokens. Customer card views render dynamic milestone badges and claim panels, and `/staff/redeem` verifies and confirms redemptions without stamp deductions.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind CSS, Supabase PostgreSQL (`SECURITY DEFINER` RPCs), Vitest, pgTAP.

**Spec:** [`docs/superpowers/specs/2026-11-11-milestone-rewards-design.md`](file:///g:/Projects/Digital-Loyalty-Card/docs/superpowers/specs/2026-11-11-milestone-rewards-design.md)

---

## Global Constraints

- **SQL:**
  - Expand-only migration `supabase/migrations/20261111000000_milestone_rewards.sql`; never modify previous migrations.
  - `SECURITY DEFINER` functions must specify `set search_path = ''` and schema-qualify all table and function references (except SQL constructs `coalesce`, `least`, `greatest`, `nullif`).
  - Strict permissions: `revoke all on function public.redeem_milestone_reward(...) from public, anon, authenticated; grant execute on function ... to service_role;`.
- **Application & Edge:**
  - ESLint rule banning `admin.from(...)` in server route handlers remains strictly enforced (all privileged writes use `admin.rpc(...)`).
  - Token domain separation: `tcpmilestone2` must never be verified as `free-coffee` (`tcp2`) or `instagram-upsize` (`tcpig2`).
  - Single-use nonces must be burned in `public.audit_log` with unique constraint `audit_log_redeem_nonce_uidx`.
- **Testing:**
  - Test-Driven Development (TDD): Write failing test first, verify failure, implement minimal solution, verify green.

---

## Review Focus

1. **Cycle Index Computation & Boundary Conditions:** When a customer has exactly 10 stamps on a 10-stamp threshold card, `total_stamps = 10` means `cycle_index = 1` and `current_stamps = 0`. Any unclaimed milestone perk from cycle 0 is expired and must not be redeemable. → Task 1 pgTAP `milestone_expires_once_card_completes` and Task 2 unit test `evaluates_cycle_expiry_at_threshold`.
2. **Double-Claim Prevention within a Cycle:** A customer sitting at 6, 7, 8, or 9 stamps who already claimed their milestone perk at stamp 5 cannot generate or redeem another milestone reward in that same cycle. → Task 1 pgTAP `milestone_rejects_second_claim_in_same_cycle` and Task 4 unit test `redeem_rejects_already_claimed_milestone`.
3. **Zero Stamp Deduction:** Confirming a milestone redemption inserts into `milestone_claims` and writes to `audit_log`, but leaves `stamps` and `redemptions` unchanged so `available_stamps` does not decrease. → Task 1 pgTAP `milestone_claim_preserves_stamp_balances`.
4. **Owner Rules Validation:** Milestone slot must be strictly less than `reward_threshold` ($1 \le \text{slot} < \text{threshold}$). Setting a milestone slot $\ge \text{threshold}$ is rejected by database check constraints and API validation. → Task 1 pgTAP `tenant_settings_rejects_milestone_gte_threshold` and Task 5 unit test `rules_validation_rejects_invalid_slot`.
5. **Cross-Shop & Staff Authorization Guard:** A barista belonging to Shop A cannot redeem a milestone token issued by Shop B (`wrong-tenant`), and an unauthenticated or non-staff user receives `unauthorized`. → Task 4 unit test `milestone_redeem_enforces_tenant_and_staff_roles`.

---

## File Structure

| Area | Create | Modify |
| :--- | :--- | :--- |
| **Database & pgTAP** | `supabase/migrations/20261111000000_milestone_rewards.sql`, `supabase/tests/database/21_milestone_rewards.test.sql` | — |
| **Contracts & Types** | — | `lib/contracts.ts`, `lib/supabase/database.types.ts` |
| **Tokens & Security** | `tests/unit/milestone-reward-token.test.ts` | `lib/security/redeemToken.ts`, `lib/security/logger.ts`, `lib/security/reward-token-helpers.ts` |
| **Customer Card & Display** | `components/card/MilestoneRewardPanel.tsx`, `tests/unit/milestone-display-and-card.test.ts` | `lib/auth/customer.ts`, `lib/rules/display.ts`, `components/card/StampGrid.tsx`, `app/s/[slug]/page.tsx` |
| **Staff Redemption** | `tests/unit/staff-milestone-redeem.test.ts` | `app/api/staff/redeem/route.ts`, `components/staff/RedeemRewardForm.tsx` |
| **Owner Console Rules** | `tests/unit/owner-milestone-rules.test.ts` | `app/api/staff/[slug]/rules/route.ts`, `components/console/RulesSettingsForm.tsx` |

---

## Tasks

### Task 1: Database Migration & Transactional RPCs (`20261111000000_milestone_rewards.sql`)

**Files:**
- Create: `supabase/migrations/20261111000000_milestone_rewards.sql`
- Create: `supabase/tests/database/21_milestone_rewards.test.sql`

- [ ] **Step 1: Write pgTAP test suite in `supabase/tests/database/21_milestone_rewards.test.sql`**
  - Verify `milestone_step` and `milestone_reward_label` columns on `tenant_settings`.
  - Verify check constraint: `milestone_step < reward_threshold`.
  - Verify `public.milestone_claims` schema and unique constraint on `(tenant_id, customer_id, cycle_index)`.
  - Test `redeem_milestone_reward`:
    - Successful claim at slot 5 of 10 (`'redeemed'`).
    - Verify `available_stamps` in `card_balances` remains unchanged.
    - Second redemption attempt in same cycle returns `'milestone-already-claimed'`.
    - Milestone attempt after completing card (e.g. 10 stamps) returns `'milestone-expired'`.
    - Milestone attempt before reaching slot 5 returns `'milestone-not-reached'`.
  - Test `update_tenant_rules` updates milestone settings cleanly.
  - Test `merge_wallets` and `remove_card` cleanly handle `milestone_claims`.

- [ ] **Step 2: Create migration `supabase/migrations/20261111000000_milestone_rewards.sql`**
  - Alter `public.tenant_settings` to add `milestone_step integer check (milestone_step is null or (milestone_step between 1 and 49))` and `milestone_reward_label text check (milestone_reward_label is null or (char_length(btrim(milestone_reward_label)) between 1 and 40))`.
  - Update `private.validate_tenant_settings()` trigger to validate that if `milestone_step is not null`, it must be strictly `< reward_threshold`.
  - Create table `public.milestone_claims`.
  - Create `public.redeem_milestone_reward` RPC with advisory lock `1001` and single-use nonce burn.
  - Update `public.update_tenant_rules` to support `milestone_step` and `milestone_reward_label` keys.
  - Update `public.remove_card` and `public.merge_wallets` to manage `public.milestone_claims`.
  - Grant permissions to `service_role`.

- [ ] **Step 3: Run pgTAP tests and verify passing**

---

### Task 2: TypeScript Contracts, Database Types & Token Security

**Files:**
- Modify: `lib/contracts.ts`
- Modify: `lib/supabase/database.types.ts`
- Modify: `lib/security/redeemToken.ts`
- Modify: `lib/security/logger.ts`
- Create: `tests/unit/milestone-reward-token.test.ts`

- [ ] **Step 1: Write failing unit tests in `tests/unit/milestone-reward-token.test.ts`**
  - Test `issueRedeemToken` with `kind: 'milestone-reward'`: produces token with `tcpmilestone2.` prefix and valid display code.
  - Test `verifyRedeemToken` recognizes `milestone-reward`.
  - Test cross-kind protection: token signed with `tcpmilestone2` cannot be verified as `free-coffee` or `instagram-upsize`.
  - Test expiry: token rejected after 300 seconds.
  - Test payload tampering causes signature mismatch.

- [ ] **Step 2: Implement contracts and token changes**
  - In `lib/contracts.ts`:
    - Add `milestoneStep?: number | null;` and `milestoneRewardLabel?: string | null;` to `TenantSettings`.
    - Add `'milestone-reward'` to `REDEEM_TOKEN_KINDS`.
    - Add `'milestone-not-reached'`, `'milestone-already-claimed'`, `'milestone-expired'` to `REDEEM_RESULT_CODES`.
    - Add `MilestoneRewardState` interface to `CustomerCardState`.
  - In `lib/security/redeemToken.ts`:
    - Add `'milestone-reward': 'tcpmilestone2'` to `TOKEN_PREFIXES`.
    - Support optional `cycleIndex` in token payload schema.
  - In `lib/security/logger.ts`:
    - Include `tcpmilestone2.` in redaction pattern.
  - Update `lib/supabase/database.types.ts` with new RPC signature and tables.

- [ ] **Step 3: Run Vitest and confirm all token tests pass**

---

### Task 3: Customer Card State, Display Helpers & Milestone UI

**Files:**
- Modify: `lib/auth/customer.ts`
- Modify: `lib/rules/display.ts`
- Modify: `components/card/StampGrid.tsx`
- Create: `components/card/MilestoneRewardPanel.tsx`
- Modify: `app/s/[slug]/page.tsx`
- Create: `tests/unit/milestone-display-and-card.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/milestone-display-and-card.test.ts`**
  - Test `calculateMilestoneRewardState(totalStamps, settings, hasClaimedThisCycle)`:
    - Slot 3 of 10: eligible = false, expired = false.
    - Slot 5 of 10: eligible = true, expired = false.
    - Slot 5 of 10 (already claimed): eligible = false, isClaimed = true.
    - Slot 10 of 10 (unclaimed): expired = true.
  - Test `StampGrid` renders dynamic label for milestone slot when configured.

- [ ] **Step 2: Implement customer state and display calculations**
  - In `lib/rules/display.ts`: Implement `calculateMilestoneRewardState`.
  - In `lib/auth/customer.ts`: Query `public.milestone_claims` for `tenant_id` and `customer_id` at the current `cycle_index = floor(total_stamps / reward_threshold)` to populate `milestoneReward`.
  - In `components/card/StampGrid.tsx`: Replace hardcoded `"50% OFF"` with `tenant.settings.milestoneRewardLabel` on slot `tenant.settings.milestoneStep`.
  - Create `components/card/MilestoneRewardPanel.tsx`:
    - Collapsible card section or callout when `milestoneReward.isEligible`.
    - Renders milestone SVG QR code and countdown timer.
    - If `isClaimed`, renders a subtle checked badge: `"Milestone perk claimed for this card"`.
  - In `app/s/[slug]/page.tsx`: Mount `MilestoneRewardPanel`.

- [ ] **Step 3: Run Vitest and confirm green**

---

### Task 4: Staff Redemption API & Scanner (`/staff/redeem`)

**Files:**
- Modify: `lib/security/reward-token-helpers.ts`
- Modify: `app/api/staff/redeem/route.ts`
- Modify: `components/staff/RedeemRewardForm.tsx`
- Create: `tests/unit/staff-milestone-redeem.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/staff-milestone-redeem.test.ts`**
  - Test `POST /api/staff/redeem` (action: `'preview'`) with `tcpmilestone2` token: returns customer name, perk title, and note that stamps are not deducted.
  - Test `POST /api/staff/redeem` (action: `'confirm'`): calls `redeem_milestone_reward` RPC and returns success without reducing available stamps.
  - Test rejection when already claimed in cycle (`milestone-already-claimed`).
  - Test rejection when cycle is expired (`milestone-expired`).
  - Test rejection for `wrong-tenant` or unauthenticated user.

- [ ] **Step 2: Update API and Staff Scanner**
  - In `lib/security/reward-token-helpers.ts`: Add parser and helper for milestone reward tokens.
  - In `app/api/staff/redeem/route.ts`:
    - Handle `token.kind === 'milestone-reward'`.
    - On confirm, execute `admin.rpc('redeem_milestone_reward', { p_actor, p_tenant, p_customer, p_nonce })`.
  - In `components/staff/RedeemRewardForm.tsx`:
    - Render distinct violet/amber milestone badge when scanning `tcpmilestone2`.
    - Clearly display: `"Milestone Perk: [Label] • Free perk, 0 stamps deducted"`.

- [ ] **Step 3: Run Vitest and confirm green**

---

### Task 5: Owner Console Rules Tab Configuration

**Files:**
- Modify: `app/api/staff/[slug]/rules/route.ts`
- Modify: `components/console/RulesSettingsForm.tsx`
- Create: `tests/unit/owner-milestone-rules.test.ts`

- [ ] **Step 1: Write failing tests in `tests/unit/owner-milestone-rules.test.ts`**
  - Test `PATCH /api/staff/[slug]/rules`:
    - Accepts valid `milestone_step: 5` and `milestone_reward_label: "50% OFF"`.
    - Accepts `milestone_step: null` and `milestone_reward_label: null` (disabling).
    - Rejects `milestone_step >= reward_threshold`.
    - Rejects invalid characters or blank label when step is set.
  - Test `RulesSettingsForm` component renders milestone toggle, inputs, and validation error messages.

- [ ] **Step 2: Implement Rules Tab updates**
  - In `app/api/staff/[slug]/rules/route.ts`:
    - Extend Zod schema to validate `milestone_step` and `milestone_reward_label`.
    - Call `admin.rpc('update_tenant_rules', ...)`.
  - In `components/console/RulesSettingsForm.tsx`:
    - Add toggle: "Enable Milestone Reward".
    - Add fields: "Milestone Stamp Slot" (number) and "Milestone Reward Label" (text).
    - Add inline validation ensuring $1 \le \text{slot} < \text{threshold}$.
    - Connect to form submit handler and preview simulation.

- [ ] **Step 3: Run Vitest and verify all tests pass**

---

### Task 6: Full System Verification & Regression Suite

**Files:**
- Run: Entire test suite (`pnpm test -- --run`)
- Run: Linter (`pnpm lint`)
- Run: Typecheck (`pnpm tsc --noEmit`)

- [ ] **Step 1: Execute complete Vitest suite to ensure no regressions across all 45+ test files**
- [ ] **Step 2: Run ESLint to ensure strict rules (including `admin.from` ban) remain respected**
- [ ] **Step 3: Run TypeScript compiler to ensure strict typing across all files**
- [ ] **Step 4: Commit changes with concise Conventional Commits**
