-- ==============================================================================
-- 12_phase12_contract.test.sql
-- pgTAP Test Suite for the Phase 12 contract migration
-- Tests:
--   1. Legacy single-shop functions, view, table and transition objects are gone
--   2. Ledgers reference a wallet card through a composite foreign key
--   3. tenant_id no longer defaults to tenant #1
--   4. log_audit_event takes a tenant
--   5. cleanup_stale_anonymous_customers runs and spares shop members
--   6. merge_nonce_used reports single-use merge nonces to service_role only
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(39);

-- ==============================================================================
-- 1. Legacy objects are gone (17 assertions)
-- ==============================================================================

select hasnt_function('public', 'record_stamp', array['uuid', 'text', 'text', 'uuid', 'text', 'timestamp with time zone'], 'record_stamp is dropped');
select hasnt_function('public', 'redeem_reward', array['uuid', 'uuid'], 'redeem_reward(uuid, uuid) is dropped');
select hasnt_function('public', 'redeem_reward', array['uuid', 'uuid', 'text'], 'redeem_reward(uuid, uuid, text) is dropped');
select hasnt_function('public', 'claim_instagram_upsize', array['uuid', 'uuid'], 'claim_instagram_upsize is dropped');
select hasnt_function('public', 'merge_anonymous_customer', array['uuid', 'uuid'], 'merge_anonymous_customer is dropped');
select hasnt_function('public', 'delete_customer_data', array['uuid'], 'delete_customer_data is dropped');
select hasnt_function('public', 'is_staff', array[]::text[], 'is_staff is dropped');
select hasnt_function('public', 'log_audit_event', array['uuid', 'text', 'text', 'jsonb'], 'the 4-argument log_audit_event is dropped');
select hasnt_function('private', 'mirror_staff_to_tenant1', array[]::text[], 'the staff mirror function is dropped');
select hasnt_function('private', 'guard_single_tenant', array[]::text[], 'the single-tenant guard function is dropped');
select hasnt_function('private', 'backfill_tenant1', array[]::text[], 'the tenant 1 backfill function is dropped');
select hasnt_table('public', 'staff', 'public.staff is dropped');
select hasnt_view('public', 'customer_balances', 'public.customer_balances is dropped');
select hasnt_trigger('public', 'tenants', 'tenants_single_tenant_guard', 'the single-tenant guard trigger is dropped');

select has_function('public', 'log_audit_event', array['uuid', 'text', 'text', 'jsonb', 'uuid'], 'log_audit_event takes a tenant');
select has_function('public', 'cleanup_stale_anonymous_customers', array['interval'], 'cleanup_stale_anonymous_customers remains');
select has_function('public', 'merge_nonce_used', array['text'], 'merge_nonce_used exists');

-- ==============================================================================
-- 2. Composite foreign keys to customer_cards (4 assertions)
-- ==============================================================================

insert into auth.users (id, aud, role, email)
values
    ('12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase12-nocard@test.local'),
    ('12000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase12-card@test.local')
on conflict (id) do nothing;

insert into public.customers (id)
values
    ('12000000-0000-4000-8000-000000000001'),
    ('12000000-0000-4000-8000-000000000002');

insert into public.customer_cards (tenant_id, customer_id)
values ('7c1f0000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002');

insert into public.tags (id, label, active, tenant_id)
values ('tag_phase12_contract', 'Phase 12 Tag', true, '7c1f0000-0000-4000-8000-000000000001');

select throws_ok(
    $$insert into public.stamps (tenant_id, customer_id, tag_id, source)
      values ('7c1f0000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'tag_phase12_contract', 'nfc')$$,
    '23503',
    null,
    'A stamp for a (tenant, customer) without a card is rejected'
);

select throws_ok(
    $$insert into public.redemptions (tenant_id, customer_id, stamps_used, staff_id)
      values ('7c1f0000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 10, '12000000-0000-4000-8000-000000000002')$$,
    '23503',
    null,
    'A redemption for a (tenant, customer) without a card is rejected'
);

select throws_ok(
    $$insert into public.perk_claims (tenant_id, customer_id, perk, staff_id)
      values ('7c1f0000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'instagram_follow_upsize', '12000000-0000-4000-8000-000000000002')$$,
    '23503',
    null,
    'A perk claim for a (tenant, customer) without a card is rejected'
);

select lives_ok(
    $$insert into public.stamps (tenant_id, customer_id, tag_id, source)
      values ('7c1f0000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'tag_phase12_contract', 'nfc')$$,
    'A stamp for a (tenant, customer) with a card is accepted'
);

-- ==============================================================================
-- 3. tenant_id has no default (5 assertions)
-- ==============================================================================

select col_hasnt_default('public', 'tags', 'tenant_id', 'tags.tenant_id has no default');
select col_hasnt_default('public', 'stamps', 'tenant_id', 'stamps.tenant_id has no default');
select col_hasnt_default('public', 'redemptions', 'tenant_id', 'redemptions.tenant_id has no default');
select col_hasnt_default('public', 'perk_claims', 'tenant_id', 'perk_claims.tenant_id has no default');
select col_hasnt_default('public', 'audit_log', 'tenant_id', 'audit_log.tenant_id has no default');

-- ==============================================================================
-- 4. log_audit_event stores the tenant (3 assertions)
-- ==============================================================================

create temporary table phase12_audit_ids as
select public.log_audit_event(null, 'phase12_tenant_event', 'target-a', null, '7c1f0000-0000-4000-8000-000000000001') as with_tenant,
       public.log_audit_event(null, 'phase12_platform_event', 'target-b') as without_tenant;

select is(
    (select a.tenant_id from public.audit_log as a join phase12_audit_ids as i on a.id = i.with_tenant),
    '7c1f0000-0000-4000-8000-000000000001'::uuid,
    'log_audit_event stores p_tenant'
);

select is(
    (select count(*) from public.audit_log as a join phase12_audit_ids as i on a.id = i.without_tenant
     where a.tenant_id is null),
    1::bigint,
    'log_audit_event without a tenant records a platform event'
);

select is(
    (select count(*) from pg_catalog.pg_proc as p
     join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'log_audit_event'
       and has_function_privilege('authenticated', p.oid, 'execute')),
    0::bigint,
    'authenticated cannot execute log_audit_event'
);

-- ==============================================================================
-- 5. cleanup_stale_anonymous_customers (4 assertions)
-- ==============================================================================

insert into auth.users (id, aud, role, is_anonymous, created_at)
values
    ('12000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', true, now() - interval '90 days'),
    ('12000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', true, now() - interval '90 days');

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values ('7c1f0000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-0000000000a2', 'staff', 'Phase 12 Member', true);

select lives_ok(
    $$select public.cleanup_stale_anonymous_customers()$$,
    'cleanup_stale_anonymous_customers() runs'
);

select is(
    (select count(*) from auth.users where id = '12000000-0000-4000-8000-0000000000a1'),
    0::bigint,
    'A stale anonymous user with no activity is removed'
);

select is(
    (select count(*) from auth.users where id = '12000000-0000-4000-8000-0000000000a2'),
    1::bigint,
    'A stale anonymous user with a shop membership is kept'
);

select is(
    (select count(*) from public.audit_log
     where action = 'stale_anonymous_cleanup' and tenant_id is null),
    1::bigint,
    'The cleanup audit row is a platform event'
);

-- ==============================================================================
-- 6. merge_nonce_used (6 assertions)
-- ==============================================================================

select is(
    public.merge_nonce_used('phase12-unknown-nonce'),
    false,
    'merge_nonce_used is false for an unused nonce'
);

select public.log_audit_event(null, 'customer_merge_token_used', 'phase12-used-nonce');
select public.log_audit_event(null, 'some_other_action', 'phase12-other-nonce');

select is(
    public.merge_nonce_used('phase12-used-nonce'),
    true,
    'merge_nonce_used is true once the token-used audit row exists'
);

select is(
    public.merge_nonce_used('phase12-other-nonce'),
    false,
    'merge_nonce_used only counts customer_merge_token_used rows'
);

select is(
    has_function_privilege('anon', 'public.merge_nonce_used(text)', 'EXECUTE'),
    false,
    'anon cannot execute merge_nonce_used'
);

select is(
    has_function_privilege('authenticated', 'public.merge_nonce_used(text)', 'EXECUTE'),
    false,
    'authenticated cannot execute merge_nonce_used'
);

select is(
    has_function_privilege('service_role', 'public.merge_nonce_used(text)', 'EXECUTE'),
    true,
    'service_role can execute merge_nonce_used'
);

select * from finish();
rollback;
