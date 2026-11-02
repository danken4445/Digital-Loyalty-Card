-- ==============================================================================
-- 03_phase6_merge_anonymous_customer.test.sql
-- pgTAP Test Suite for Phase 6 Customer Backup, Recovery & Atomic Account Merge
-- Tests:
--   1. Privilege hardening: anon & authenticated EXECUTE revoked, service_role allowed
--   2. Input validation & boundaries: null inputs rejected, noop-same-user,
--      source-not-found, and target-not-found
--   3. Happy path merge execution:
--      - Transfers all stamps from source to target customer
--      - Transfers all redemptions from source to target customer
--      - Deletes source customer record from public.customers
--      - Correctly updates public.customer_balances view (total_stamps, stamps_redeemed, available_stamps)
--      - Records immutable audit_log entry with action = 'merge_anonymous_customer' / 'customer_merged'
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0. Environment Setup & Plan
-- ------------------------------------------------------------------------------
create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

-- Grant usage on extensions so pgtap assertion functions run cleanly under test roles
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(24);

-- Pre-seed test users in auth.users
insert into auth.users (id, aud, role, email)
values
    ('s1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'phase6-source@caffeineplug.ph'),
    ('t2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'phase6-target@caffeineplug.ph'),
    ('f3333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'phase6-staff@caffeineplug.ph')
on conflict (id) do nothing;

-- Pre-seed customers in public.customers
insert into public.customers (id)
values
    ('s1111111-1111-1111-1111-111111111111'),
    ('t2222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

-- Pre-seed staff in public.staff
insert into public.staff (user_id, display_name, role, active)
values
    ('f3333333-3333-3333-3333-333333333333', 'Phase 6 Staff Tester', 'staff', true)
on conflict (user_id) do update set active = true;

-- Pre-seed tag in public.tags
insert into public.tags (id, label, active)
values
    ('tag_phase6_test_merge', 'Phase 6 Test Tag', true)
on conflict (id) do update set active = true;


-- ==============================================================================
-- 1. Privilege Hardening (3 assertions)
-- ==============================================================================

-- 1.1 anon role must NOT have EXECUTE on merge_anonymous_customer
select is(
    has_function_privilege('anon', 'public.merge_anonymous_customer(uuid, uuid)', 'EXECUTE'),
    false,
    'anon role cannot execute public.merge_anonymous_customer(uuid, uuid)'
);

-- 1.2 authenticated role must NOT have EXECUTE on merge_anonymous_customer
select is(
    has_function_privilege('authenticated', 'public.merge_anonymous_customer(uuid, uuid)', 'EXECUTE'),
    false,
    'authenticated role cannot execute public.merge_anonymous_customer(uuid, uuid)'
);

-- 1.3 service_role must have EXECUTE on merge_anonymous_customer
select is(
    has_function_privilege('service_role', 'public.merge_anonymous_customer(uuid, uuid)', 'EXECUTE'),
    true,
    'service_role can execute public.merge_anonymous_customer(uuid, uuid)'
);


-- ==============================================================================
-- 2. Input Validation & Boundary Conditions (5 assertions)
-- ==============================================================================

-- 2.1 Null source customer throws exception
select throws_ok(
    $$ select public.merge_anonymous_customer(null, 't2222222-2222-2222-2222-222222222222'::uuid) $$,
    'p_source_customer and p_target_customer must not be null',
    'Null p_source_customer throws exception'
);

-- 2.2 Null target customer throws exception
select throws_ok(
    $$ select public.merge_anonymous_customer('s1111111-1111-1111-1111-111111111111'::uuid, null) $$,
    'p_source_customer and p_target_customer must not be null',
    'Null p_target_customer throws exception'
);

-- 2.3 Same source and target customer returns 'noop-same-user'
select is(
    public.merge_anonymous_customer(
        's1111111-1111-1111-1111-111111111111'::uuid,
        's1111111-1111-1111-1111-111111111111'::uuid
    ),
    'noop-same-user',
    'Identical source and target customer returns noop-same-user'
);

-- 2.4 Non-existent source customer returns 'source-not-found'
select is(
    public.merge_anonymous_customer(
        '99999999-9999-9999-9999-999999999999'::uuid,
        't2222222-2222-2222-2222-222222222222'::uuid
    ),
    'source-not-found',
    'Non-existent source customer returns source-not-found'
);

-- 2.5 Non-existent target customer returns 'target-not-found'
select is(
    public.merge_anonymous_customer(
        's1111111-1111-1111-1111-111111111111'::uuid,
        '99999999-9999-9999-9999-999999999999'::uuid
    ),
    'target-not-found',
    'Non-existent target customer returns target-not-found'
);


-- ==============================================================================
-- 3. Happy Path Merge Execution (16 assertions)
-- ==============================================================================

-- 3.0 Pre-seed initial ledger records
-- Source: 3 NFC stamps + 1 Manual stamp = 4 stamps total, 1 redemption of 1 stamp
insert into public.stamps (customer_id, tag_id, source, created_at)
values
    ('s1111111-1111-1111-1111-111111111111', 'tag_phase6_test_merge', 'nfc', '2026-11-02 01:00:00+08'),
    ('s1111111-1111-1111-1111-111111111111', 'tag_phase6_test_merge', 'nfc', '2026-11-02 02:00:00+08'),
    ('s1111111-1111-1111-1111-111111111111', 'tag_phase6_test_merge', 'nfc', '2026-11-02 03:00:00+08');

insert into public.stamps (customer_id, source, staff_id, reason, created_at)
values
    ('s1111111-1111-1111-1111-111111111111', 'manual', 'f3333333-3333-3333-3333-333333333333', 'Manual promo stamp', '2026-11-02 04:00:00+08');

insert into public.redemptions (customer_id, stamps_used, staff_id, created_at)
values
    ('s1111111-1111-1111-1111-111111111111', 1, 'f3333333-3333-3333-3333-333333333333', '2026-11-02 05:00:00+08');

-- Target: 2 NFC stamps, 0 redemptions
insert into public.stamps (customer_id, tag_id, source, created_at)
values
    ('t2222222-2222-2222-2222-222222222222', 'tag_phase6_test_merge', 'nfc', '2026-11-02 06:00:00+08'),
    ('t2222222-2222-2222-2222-222222222222', 'tag_phase6_test_merge', 'nfc', '2026-11-02 07:00:00+08');

-- Pre-merge balances verification
select is(
    (select total_stamps from public.customer_balances where customer_id = 's1111111-1111-1111-1111-111111111111'),
    4,
    'Source customer initially has total_stamps = 4'
);

select is(
    (select available_stamps from public.customer_balances where customer_id = 's1111111-1111-1111-1111-111111111111'),
    3,
    'Source customer initially has available_stamps = 3 (4 total - 1 redeemed)'
);

select is(
    (select total_stamps from public.customer_balances where customer_id = 't2222222-2222-2222-2222-222222222222'),
    2,
    'Target customer initially has total_stamps = 2'
);

select is(
    (select available_stamps from public.customer_balances where customer_id = 't2222222-2222-2222-2222-222222222222'),
    2,
    'Target customer initially has available_stamps = 2 (2 total - 0 redeemed)'
);

-- Execute atomic customer merge
select is(
    public.merge_anonymous_customer(
        's1111111-1111-1111-1111-111111111111'::uuid,
        't2222222-2222-2222-2222-222222222222'::uuid
    ),
    'merged',
    'merge_anonymous_customer executes successfully and returns merged'
);

-- Post-merge checks
-- 3.6 Source row deleted from public.customers
select is(
    (select count(*)::int from public.customers where id = 's1111111-1111-1111-1111-111111111111'),
    0,
    'Source customer row is deleted from public.customers'
);

-- 3.7 Zero stamps remain under source customer
select is(
    (select count(*)::int from public.stamps where customer_id = 's1111111-1111-1111-1111-111111111111'),
    0,
    'Zero stamps remain under source customer'
);

-- 3.8 Target customer has 6 stamps (2 initial + 4 transferred)
select is(
    (select count(*)::int from public.stamps where customer_id = 't2222222-2222-2222-2222-222222222222'),
    6,
    'Target customer owns 6 total stamps (2 initial + 4 transferred)'
);

-- 3.9 Zero redemptions remain under source customer
select is(
    (select count(*)::int from public.redemptions where customer_id = 's1111111-1111-1111-1111-111111111111'),
    0,
    'Zero redemptions remain under source customer'
);

-- 3.10 Target customer owns 1 redemption transferred from source
select is(
    (select count(*)::int from public.redemptions where customer_id = 't2222222-2222-2222-2222-222222222222'),
    1,
    'Target customer owns 1 redemption transferred from source'
);

-- 3.11 Target total_stamps in customer_balances is 6
select is(
    (select total_stamps from public.customer_balances where customer_id = 't2222222-2222-2222-2222-222222222222'),
    6,
    'Target customer total_stamps in customer_balances view is 6'
);

-- 3.12 Target stamps_redeemed is 1 and available_stamps is 5 in customer_balances
select is(
    (select stamps_redeemed from public.customer_balances where customer_id = 't2222222-2222-2222-2222-222222222222'),
    1,
    'Target customer stamps_redeemed in customer_balances view is 1'
);

select is(
    (select available_stamps from public.customer_balances where customer_id = 't2222222-2222-2222-2222-222222222222'),
    5,
    'Target customer available_stamps in customer_balances view is 5 (6 total - 1 redeemed)'
);

-- 3.13 Audit log entry exists with target = source_customer
select cmp_ok(
    (select count(*)::int from public.audit_log where action in ('merge_anonymous_customer', 'customer_merged') and target = 's1111111-1111-1111-1111-111111111111'),
    '>=',
    1,
    'Audit log entry created with action merge_anonymous_customer/customer_merged and target = source customer id'
);

-- 3.14 Audit log detail captures stamps_moved = 4
select is(
    (select (detail->>'stamps_moved')::int from public.audit_log where action in ('merge_anonymous_customer', 'customer_merged') and target = 's1111111-1111-1111-1111-111111111111' limit 1),
    4,
    'Audit log detail records stamps_moved = 4'
);

-- 3.15 Audit log detail captures redemptions_moved = 1
select is(
    (select (detail->>'redemptions_moved')::int from public.audit_log where action in ('merge_anonymous_customer', 'customer_merged') and target = 's1111111-1111-1111-1111-111111111111' limit 1),
    1,
    'Audit log detail records redemptions_moved = 1'
);

-- ------------------------------------------------------------------------------
-- 4. Finish Test Suite & Rollback Transaction
-- ------------------------------------------------------------------------------
select * from finish();

rollback;
