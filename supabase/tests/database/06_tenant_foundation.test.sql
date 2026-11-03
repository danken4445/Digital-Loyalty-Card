-- ==============================================================================
-- 06_tenant_foundation.test.sql
-- pgTAP Test Suite for Phase 10 Tenant Foundation
-- Tests:
--   1. Tenant tables exist
--   2. The Caffeine Plug is tenant #1 with today's rules and its domain alias
--   3. tenant_settings bounds and timezone validation
--   4. Slug format and anonymous access to memberships
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(26);

-- ==============================================================================
-- 1. Tenant tables exist (5 assertions)
-- ==============================================================================

select has_table('public', 'tenants', 'public.tenants exists');
select has_table('public', 'tenant_settings', 'public.tenant_settings exists');
select has_table('public', 'tenant_members', 'public.tenant_members exists');
select has_table('public', 'tenant_domains', 'public.tenant_domains exists');
select has_table('public', 'customer_cards', 'public.customer_cards exists');

-- ==============================================================================
-- 2. Tenant #1 (3 assertions)
-- ==============================================================================

select is(
    (select slug from public.tenants where id = '7c1f0000-0000-4000-8000-000000000001'),
    'caffeine-plug',
    'The Caffeine Plug is tenant #1 with slug caffeine-plug'
);

select results_eq(
    $$select cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone, currency, reward_label
      from public.tenant_settings
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'$$,
    $$values (30, 2, 10, 5, 'Asia/Manila'::text, 'PHP'::text, 'FREE COFFEE'::text)$$,
    'Tenant #1 settings match the original single-shop rules'
);

select is(
    (select tenant_id from public.tenant_domains where host = 'card.thecaffeineplug.ph'),
    '7c1f0000-0000-4000-8000-000000000001'::uuid,
    'card.thecaffeineplug.ph is an alias for tenant #1'
);

-- ==============================================================================
-- 3. Settings bounds and timezone validation (4 assertions)
-- ==============================================================================

select throws_ok(
    $$update public.tenant_settings set timezone = 'Mars/Olympus'
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'$$,
    '22023',
    'invalid timezone',
    'Unknown timezone is rejected'
);

select throws_ok(
    $$update public.tenant_settings set reward_threshold = 2
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'$$,
    '23514',
    null,
    'reward_threshold below 3 is rejected'
);

select throws_ok(
    $$update public.tenant_settings set daily_cap = 0
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'$$,
    '23514',
    null,
    'daily_cap below 1 is rejected'
);

select throws_ok(
    $$update public.tenant_settings set cooldown_minutes = 1441
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'$$,
    '23514',
    null,
    'cooldown_minutes above 1440 is rejected'
);

-- ==============================================================================
-- 4. Transition guard, slug format and anonymous access (4 assertions)
-- ==============================================================================

select throws_ok(
    $$insert into public.tenants (slug, name) values ('second-shop', 'Second Shop')$$,
    'P0001',
    'additional tenants are blocked until Phase 12',
    'A second tenant is refused while the legacy single-shop functions are live'
);

select set_config('app.allow_multi_tenant', 'on', true);

select lives_ok(
    $$insert into public.tenants (slug, name) values ('second-shop', 'Second Shop')$$,
    'A second tenant is allowed when app.allow_multi_tenant is on (tests, local seed)'
);

select throws_ok(
    $$insert into public.tenants (slug, name) values ('Bad Slug!', 'Bad Slug Shop')$$,
    '23514',
    null,
    'Slug with uppercase, spaces or punctuation is rejected'
);

set local role anon;
select throws_ok(
    $$select count(*) from public.tenant_members$$,
    '42501',
    null,
    'anon cannot read tenant_members'
);
reset role;

-- ==============================================================================
-- 5. Legacy compatibility: tenant_id defaults to tenant #1 (2 assertions)
-- ==============================================================================

insert into auth.users (id, aud, role, email)
values
    ('e6000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase10-customer@caffeineplug.ph'),
    ('e6000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase10-staff@caffeineplug.ph'),
    ('e6000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase10-backfill@caffeineplug.ph'),
    ('e6000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'phase10-staff-old@caffeineplug.ph'),
    ('e6000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'phase10-staff-new@caffeineplug.ph')
on conflict (id) do nothing;

insert into public.tags (id, label, active)
values ('tag_phase10_legacy01', 'Phase 10 Legacy Tag', true)
on conflict (id) do nothing;

select is(
    public.record_stamp(
        'e6000000-0000-4000-8000-000000000001'::uuid,
        'tag_phase10_legacy01',
        'nfc',
        null,
        null,
        '2026-11-04 10:00:00+08'::timestamptz
    ),
    'stamped',
    'Legacy record_stamp still stamps after tenant columns are added'
);

select is(
    (select tenant_id from public.stamps where customer_id = 'e6000000-0000-4000-8000-000000000001'),
    '7c1f0000-0000-4000-8000-000000000001'::uuid,
    'Legacy stamp rows default to tenant #1'
);

-- ==============================================================================
-- 6. Staff mirror trigger (1 assertion)
-- ==============================================================================

insert into public.staff (user_id, display_name, role)
values ('e6000000-0000-4000-8000-000000000002', 'Phase 10 Barista', 'staff');

select is(
    (select role from public.tenant_members
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
       and user_id = 'e6000000-0000-4000-8000-000000000002'),
    'staff',
    'Inserting a legacy staff row mirrors a tenant #1 membership'
);

delete from public.staff where user_id = 'e6000000-0000-4000-8000-000000000002';

select is(
    (select active from public.tenant_members
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
       and user_id = 'e6000000-0000-4000-8000-000000000002'),
    false,
    'Deleting a legacy staff row deactivates the tenant #1 membership'
);

insert into public.staff (user_id, display_name, role)
values ('e6000000-0000-4000-8000-000000000004', 'Phase 10 Reassigned', 'staff');

update public.staff
set user_id = 'e6000000-0000-4000-8000-000000000005'
where user_id = 'e6000000-0000-4000-8000-000000000004';

select results_eq(
    $$select user_id, active from public.tenant_members
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
        and user_id in ('e6000000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000005')
      order by user_id$$,
    $$values ('e6000000-0000-4000-8000-000000000004'::uuid, false),
             ('e6000000-0000-4000-8000-000000000005'::uuid, true)$$,
    'Moving a legacy staff row to another user deactivates the old membership'
);

-- ==============================================================================
-- 7. Backfill function (3 assertions)
-- ==============================================================================

insert into public.customers (id) values ('e6000000-0000-4000-8000-000000000003');

select private.backfill_tenant1();

select is(
    (select count(*) from public.customers as c
     where not exists (
         select 1 from public.customer_cards as cc
         where cc.customer_id = c.id
           and cc.tenant_id = '7c1f0000-0000-4000-8000-000000000001'
     )),
    0::bigint,
    'every customer has a tenant 1 card'
);

create temporary table phase10_card_count as select count(*) as n from public.customer_cards;

select lives_ok(
    $$select private.backfill_tenant1()$$,
    'backfill_tenant1 can run a second time'
);

select is(
    (select count(*) from public.customer_cards),
    (select n from phase10_card_count),
    'A second backfill run adds no cards'
);

-- ==============================================================================
-- 8. Schema guards (2 assertions)
-- ==============================================================================

select is_empty(
    $$select t.table_name::text
      from information_schema.tables as t
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and t.table_name not in ('tenants', 'customers', 'staff')
        and not exists (
            select 1 from information_schema.columns as c
            where c.table_schema = 'public'
              and c.table_name = t.table_name
              and c.column_name = 'tenant_id'
        )$$,
    'every business table has tenant_id'
);

select is_empty(
    $$select c.relname::text
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relrowsecurity$$,
    'RLS enabled on every public table'
);

select * from finish();
rollback;
