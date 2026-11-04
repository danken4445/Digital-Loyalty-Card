-- ==============================================================================
-- 16_ops_and_leak_signals.test.sql
-- pgTAP Test Suite for Phase 14 Task 8: Operations (cron, heartbeat, leak signals)
-- Tests:
--   1. cron_job_is_scheduled_by_migration
--   2. ops_cleanup_status_flags_stale_after_8_days
--   3. tag_leak_signals_scoped_to_tenant
--   4. tag_leak_signals_thresholds
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(21);

-- ------------------------------------------------------------------------------
-- Fixtures: owners, managers, staff, customers, two tenants, tags
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous)
values
    ('16000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-shop-a@test.local', now(), false),
    ('16000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'manager-shop-a@test.local', now(), false),
    ('16000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'staff-shop-a@test.local', now(), false),
    ('16000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'owner-shop-b@test.local', now(), false),
    ('16000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unaffiliated-user@test.local', now(), false)
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('16111111-0000-4000-8000-000000000001', 'shop-ops-a', 'Shop Ops A', 'active'),
    ('16222222-0000-4000-8000-000000000002', 'shop-ops-b', 'Shop Ops B', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, reward_label)
values
    ('16111111-0000-4000-8000-000000000001', 30, 5, 10, 5, 'FREE COFFEE'),
    ('16222222-0000-4000-8000-000000000002', 30, 5, 10, 5, 'FREE COFFEE')
on conflict (tenant_id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('16111111-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001', 'owner', 'Owner A', true),
    ('16111111-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000002', 'manager', 'Manager A', true),
    ('16111111-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000003', 'staff', 'Staff A', true),
    ('16222222-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000004', 'owner', 'Owner B', true)
on conflict (tenant_id, user_id) do nothing;

-- 12 distinct customers for threshold testing
insert into auth.users (id, aud, role, email, is_anonymous)
select
    ('16000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
    'authenticated',
    'authenticated',
    'customer-' || i || '@test.local',
    false
from generate_series(10, 25) as i
on conflict (id) do nothing;

insert into public.customers (id)
select ('16000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid
from generate_series(10, 25) as i
on conflict (id) do nothing;

insert into public.customer_cards (tenant_id, customer_id)
select
    '16111111-0000-4000-8000-000000000001',
    ('16000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid
from generate_series(10, 25) as i
on conflict (tenant_id, customer_id) do nothing;

-- Tags for Shop A
insert into public.tags (id, label, active, tenant_id)
values
    ('tcp_tag_shop_a_norm', 'Normal Tag A', true, '16111111-0000-4000-8000-000000000001'),
    ('tcp_tag_shop_a_leak1', 'Leaking Customers Tag', true, '16111111-0000-4000-8000-000000000001'),
    ('tcp_tag_shop_a_leak2', 'High Throttle Rejections Tag', true, '16111111-0000-4000-8000-000000000001'),
    ('tcp_tag_shop_a_eight', 'Border Eight Tag', true, '16111111-0000-4000-8000-000000000001'),
    ('tcp_tag_shop_a_old', 'Old Burst Tag', true, '16111111-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- Tags for Shop B
insert into public.tags (id, label, active, tenant_id)
values
    ('tcp_tag_shop_b_norm', 'Normal Tag B', true, '16222222-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------
-- 1. cron_job_is_scheduled_by_migration
-- ------------------------------------------------------------------------------

select isnt_empty(
    $$select 1 from cron.job where jobname = 'weekly-stale-anonymous-cleanup'$$,
    'cron_job_is_scheduled_by_migration: weekly-stale-anonymous-cleanup job exists'
);

select is(
    (select schedule from cron.job where jobname = 'weekly-stale-anonymous-cleanup' limit 1),
    '0 3 * * 0',
    'cron_job_is_scheduled_by_migration: schedule is weekly at 03:00 UTC on Sunday'
);

select is(
    (select active from cron.job where jobname = 'weekly-stale-anonymous-cleanup' limit 1),
    true,
    'cron_job_is_scheduled_by_migration: job is active'
);

-- ------------------------------------------------------------------------------
-- 2. ops_cleanup_status_flags_stale_after_8_days
-- ------------------------------------------------------------------------------

-- Ensure function exists and permissions are tight
select has_function('public', 'ops_cleanup_status', 'ops_cleanup_status function exists');

-- Initially with no run details, status is stale
select is(
    (public.ops_cleanup_status()->>'stale')::boolean,
    true,
    'ops_cleanup_status_flags_stale_after_8_days: stale when no run details exist'
);

-- Record a successful run 2 days ago
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'weekly-stale-anonymous-cleanup' limit 1;
  insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
  values (v_jobid, 999901, current_database(), current_user, 'select 1;', 'succeeded', now() - interval '2 days', now() - interval '2 days');
end;
$$;

select is(
    (public.ops_cleanup_status()->>'stale')::boolean,
    false,
    'ops_cleanup_status_flags_stale_after_8_days: not stale when run occurred 2 days ago'
);

select ok(
    (public.ops_cleanup_status()->>'lastRunAt') is not null,
    'ops_cleanup_status_flags_stale_after_8_days: lastRunAt is populated'
);

-- Now record an older run 9 days ago and delete the 2-day-old run to simulate a missed run
delete from cron.job_run_details where runid = 999901;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'weekly-stale-anonymous-cleanup' limit 1;
  insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
  values (v_jobid, 999902, current_database(), current_user, 'select 1;', 'succeeded', now() - interval '9 days', now() - interval '9 days');
end;
$$;

select is(
    (public.ops_cleanup_status()->>'stale')::boolean,
    true,
    'ops_cleanup_status_flags_stale_after_8_days: stale when last run was 9 days ago'
);

-- Record a failed run 1 day ago; it should NOT clear the stale status
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'weekly-stale-anonymous-cleanup' limit 1;
  insert into cron.job_run_details (jobid, runid, database, username, command, status, start_time, end_time)
  values (v_jobid, 999903, current_database(), current_user, 'select 1;', 'failed', now() - interval '1 day', now() - interval '1 day');
end;
$$;

select is(
    (public.ops_cleanup_status()->>'stale')::boolean,
    true,
    'ops_cleanup_status_flags_stale_after_8_days: failed run 1 day ago does not clear stale'
);

-- ------------------------------------------------------------------------------
-- 3. tag_leak_signals_scoped_to_tenant
-- ------------------------------------------------------------------------------

-- Setup leak data on Shop A:
-- tcp_tag_shop_a_leak1: 10 distinct customers in the last 10 minutes
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select
    '16111111-0000-4000-8000-000000000001',
    ('16000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
    'tcp_tag_shop_a_leak1',
    'nfc',
    now() - (i || ' seconds')::interval
from generate_series(10, 19) as i;

-- Owner A sees the leak signal for Shop A
select ok(
    jsonb_array_length(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) >= 1,
    'tag_leak_signals_scoped_to_tenant: Owner A detects leaking tag on Shop A'
);

-- Manager A also sees the leak signal for Shop A
select ok(
    jsonb_array_length(public.tag_leak_signals('16000000-0000-4000-8000-000000000002', '16111111-0000-4000-8000-000000000001')) >= 1,
    'tag_leak_signals_scoped_to_tenant: Manager A detects leaking tag on Shop A'
);

-- Owner B queries Shop B and receives empty list (no leaks in Shop B)
select is(
    public.tag_leak_signals('16000000-0000-4000-8000-000000000004', '16222222-0000-4000-8000-000000000002'),
    '[]'::jsonb,
    'tag_leak_signals_scoped_to_tenant: Owner B sees empty signals for Shop B'
);

-- Owner B tries to query Shop A (unauthorized cross-tenant call)
select is(
    public.tag_leak_signals('16000000-0000-4000-8000-000000000004', '16111111-0000-4000-8000-000000000001')->>'result',
    'unauthorized',
    'tag_leak_signals_scoped_to_tenant: Cross-tenant query returns unauthorized'
);

-- Staff (not owner/manager) receives unauthorized
select is(
    public.tag_leak_signals('16000000-0000-4000-8000-000000000003', '16111111-0000-4000-8000-000000000001')->>'result',
    'unauthorized',
    'tag_leak_signals_scoped_to_tenant: Staff role returns unauthorized'
);

-- Unaffiliated user receives unauthorized
select is(
    public.tag_leak_signals('16000000-0000-4000-8000-000000000005', '16111111-0000-4000-8000-000000000001')->>'result',
    'unauthorized',
    'tag_leak_signals_scoped_to_tenant: Non-member user returns unauthorized'
);

-- ------------------------------------------------------------------------------
-- 4. tag_leak_signals_thresholds
-- ------------------------------------------------------------------------------

-- Border case 1: exactly 8 distinct customers in 15 mins -> NOT flagged (> 8 required)
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select
    '16111111-0000-4000-8000-000000000001',
    ('16000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
    'tcp_tag_shop_a_eight',
    'nfc',
    now() - (i || ' minutes')::interval
from generate_series(10, 17) as i;

-- Older burst: 10 distinct customers, but 25 minutes ago -> NOT flagged (> 15 mins)
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select
    '16111111-0000-4000-8000-000000000001',
    ('16000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
    'tcp_tag_shop_a_old',
    'nfc',
    now() - interval '25 minutes' - (i || ' seconds')::interval
from generate_series(10, 19) as i;

-- Threshold 2: exactly 26 throttle rejections within the past hour on tcp_tag_shop_a_leak2 (> 25 required)
insert into public.audit_log (tenant_id, actor, action, target, created_at)
select
    '16111111-0000-4000-8000-000000000001',
    null,
    'tag_throttled',
    'tcp_tag_shop_a_leak2',
    now() - (i || ' minutes')::interval
from generate_series(1, 26) as i;

-- Normal tag has 20 rejections -> NOT flagged
insert into public.audit_log (tenant_id, actor, action, target, created_at)
select
    '16111111-0000-4000-8000-000000000001',
    null,
    'stamp_rejected_tag_throttled',
    'tcp_tag_shop_a_norm',
    now() - (i || ' minutes')::interval
from generate_series(1, 20) as i;

-- Query leak signals for Shop A
-- Expected flagged tags: tcp_tag_shop_a_leak1 (10 customers) and tcp_tag_shop_a_leak2 (26 rejections)
-- tcp_tag_shop_a_eight, tcp_tag_shop_a_old, tcp_tag_shop_a_norm should NOT be in the result
select is(
    (select count(*)::integer from jsonb_to_recordset(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) as x("tagId" text, "distinctCustomers" int, "throttleRejections" int)),
    2,
    'tag_leak_signals_thresholds: exactly two tags meet the leak criteria'
);

select is(
    (select "distinctCustomers" from jsonb_to_recordset(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) as x("tagId" text, "distinctCustomers" int, "throttleRejections" int) where "tagId" = 'tcp_tag_shop_a_leak1'),
    10,
    'tag_leak_signals_thresholds: leak1 has 10 distinct customers'
);

select is(
    (select "throttleRejections" from jsonb_to_recordset(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) as x("tagId" text, "distinctCustomers" int, "throttleRejections" int) where "tagId" = 'tcp_tag_shop_a_leak2'),
    26,
    'tag_leak_signals_thresholds: leak2 has 26 throttle rejections'
);

select ok(
    not exists (
        select 1 from jsonb_to_recordset(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) as x("tagId" text)
        where "tagId" = 'tcp_tag_shop_a_eight'
    ),
    'tag_leak_signals_thresholds: border eight tag is not flagged'
);

-- Deactivate leak1 tag (e.g. after operator rotates the tag)
update public.tags
set active = false, deactivated_at = now()
where id = 'tcp_tag_shop_a_leak1';

select is(
    (select count(*)::integer from jsonb_to_recordset(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) as x("tagId" text, "distinctCustomers" int, "throttleRejections" int)),
    1,
    'tag_leak_signals_thresholds: deactivated tag is excluded from leak signals'
);

select ok(
    not exists (
        select 1 from jsonb_to_recordset(public.tag_leak_signals('16000000-0000-4000-8000-000000000001', '16111111-0000-4000-8000-000000000001')) as x("tagId" text)
        where "tagId" = 'tcp_tag_shop_a_leak1'
    ),
    'tag_leak_signals_thresholds: deactivated leak1 tag no longer appears in signals'
);

-- Finish pgTAP
select * from finish();

rollback;
