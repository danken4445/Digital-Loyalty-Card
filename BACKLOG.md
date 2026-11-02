# Product Backlog & Future Scope

This document tracks items intentionally deferred from Phase 0 / v1 core delivery. Complete architecture designs, plain-language guides for Dan, and ready-to-run SQL/TypeScript migration blueprints for all items below are documented in [**`docs/FUTURE_UPGRADES.md`**](docs/FUTURE_UPGRADES.md).

---

## Milestone & Reward Structure Post-v1 Evaluation

- **Item:** Mid-Tier Reward vs. Milestone Badge at Stamp #5
- **Context:** The physical printed reference card displays "50% off" at stamp #5 and "FREE COFFEE" at stamp #10.
- **Current Scope (v1):** The locked v1 specification implements a single reward redemption at 10 stamps ("FREE COFFEE"). Stamp #5 displays as a visual halfway progress milestone badge.
- **Post-v1 Action:** Evaluate whether stamp #5 should remain a purely visual motivator or be upgraded into an active redeemable mid-tier reward (50% off beverage) with its own QR redemption token flow and ledger entry.
- **Architecture Blueprint:** See [`docs/FUTURE_UPGRADES.md#42-activating-slot-5-50-off-as-a-redeemable-reward`](docs/FUTURE_UPGRADES.md#42-activating-slot-5-50-off-as-a-redeemable-reward) for the zero-breaking-change migration blueprint (`stamps_used: 5` vs `stamps_used: 10`, `reward_tier` column, and barista counter interface).

---

## Phase 9 Advanced Design Items

### 1. NTAG 424 DNA (SUN) Cryptographic Tap Counter Verification

- **Context:** Standard NFC tags (like NTAG 213/215) broadcast a static URL that can theoretically be copied or shared.
- **Planned Feature:** Upgrade physical cards to NTAG 424 DNA chips utilizing Secure Unique NFC (SUN). On each physical tap, the tag generates a dynamic AES-128 cryptographic MAC and incrementing tap counter in the URL query string (`?picc_data=...&cmac=...`).
- **Benefit:** The server cryptographically validates that a physical card was tapped in real time, preventing tag URL cloning and replay attacks with 100% mathematical certainty.
- **Architecture Blueprint:** See [`docs/FUTURE_UPGRADES.md#2-upgrade-1-nxp-ntag-424-dna-cryptographic-tap-verification`](docs/FUTURE_UPGRADES.md#2-upgrade-1-nxp-ntag-424-dna-cryptographic-tap-verification) for the zero-rewrite `lib/nfc/verifyTap.ts` boundary and SQL migration (`last_counter` verification under transaction advisory locks).

### 2. Repeat-Visit Analytics

- **Context:** Shop managers need insight into customer retention and visit frequency.
- **Planned Feature:** A private administrative dashboard visualizing:
  - Retention cohorts (percentage of first-time tappers who return for a second visit within 14 and 30 days).
  - Average days between visits.
  - Peak tap times by hour and day of week in Manila time (`Asia/Manila`).
  - Stamp completion velocity (how many days it takes a customer to reach 10 stamps).
- **Architecture Blueprint:** See [`docs/FUTURE_UPGRADES.md#3-upgrade-2-repeat-visit--retention-cohort-analytics-asiamanila`](docs/FUTURE_UPGRADES.md#3-upgrade-2-repeat-visit--retention-cohort-analytics-asiamanila) for ready-to-run SQL views (`security_invoker = true`) and copy-paste queries for Dan's Supabase SQL Editor.

### 3. Opt-in Customer Messaging & Account Linking

- **Context:** Anonymous sessions are linked to the customer's mobile browser cookies. If a customer clears their browser data or switches phones, access to their stamps could be lost.
- **Planned Feature:** An optional, non-intrusive prompt allowing customers to link their anonymous wallet to an email address or mobile phone number (SMS/WhatsApp).
- **Benefit:** Enables cross-device wallet recovery and opt-in alerts for seasonal coffee drops, special streetwear merchandise releases, or loyalty anniversary perks.
- **Architecture Blueprint:** See [`docs/FUTURE_UPGRADES.md#41-philippines-ra-10173-compliant-opt-in-messaging`](docs/FUTURE_UPGRADES.md#41-philippines-ra-10173-compliant-opt-in-messaging) for Philippines RA 10173 unbundled consent compliance, the `public.customer_consents` table, one-click unsubscribe, and cascading deletion.
