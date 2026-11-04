-- ==============================================================================
-- 04_phase7_compliance_and_cleanup.test.sql
-- pgTAP Test Suite for Phase 7 Hardening, Compliance, Erasure & Cleanup
-- Tests:
--   1. Privilege hardening: anon & authenticated cannot execute delete_wallet
--      or cleanup_stale_anonymous_customers; service_role can execute both.
--   2. public.delete_wallet (Right to Erasure / RA 10173):
--      - Null customer throws exception
--      - Non-existent customer UUID returns false
--      - Existing customer: returns true, cascades deletion of customer row,
--        stamps, redemptions, auth.users row, removes customer-identifiable audit logs,
--        and writes anonymized customer_wallet_deleted audit log with md5(customer).
--   3. public.cleanup_stale_anonymous_customers (Storage limitation):
--      - Deletes stale anonymous account (>30 days old, 0 stamps)
--      - Preserves active anonymous account (>30 days old, >=1 stamp)
--      - Preserves backed up non-anonymous account (>30 days old, 0 stamps)
--      - Preserves recent anonymous account (<30 days old, 0 stamps)
--      - Emits stale_anonymous_cleanup audit log entry
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

select plan(25);

-- Pre-seed test staff in auth.users & as a tenant #1 member
insert into auth.users (id, aud, role, email, is_anonymous)
values
    ('f7777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated', 'phase7-staff@caffeineplug.ph', false)
on conflict (id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'f7777777-7777-7777-7777-777777777777', 'staff', 'Phase 7 Staff Tester', true)
on conflict (tenant_id, user_id) do update set active = true;

-- Pre-seed test tag in public.tags
insert into public.tags (id, label, active, tenant_id)
values
    ('tag_phase7_test_harness', 'Phase 7 Test Tag', true, '7c1f0000-0000-4000-8000-000000000001')
on conflict (id) do update set active = true;


-- ==============================================================================
-- 1. Privilege Hardening (6 assertions)
-- ==============================================================================

-- 1.1 anon role must NOT have EXECUTE on delete_wallet
select is(
    has_function_privilege('anon', 'public.delete_wallet(uuid)', 'EXECUTE'),
    false,
    'anon role cannot execute public.delete_wallet(uuid)'
);

-- 1.2 authenticated role must NOT have EXECUTE on delete_wallet
select is(
    has_function_privilege('authenticated', 'public.delete_wallet(uuid)', 'EXECUTE'),
    false,
    'authenticated role cannot execute public.delete_wallet(uuid)'
);

-- 1.3 service_role must have EXECUTE on delete_wallet
select is(
    has_function_privilege('service_role', 'public.delete_wallet(uuid)', 'EXECUTE'),
    true,
    'service_role can execute public.delete_wallet(uuid)'
);

-- 1.4 anon role must NOT have EXECUTE on cleanup_stale_anonymous_customers
select is(
    has_function_privilege('anon', 'public.cleanup_stale_anonymous_customers(interval)', 'EXECUTE'),
    false,
    'anon role cannot execute public.cleanup_stale_anonymous_customers(interval)'
);

-- 1.5 authenticated role must NOT have EXECUTE on cleanup_stale_anonymous_customers
select is(
    has_function_privilege('authenticated', 'public.cleanup_stale_anonymous_customers(interval)', 'EXECUTE'),
    false,
    'authenticated role cannot execute public.cleanup_stale_anonymous_customers(interval)'
);

-- 1.6 service_role must have EXECUTE on cleanup_stale_anonymous_customers
select is(
    has_function_privilege('service_role', 'public.cleanup_stale_anonymous_customers(interval)', 'EXECUTE'),
    true,
    'service_role can execute public.cleanup_stale_anonymous_customers(interval)'
);


-- ==============================================================================
-- 2. public.delete_wallet (Right to Erasure / RA 10173) (11 assertions)
-- ==============================================================================

-- 2.1 Null customer UUID throws exception
select throws_ok(
    $$ select public.delete_wallet(null) $$,
    'p_customer must not be null',
    'Null p_customer throws exception'
);

-- 2.2 Non-existent customer UUID returns false
select is(
    public.delete_wallet('99999999-9999-9999-9999-999999999999'::uuid),
    false,
    'Non-existent customer returns false'
);

-- Pre-seed customer targeted for self-service deletion
insert into auth.users (id, aud, role, email, is_anonymous)
values
    ('e5555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'phase7-erasure@caffeineplug.ph', true)
on conflict (id) do nothing;

insert into public.customers (id)
values
    ('e5555555-5555-5555-5555-555555555555')
on conflict (id) do nothing;

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'e5555555-5555-5555-5555-555555555555');

-- Pre-seed customer records: 1 NFC stamp, 1 manual stamp, 1 redemption
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'e5555555-5555-5555-5555-555555555555', 'tag_phase7_test_harness', 'nfc', '2026-11-02 01:00:00+08');

insert into public.stamps (tenant_id, customer_id, source, staff_id, reason, created_at)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'e5555555-5555-5555-5555-555555555555', 'manual', 'f7777777-7777-7777-7777-777777777777', 'Customer goodwill stamp', '2026-11-02 02:00:00+08');

insert into public.redemptions (tenant_id, customer_id, stamps_used, staff_id, created_at)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'e5555555-5555-5555-5555-555555555555', 1, 'f7777777-7777-7777-7777-777777777777', '2026-11-02 03:00:00+08');

-- Pre-seed audit log rows:
-- Row 1: actor = customer
-- Row 2: target = customer::text
-- Row 3: unrelated staff audit log (must be preserved)
insert into public.audit_log (tenant_id, actor, action, target, detail)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'e5555555-5555-5555-5555-555555555555', 'card_onboarded', 'initial_provision', '{"channel": "nfc"}'::jsonb),
    ('7c1f0000-0000-4000-8000-000000000001', null, 'customer_token_issued', 'e5555555-5555-5555-5555-555555555555', '{"type": "redeem"}'::jsonb),
    ('7c1f0000-0000-4000-8000-000000000001', 'f7777777-7777-7777-7777-777777777777', 'staff_shift_start', 'counter_pos', '{"terminal": 1}'::jsonb);

-- 2.3 Execute delete_wallet
select is(
    public.delete_wallet('e5555555-5555-5555-5555-555555555555'::uuid),
    true,
    'delete_wallet returns true on successful erasure'
);

-- 2.4 Customer row deleted from public.customers
select is(
    (select count(*)::int from public.customers where id = 'e5555555-5555-5555-5555-555555555555'),
    0,
    'Customer row is deleted from public.customers'
);

-- 2.5 Stamps cascadingly deleted
select is(
    (select count(*)::int from public.stamps where customer_id = 'e5555555-5555-5555-5555-555555555555'),
    0,
    'Customer stamps are cascadingly deleted'
);

-- 2.6 Redemptions cascadingly deleted
select is(
    (select count(*)::int from public.redemptions where customer_id = 'e5555555-5555-5555-5555-555555555555'),
    0,
    'Customer redemptions are cascadingly deleted'
);

-- 2.7 Auth user row deleted from auth.users
select is(
    (select count(*)::int from auth.users where id = 'e5555555-5555-5555-5555-555555555555'),
    0,
    'Customer row is deleted from auth.users'
);

-- 2.8 Customer-identifiable audit log rows are purged
select is(
    (select count(*)::int from public.audit_log where actor = 'e5555555-5555-5555-5555-555555555555' or target = 'e5555555-5555-5555-5555-555555555555'),
    0,
    'Customer-identifiable audit log rows (actor or target) are purged'
);

-- 2.9 Unrelated staff audit log row is preserved
select is(
    (select count(*)::int from public.audit_log where actor = 'f7777777-7777-7777-7777-777777777777'),
    1,
    'Unrelated staff audit log row is preserved'
);

-- 2.10 Anonymized compliance audit log entry exists with target = md5(p_customer::text)
select is(
    (select count(*)::int from public.audit_log where action = 'customer_wallet_deleted' and target = pg_catalog.md5('e5555555-5555-5555-5555-555555555555')),
    1,
    'Anonymized customer_wallet_deleted audit log row created with target = md5(customer_id)'
);

-- 2.11 Anonymized compliance audit log records RA_10173_erasure and actor is null
select is(
    (select detail->>'compliance' from public.audit_log where action = 'customer_wallet_deleted' and target = pg_catalog.md5('e5555555-5555-5555-5555-555555555555') limit 1),
    'RA_10173_erasure',
    'Anonymized audit log detail specifies compliance RA_10173_erasure'
);


-- ==============================================================================
-- 3. public.cleanup_stale_anonymous_customers (Storage Limitation) (8 assertions)
-- ==============================================================================

-- Pre-seed test cohort:
-- Account A: Stale anonymous customer (>30 days old, 0 stamps) -> MUST BE DELETED
insert into auth.users (id, aud, role, email, is_anonymous, created_at)
values
    ('a1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'stale-anon@caffeineplug.ph', true, pg_catalog.now() - interval '35 days')
on conflict (id) do nothing;

insert into public.customers (id, created_at)
values
    ('a1111111-1111-1111-1111-111111111111', pg_catalog.now() - interval '35 days')
on conflict (id) do nothing;

-- Account B: Active anonymous customer (>30 days old, has >= 1 stamp) -> MUST BE PRESERVED
insert into auth.users (id, aud, role, email, is_anonymous, created_at)
values
    ('b2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'active-anon@caffeineplug.ph', true, pg_catalog.now() - interval '35 days')
on conflict (id) do nothing;

insert into public.customers (id, created_at)
values
    ('b2222222-2222-2222-2222-222222222222', pg_catalog.now() - interval '35 days')
on conflict (id) do nothing;

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'b2222222-2222-2222-2222-222222222222');

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'b2222222-2222-2222-2222-222222222222', 'tag_phase7_test_harness', 'nfc', pg_catalog.now() - interval '34 days');

-- Account C: Non-anonymous (backed up) customer (>30 days old, 0 stamps) -> MUST BE PRESERVED
insert into auth.users (id, aud, role, email, is_anonymous, created_at)
values
    ('c3333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'backed-up-zero-stamps@caffeineplug.ph', false, pg_catalog.now() - interval '35 days')
on conflict (id) do nothing;

insert into public.customers (id, created_at)
values
    ('c3333333-3333-3333-3333-333333333333', pg_catalog.now() - interval '35 days')
on conflict (id) do nothing;

-- Account D: Recent anonymous customer (<30 days old, 0 stamps) -> MUST BE PRESERVED
insert into auth.users (id, aud, role, email, is_anonymous, created_at)
values
    ('d4444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'recent-anon@caffeineplug.ph', true, pg_catalog.now() - interval '5 days')
on conflict (id) do nothing;

insert into public.customers (id, created_at)
values
    ('d4444444-4444-4444-4444-444444444444', pg_catalog.now() - interval '5 days')
on conflict (id) do nothing;

-- 3.1 Execute cleanup_stale_anonymous_customers with 30 days retention
select is(
    public.cleanup_stale_anonymous_customers(interval '30 days'),
    1,
    'cleanup_stale_anonymous_customers returns deleted_count = 1'
);

-- 3.2 Account A (stale anonymous) deleted from public.customers
select is(
    (select count(*)::int from public.customers where id = 'a1111111-1111-1111-1111-111111111111'),
    0,
    'Stale anonymous customer A is deleted from public.customers'
);

-- 3.3 Account A (stale anonymous) deleted from auth.users
select is(
    (select count(*)::int from auth.users where id = 'a1111111-1111-1111-1111-111111111111'),
    0,
    'Stale anonymous customer A is deleted from auth.users'
);

-- 3.4 Account B (active anonymous with stamps) preserved in public.customers
select is(
    (select count(*)::int from public.customers where id = 'b2222222-2222-2222-2222-222222222222'),
    1,
    'Active anonymous customer B with stamp is preserved in public.customers'
);

-- 3.5 Account C (backed-up non-anonymous) preserved in public.customers
select is(
    (select count(*)::int from public.customers where id = 'c3333333-3333-3333-3333-333333333333'),
    1,
    'Backed-up non-anonymous customer C is preserved in public.customers'
);

-- 3.6 Account D (recent anonymous) preserved in public.customers
select is(
    (select count(*)::int from public.customers where id = 'd4444444-4444-4444-4444-444444444444'),
    1,
    'Recent anonymous customer D is preserved in public.customers'
);

-- 3.7 Audit log row created with action = stale_anonymous_cleanup
select is(
    (select count(*)::int from public.audit_log where action = 'stale_anonymous_cleanup'),
    1,
    'Audit log records stale_anonymous_cleanup action'
);

-- 3.8 Audit log detail captures deleted_count = 1
select is(
    (select (detail->>'deleted_count')::int from public.audit_log where action = 'stale_anonymous_cleanup' limit 1),
    1,
    'Audit log detail records deleted_count = 1'
);


-- ------------------------------------------------------------------------------
-- 4. Finish Test Suite & Rollback Transaction
-- ------------------------------------------------------------------------------
select * from finish();

rollback;
