-- ==============================================================================
-- 07_tenant_isolation.test.sql
-- pgTAP Test Suite for Phase 11 Tenant-Scoped RLS
-- Tests:
--   1. Staff of tenant B see none of tenant A's rows on any table
--   2. Staff see customers only through a card in their tenant
--   3. Single-tenant and dual-tenant staff see exactly their tenants
--   4. Customers see all of their own cards (the wallet) and nobody else's rows
--   5. Inactive memberships grant nothing; private helpers are not callable by anon
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(16);

-- ------------------------------------------------------------------------------
-- Shared fixtures: tenant A = tenant #1, tenant B = bean-there (Asia/Tokyo)
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('5a000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'staff-a@test.local'),
    ('5b000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'staff-b@test.local'),
    ('5d000000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'dual-staff@test.local'),
    ('5e000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'manager-a@test.local'),
    ('5f000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'inactive-a@test.local'),
    ('ca000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'cust-a@test.local'),
    ('cb000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'cust-b@test.local'),
    ('cc000000-0000-4000-8000-0000000000ab', 'authenticated', 'authenticated', 'cust-ab@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-00000000000b', 'bean-there', 'Bean There', 'active');

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone)
values ('7c1f0000-0000-4000-8000-00000000000b', 60, 1, 8, 5, 'Asia/Tokyo');

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('7c1f0000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-00000000000a', 'staff', 'Staff A', true),
    ('7c1f0000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-00000000000b', 'staff', 'Staff B', true),
    ('7c1f0000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-00000000000d', 'staff', 'Dual Staff', true),
    ('7c1f0000-0000-4000-8000-00000000000b', '5d000000-0000-4000-8000-00000000000d', 'staff', 'Dual Staff', true),
    ('7c1f0000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-00000000000a', 'manager', 'Manager A', true),
    ('7c1f0000-0000-4000-8000-000000000001', '5f000000-0000-4000-8000-00000000000a', 'staff', 'Inactive A', false);

-- Staff B is also a legacy staff row (is_staff() = true) but a member of tenant B only,
-- so these tests fail if any policy still trusts the global is_staff() check.
insert into public.staff (user_id, display_name, role)
values ('5b000000-0000-4000-8000-00000000000b', 'Staff B', 'staff');
delete from public.tenant_members
where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
  and user_id = '5b000000-0000-4000-8000-00000000000b';

insert into public.customers (id)
values
    ('ca000000-0000-4000-8000-00000000000a'),
    ('cb000000-0000-4000-8000-00000000000b'),
    ('cc000000-0000-4000-8000-0000000000ab');

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b'),
    ('7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab');

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_tenant_a_0001', 'Tenant A Counter', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('tag_tenant_b_0001', 'Tenant B Counter', true, '7c1f0000-0000-4000-8000-00000000000b');

-- One ledger row of every kind per card
insert into public.stamps (tenant_id, customer_id, tag_id, source)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a', 'tag_tenant_a_0001', 'nfc'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b', 'tag_tenant_b_0001', 'nfc'),
    ('7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_a_0001', 'nfc'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_b_0001', 'nfc');

insert into public.redemptions (tenant_id, customer_id, stamps_used, staff_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a', 10, '5a000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b', 8, '5b000000-0000-4000-8000-00000000000b');

insert into public.perk_claims (tenant_id, customer_id, perk, staff_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a', 'instagram_follow_upsize', '5a000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b', 'instagram_follow_upsize', '5b000000-0000-4000-8000-00000000000b');

insert into public.audit_log (tenant_id, actor, action, target)
values
    ('7c1f0000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-00000000000a', 'phase11_isolation_a', 'a'),
    ('7c1f0000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-00000000000b', 'phase11_isolation_b', 'b');

-- ==============================================================================
-- 1. Staff of tenant B see none of tenant A's rows (7 assertions)
-- ==============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5b000000-0000-4000-8000-00000000000b","role":"authenticated"}';
set local "request.jwt.claim.sub" = '5b000000-0000-4000-8000-00000000000b';
set local "request.jwt.claim.role" = 'authenticated';

select is((select count(*) from public.stamps where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A stamps');
select is((select count(*) from public.redemptions where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A redemptions');
select is((select count(*) from public.perk_claims where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A perk claims');
select is((select count(*) from public.audit_log where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A audit rows');
select is((select count(*) from public.tags where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A tags');
select is((select count(*) from public.customer_cards where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A cards');
select is((select count(*) from public.tenant_members where tenant_id = '7c1f0000-0000-4000-8000-000000000001'), 0::bigint,
    'Tenant B staff see no tenant A memberships');

-- ==============================================================================
-- 2. Customers are visible to staff only through a card in their tenant (2 assertions)
-- ==============================================================================

select is((select count(*) from public.customers where id = 'ca000000-0000-4000-8000-00000000000a'), 0::bigint,
    'Tenant B staff cannot see a customer who holds only a tenant A card');
select is((select count(*) from public.customers where id = 'cc000000-0000-4000-8000-0000000000ab'), 1::bigint,
    'Tenant B staff can see a customer who holds a tenant B card');

reset role;

-- ==============================================================================
-- 3. Single- and dual-tenant staff (2 assertions)
-- ==============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5a000000-0000-4000-8000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" = '5a000000-0000-4000-8000-00000000000a';

select results_eq(
    $$select distinct tenant_id from public.stamps$$,
    $$values ('7c1f0000-0000-4000-8000-000000000001'::uuid)$$,
    'Tenant A staff see only tenant A stamps'
);

set local "request.jwt.claims" = '{"sub":"5d000000-0000-4000-8000-00000000000d","role":"authenticated"}';
set local "request.jwt.claim.sub" = '5d000000-0000-4000-8000-00000000000d';

select results_eq(
    $$select distinct tenant_id from public.stamps order by 1$$,
    $$values ('7c1f0000-0000-4000-8000-000000000001'::uuid), ('7c1f0000-0000-4000-8000-00000000000b'::uuid)$$,
    'Staff with two memberships see both tenants'
);

-- ==============================================================================
-- 4. Customers see their own wallet only (3 assertions)
-- ==============================================================================

set local "request.jwt.claims" = '{"sub":"cc000000-0000-4000-8000-0000000000ab","role":"authenticated"}';
set local "request.jwt.claim.sub" = 'cc000000-0000-4000-8000-0000000000ab';

select is((select count(*) from public.card_balances), 2::bigint,
    'A customer with two cards sees two card balances');

set local "request.jwt.claims" = '{"sub":"ca000000-0000-4000-8000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" = 'ca000000-0000-4000-8000-00000000000a';

select is((select count(*) from public.card_balances), 1::bigint,
    'A customer with one card sees one card balance');

select is((select count(*) from public.stamps where customer_id = 'cc000000-0000-4000-8000-0000000000ab'), 0::bigint,
    'A customer cannot see another customer''s stamps');

-- ==============================================================================
-- 5. Inactive membership and private helper privileges (2 assertions)
-- ==============================================================================

set local "request.jwt.claims" = '{"sub":"5f000000-0000-4000-8000-00000000000a","role":"authenticated"}';
set local "request.jwt.claim.sub" = '5f000000-0000-4000-8000-00000000000a';

select is((select count(*) from public.stamps), 0::bigint,
    'An inactive membership grants no tenant rows');

reset role;

select is_empty(
    $$select p.proname::text
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and has_function_privilege('anon', p.oid, 'execute')$$,
    'No private function is executable by anon'
);

select * from finish();
rollback;
