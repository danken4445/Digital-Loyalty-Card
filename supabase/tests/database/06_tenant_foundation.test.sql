-- ==============================================================================
-- 06_tenant_foundation.test.sql
-- pgTAP Test Suite for Phase 10 Tenant Foundation
-- Tests:
--   1. Tenant tables exist
--   2. The Caffeine Plug is tenant #1 with today's rules and its domain alias
--   3. tenant_settings bounds and timezone validation
--   4. A second tenant, slug format and anonymous access to memberships
--   5. Schema guards (tenant_id and RLS everywhere)
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(17);

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
-- 4. Second tenant, slug format and anonymous access (3 assertions)
-- ==============================================================================

select lives_ok(
    $$insert into public.tenants (slug, name) values ('second-shop', 'Second Shop')$$,
    'A second tenant can be created'
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
-- 5. Schema guards (2 assertions)
-- ==============================================================================

select is_empty(
    $$select t.table_name::text
      from information_schema.tables as t
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and t.table_name not in ('tenants', 'customers', 'platform_admins', 'billing_plans')
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
