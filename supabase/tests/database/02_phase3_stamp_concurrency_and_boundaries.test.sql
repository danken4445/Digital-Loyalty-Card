-- ==============================================================================
-- 02_phase3_stamp_concurrency_and_boundaries.test.sql
-- pgTAP Test Suite for Phase 3 Stamp Engine Boundaries & Concurrency
-- Tests:
--   1. Exact 5-second per-tag throttle boundary (4.999s throttled, 5.000s allowed)
--   2. Exact 30-minute customer cooldown boundary (29m 59.999s cooldown, 30m 00.000s allowed)
--   3. Exact Asia/Manila midnight boundary (UTC+8 daily limit reset at 00:00:00+08)
--   4. Rapid burst of 20 taps by the same customer within cooldown window (1 stamped, 19 cooldown)
--   5. Inactive and non-existent tag rejection
--   6. Tag whitespace normalization
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0. Environment Setup & Plan
-- ------------------------------------------------------------------------------
create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

-- Grant usage on extensions so pgtap assertion functions run cleanly
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(20);

-- Pre-seed test users in auth.users
insert into auth.users (id, aud, role, email)
values
    ('a1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'phase3-customer-a@caffeineplug.ph'),
    ('b2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'phase3-customer-b@caffeineplug.ph'),
    ('c3333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'phase3-customer-burst@caffeineplug.ph'),
    ('d4444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'phase3-customer-invalid@caffeineplug.ph')
on conflict (id) do nothing;

-- Pre-seed tags dedicated to boundary & concurrency tests
insert into public.tags (id, label, active)
values
    ('tag_phase3_x1', 'Phase 3 Throttle & Cooldown Tag', true),
    ('tag_phase3_w1', 'Phase 3 Rapid Burst Tag', true),
    ('tag_phase3_inactive_z1', 'Phase 3 Inactive Test Tag', false)
on conflict (id) do update set active = excluded.active;


-- ==============================================================================
-- 1. Exact 5-Second Per-Tag Throttle Boundary (3 assertions)
-- ==============================================================================

-- 1.1 Customer A stamps Tag X at 10:00:00.000+08 -> 'stamped'
select is(
    public.record_stamp(
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-02 10:00:00.000+08'::timestamptz
    ),
    'stamped',
    'Customer A 1st stamp on Tag X at 10:00:00.000+08 returns stamped'
);

-- 1.2 Customer B stamps same Tag X at 10:00:04.999+08 (4.999s later) -> 'tag-throttled'
select is(
    public.record_stamp(
        'b2222222-2222-2222-2222-222222222222'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-02 10:00:04.999+08'::timestamptz
    ),
    'tag-throttled',
    'Customer B on Tag X at 10:00:04.999+08 (4.999s later) returns tag-throttled'
);

-- 1.3 Customer B stamps same Tag X at 10:00:05.000+08 (exactly 5.000s later) -> 'stamped'
select is(
    public.record_stamp(
        'b2222222-2222-2222-2222-222222222222'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-02 10:00:05.000+08'::timestamptz
    ),
    'stamped',
    'Customer B on Tag X at 10:00:05.000+08 (exactly 5.000s later) returns stamped'
);


-- ==============================================================================
-- 2. Exact 30-Minute Customer Cooldown Boundary (2 assertions)
-- ==============================================================================

-- 2.1 Customer A at 10:29:59.999+08 (29m 59.999s after their 10:00:00.000 stamp) -> 'cooldown'
select is(
    public.record_stamp(
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-02 10:29:59.999+08'::timestamptz
    ),
    'cooldown',
    'Customer A on Tag X at 10:29:59.999+08 (29m 59.999s later) returns cooldown'
);

-- 2.2 Customer A at 10:30:00.000+08 (exactly 30m 00.000s after their 10:00:00.000 stamp) -> 'stamped'
select is(
    public.record_stamp(
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-02 10:30:00.000+08'::timestamptz
    ),
    'stamped',
    'Customer A on Tag X at 10:30:00.000+08 (exactly 30m 00.000s later) returns stamped'
);


-- ==============================================================================
-- 3. Exact Asia/Manila Midnight Boundary (UTC+8) (7 assertions)
-- ==============================================================================

-- 3.1 Customer A attempts a 3rd stamp on 2026-11-02 at 23:59:59.999+08 (15:59:59.999Z UTC) -> 'daily-limit'
select is(
    public.record_stamp(
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-02 23:59:59.999+08'::timestamptz
    ),
    'daily-limit',
    'Customer A at 2026-11-02 23:59:59.999+08 (3rd stamp of the day) returns daily-limit'
);

-- 3.2 Customer A attempts stamp at 2026-11-03 00:00:00.000+08 (16:00:00.000Z UTC, exact Manila midnight!) -> 'stamped'
select is(
    public.record_stamp(
        'a1111111-1111-1111-1111-111111111111'::uuid,
        'tag_phase3_x1',
        'nfc',
        null,
        null,
        '2026-11-03 00:00:00.000+08'::timestamptz
    ),
    'stamped',
    'Customer A at 2026-11-03 00:00:00.000+08 (exact Asia/Manila midnight) returns stamped'
);

-- 3.3 Verify Customer A stamp count on 2026-11-02 in Asia/Manila is exactly 2
select is(
    (
        select count(*)::integer
        from public.stamps
        where customer_id = 'a1111111-1111-1111-1111-111111111111'
          and (created_at at time zone 'Asia/Manila')::date = '2026-11-02'::date
    ),
    2,
    'Customer A has exactly 2 stamps recorded on 2026-11-02 in Asia/Manila'
);

-- 3.4 Verify Customer A stamp count on 2026-11-03 in Asia/Manila is exactly 1
select is(
    (
        select count(*)::integer
        from public.stamps
        where customer_id = 'a1111111-1111-1111-1111-111111111111'
          and (created_at at time zone 'Asia/Manila')::date = '2026-11-03'::date
    ),
    1,
    'Customer A has exactly 1 stamp recorded on 2026-11-03 in Asia/Manila'
);

-- 3.5 Verify Customer A total all-time stamps in public.stamps is 3
select is(
    (
        select count(*)::integer
        from public.stamps
        where customer_id = 'a1111111-1111-1111-1111-111111111111'
    ),
    3,
    'Customer A has exactly 3 stamps recorded all-time in public.stamps'
);

-- 3.6 Verify Customer A customer_balances view reflects total_stamps = 3
select is(
    (
        select total_stamps
        from public.customer_balances
        where customer_id = 'a1111111-1111-1111-1111-111111111111'
    ),
    3,
    'customer_balances shows total_stamps = 3 for Customer A'
);

-- 3.7 Verify Customer A customer_balances view reflects available_stamps = 3
select is(
    (
        select available_stamps
        from public.customer_balances
        where customer_id = 'a1111111-1111-1111-1111-111111111111'
    ),
    3,
    'customer_balances shows available_stamps = 3 for Customer A'
);


-- ==============================================================================
-- 4. Burst of 20 Rapid Taps by Same Customer Within Cooldown Window (4 assertions)
-- ==============================================================================

-- 4.1 First tap by Customer Burst at 12:00:00+08 -> 'stamped'
select is(
    public.record_stamp(
        'c3333333-3333-3333-3333-333333333333'::uuid,
        'tag_phase3_w1',
        'nfc',
        null,
        null,
        '2026-11-02 12:00:00.000+08'::timestamptz
    ),
    'stamped',
    'Customer Burst 1st tap at 12:00:00.000+08 returns stamped'
);

-- 4.2 Taps 2 through 20 (19 subsequent taps inside the 30-minute cooldown window) all return 'cooldown'
select is(
    (
        select count(*)::integer
        from (
            select public.record_stamp(
                'c3333333-3333-3333-3333-333333333333'::uuid,
                'tag_phase3_w1',
                'nfc',
                null,
                null,
                '2026-11-02 12:00:00.000+08'::timestamptz + (i || ' seconds')::interval
            ) as stamp_result
            from generate_series(1, 19) as i
        ) results
        where results.stamp_result = 'cooldown'
    ),
    19,
    'Burst of 19 subsequent rapid taps by Customer Burst within cooldown window all return cooldown'
);

-- 4.3 Total stamps recorded for Customer Burst in public.stamps is exactly 1
select is(
    (
        select count(*)::integer
        from public.stamps
        where customer_id = 'c3333333-3333-3333-3333-333333333333'
    ),
    1,
    'Total stamps recorded for Customer Burst is exactly 1'
);

-- 4.4 customer_balances view reflects available_stamps = 1 for Customer Burst
select is(
    (
        select available_stamps
        from public.customer_balances
        where customer_id = 'c3333333-3333-3333-3333-333333333333'
    ),
    1,
    'customer_balances shows available_stamps = 1 for Customer Burst'
);


-- ==============================================================================
-- 5. Invalid / Inactive Tag Rejection & Whitespace Trimming (4 assertions)
-- ==============================================================================

-- 5.1 Non-existent tag returns 'invalid-tag'
select is(
    public.record_stamp(
        'd4444444-4444-4444-4444-444444444444'::uuid,
        'non_existent_tag_xyz',
        'nfc',
        null,
        null,
        '2026-11-02 14:00:00+08'::timestamptz
    ),
    'invalid-tag',
    'record_stamp with non-existent tag returns invalid-tag'
);

-- 5.2 Inactive tag returns 'invalid-tag'
select is(
    public.record_stamp(
        'd4444444-4444-4444-4444-444444444444'::uuid,
        'tag_phase3_inactive_z1',
        'nfc',
        null,
        null,
        '2026-11-02 14:00:00+08'::timestamptz
    ),
    'invalid-tag',
    'record_stamp with inactive tag returns invalid-tag'
);

-- 5.3 Customer D has 0 stamps inserted from rejected attempts
select is(
    (
        select count(*)::integer
        from public.stamps
        where customer_id = 'd4444444-4444-4444-4444-444444444444'
    ),
    0,
    'Customer D has 0 stamp records in public.stamps'
);

-- 5.4 Tag whitespace trimming: leading and trailing whitespace on tag ID is normalized and succeeds
select is(
    public.record_stamp(
        'b2222222-2222-2222-2222-222222222222'::uuid,
        '   tag_phase3_x1   ',
        'nfc',
        null,
        null,
        '2026-11-03 00:35:00.000+08'::timestamptz
    ),
    'stamped',
    'record_stamp trims leading and trailing whitespace on tag ID and awards stamp'
);

-- ------------------------------------------------------------------------------
-- Finish & Rollback
-- ------------------------------------------------------------------------------
select * from finish();
rollback;
