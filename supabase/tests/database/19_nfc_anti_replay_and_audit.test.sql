-- ==============================================================================
-- 19_nfc_anti_replay_and_audit.test.sql
-- pgTAP Test Suite for NFC Anti-Replay, Hardware Counter Auto-Latch & Audit Logging
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(20);

-- ------------------------------------------------------------------------------
-- Fixtures: Shop, Tag, and Customers
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous)
values
    ('19000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-nfc@test.local', now(), false),
    ('19000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cust-nfc-1@test.local', now(), false),
    ('19000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'cust-nfc-2@test.local', now(), false),
    ('19000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'cust-nfc-nocard@test.local', now(), false)
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('19111111-0000-4000-8000-000000000001', 'nfc-security-cafe', 'NFC Security Cafe', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, reward_label, timezone)
values
    ('19111111-0000-4000-8000-000000000001', 30, 2, 10, 0, 'FREE COFFEE', 'Asia/Manila')
on conflict (tenant_id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('19111111-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000001', 'owner', 'Owner NFC', true)
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (id)
values
    ('19000000-0000-4000-8000-000000000002'),
    ('19000000-0000-4000-8000-000000000003'),
    ('19000000-0000-4000-8000-000000000004')
on conflict (id) do nothing;

-- cust-nfc-1 and cust-nfc-2 have cards; cust-nfc-nocard does NOT
insert into public.customer_cards (customer_id, tenant_id, available_stamps, total_stamps, consent_version)
values
    ('19000000-0000-4000-8000-000000000002', '19111111-0000-4000-8000-000000000001', 0, 0, 'v1'),
    ('19000000-0000-4000-8000-000000000003', '19111111-0000-4000-8000-000000000001', 0, 0, 'v1')
on conflict (customer_id, tenant_id) do nothing;

-- Provision fresh tag
insert into public.tags (id, tenant_id, label, active)
values ('tag_anti_replay_test_01', '19111111-0000-4000-8000-000000000001', 'Barista - Front', true)
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------
-- 1. Non-Zero Initial Counter Auto-Latch Test
-- ------------------------------------------------------------------------------

-- Initial state: last_tap_counter and hardware_uid are null
select is(
    last_tap_counter,
    null,
    'Tag starts with last_tap_counter = null'
) from public.tags where id = 'tag_anti_replay_test_01';

select is(
    hardware_uid,
    null,
    'Tag starts with hardware_uid = null'
) from public.tags where id = 'tag_anti_replay_test_01';

-- First tap from customer 1 with counter 20 and UID 04930D01590F13
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000002',
        'tag_anti_replay_test_01',
        now(),
        20,
        '04930d01590f13'
    ),
    '{"result": "stamped", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'First tap with non-zero counter 20 auto-latches and succeeds'
);

-- Tag now has latched counter 20 and uppercase UID
select is(
    last_tap_counter,
    20::bigint,
    'Tag has latched last_tap_counter = 20'
) from public.tags where id = 'tag_anti_replay_test_01';

select is(
    hardware_uid,
    '04930D01590F13',
    'Tag has latched hardware_uid = 04930D01590F13'
) from public.tags where id = 'tag_anti_replay_test_01';

-- ------------------------------------------------------------------------------
-- 2. Hardware Counter Replay Detection
-- ------------------------------------------------------------------------------

-- Replay identical counter 20 -> must reject as invalid-tag
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000003',
        'tag_anti_replay_test_01',
        now() + interval '1 minute',
        20,
        '04930D01590F13'
    ),
    '{"result": "invalid-tag", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Replaying identical tap counter (20 <= 20) returns invalid-tag'
);

-- Stale counter 19 -> must reject as invalid-tag
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000003',
        'tag_anti_replay_test_01',
        now() + interval '2 minutes',
        19,
        '04930D01590F13'
    ),
    '{"result": "invalid-tag", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Replaying older tap counter (19 < 20) returns invalid-tag'
);

-- Missing counter on latched tag -> must reject as invalid-tag
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000003',
        'tag_anti_replay_test_01',
        now() + interval '3 minutes',
        null,
        '04930D01590F13'
    ),
    '{"result": "invalid-tag", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Static tap with null counter on counter-latched tag returns invalid-tag'
);

-- Verify audit_log entries for counter replay
select is(
    count(*)::integer,
    3,
    'audit_log recorded 3 stamp_rejected_counter_replay events'
) from public.audit_log
where action = 'stamp_rejected_counter_replay'
  and target = 'tag_anti_replay_test_01';

-- ------------------------------------------------------------------------------
-- 3. Hardware UID Mismatch Detection
-- ------------------------------------------------------------------------------

-- Tap with counter 21 but different cloned UID -> must reject as invalid-tag
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000003',
        'tag_anti_replay_test_01',
        now() + interval '4 minutes',
        21,
        '01020304050607'
    ),
    '{"result": "invalid-tag", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Tap with mismatched hardware UID returns invalid-tag'
);

-- Counter did NOT advance from mismatched UID attempt
select is(
    last_tap_counter,
    20::bigint,
    'last_tap_counter remains 20 after UID mismatch reject'
) from public.tags where id = 'tag_anti_replay_test_01';

-- ------------------------------------------------------------------------------
-- 4. Monotonic Valid Tap Progression
-- ------------------------------------------------------------------------------

-- Valid tap from customer 2 with counter 21 and correct UID
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000003',
        'tag_anti_replay_test_01',
        now() + interval '5 minutes',
        21,
        '04930D01590F13'
    ),
    '{"result": "stamped", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Valid strictly increasing tap counter (21 > 20) succeeds'
);

-- Tag counter advanced to 21
select is(
    last_tap_counter,
    21::bigint,
    'last_tap_counter successfully advanced to 21'
) from public.tags where id = 'tag_anti_replay_test_01';

-- ------------------------------------------------------------------------------
-- 5. no-card Tap Does Not Burn Counter
-- ------------------------------------------------------------------------------

-- Customer 4 has no card at this shop yet, taps with counter 22
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000004',
        'tag_anti_replay_test_01',
        now() + interval '6 minutes',
        22,
        '04930D01590F13'
    ),
    '{"result": "no-card", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Tap without customer card returns no-card'
);

-- Crucial: Counter must NOT advance to 22 yet, so follow-up claim can succeed!
select is(
    last_tap_counter,
    21::bigint,
    'last_tap_counter was NOT burned by no-card tap'
) from public.tags where id = 'tag_anti_replay_test_01';

-- Customer 4 adds card and claims with that same counter 22
insert into public.customer_cards (customer_id, tenant_id, available_stamps, total_stamps, consent_version)
values ('19000000-0000-4000-8000-000000000004', '19111111-0000-4000-8000-000000000001', 0, 0, 'v1');

select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000004',
        'tag_anti_replay_test_01',
        now() + interval '7 minutes',
        22,
        '04930D01590F13'
    ),
    '{"result": "stamped", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Follow-up claim with counter 22 succeeds after card was added'
);

select is(
    last_tap_counter,
    22::bigint,
    'last_tap_counter is now 22 after follow-up claim'
) from public.tags where id = 'tag_anti_replay_test_01';

-- ------------------------------------------------------------------------------
-- 6. Cooldown & Daily Limit Audit Logging
-- ------------------------------------------------------------------------------

-- Customer 4 taps again within cooldown (30 min) with counter 23
select is(
    public.stamp_card_nfc(
        '19000000-0000-4000-8000-000000000004',
        'tag_anti_replay_test_01',
        now() + interval '8 minutes',
        23,
        '04930D01590F13'
    ),
    '{"result": "cooldown", "tenant_slug": "nfc-security-cafe"}'::jsonb,
    'Tap within 30-min cooldown returns cooldown'
);

-- Even though rejected by cooldown, counter 23 was valid and burned
select is(
    last_tap_counter,
    23::bigint,
    'last_tap_counter advanced to 23 even on cooldown rejection'
) from public.tags where id = 'tag_anti_replay_test_01';

-- Verify audit_log recorded stamp_rejected_cooldown
select is(
    count(*)::integer,
    1,
    'audit_log recorded stamp_rejected_cooldown event'
) from public.audit_log
where action = 'stamp_rejected_cooldown'
  and target = '19000000-0000-4000-8000-000000000004';

rollback;

