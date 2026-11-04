-- ==============================================================================
-- 01_rls_and_functions.test.sql
-- pgTAP Test Suite for The Caffeine Plug NFC Digital Loyalty Card Database
-- Tests RLS isolation, write protection, function EXECUTE locks, and business rules
-- through the tenant-aware functions (stamp_card_nfc, redeem_card_reward).
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0. Environment Setup & Plan
-- ------------------------------------------------------------------------------
create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

-- Grant usage on extensions so pgtap assertion functions run under switched test roles
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(111);

-- Pre-seed test users in auth.users
insert into auth.users (id, aud, role, email)
values
    ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'staff@caffeineplug.ph'),
    ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'customer-a@caffeineplug.ph'),
    ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'customer-b@caffeineplug.ph')
on conflict (id) do nothing;

-- Pre-seed demo staff as an owner of tenant #1 (The Caffeine Plug)
insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('7c1f0000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner', 'Demo Staff', true)
on conflict (tenant_id, user_id) do update set role = 'owner', active = true;

-- Pre-seed tags (demo tag, test active tag alpha, test inactive tag)
insert into public.tags (id, label, active, tenant_id)
values
    ('tcp_tag_demo_9x8k2m4p7q1w', 'Demo Counter Tag', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('test_tag_alpha_12345', 'Alpha Tag', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('test_tag_inactive_999', 'Inactive Tag', false, '7c1f0000-0000-4000-8000-000000000001')
on conflict (id) do update set active = excluded.active;


-- ==============================================================================
-- 1. RLS Enablement on the Core Public Tables (6 assertions)
-- ==============================================================================

select is(
    (select relrowsecurity from pg_class where oid = 'public.customers'::regclass),
    true,
    'customers table has RLS enabled'
);

select is(
    (select relrowsecurity from pg_class where oid = 'public.tags'::regclass),
    true,
    'tags table has RLS enabled'
);

select is(
    (select relrowsecurity from pg_class where oid = 'public.stamps'::regclass),
    true,
    'stamps table has RLS enabled'
);

select is(
    (select relrowsecurity from pg_class where oid = 'public.redemptions'::regclass),
    true,
    'redemptions table has RLS enabled'
);

select is(
    (select relrowsecurity from pg_class where oid = 'public.tenant_members'::regclass),
    true,
    'tenant_members table has RLS enabled'
);

select is(
    (select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass),
    true,
    'audit_log table has RLS enabled'
);


-- ==============================================================================
-- 2. EXECUTE Privilege Locks (16 assertions)
-- ==============================================================================

-- 2.1 anon role must NOT have EXECUTE on privileged RPC functions
select is(
    has_function_privilege('anon', 'public.ensure_customer(uuid)', 'EXECUTE'),
    false,
    'anon cannot execute ensure_customer'
);

select is(
    has_function_privilege('anon', 'public.stamp_card_nfc(uuid, text, timestamptz)', 'EXECUTE'),
    false,
    'anon cannot execute stamp_card_nfc'
);

select is(
    has_function_privilege('anon', 'public.redeem_card_reward(uuid, uuid, uuid, text)', 'EXECUTE'),
    false,
    'anon cannot execute redeem_card_reward'
);

select is(
    has_function_privilege('anon', 'public.log_audit_event(uuid, text, text, jsonb, uuid)', 'EXECUTE'),
    false,
    'anon cannot execute log_audit_event'
);

-- 2.2 authenticated role must NOT have EXECUTE on privileged RPC functions
select is(
    has_function_privilege('authenticated', 'public.ensure_customer(uuid)', 'EXECUTE'),
    false,
    'authenticated cannot execute ensure_customer'
);

select is(
    has_function_privilege('authenticated', 'public.stamp_card_nfc(uuid, text, timestamptz)', 'EXECUTE'),
    false,
    'authenticated cannot execute stamp_card_nfc'
);

select is(
    has_function_privilege('authenticated', 'public.redeem_card_reward(uuid, uuid, uuid, text)', 'EXECUTE'),
    false,
    'authenticated cannot execute redeem_card_reward'
);

select is(
    has_function_privilege('authenticated', 'public.log_audit_event(uuid, text, text, jsonb, uuid)', 'EXECUTE'),
    false,
    'authenticated cannot execute log_audit_event'
);

-- 2.3 service_role DOES have EXECUTE privilege on privileged RPC functions
select is(
    has_function_privilege('service_role', 'public.ensure_customer(uuid)', 'EXECUTE'),
    true,
    'service_role can execute ensure_customer'
);

select is(
    has_function_privilege('service_role', 'public.stamp_card_nfc(uuid, text, timestamptz)', 'EXECUTE'),
    true,
    'service_role can execute stamp_card_nfc'
);

select is(
    has_function_privilege('service_role', 'public.redeem_card_reward(uuid, uuid, uuid, text)', 'EXECUTE'),
    true,
    'service_role can execute redeem_card_reward'
);

select is(
    has_function_privilege('service_role', 'public.log_audit_event(uuid, text, text, jsonb, uuid)', 'EXECUTE'),
    true,
    'service_role can execute log_audit_event'
);

-- 2.4 Calling stamp_card_nfc or redeem_card_reward throws 42501 for authenticated & anon
set local role authenticated;
select throws_ok(
    $$select public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', now())$$,
    '42501',
    null,
    'authenticated role execution of stamp_card_nfc throws 42501'
);

select throws_ok(
    $$select public.redeem_card_reward('00000000-0000-0000-0000-000000000001'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, null)$$,
    '42501',
    null,
    'authenticated role execution of redeem_card_reward throws 42501'
);

set local role anon;
select throws_ok(
    $$select public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', now())$$,
    '42501',
    null,
    'anon role execution of stamp_card_nfc throws 42501'
);

select throws_ok(
    $$select public.redeem_card_reward('00000000-0000-0000-0000-000000000001'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, null)$$,
    '42501',
    null,
    'anon role execution of redeem_card_reward throws 42501'
);
reset role;


-- ==============================================================================
-- 3. Table Write Locks (38 assertions)
-- ==============================================================================

-- 3.1 Anon direct write locks (18 assertions)
select is(has_table_privilege('anon', 'public.customers', 'INSERT'), false, 'anon cannot INSERT customers');
select is(has_table_privilege('anon', 'public.customers', 'UPDATE'), false, 'anon cannot UPDATE customers');
select is(has_table_privilege('anon', 'public.customers', 'DELETE'), false, 'anon cannot DELETE customers');

select is(has_table_privilege('anon', 'public.tags', 'INSERT'), false, 'anon cannot INSERT tags');
select is(has_table_privilege('anon', 'public.tags', 'UPDATE'), false, 'anon cannot UPDATE tags');
select is(has_table_privilege('anon', 'public.tags', 'DELETE'), false, 'anon cannot DELETE tags');

select is(has_table_privilege('anon', 'public.stamps', 'INSERT'), false, 'anon cannot INSERT stamps');
select is(has_table_privilege('anon', 'public.stamps', 'UPDATE'), false, 'anon cannot UPDATE stamps');
select is(has_table_privilege('anon', 'public.stamps', 'DELETE'), false, 'anon cannot DELETE stamps');

select is(has_table_privilege('anon', 'public.redemptions', 'INSERT'), false, 'anon cannot INSERT redemptions');
select is(has_table_privilege('anon', 'public.redemptions', 'UPDATE'), false, 'anon cannot UPDATE redemptions');
select is(has_table_privilege('anon', 'public.redemptions', 'DELETE'), false, 'anon cannot DELETE redemptions');

select is(has_table_privilege('anon', 'public.tenant_members', 'INSERT'), false, 'anon cannot INSERT tenant_members');
select is(has_table_privilege('anon', 'public.tenant_members', 'UPDATE'), false, 'anon cannot UPDATE tenant_members');
select is(has_table_privilege('anon', 'public.tenant_members', 'DELETE'), false, 'anon cannot DELETE tenant_members');

select is(has_table_privilege('anon', 'public.audit_log', 'INSERT'), false, 'anon cannot INSERT audit_log');
select is(has_table_privilege('anon', 'public.audit_log', 'UPDATE'), false, 'anon cannot UPDATE audit_log');
select is(has_table_privilege('anon', 'public.audit_log', 'DELETE'), false, 'anon cannot DELETE audit_log');

-- 3.2 Authenticated direct write locks (18 assertions)
select is(has_table_privilege('authenticated', 'public.customers', 'INSERT'), false, 'authenticated cannot INSERT customers');
select is(has_table_privilege('authenticated', 'public.customers', 'UPDATE'), false, 'authenticated cannot UPDATE customers');
select is(has_table_privilege('authenticated', 'public.customers', 'DELETE'), false, 'authenticated cannot DELETE customers');

select is(has_table_privilege('authenticated', 'public.tags', 'INSERT'), false, 'authenticated cannot INSERT tags');
select is(has_table_privilege('authenticated', 'public.tags', 'UPDATE'), false, 'authenticated cannot UPDATE tags');
select is(has_table_privilege('authenticated', 'public.tags', 'DELETE'), false, 'authenticated cannot DELETE tags');

select is(has_table_privilege('authenticated', 'public.stamps', 'INSERT'), false, 'authenticated cannot INSERT stamps');
select is(has_table_privilege('authenticated', 'public.stamps', 'UPDATE'), false, 'authenticated cannot UPDATE stamps');
select is(has_table_privilege('authenticated', 'public.stamps', 'DELETE'), false, 'authenticated cannot DELETE stamps');

select is(has_table_privilege('authenticated', 'public.redemptions', 'INSERT'), false, 'authenticated cannot INSERT redemptions');
select is(has_table_privilege('authenticated', 'public.redemptions', 'UPDATE'), false, 'authenticated cannot UPDATE redemptions');
select is(has_table_privilege('authenticated', 'public.redemptions', 'DELETE'), false, 'authenticated cannot DELETE redemptions');

select is(has_table_privilege('authenticated', 'public.tenant_members', 'INSERT'), false, 'authenticated cannot INSERT tenant_members');
select is(has_table_privilege('authenticated', 'public.tenant_members', 'UPDATE'), false, 'authenticated cannot UPDATE tenant_members');
select is(has_table_privilege('authenticated', 'public.tenant_members', 'DELETE'), false, 'authenticated cannot DELETE tenant_members');

select is(has_table_privilege('authenticated', 'public.audit_log', 'INSERT'), false, 'authenticated cannot INSERT audit_log');
select is(has_table_privilege('authenticated', 'public.audit_log', 'UPDATE'), false, 'authenticated cannot UPDATE audit_log');
select is(has_table_privilege('authenticated', 'public.audit_log', 'DELETE'), false, 'authenticated cannot DELETE audit_log');

-- 3.3 Direct INSERT into stamps throws 42501 (2 assertions)
set local role anon;
select throws_ok(
    $$insert into public.stamps (tenant_id, customer_id, tag_id, source) values ('7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', 'nfc')$$,
    '42501',
    null,
    'anon direct INSERT into public.stamps throws 42501'
);

set local role authenticated;
select throws_ok(
    $$insert into public.stamps (tenant_id, customer_id, tag_id, source) values ('7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', 'nfc')$$,
    '42501',
    null,
    'authenticated direct INSERT into public.stamps throws 42501'
);
reset role;


-- ==============================================================================
-- 4. Business Rules & Function Invariants (as service_role) (13 assertions)
-- ==============================================================================

-- 4.1 ensure_customer idempotency
select is(
    public.ensure_customer('11111111-1111-1111-1111-111111111111'::uuid),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'ensure_customer creates customer A'
);

select is(
    public.ensure_customer('11111111-1111-1111-1111-111111111111'::uuid),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'ensure_customer is idempotent for customer A'
);

select is(
    (select count(*)::int from public.customers where id = '11111111-1111-1111-1111-111111111111'),
    1,
    'customer A row count is exactly 1'
);

select is(
    public.ensure_customer('22222222-2222-2222-2222-222222222222'::uuid),
    '22222222-2222-2222-2222-222222222222'::uuid,
    'ensure_customer creates customer B'
);

select is(
    (select count(*)::int from public.customers where id = '22222222-2222-2222-2222-222222222222'),
    1,
    'customer B row count is exactly 1'
);

-- Both customers hold a tenant #1 card
do $$
begin
    perform public.add_card('11111111-1111-1111-1111-111111111111'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid);
    perform public.add_card('22222222-2222-2222-2222-222222222222'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid);
end $$;

-- 4.2 Non-existent or inactive tags return 'invalid-tag'
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'nonexistent_tag_xyz', '2026-11-02 09:00:00+08'::timestamptz) ->> 'result',
    'invalid-tag',
    'stamp_card_nfc with non-existent tag returns invalid-tag'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_inactive_999', '2026-11-02 09:00:00+08'::timestamptz) ->> 'result',
    'invalid-tag',
    'stamp_card_nfc with inactive tag returns invalid-tag'
);

-- 4.3 Customer A first stamp at 2026-11-02 10:00:00+08 returns 'stamped'
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-02 10:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'stamp_card_nfc for customer A at 10:00:00 returns stamped'
);

-- 4.4 Same tag 3 seconds later (10:00:03+08) for Customer B returns 'tag-throttled'
select is(
    public.stamp_card_nfc('22222222-2222-2222-2222-222222222222'::uuid, 'test_tag_alpha_12345', '2026-11-02 10:00:03+08'::timestamptz) ->> 'result',
    'tag-throttled',
    'stamp_card_nfc on same tag 3s later returns tag-throttled'
);

-- 4.5 Customer A 29 minutes later (10:29:00+08) returns 'cooldown'
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-02 10:29:00+08'::timestamptz) ->> 'result',
    'cooldown',
    'stamp_card_nfc for customer A 29 min later returns cooldown'
);

-- 4.6 Customer A 30 minutes later (10:30:00+08) returns 'stamped'
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-02 10:30:00+08'::timestamptz) ->> 'result',
    'stamped',
    'stamp_card_nfc for customer A at 30 min boundary returns stamped'
);

-- 4.7 Customer A 31 minutes after that (11:01:00+08, 3rd of the day) returns 'daily-limit'
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-02 11:01:00+08'::timestamptz) ->> 'result',
    'daily-limit',
    'stamp_card_nfc for customer A 3rd time same day returns daily-limit'
);

-- 4.8 Customer A after midnight Asia/Manila (2026-11-03 00:01:00+08) returns 'stamped'
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-03 00:01:00+08'::timestamptz) ->> 'result',
    'stamped',
    'stamp_card_nfc for customer A past midnight Asia/Manila returns stamped'
);


-- ==============================================================================
-- 5. Cross-Customer RLS Isolation (as authenticated) (17 assertions)
-- ==============================================================================

-- 5.0 Seed a tenant #1 audit log entry so audit_log has rows to inspect
do $$
begin
    perform public.log_audit_event(
        '00000000-0000-0000-0000-000000000001'::uuid,
        'test_audit_event',
        'system',
        '{"test": true}'::jsonb,
        '7c1f0000-0000-4000-8000-000000000001'::uuid
    );
end $$;

-- 5.1 Simulate Customer A
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
set local "request.jwt.claim.role" = 'authenticated';

select is(
    (select count(*)::int from public.customers),
    1,
    'Customer A sees exactly 1 row in public.customers'
);

select is(
    (select id from public.customers limit 1),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Customer A sees their own id in public.customers'
);

select is(
    (select count(*)::int from public.customer_cards),
    1,
    'Customer A sees exactly 1 row in public.customer_cards'
);

select is(
    (select count(*)::int from public.stamps),
    3,
    'Customer A sees exactly 3 stamps in public.stamps'
);

select is(
    (select count(*)::int from public.stamps where customer_id = '11111111-1111-1111-1111-111111111111'),
    3,
    'All visible stamps belong to Customer A'
);

select is(
    (select count(*)::int from public.card_balances),
    1,
    'Customer A sees exactly 1 row in public.card_balances'
);

select is(
    (select customer_id from public.card_balances limit 1),
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Customer A sees their own row in public.card_balances'
);

select is(
    (select available_stamps from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    3,
    'Customer A sees available_stamps = 3 in public.card_balances'
);

select is(
    (select count(*)::int from public.customers where id = '22222222-2222-2222-2222-222222222222'),
    0,
    'Customer A sees 0 rows for Customer B in public.customers'
);

select is(
    (select count(*)::int from public.stamps where customer_id = '22222222-2222-2222-2222-222222222222'),
    0,
    'Customer A sees 0 stamps for Customer B in public.stamps'
);

select is(
    (select count(*)::int from public.card_balances where customer_id = '22222222-2222-2222-2222-222222222222'),
    0,
    'Customer A sees 0 rows for Customer B in public.card_balances'
);

select is(
    (select count(*)::int from public.tenant_members),
    0,
    'Customer A sees 0 rows in public.tenant_members'
);

select is(
    (select count(*)::int from public.tags),
    0,
    'Customer A sees 0 rows in public.tags'
);

select is(
    (select count(*)::int from public.audit_log),
    0,
    'Customer A sees 0 rows in public.audit_log'
);

-- 5.2 Simulate Staff user (an active tenant #1 member)
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
set local "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

select cmp_ok(
    (select count(*)::int from public.customers),
    '>=',
    2,
    'Staff can select customers who hold a card at their shop'
);

select cmp_ok(
    (select count(*)::int from public.tags),
    '>=',
    2,
    'Staff can select rows across public.tags'
);

select cmp_ok(
    (select count(*)::int from public.audit_log),
    '>=',
    1,
    'Staff can select rows across public.audit_log'
);

select is(
    (select available_stamps from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    3,
    'Staff can read a customer''s card balance at their shop'
);
reset role;


-- ==============================================================================
-- 6. Redemption & Double-Redeem Prevention (as service_role) (20 assertions)
-- ==============================================================================

-- 6.1 Redeeming with insufficient stamps returns 'insufficient-stamps'
select is(
    public.redeem_card_reward('00000000-0000-0000-0000-000000000001'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'nonce-01-early'),
    'insufficient-stamps',
    'redeem_card_reward with 3 stamps returns insufficient-stamps'
);

-- 6.2 Redeeming with a non-member actor returns 'unauthorized'
select is(
    public.redeem_card_reward('22222222-2222-2222-2222-222222222222'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'nonce-01-nonmember'),
    'unauthorized',
    'redeem_card_reward with non-member actor returns unauthorized'
);

-- 6.3 Award 7 more stamps across subsequent days so Customer A reaches 10 stamps
select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-03 10:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 4 succeeds'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-04 10:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 5 succeeds'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-04 11:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 6 succeeds'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-05 10:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 7 succeeds'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-05 11:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 8 succeeds'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-06 10:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 9 succeeds'
);

select is(
    public.stamp_card_nfc('11111111-1111-1111-1111-111111111111'::uuid, 'test_tag_alpha_12345', '2026-11-06 11:00:00+08'::timestamptz) ->> 'result',
    'stamped',
    'customer A stamp 10 succeeds'
);

-- Verify balance at 10 stamps
select is(
    (select available_stamps from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    10,
    'Customer A available_stamps reaches 10'
);

select is(
    (select total_stamps from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    10,
    'Customer A total_stamps is 10'
);

select is(
    (select stamps_redeemed from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'Customer A stamps_redeemed is initially 0'
);

-- 6.4 First redemption succeeds
select is(
    public.redeem_card_reward('00000000-0000-0000-0000-000000000001'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'nonce-01-first'),
    'redeemed',
    'redeem_card_reward with 10 available stamps returns redeemed'
);

select is(
    (select available_stamps from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'Customer A available_stamps reduced from 10 to 0'
);

select is(
    (select stamps_redeemed from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    10,
    'Customer A stamps_redeemed increased to 10'
);

select is(
    (select total_stamps from public.card_balances where customer_id = '11111111-1111-1111-1111-111111111111'),
    10,
    'Customer A total_stamps remains 10 after redemption'
);

select is(
    (select count(*)::int from public.redemptions where customer_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'One redemption record exists for Customer A'
);

select cmp_ok(
    (select count(*)::int from public.audit_log where action = 'staff_redeem_token_used' and target = 'nonce-01-first'),
    '>=',
    1,
    'Redemption event recorded in audit_log'
);

-- 6.5 Immediate second redemption returns 'insufficient-stamps' (double-redeem prevented)
select is(
    public.redeem_card_reward('00000000-0000-0000-0000-000000000001'::uuid, '7c1f0000-0000-4000-8000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'nonce-01-second'),
    'insufficient-stamps',
    'immediate second redeem_card_reward returns insufficient-stamps (double-redeem prevented)'
);

select is(
    (select count(*)::int from public.redemptions where customer_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'Still exactly one redemption record exists (no duplicate redemption row)'
);

-- ------------------------------------------------------------------------------
-- 7. Finish Test Suite & Rollback Transaction
-- ------------------------------------------------------------------------------
select * from finish();

rollback;
