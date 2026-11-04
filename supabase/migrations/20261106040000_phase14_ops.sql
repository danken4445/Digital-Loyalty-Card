-- Migration: 20261106040000_phase14_ops.sql
-- Description: Phase 14 Task 8 Operations
--              - Enables pg_cron extension
--              - Schedules weekly-stale-anonymous-cleanup idempotently
--              - Adds public.ops_cleanup_status() for health check probes
--              - Adds public.tag_leak_signals() for detecting leaked NFC tags

-- -----------------------------------------------------------------------------
-- 1. PG_CRON EXTENSION & IDEMPOTENT CLEANUP SCHEDULE
-- -----------------------------------------------------------------------------

create extension if not exists pg_cron;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'weekly-stale-anonymous-cleanup' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'weekly-stale-anonymous-cleanup',
    '0 3 * * 0',
    'select public.cleanup_stale_anonymous_customers();'
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. OPS CLEANUP STATUS RPC
-- -----------------------------------------------------------------------------

create or replace function public.ops_cleanup_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_run_at timestamptz;
  v_stale boolean;
begin
  select max(coalesce(d.end_time, d.start_time))
  into v_last_run_at
  from cron.job_run_details as d
  join cron.job as j on j.jobid = d.jobid
  where j.jobname = 'weekly-stale-anonymous-cleanup';

  v_stale := (v_last_run_at is null or v_last_run_at < (pg_catalog.now() - interval '8 days'));

  return pg_catalog.jsonb_build_object(
    'lastRunAt', v_last_run_at,
    'stale', v_stale
  );
end;
$$;

revoke all on function public.ops_cleanup_status() from public, anon, authenticated;
grant execute on function public.ops_cleanup_status() to service_role;

-- -----------------------------------------------------------------------------
-- 3. TAG LEAK SIGNALS RPC (R-6)
-- -----------------------------------------------------------------------------

create or replace function public.tag_leak_signals(
  p_actor uuid,
  p_tenant uuid,
  p_window_minutes integer default 15
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_window integer;
  v_result jsonb;
begin
  if p_tenant is null then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_role := private.member_role(p_actor, p_tenant);
  if coalesce(v_role, '') not in ('owner', 'manager') then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_window := coalesce(nullif(p_window_minutes, 0), 15);
  if v_window < 1 then
    v_window := 15;
  end if;

  with tag_stamps as (
    select
      s.tag_id,
      count(distinct s.customer_id)::integer as distinct_customers
    from public.stamps as s
    where s.tenant_id = p_tenant
      and s.tag_id is not null
      and s.created_at >= (pg_catalog.now() - pg_catalog.make_interval(mins => v_window))
    group by s.tag_id
  ),
  tag_rejections as (
    select
      al.target as tag_id,
      count(*)::integer as throttle_rejections
    from public.audit_log as al
    where al.tenant_id = p_tenant
      and al.action in ('tag_throttled', 'tag-throttled', 'stamp_rejected_tag_throttled')
      and al.target is not null
      and al.created_at >= (pg_catalog.now() - interval '1 hour')
    group by al.target
  ),
  candidate_tags as (
    select
      t.id as tag_id,
      coalesce(ts.distinct_customers, 0)::integer as distinct_customers,
      coalesce(tr.throttle_rejections, 0)::integer as throttle_rejections
    from public.tags as t
    left join tag_stamps as ts on ts.tag_id = t.id
    left join tag_rejections as tr on tr.tag_id = t.id
    where t.tenant_id = p_tenant
      and (coalesce(ts.distinct_customers, 0) > 8 or coalesce(tr.throttle_rejections, 0) > 25)
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'tagId', ct.tag_id,
        'distinctCustomers', ct.distinct_customers,
        'throttleRejections', ct.throttle_rejections
      )
      order by ct.distinct_customers desc, ct.throttle_rejections desc, ct.tag_id asc
    ),
    '[]'::jsonb
  )
  into v_result
  from candidate_tags as ct;

  return v_result;
end;
$$;

revoke all on function public.tag_leak_signals(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.tag_leak_signals(uuid, uuid, integer) to service_role;
