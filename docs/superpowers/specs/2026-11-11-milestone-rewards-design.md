# Milestone Rewards Design Spec

**Date:** 2026-11-11  
**Status:** Approved for Planning  

---

## 1. Problem & Goal

Currently, ODYSSEY loyalty cards only support a single end-of-card reward (e.g. 10 stamps = 1 free coffee), plus an optional one-time social perk (Instagram follow upsize). For higher thresholds (such as 8, 10, or 12 stamps), customers can experience "loyalty fatigue" before ever reaching their first reward.

Tenant #1 (*The Caffeine Plug*) historically had static text `"50% OFF"` hardcoded into slot 5 of its physical card reference, but no digital mechanism existed for shop owners to configure mid-card rewards or for cashiers to verify and redeem them.

**Goal:**
1. Enable shop owners to configure an optional **Milestone Reward** (e.g. at 5 of 10 stamps, get 50% off next purchase) directly from the Owner Rules Console (`/staff/[slug]/settings`).
2. Allow customers who reach the milestone on their active card to present a secure, 5-minute signed QR code at the counter.
3. Allow cashiers to scan and redeem the milestone reward via `/staff/redeem` **without deducting any stamps**, keeping the customer's momentum toward their full 10th stamp.
4. Enforce that each card cycle receives at most **one** milestone claim, and if a customer fills all 10 stamps without claiming the milestone discount, the unclaimed milestone perk expires for that card cycle.

---

## 2. User Stories & Experience

### 2.1 The Customer Experience (`/s/[slug]`)
- **Visual Goal Tracking:** On the digital loyalty card grid, the milestone slot (e.g. slot 5) displays a distinct badge with the configured label (e.g. `"50% OFF"`).
- **Milestone Unlocked:** When `(total_stamps % reward_threshold) >= milestone_step` and the customer has not yet claimed the milestone for their current cycle:
  - A prominent card callout appears: *"Milestone Unlocked: 50% OFF on your next purchase!"*
  - Tapping **"Claim Milestone Perk"** generates a short-lived (5-minute TTL) signed QR code (`tcpmilestone2`) with an 8-character verification code (`XXXX-XXXX`).
- **Use-It-or-Lose-It Window:** If the customer reaches 10 stamps (`current_cycle_stamps = 0` into the next cycle) without redeeming the milestone, the milestone card callout disappears and is marked expired for that cycle. When they collect stamps on their next card and reach slot 5 again, the milestone unlocks fresh for the new cycle.

### 2.2 The Cashier / Barista Experience (`/staff/redeem`)
- The cashier opens `/staff/redeem` (camera scanner launches immediately).
- Cashier scans the customer's milestone QR code.
- **Preview Screen:** Displays *"Milestone Reward: 50% OFF"* along with the customer's name, verification code, and note: *"Free perk • Does not deduct stamps"*.
- Cashier taps **"Confirm Redemption"**.
- The server atomically verifies the token signature, checks that the customer hasn't claimed this cycle's milestone, burns the single-use nonce, and records the claim.
- Cashier sees a success confirmation and applies the 50% discount to POS/register.

### 2.3 The Shop Owner Experience (`/staff/[slug]/settings`)
- In the **Rules Tab** of the console:
  - Toggle: **"Enable Milestone Reward"** (Default: Off, or On for Tenant #1).
  - Number Input: **"Milestone Stamp Slot"** (e.g. `5`, constrained to $1 \le \text{slot} < \text{reward\_threshold}$).
  - Text Input: **"Milestone Reward Label"** (e.g. `"50% OFF"`, `"FREE PASTRY"`).
  - Dynamic preview and validation prevent setting a milestone slot greater than or equal to the final reward threshold.

---

## 3. Domain Model & Database Architecture

### 3.1 Tenant Settings Schema
Update `public.tenant_settings`:
- `milestone_step`: `integer null check (milestone_step is null or (milestone_step between 1 and 49))`
- `milestone_reward_label`: `text null check (milestone_reward_label is null or (char_length(btrim(milestone_reward_label)) between 1 and 40))`
- Trigger constraint in `private.validate_tenant_settings()`:
  - If `milestone_step` is provided, `milestone_step < reward_threshold`.
  - Both `milestone_step` and `milestone_reward_label` must be either both null or both non-null.

### 3.2 Milestone Claims Ledger (`public.milestone_claims`)
```sql
create table if not exists public.milestone_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  cycle_index integer not null check (cycle_index >= 0),
  milestone_step integer not null check (milestone_step >= 1),
  staff_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, customer_id, cycle_index)
);

create index if not exists milestone_claims_customer_idx 
  on public.milestone_claims (customer_id, tenant_id);
```

### 3.3 Cycle Index Calculation
Given `total_stamps` (lifetime stamps earned at this tenant):
- `cycle_index = floor(total_stamps / reward_threshold)`
- `current_card_stamps = total_stamps % reward_threshold`
- Milestone eligibility in current cycle:
  - Milestone configured (`ts.milestone_step is not null`)
  - Milestone reached in this cycle (`current_card_stamps >= ts.milestone_step`)
  - Card not completed yet (`current_card_stamps < ts.reward_threshold` and `current_card_stamps > 0`)
  - No existing claim in `public.milestone_claims` with `cycle_index`

### 3.4 Transactional RPC `public.redeem_milestone_reward`
```sql
public.redeem_milestone_reward(
  p_actor uuid,
  p_tenant uuid,
  p_customer uuid,
  p_nonce text
) returns text
```
1. Verifies staff role on `p_tenant` (`private.member_role`).
2. Acquires advisory transaction lock on customer: `pg_advisory_xact_lock(hashtextextended(p_customer::text, 1001))`.
3. Verifies tenant status is `trial` or `active`.
4. Checks single-use `p_nonce` against `public.audit_log` (`action = 'staff_redeem_token_used'`).
5. Calculates current `cycle_index` and verifies milestone conditions.
6. Burns `p_nonce` in `public.audit_log`.
7. Inserts record into `public.milestone_claims`.
8. Logs `action = 'redeem_milestone_reward'` in `public.audit_log`.
9. Returns `'redeemed'`.

### 3.5 Wallet Lifecycle Integration
- **`remove_card`:** Deletes from `public.milestone_claims where tenant_id = p_tenant and customer_id = p_customer`.
- **`delete_wallet`:** Foreign keys on `customers` cascade automatically.
- **`merge_wallets`:** Resolves conflict by keeping existing target milestone claims and moving source claims:
  ```sql
  delete from public.milestone_claims as mc
  where mc.customer_id = p_source
    and exists (
      select 1 from public.milestone_claims as t
      where t.customer_id = p_target
        and t.tenant_id = mc.tenant_id
        and t.cycle_index = mc.cycle_index
    );
  update public.milestone_claims set customer_id = p_target where customer_id = p_source;
  ```

---

## 4. Cryptographic Token Design (`tcpmilestone2`)

- **Token Kind:** `milestone-reward`
- **Prefix:** `tcpmilestone2` (domain-separated from `tcp2` and `tcpig2`)
- **Payload (`MilestoneRedeemTokenPayload`):**
  ```ts
  export interface MilestoneRedeemTokenPayload {
    customerId: string; // UUID
    tenantId: string;   // UUID
    cycleIndex: number; // int >= 0
    iat: number;        // Epoch seconds
    exp: number;        // Epoch seconds (iat + 300)
    nonce: string;      // Random 128-bit hex
  }
  ```
- **HMAC Signature:** SHA-256 using `REDEEM_TOKEN_SECRET`, verified with `timingSafeEqual`.
- **Display Code:** 8-character uppercase Crockford-like code (`XXXX-XXXX`) derived from HMAC bytes.

---

## 5. Security & Anti-Fraud Gates

1. **Domain Separation:** `tcpmilestone2` cannot be verified as `free-coffee` or `instagram-upsize`, preventing privilege escalation.
2. **5-Minute TTL + Single-Use Nonce:** Screenshot QR codes cannot be reused.
3. **Database Unique Constraint:** `UNIQUE (tenant_id, customer_id, cycle_index)` prevents race condition double-claims even under concurrent requests.
4. **Hierarchical Lock:** `pg_advisory_xact_lock(1001)` prevents simultaneous stamping and redeeming races.
5. **Staff Attribution:** Every milestone redemption logs the operating `staff_id` in `milestone_claims` and `audit_log`.
