-- ==============================================================================
-- 08_card_stamping.test.sql
-- pgTAP Test Suite for Phase 11 Wallet Cards and Tenant-Aware NFC Stamping
-- Tests:
--   1. add_card is idempotent and refuses closed tenants
--   2. stamp_card_nfc credits the tag's tenant, never the caller's
--   3. no-card, invalid-tag and tenant-unavailable outcomes
--   4. Cooldown, daily cap and tag throttle come from each tenant's settings
--   5. Clients cannot call the functions directly
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(26);

-- ------------------------------------------------------------------------------
-- Shared fixtures: tenant A = tenant #1, tenant B = bean-there (Asia/Tokyo)
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('ca000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'cust-a@test.local'),
    ('cb000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'cust-b@test.local'),
    ('cc000000-0000-4000-8000-0000000000ab', 'authenticated', 'authenticated', 'cust-ab@test.local'),
    ('c8000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cust-per-tenant@test.local'),
    ('c8000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cust-cooldown@test.local'),
    ('c8000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'cust-timezone@test.local'),
    ('c8000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'cust-throttle-1@test.local'),
    ('c8000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'cust-throttle-2@test.local'),
    ('c8000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'cust-throttle-3@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('7c1f0000-0000-4000-8000-00000000000b', 'bean-there', 'Bean There', 'active'),
    ('7c1f0000-0000-4000-8000-00000000000c', 'closed-shop', 'Closed Shop', 'closed');

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone)
values
    ('7c1f0000-0000-4000-8000-00000000000b', 60, 1, 8, 5, 'Asia/Tokyo'),
    ('7c1f0000-0000-4000-8000-00000000000c', 30, 2, 10, 5, 'Asia/Manila');

insert into public.customers (id)
values
    ('ca000000-0000-4000-8000-00000000000a'),
    ('cb000000-0000-4000-8000-00000000000b'),
    ('cc000000-0000-4000-8000-0000000000ab'),
    ('c8000000-0000-4000-8000-000000000001'),
    ('c8000000-0000-4000-8000-000000000002'),
    ('c8000000-0000-4000-8000-000000000003'),
    ('c8000000-0000-4000-8000-000000000004'),
    ('c8000000-0000-4000-8000-000000000005'),
    ('c8000000-0000-4000-8000-000000000006');

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b'),
    ('7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'c8000000-0000-4000-8000-000000000001'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'c8000000-0000-4000-8000-000000000002'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'c8000000-0000-4000-8000-000000000003'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000004'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000005'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000006');

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_tenant_a_0001', 'Tenant A Counter', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('tag_tenant_b_0001', 'Tenant B Counter', true, '7c1f0000-0000-4000-8000-00000000000b'),
    ('tag_tenant_a_retired', 'Tenant A Retired', false, '7c1f0000-0000-4000-8000-000000000001');

-- ==============================================================================
-- 1. add_card (3 assertions)
-- ==============================================================================

select is(
    public.add_card('ca000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-00000000000b'),
    'added',
    'add_card adds a tenant B card to a tenant A customer'
);

select is(
    public.add_card('ca000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-00000000000b'),
    'already-added',
    'add_card is idempotent'
);

select is(
    public.add_card('ca000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-00000000000c'),
    'tenant-unavailable',
    'add_card refuses a closed tenant'
);

-- ==============================================================================
-- 2. The tag decides the tenant (2 assertions)
-- ==============================================================================

select is(
    public.stamp_card_nfc('cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_b_0001', '2026-11-04 10:00:00+09') ->> 'result',
    'stamped',
    'A customer with cards at A and B stamps with tenant B''s tag'
);

select is(
    (select tenant_id from public.stamps where customer_id = 'cc000000-0000-4000-8000-0000000000ab'),
    '7c1f0000-0000-4000-8000-00000000000b'::uuid,
    'The stamp is credited to the tag''s tenant (B)'
);

-- ==============================================================================
-- 3. no-card, invalid-tag, tenant-unavailable (7 assertions)
-- ==============================================================================

select is(
    public.stamp_card_nfc('cb000000-0000-4000-8000-00000000000b', 'tag_tenant_a_0001', '2026-11-04 10:00:00+08') ->> 'result',
    'no-card',
    'Tapping a shop where the customer holds no card returns no-card'
);

select is(
    public.stamp_card_nfc('cb000000-0000-4000-8000-00000000000b', 'tag_tenant_a_0001', '2026-11-04 10:01:00+08') ->> 'tenant_slug',
    'caffeine-plug',
    'no-card returns the tag''s tenant slug so the app can show the add-card screen'
);

select is(
    (select count(*) from public.stamps where customer_id = 'cb000000-0000-4000-8000-00000000000b'),
    0::bigint,
    'no-card writes no stamp'
);

select is(
    public.stamp_card_nfc('ca000000-0000-4000-8000-00000000000a', 'tag_does_not_exist', '2026-11-04 10:00:00+08') ->> 'result',
    'invalid-tag',
    'An unknown tag returns invalid-tag'
);

select is(
    public.stamp_card_nfc('ca000000-0000-4000-8000-00000000000a', 'tag_does_not_exist', '2026-11-04 10:00:00+08') ->> 'tenant_slug',
    null,
    'invalid-tag reveals no tenant'
);

select is(
    public.stamp_card_nfc('ca000000-0000-4000-8000-00000000000a', 'tag_tenant_a_retired', '2026-11-04 10:00:00+08') ->> 'result',
    'invalid-tag',
    'A deactivated tag returns invalid-tag'
);

update public.tenants set status = 'suspended' where id = '7c1f0000-0000-4000-8000-00000000000b';

select is(
    public.stamp_card_nfc('cb000000-0000-4000-8000-00000000000b', 'tag_tenant_b_0001', '2026-11-04 12:00:00+09') ->> 'result',
    'tenant-unavailable',
    'A suspended tenant accepts no new stamps'
);

update public.tenants set status = 'active' where id = '7c1f0000-0000-4000-8000-00000000000b';

-- ==============================================================================
-- 4a. cooldown_is_per_tenant (3 assertions)
-- ==============================================================================

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000001', 'tag_tenant_a_0001', '2026-11-06 10:00:00+08') ->> 'result',
    'stamped',
    'cooldown_is_per_tenant: stamp at A'
);

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000001', 'tag_tenant_b_0001', '2026-11-06 10:05:00+08') ->> 'result',
    'stamped',
    'cooldown_is_per_tenant: stamp at B 5 minutes later is not blocked by A''s cooldown'
);

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000001', 'tag_tenant_a_0001', '2026-11-06 10:20:00+08') ->> 'result',
    'cooldown',
    'cooldown_is_per_tenant: a second A tap 20 minutes later is in A''s cooldown'
);

-- ==============================================================================
-- 4b. cooldown_uses_tenant_setting: B cooldown is 60 minutes (3 assertions)
-- ==============================================================================

update public.tenant_settings set daily_cap = 2 where tenant_id = '7c1f0000-0000-4000-8000-00000000000b';

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000002', 'tag_tenant_b_0001', '2026-11-07 10:00:00+09') ->> 'result',
    'stamped',
    'cooldown_uses_tenant_setting: first B stamp'
);

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000002', 'tag_tenant_b_0001', '2026-11-07 10:59:59.999+09') ->> 'result',
    'cooldown',
    'cooldown_uses_tenant_setting: 59m59.999s later is still in B''s 60-minute cooldown'
);

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000002', 'tag_tenant_b_0001', '2026-11-07 11:00:00+09') ->> 'result',
    'stamped',
    'cooldown_uses_tenant_setting: exactly 60 minutes later is allowed'
);

update public.tenant_settings set daily_cap = 1 where tenant_id = '7c1f0000-0000-4000-8000-00000000000b';

-- ==============================================================================
-- 4c. daily_cap_uses_tenant_timezone: B is Asia/Tokyo with cap 1 (3 assertions)
-- ==============================================================================

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000003', 'tag_tenant_b_0001', '2026-11-08 22:30:00+09') ->> 'result',
    'stamped',
    'daily_cap_uses_tenant_timezone: stamp at 22:30 Tokyo'
);

-- 00:00+09 on 9 Nov is still 8 Nov 23:00 in Manila: a Manila-based cap would return daily-limit
select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000003', 'tag_tenant_b_0001', '2026-11-09 00:00:00+09') ->> 'result',
    'stamped',
    'daily_cap_uses_tenant_timezone: the cap resets at Tokyo midnight'
);

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000003', 'tag_tenant_b_0001', '2026-11-09 01:30:00+09') ->> 'result',
    'daily-limit',
    'daily_cap_uses_tenant_timezone: a second stamp the same Tokyo day hits the cap of 1'
);

-- ==============================================================================
-- 4d. Tag throttle from settings (3 assertions)
-- ==============================================================================

update public.tenant_settings set tag_throttle_seconds = 0 where tenant_id = '7c1f0000-0000-4000-8000-000000000001';

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000004', 'tag_tenant_a_0001', '2026-11-10 10:00:00+08') ->> 'result',
    'stamped',
    'throttle_zero_disables: first customer'
);

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000005', 'tag_tenant_a_0001', '2026-11-10 10:00:01+08') ->> 'result',
    'stamped',
    'throttle_zero_disables: second customer 1 second later is not throttled'
);

update public.tenant_settings set tag_throttle_seconds = 5 where tenant_id = '7c1f0000-0000-4000-8000-000000000001';

select is(
    public.stamp_card_nfc('c8000000-0000-4000-8000-000000000006', 'tag_tenant_a_0001', '2026-11-10 10:00:02+08') ->> 'result',
    'tag-throttled',
    'With a 5-second throttle, a third customer 1 second later is throttled'
);

-- ==============================================================================
-- 5. Not callable by clients (2 assertions)
-- ==============================================================================

set local role authenticated;
select throws_ok(
    $$select public.stamp_card_nfc('ca000000-0000-4000-8000-00000000000a', 'tag_tenant_a_0001')$$,
    '42501',
    null,
    'authenticated cannot call stamp_card_nfc'
);

select throws_ok(
    $$select public.add_card('ca000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001')$$,
    '42501',
    null,
    'authenticated cannot call add_card'
);
reset role;

select * from finish();
rollback;
