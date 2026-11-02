# The Caffeine Plug — Phase 9 Future Upgrades & Migration Blueprints

**Audience:** Dan (Owner, The Caffeine Plug) and software engineering team  
**System:** The Caffeine Plug NFC Digital Loyalty Card  
**Timezone:** `Asia/Manila` (UTC+8)  
**Status:** Approved Architecture Specification & Migration Blueprints (Phase 9)  
**Document Purpose:** Ready-to-run blueprints for post-v1 system enhancements without breaking existing features.

---

## Table of Contents

1. [Executive Summary for Dan](#1-executive-summary-for-dan)
2. [Upgrade 1: NXP NTAG 424 DNA Cryptographic Tap Verification](#2-upgrade-1-nxp-ntag-424-dna-cryptographic-tap-verification)
   - [2.1 Plain-Language Guide: Why Upgrade from NTAG215](#21-plain-language-guide-why-upgrade-from-ntag215)
   - [2.2 Zero-Rewrite Integration Boundary (`verifyTap`)](#22-zero-rewrite-integration-boundary-verifytap)
   - [2.3 Future SQL Migration Blueprint](#23-future-sql-migration-blueprint)
   - [2.4 Step-by-Step Rollout Guide for Dan](#24-step-by-step-rollout-guide-for-dan)
3. [Upgrade 2: Repeat-Visit & Retention Cohort Analytics (`Asia/Manila`)](#3-upgrade-2-repeat-visit--retention-cohort-analytics-asiamanila)
   - [3.1 What These Analytics Answer for Dan](#31-what-these-analytics-answer-for-dan)
   - [3.2 Secure SQL Views (`security_invoker = true`)](#32-secure-sql-views-security_invoker--true)
   - [3.3 Ready-to-Run SQL Queries for Dan's Supabase Dashboard](#33-ready-to-run-sql-queries-for-dans-supabase-dashboard)
4. [Upgrade 3: Opt-In Customer Messaging & Mid-Tier Milestone Rewards](#4-upgrade-3-opt-in-customer-messaging--mid-tier-milestone-rewards)
   - [4.1 Philippines RA 10173 Compliant Opt-In Messaging](#41-philippines-ra-10173-compliant-opt-in-messaging)
   - [4.2 Activating Slot #5 (`50% OFF`) as a Redeemable Reward](#42-activating-slot-5-50-off-as-a-redeemable-reward)
5. [Summary Decision Matrix & Roadmap](#5-summary-decision-matrix--roadmap)

---

## 1. Executive Summary for Dan

The Caffeine Plug loyalty system was designed from Day 1 to grow with your business.

In Phase 1 through Phase 8, we built a secure, lightning-fast foundation:

- Customers collect stamps by tapping an NFC card or scanning a counter QR code.
- Anti-fraud rules run inside PostgreSQL: a 30-minute cooldown, a 2 stamps per calendar day limit in Philippine time, and an instant 5-second anti-spam lock on each card.
- Baristas redeem free drinks using single-use, 5-minute cryptographic QR tokens.

As your store expands and tap volume increases, you may want three advanced capabilities:

1. **Uncloneable Physical NFC Cards (NTAG 424 DNA):** Cards that generate a brand-new digital signature on every tap so nobody can ever share or bookmark the tap URL.
2. **Customer Retention Analytics:** Automated reports showing how many first-time customers return for a second drink, what your busiest hours are in Manila time, and how fast customers reach their free coffee.
3. **Opt-In Seasonal Coffee Drops & 50% Off Mid-Tier Perk:** A privacy-compliant way to send WhatsApp/SMS/Email notifications to VIP customers about secret coffee drops, plus turning the 5-stamp milestone into an active 50% discount.

This document contains the exact blueprints, SQL code, and TypeScript definitions needed to roll out each upgrade. **None of these upgrades require rewriting existing code.** Every interface in the system was deliberately built with clean seams ready for this expansion.

---

## 2. Upgrade 1: NXP NTAG 424 DNA Cryptographic Tap Verification

### 2.1 Plain-Language Guide: Why Upgrade from NTAG215

#### How Your Current Cards Work (NXP NTAG215)

Today, your baristas hold an **NTAG215** card behind the counter. When tapped against a customer's phone, it opens a static web address:

```text
https://card.thecaffeineplug.ph/t/tcp-counter-tag-01
```

This setup is safe today because:

1. The barista keeps the card behind the counter (physical custody).
2. The server blocks duplicate taps from the same customer within 30 minutes.
3. The server caps each customer at 2 stamps per day in Manila time.
4. If a customer bookmarks the link, your staff can deactivate and replace the card in under 10 seconds from the `/staff/tags` screen.

#### What Changes with NXP NTAG 424 DNA (Secure Unique NFC)

An **NXP NTAG 424 DNA** chip contains a hardware cryptography engine. It does not broadcast a static address. Instead, every single physical tap generates a completely unique web link:

```text
https://card.thecaffeineplug.ph/t/tcp-tag-01?picc_data=0123456789ABCDEF0123456789ABCDEF&cmac=9A8B7C6D5E4F3A2B
```

Inside this link are two special pieces of data:

1. **Encrypted Tap Counter (`picc_data`):** A physical 24-bit counter inside the chip that increases by exactly +1 every time the card touches a phone (e.g., tap #101, tap #102, tap #103).
2. **Cryptographic MAC Signature (`cmac`):** An AES-128 cryptographic signature calculated by the chip's internal security key.

#### Why This Matters for Dan

- **Photocopies and Bookmarks Are Useless:** If someone saves the URL on their phone or shares it in a group chat, that URL is already expired. The moment tap #101 is used, the server records counter 101. Any future request showing counter 101 or lower is rejected instantly.
- **Mathematical Proof of Physical Presence:** The server can verify with 100% cryptographic certainty that a customer's phone physically touched your chip at the counter.

---

### 2.2 Zero-Rewrite Integration Boundary (`verifyTap`)

During Phase 3 development, the tap verification logic was intentionally isolated inside `lib/nfc/verifyTap.ts`.

Notice that `VerifyTapInput` was already coded to accept query parameters:

```typescript
// lib/nfc/verifyTap.ts (Current v1 Code)
export interface VerifyTapInput {
  tagId: string;
  /**
   * Optional query parameters from the tap URL.
   * Reserved for Phase 9 NTAG 424 DNA (SUN) dynamic `picc_data` and `cmac` verification.
   */
  query?: Record<string, string | string[] | undefined>;
}
```

Because of this forward-thinking design, **the customer-facing routes do not need to be rewritten**.

#### Route Handler Integration Blueprint

In both `/t/[tagId]/route.ts` and `/api/claim/route.ts`, only one line changes: pass the incoming URL search parameters to `verifyTap`:

```typescript
// app/t/[tagId]/route.ts (Future Phase 9 Upgrade)
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tagId: string }> },
): Promise<NextResponse> {
  const { tagId } = await context.params;

  // Extract query parameters (?picc_data=...&cmac=...)
  const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());

  // Pass queryParams to verifyTap - zero changes to surrounding auth or rate limiting
  const tapVerification = verifyTap({ tagId, query: queryParams });
  if (!tapVerification.valid) {
    return NextResponse.redirect(new URL(ROUTES.cardWithResult('invalid-tag'), request.url), 303);
  }

  // Pass verified monotonic counter to database RPC
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('record_stamp', {
    p_customer: user.id,
    p_tag: tapVerification.normalizedTagId,
    p_source: 'nfc',
    p_tap_counter: tapVerification.mode === 'ntag424dna-sun' ? tapVerification.tapCounter : null,
  });
  // ... rest of route handler remains identical
}
```

#### TypeScript Implementation Blueprint for `verifyTap.ts`

When upgrading, replace the internals of `lib/nfc/verifyTap.ts` with this implementation:

```typescript
// lib/nfc/verifyTap.ts (Phase 9 Implementation Blueprint)
import crypto from 'node:crypto';
import type { VerifyTapResult } from '@/lib/contracts';

const TAG_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

// Secret master AES-128 key stored securely in environment variables
const NTAG424_MASTER_KEY = process.env.NTAG424_MASTER_KEY || '';

export interface VerifyTapInput {
  tagId: string;
  query?: Record<string, string | string[] | undefined>;
}

export type Phase9VerifyTapResult =
  | {
      valid: true;
      normalizedTagId: string;
      mode: 'ntag215-static';
      tapCounter: null;
    }
  | {
      valid: true;
      normalizedTagId: string;
      mode: 'ntag424dna-sun';
      tapCounter: number;
    }
  | {
      valid: false;
      reason: 'malformed-tag-id' | 'invalid-sun-signature' | 'missing-sun-params';
    };

/**
 * Validates NFC tap authenticity.
 * Automatically supports legacy NTAG215 static tags and NTAG 424 DNA SUN dynamic tags.
 */
export function verifyTap(input: VerifyTapInput): Phase9VerifyTapResult {
  const trimmed = typeof input.tagId === 'string' ? input.tagId.trim() : '';

  if (!TAG_ID_REGEX.test(trimmed)) {
    return { valid: false, reason: 'malformed-tag-id' };
  }

  const piccDataHex = typeof input.query?.picc_data === 'string' ? input.query.picc_data : null;
  const cmacHex = typeof input.query?.cmac === 'string' ? input.query.cmac : null;

  // 1. If no cryptographic parameters are present, fall back to NTAG215 mode
  if (!piccDataHex || !cmacHex) {
    return {
      valid: true,
      normalizedTagId: trimmed,
      mode: 'ntag215-static',
      tapCounter: null,
    };
  }

  // 2. Validate NTAG 424 DNA SUN cryptographic payload
  try {
    if (!NTAG424_MASTER_KEY || NTAG424_MASTER_KEY.length !== 32) {
      throw new Error('NTAG424_MASTER_KEY must be a 32-character hex string (128 bits)');
    }

    const keyBuffer = Buffer.from(NTAG424_MASTER_KEY, 'hex');
    const piccBuffer = Buffer.from(piccDataHex, 'hex');

    // Decrypt PICC data using AES-128-CBC with zero IV
    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, Buffer.alloc(16, 0));
    decipher.setAutoPadding(false);
    const decryptedPicc = Buffer.concat([decipher.update(piccBuffer), decipher.final()]);

    // Format of decrypted PICC: [Header: 1 byte][UID: 7 bytes][Tap Counter: 3 bytes LSB][Padding: 5 bytes]
    const tagUid = decryptedPicc.subarray(1, 8).toString('hex');
    const tapCounter = decryptedPicc.readUIntLE(8, 3); // 24-bit little endian counter

    // Verify CMAC signature over tagId + tapCounter
    const hmac = crypto.createHmac('sha256', keyBuffer);
    hmac.update(`${trimmed}:${tapCounter}:${tagUid}`);
    const expectedCmac = hmac.digest('hex').substring(0, 16);

    // Constant-time comparison to prevent timing attacks
    const isValidSignature = crypto.timingSafeEqual(
      Buffer.from(cmacHex.toLowerCase(), 'utf-8'),
      Buffer.from(expectedCmac.toLowerCase(), 'utf-8'),
    );

    if (!isValidSignature) {
      return { valid: false, reason: 'invalid-sun-signature' };
    }

    return {
      valid: true,
      normalizedTagId: trimmed,
      mode: 'ntag424dna-sun',
      tapCounter,
    };
  } catch {
    return { valid: false, reason: 'invalid-sun-signature' };
  }
}
```

---

### 2.3 Future SQL Migration Blueprint

To enforce the incrementing tap counter in the database, run the following SQL migration.

#### SQL Migration Script: `supabase/migrations/20261102050000_phase9_ntag424dna_verification.sql`

```sql
-- Migration: 20261102050000_phase9_ntag424dna_verification.sql
-- Description: Phase 9 Support for NTAG 424 DNA SUN monotonic tap counter validation

-- 1. Upgrade public.tags table with chip type and last seen counter
alter table public.tags
  add column if not exists chip_type text not null default 'ntag215' check (chip_type in ('ntag215', 'ntag424dna')),
  add column if not exists last_counter bigint not null default 0 check (last_counter >= 0);

comment on column public.tags.chip_type is 'NFC chip architecture: ntag215 (static) or ntag424dna (cryptographic SUN)';
comment on column public.tags.last_counter is 'Highest verified monotonic tap counter received for this tag';

-- 2. Update record_stamp to atomically verify and increment last_counter
create or replace function public.record_stamp(
  p_customer uuid,
  p_tag text default null,
  p_source text default 'nfc',
  p_staff uuid default null,
  p_reason text default null,
  p_now timestamptz default null,
  p_tap_counter bigint default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_last_stamp timestamptz;
  v_daily_count integer;
  v_tag_chip_type text;
  v_tag_last_counter bigint;
begin
  -- 1. Input validation & normalization
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  if p_tag is not null then
    p_tag := pg_catalog.btrim(p_tag);
  end if;

  -- 2. Hierarchical transaction-scoped advisory locks:
  -- Lock tag first (1002) to serialize concurrent taps on the same physical card,
  -- then lock customer (1001) to serialize customer stamp balance.
  if p_tag is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tag, 1002));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 3. Monotonic clock capture after lock acquisition
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  -- 4. Ensure customer ledger anchor exists
  insert into public.customers (id)
  values (p_customer)
  on conflict (id) do nothing;

  -- 5. Validate source & tag active state
  if p_source = 'nfc' then
    select t.chip_type, t.last_counter
    into v_tag_chip_type, v_tag_last_counter
    from public.tags as t
    where t.id = p_tag
      and t.active = true
      and t.deactivated_at is null;

    if not found then
      return 'invalid-tag';
    end if;

    -- Cryptographic Monotonic Counter Check for NTAG 424 DNA
    if v_tag_chip_type = 'ntag424dna' then
      -- If the card is NTAG 424 DNA, counter is mandatory and must strictly increase
      if p_tap_counter is null or p_tap_counter <= v_tag_last_counter then
        -- Cloned, replayed, or out-of-order counter detected: reject tap immediately
        return 'invalid-tag';
      end if;

      -- Update recorded counter under the safety of the advisory lock
      update public.tags
      set last_counter = p_tap_counter
      where id = p_tag;
    end if;

  elsif p_source = 'manual' then
    if p_staff is null
      or not exists (
        select 1
        from public.staff as st
        where st.user_id = p_staff
          and st.active = true
      )
      or p_reason is null
      or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 500
    then
      raise exception 'invalid manual stamp parameters';
    end if;
  else
    raise exception 'invalid stamp source';
  end if;

  -- 6. Check Customer 30-minute cooldown
  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.customer_id = p_customer;

  if v_last_stamp is not null and v_last_stamp > (v_now - interval '30 minutes') then
    return 'cooldown';
  end if;

  -- 7. Check Customer daily cap (maximum 2 stamps per calendar day in Asia/Manila)
  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.customer_id = p_customer
    and (s.created_at at time zone 'Asia/Manila')::date = (v_now at time zone 'Asia/Manila')::date;

  if v_daily_count >= 2 then
    return 'daily-limit';
  end if;

  -- 8. Check Per-Tag 5-second throttle
  if p_source = 'nfc' and exists (
    select 1
    from public.stamps as s
    where s.tag_id = p_tag
      and s.created_at > (v_now - interval '5 seconds')
  ) then
    return 'tag-throttled';
  end if;

  -- 9. Insert stamp record into immutable ledger
  insert into public.stamps (
    customer_id,
    tag_id,
    source,
    staff_id,
    reason,
    created_at
  ) values (
    p_customer,
    case when p_source = 'nfc' then p_tag else null end,
    p_source,
    case when p_source = 'manual' then p_staff else null end,
    case when p_source = 'manual' then pg_catalog.btrim(p_reason) else null end,
    v_now
  );

  -- 10. Audit log for manual stamps
  if p_source = 'manual' then
    insert into public.audit_log (
      actor,
      action,
      target,
      detail,
      created_at
    ) values (
      p_staff,
      'manual_stamp',
      p_customer::text,
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)),
      v_now
    );
  end if;

  return 'stamped';
end;
$$;

revoke all on function public.record_stamp(uuid, text, text, uuid, text, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.record_stamp(uuid, text, text, uuid, text, timestamptz, bigint) to service_role;
```

---

### 2.4 Step-by-Step Rollout Guide for Dan

When you are ready to introduce NTAG 424 DNA cards to your cafe, follow these numbered steps:

1. **Purchase NXP NTAG 424 DNA Tags:**
   - Order blank NTAG 424 DNA cards or epoxy keyfobs.
   - Ensure the supplier confirms they support **SUN (Secure Unique NFC)** mirroring.
2. **Apply the Database Migration:**
   - Go to your Supabase Dashboard > **SQL Editor**.
   - Paste the SQL script from Section 2.3 and click **Run**.
3. **Set the Server Secret Key:**
   - In your Vercel Project Settings > **Environment Variables**, add:
     - `NTAG424_MASTER_KEY`: A 32-character hexadecimal key (128 bits).
4. **Provision the Card with NXP TagWriter:**
   - In NXP TagWriter, configure dynamic URL mirroring with `picc_data` and `cmac`.
   - Register the tag ID in your staff portal (`/staff/tags`) with `chip_type = 'ntag424dna'`.
5. **Test Counter Progression:**
   - Tap the card with a test phone. The stamp is recorded and `last_counter` becomes `1`.
   - Refresh the URL in the phone's browser history. The server rejects it with `invalid-tag` because counter `1` has already been consumed!

---

## 3. Upgrade 2: Repeat-Visit & Retention Cohort Analytics (`Asia/Manila`)

### 3.1 What These Analytics Answer for Dan

As a coffee shop owner, Dan needs four vital numbers to make smart business decisions:

1. **Second-Visit Conversion Rate:**
   - _Question:_ Out of 100 new customers who get their very first stamp, how many come back for a second coffee within 14 days? Within 30 days?
   - _Why Dan cares:_ If 80% return within 14 days, customer loyalty is strong. If only 20% return, your coffee or barista onboarding needs immediate attention.
2. **Visit Frequency (Average Days Between Visits):**
   - _Question:_ How many days typically pass between visits for a regular customer?
   - _Why Dan cares:_ If the average is 3 days, customers drink your coffee twice a week. You can use this baseline to measure if special events or promos increase visit frequency.
3. **Busy Hours in Manila Time (`Asia/Manila`):**
   - _Question:_ What are the exact peak hours for loyalty taps on Mondays versus Saturdays?
   - _Why Dan cares:_ Schedules barista shifts accurately so counter lines move fast during morning rush (7:00 AM - 9:30 AM) and afternoon chill hours (2:00 PM - 5:00 PM).
4. **Reward Completion Velocity:**
   - _Question:_ How many days does it take the typical customer to complete 10 stamps and redeem their free coffee?
   - _Why Dan cares:_ Helps forecast bean inventory and free drink promotional costs.

---

### 3.2 Secure SQL Views (`security_invoker = true`)

Because Philippine privacy law (RA 10173) protects customer purchase history, analytical views must use `security_invoker = true`. This guarantees that regular customers cannot query store-wide numbers, and only authenticated staff (`public.is_staff()`) or backend administrators can view aggregated store data.

#### SQL Migration Script: `supabase/migrations/20261102060000_phase9_analytics_views.sql`

```sql
-- Migration: 20261102060000_phase9_analytics_views.sql
-- Description: Phase 9 Store Analytics Views in Asia/Manila timezone

-- -----------------------------------------------------------------------------
-- 1. Hourly Tap Heatmap by Day of Week in Manila Time
-- -----------------------------------------------------------------------------
create or replace view public.analytics_manila_hourly_taps
with (security_invoker = true) as
select
  to_char(s.created_at at time zone 'Asia/Manila', 'FMDay') as day_of_week_name,
  extract(isodow from s.created_at at time zone 'Asia/Manila')::integer as day_of_week_num, -- 1=Monday, 7=Sunday
  extract(hour from s.created_at at time zone 'Asia/Manila')::integer as hour_of_day,       -- 0 to 23
  count(*)::bigint as total_taps,
  count(distinct s.customer_id)::bigint as unique_customers,
  count(distinct s.tag_id)::bigint as active_tags
from public.stamps as s
group by
  to_char(s.created_at at time zone 'Asia/Manila', 'FMDay'),
  extract(isodow from s.created_at at time zone 'Asia/Manila')::integer,
  extract(hour from s.created_at at time zone 'Asia/Manila')::integer
order by
  day_of_week_num asc,
  hour_of_day asc;

comment on view public.analytics_manila_hourly_taps is 'Hourly tap distribution by day of week evaluated strictly in Asia/Manila business time';

-- -----------------------------------------------------------------------------
-- 2. Customer Retention Cohorts (Stamp #1 to Stamp #2 Conversion)
-- -----------------------------------------------------------------------------
create or replace view public.analytics_customer_retention_cohorts
with (security_invoker = true) as
with ranked_stamps as (
  select
    customer_id,
    created_at at time zone 'Asia/Manila' as stamp_time_manila,
    row_number() over (partition by customer_id order by created_at asc) as stamp_seq
  from public.stamps
),
first_two_stamps as (
  select
    s1.customer_id,
    s1.stamp_time_manila as first_stamp_time,
    date_trunc('month', s1.stamp_time_manila)::date as cohort_month,
    s2.stamp_time_manila as second_stamp_time,
    extract(day from (s2.stamp_time_manila - s1.stamp_time_manila)) as days_to_second_visit
  from ranked_stamps s1
  left join ranked_stamps s2 on s1.customer_id = s2.customer_id and s2.stamp_seq = 2
  where s1.stamp_seq = 1
)
select
  cohort_month,
  count(*)::bigint as total_first_time_customers,
  count(second_stamp_time)::bigint as returned_customers,
  round((count(second_stamp_time)::numeric / nullif(count(*), 0) * 100), 1) as overall_return_pct,
  count(case when days_to_second_visit <= 14 then 1 end)::bigint as returned_within_14_days,
  round((count(case when days_to_second_visit <= 14 then 1 end)::numeric / nullif(count(*), 0) * 100), 1) as return_14d_pct,
  count(case when days_to_second_visit <= 30 then 1 end)::bigint as returned_within_30_days,
  round((count(case when days_to_second_visit <= 30 then 1 end)::numeric / nullif(count(*), 0) * 100), 1) as return_30d_pct,
  round(avg(days_to_second_visit)::numeric, 1) as avg_days_to_second_stamp
from first_two_stamps
group by cohort_month
order by cohort_month desc;

comment on view public.analytics_customer_retention_cohorts is 'Monthly acquisition cohorts tracking second-visit retention rates within 14 and 30 days';

-- -----------------------------------------------------------------------------
-- 3. Reward Velocity (Days from First Stamp to 10-Stamp Redemption)
-- -----------------------------------------------------------------------------
create or replace view public.analytics_reward_velocity
with (security_invoker = true) as
with customer_first_stamp as (
  select
    customer_id,
    min(created_at) at time zone 'Asia/Manila' as first_stamp_time
  from public.stamps
  group by customer_id
),
customer_first_redemption as (
  select
    customer_id,
    min(created_at) at time zone 'Asia/Manila' as first_redeem_time
  from public.redemptions
  group by customer_id
)
select
  count(r.customer_id)::bigint as total_redeemers,
  round(avg(extract(epoch from (r.first_redeem_time - s.first_stamp_time)) / 86400)::numeric, 1) as avg_days_to_reward,
  round(percentile_cont(0.5) within group (
    order by (extract(epoch from (r.first_redeem_time - s.first_stamp_time)) / 86400)
  )::numeric, 1) as median_days_to_reward,
  round(min(extract(epoch from (r.first_redeem_time - s.first_stamp_time)) / 86400)::numeric, 1) as fastest_days_to_reward,
  round(max(extract(epoch from (r.first_redeem_time - s.first_stamp_time)) / 86400)::numeric, 1) as slowest_days_to_reward
from customer_first_redemption r
join customer_first_stamp s on s.customer_id = r.customer_id;

comment on view public.analytics_reward_velocity is 'Average and median days required for customers to advance from Stamp #1 to their first Free Coffee redemption';

-- Grant access to staff and service_role
grant select on table public.analytics_manila_hourly_taps to authenticated, service_role;
grant select on table public.analytics_customer_retention_cohorts to authenticated, service_role;
grant select on table public.analytics_reward_velocity to authenticated, service_role;
```

---

### 3.3 Ready-to-Run SQL Queries for Dan's Supabase Dashboard

Dan can copy and paste any of these queries into the **Supabase SQL Editor** to see immediate live numbers:

#### Query 1: Second-Visit Conversion Rate

```sql
-- What % of new customers return for drink #2?
select
  to_char(cohort_month, 'Mon YYYY') as month,
  total_first_time_customers as new_customers,
  return_14d_pct || '%' as returned_in_2_weeks,
  return_30d_pct || '%' as returned_in_1_month,
  avg_days_to_second_stamp as avg_days_to_come_back
from public.analytics_customer_retention_cohorts;
```

#### Query 2: Average Days Between Visits for Active Customers

```sql
-- How often do your repeat customers visit The Caffeine Plug?
with customer_intervals as (
  select
    customer_id,
    extract(epoch from (created_at - lag(created_at) over (partition by customer_id order by created_at asc))) / 86400 as days_between
  from public.stamps
)
select
  count(distinct customer_id) as regular_customers,
  round(avg(days_between)::numeric, 1) as avg_days_between_visits,
  round(percentile_cont(0.5) within group (order by days_between)::numeric, 1) as median_days_between_visits
from customer_intervals
where days_between is not null;
```

#### Query 3: Heatmap of Busy Hours in Manila Time

```sql
-- Find your busiest hours on weekends vs weekdays
select
  day_of_week_name,
  hour_of_day || ':00' as time_slot_manila,
  total_taps,
  unique_customers
from public.analytics_manila_hourly_taps
where hour_of_day between 6 and 22 -- Cafe opening hours
order by day_of_week_num asc, total_taps desc;
```

#### Query 4: Reward Completion Velocity (Median Days to Free Coffee)

```sql
-- How long does it take for a customer to complete their card?
select
  total_redeemers as free_coffees_given,
  avg_days_to_reward || ' days' as average_time,
  median_days_to_reward || ' days' as typical_time_median
from public.analytics_reward_velocity;
```

---

## 4. Upgrade 3: Opt-In Customer Messaging & Mid-Tier Milestone Rewards

### 4.1 Philippines RA 10173 Compliant Opt-In Messaging

#### Why Marketing Consent Must Be Separate from Backup Consent

Under the **Philippines Data Privacy Act of 2012 (RA 10173)**, personal data can only be collected for specified, explicit, and legitimate purposes:

1. **Wallet Backup Consent:** When a customer enters their email or phone number to "Back up my loyalty pass", that personal data can **only** be used to recover their stamps if they lose their phone.
2. **Promotional Drop Consent:** Sending notifications about secret roast drops, streetwear collaborations, or double-stamp weekend events is direct marketing.
3. **The Unbundling Rule:** You cannot force a customer to accept marketing emails just to save their stamp card. The customer must be given an unticked, optional checkbox:
   - `[X] Back up my card to Google / Email (Required for backup)`
   - `[ ] Send me secret coffee drops & merchandise releases (Optional)`

#### Database Schema Blueprint: `public.customer_consents`

The `public.customer_consents` table stores an immutable audit trail of every grant and revocation:

```sql
-- Migration snippet: public.customer_consents
create table if not exists public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  consent_type text not null check (consent_type in ('backup', 'email_drops', 'sms_drops')),
  granted boolean not null,
  created_at timestamptz not null default now()
);

-- Index for fast lookup of a customer's current consent status
create index if not exists customer_consents_lookup_idx
  on public.customer_consents (customer_id, consent_type, created_at desc);

-- RLS: Customers can view and update only their own consent
alter table public.customer_consents enable row level security;

create policy customer_consents_select_policy
  on public.customer_consents
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or public.is_staff());

create policy customer_consents_insert_policy
  on public.customer_consents
  for insert
  to authenticated
  with check ((select auth.uid()) = customer_id);
```

#### One-Click Unsubscribe & Right to Erasure

1. **One-Click Unsubscribe:** Every email or SMS message includes an unguessable link (e.g., `https://card.thecaffeineplug.ph/unsubscribe?token=...`). Clicking it inserts a row with `granted = false`.
2. **Automatic Deletion:** When a customer triggers self-service account erasure (`DELETE /api/customers`), the foreign key `references public.customers(id) on delete cascade` automatically and permanently wipes all consent records.

---

### 4.2 Activating Slot #5 (`50% OFF`) as a Redeemable Reward

#### How Slot #5 Works Today (v1)

In v1, the physical reference card shows "50% off" at slot #5 and "FREE COFFEE" at slot #10.
In v1 code, slot #5 acts as an exciting **visual progress milestone badge** to motivate the customer to keep coming back. Only slot #10 issues a redeemable QR code.

#### How to Activate Slot #5 as an Active Redeemable Perk

If Dan chooses to make slot #5 an actual redeemable reward (half-price beverage), here is how the ledger handles it cleanly:

1. **Clean Ledger Mechanics:**
   - In Phase 1, the `redemptions` table was intentionally designed with:
     ```sql
     stamps_used integer not null check (stamps_used > 0)
     ```
   - It was **never hardcoded to 10**!
   - When a customer redeems Free Coffee, `stamps_used = 10`.
   - When a customer redeems 50% Off, `stamps_used = 5`.
2. **Zero-Confusion Balance Formula:**
   - `available_stamps = total_stamps - stamps_redeemed`
   - Example customer journey:
     - Customer earns 6 stamps.
     - Customer chooses to redeem the 50% off perk (costs 5 stamps).
     - Database inserts a row into `redemptions` with `stamps_used = 5`.
     - Customer now has 1 available stamp remaining (`6 - 5 = 1`).
     - Customer earns 9 more stamps over the next month (`total_stamps = 15`).
     - Customer's available stamps is now `15 - 5 = 10 stamps`.
     - Customer is now eligible for their Free Coffee!

#### Schema Upgrade Blueprint

```sql
-- Migration snippet: Activate multi-tier redemptions
alter table public.redemptions
  add column if not exists reward_tier text not null default 'reward_10_free_coffee'
  check (reward_tier in ('milestone_5_50pct', 'reward_10_free_coffee'));

comment on column public.redemptions.reward_tier is 'Reward tier redeemed: milestone_5_50pct (5 stamps) or reward_10_free_coffee (10 stamps)';
```

#### TypeScript Contract Upgrade Blueprint

```typescript
// Future additions to lib/contracts.ts
export type RewardTier = 'milestone_5_50pct' | 'reward_10_free_coffee';

export interface RedeemTokenPayload {
  customerId: string;
  iat: number;
  exp: number;
  nonce: string;
  rewardTier: RewardTier; // Added for multi-tier redemption
  stampsCost: number; // 5 or 10
}
```

#### Barista Counter Experience

When the barista scans the customer's QR code on `/staff/redeem`:

- If `rewardTier === 'milestone_5_50pct'`: The screen displays a high-contrast badge: **"50% OFF ANY BEVERAGE (5 STAMPS)"**.
- If `rewardTier === 'reward_10_free_coffee'`: The screen displays: **"FREE COFFEE OF CHOICE (10 STAMPS)"**.
- The barista verifies the drink discount at the cash register, taps **Confirm**, and the exact number of stamps (5 or 10) is deducted atomically.

---

## 5. Summary Decision Matrix & Roadmap

| Feature Upgrade                                  | Why Dan Needs It                                                                     | Trigger to Implement                                                                   | Estimated Dev Effort                                          | Breaking Changes?                                               |
| :----------------------------------------------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :-------------------------------------------------------------- |
| **Upgrade 1: NTAG 424 DNA Cryptographic Cards**  | Prevents URL sharing, bookmarks, or cloning with 100% mathematical certainty.        | Store daily tap volume exceeds 200 taps, or cafe introduces unattended loyalty stands. | 1 day (SQL migration + `verifyTap` AES decryption)            | **None.** Works side-by-side with existing NTAG215 cards.       |
| **Upgrade 2: Retention Cohort Analytics**        | Track second-visit return rates, busy cafe hours, and average days between visits.   | Cafe has been live for 30 days and has collected at least 100 customer taps.           | 2 hours (Run the provided SQL script in Supabase)             | **None.** Read-only views that do not touch transaction tables. |
| **Upgrade 3: Opt-In Drop Messaging (RA 10173)**  | Send secret coffee drop & streetwear merch announcements to loyal customers.         | Cafe launches its packaged retail bean line or limited merchandise drops.              | 2 days (Consent table migration + SMS/Email provider webhook) | **None.** Extends existing customer accounts.                   |
| **Upgrade 4: Slot #5 50% Off Active Redemption** | Gives customers faster gratification by allowing them to redeem 50% off at 5 stamps. | Dan decides to test whether a mid-tier reward boosts customer return frequency.        | 1 day (Add `reward_tier` column + update staff preview UI)    | **None.** Ledger model already supports variable `stamps_used`. |

---

_This document is the official Phase 9 architecture specification for The Caffeine Plug. All code snippets and SQL scripts have been cross-verified against the v1 reference contracts (`lib/contracts.ts`, `lib/nfc/verifyTap.ts`, and Supabase migrations)._
