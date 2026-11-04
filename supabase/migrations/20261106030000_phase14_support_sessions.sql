-- Migration: 20261106030000_phase14_support_sessions.sql
-- Description: Phase 14 support sessions (database).
--              Adds public.support_sessions table (service role only),
--              public.start_support_session, public.end_support_session,
--              public.support_get_tenant_overview, and public.support_list_recent_activity.
--              Strictly read-only, time-boxed (30 min), pseudonymous/aggregate only (no customer emails).

-- -----------------------------------------------------------------------------
-- 1. SUPPORT SESSIONS TABLE
-- -----------------------------------------------------------------------------

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  admin_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (pg_catalog.char_length(pg_catalog.btrim(reason)) >= 10),
  mode text not null default 'read_only' check (mode = 'read_only'),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  ended_at timestamptz null
);

create index if not exists support_sessions_tenant_idx on public.support_sessions (tenant_id);
create index if not exists support_sessions_admin_idx on public.support_sessions (admin_id);
create index if not exists support_sessions_active_idx on public.support_sessions (id) where ended_at is null;

alter table public.support_sessions enable row level security;

revoke all on table public.support_sessions from public, anon, authenticated;
grant all on table public.support_sessions to service_role;

-- -----------------------------------------------------------------------------
-- 2. START SUPPORT SESSION
-- -----------------------------------------------------------------------------

create or replace function public.start_support_session(
  p_admin uuid,
  p_tenant uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_id uuid;
  v_expires_at timestamptz;
begin
  if p_admin is null or not private.is_platform_admin(p_admin) then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_reason := pg_catalog.btrim(p_reason);
  if v_reason is null or pg_catalog.char_length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('result', 'invalid-reason');
  end if;

  if p_tenant is null then
    return pg_catalog.jsonb_build_object('result', 'not-found');
  end if;

  perform 1
  from public.tenants as tn
  where tn.id = p_tenant;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'not-found');
  end if;

  insert into public.support_sessions (
    tenant_id,
    admin_id,
    reason,
    mode
  ) values (
    p_tenant,
    p_admin,
    v_reason,
    'read_only'
  )
  returning id, expires_at into v_id, v_expires_at;

  insert into public.audit_log (
    tenant_id,
    actor,
    action,
    target,
    detail
  ) values (
    p_tenant,
    p_admin,
    'support_session_started',
    v_id::text,
    pg_catalog.jsonb_build_object('reason', v_reason)
  );

  return pg_catalog.jsonb_build_object(
    'result', 'started',
    'sessionId', v_id,
    'expiresAt', v_expires_at
  );
end;
$$;

revoke all on function public.start_support_session(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_support_session(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. END SUPPORT SESSION
-- -----------------------------------------------------------------------------

create or replace function public.end_support_session(
  p_admin uuid,
  p_session uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_ended_at timestamptz;
  v_reason text;
begin
  if p_admin is null or not private.is_platform_admin(p_admin) then
    return 'unauthorized';
  end if;

  if p_session is null then
    return 'not-found';
  end if;

  select
    s.tenant_id,
    s.ended_at,
    s.reason
  into
    v_tenant,
    v_ended_at,
    v_reason
  from public.support_sessions as s
  where s.id = p_session
  for update;

  if not found then
    return 'not-found';
  end if;

  if v_ended_at is null then
    update public.support_sessions
    set ended_at = pg_catalog.now()
    where id = p_session;

    insert into public.audit_log (
      tenant_id,
      actor,
      action,
      target,
      detail
    ) values (
      v_tenant,
      p_admin,
      'support_session_ended',
      p_session::text,
      pg_catalog.jsonb_build_object('reason', v_reason)
    );
  end if;

  return 'ended';
end;
$$;

revoke all on function public.end_support_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_support_session(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. SUPPORT GET TENANT OVERVIEW
-- -----------------------------------------------------------------------------

create or replace function public.support_get_tenant_overview(
  p_admin uuid,
  p_session uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_admin uuid;
  v_expires_at timestamptz;
  v_ended_at timestamptz;
  v_tenant_id uuid;
  v_slug text;
  v_name text;
  v_status text;
  v_cards bigint;
  v_active_staff bigint;
  v_stamps_last_7_days bigint;
begin
  if p_admin is null or not private.is_platform_admin(p_admin) then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  if p_session is null then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  select
    s.tenant_id,
    s.admin_id,
    s.expires_at,
    s.ended_at
  into
    v_tenant,
    v_admin,
    v_expires_at,
    v_ended_at
  from public.support_sessions as s
  where s.id = p_session;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  if v_admin <> p_admin or v_ended_at is not null or v_expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  select
    tn.id,
    tn.slug,
    tn.name,
    tn.status
  into
    v_tenant_id,
    v_slug,
    v_name,
    v_status
  from public.tenants as tn
  where tn.id = v_tenant;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  select pg_catalog.count(*)
  into v_cards
  from public.customer_cards as cc
  where cc.tenant_id = v_tenant;

  select pg_catalog.count(*)
  into v_active_staff
  from public.tenant_members as tm
  where tm.tenant_id = v_tenant
    and tm.active = true;

  select pg_catalog.count(*)
  into v_stamps_last_7_days
  from public.stamps as st
  where st.tenant_id = v_tenant
    and st.created_at >= pg_catalog.now() - interval '7 days';

  return pg_catalog.jsonb_build_object(
    'tenantId', v_tenant_id,
    'slug', v_slug,
    'name', v_name,
    'status', v_status,
    'cards', v_cards,
    'activeStaff', v_active_staff,
    'stampsLast7Days', v_stamps_last_7_days
  );
end;
$$;

revoke all on function public.support_get_tenant_overview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.support_get_tenant_overview(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 5. SUPPORT LIST RECENT ACTIVITY
-- -----------------------------------------------------------------------------

create or replace function public.support_list_recent_activity(
  p_admin uuid,
  p_session uuid,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_admin uuid;
  v_expires_at timestamptz;
  v_ended_at timestamptz;
  v_limit integer;
  v_result jsonb;
begin
  if p_admin is null or not private.is_platform_admin(p_admin) then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  if p_session is null then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  select
    s.tenant_id,
    s.admin_id,
    s.expires_at,
    s.ended_at
  into
    v_tenant,
    v_admin,
    v_expires_at,
    v_ended_at
  from public.support_sessions as s
  where s.id = p_session;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  if v_admin <> p_admin or v_ended_at is not null or v_expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 50), 100));

  with unioned as (
    (
      select
        st.created_at as at,
        'stamp'::text as kind,
        ('stamp_' || st.source)::text as action
      from public.stamps as st
      where st.tenant_id = v_tenant
      order by st.created_at desc
      limit v_limit
    )
    union all
    (
      select
        rd.created_at as at,
        'redeem'::text as kind,
        'redeem_reward'::text as action
      from public.redemptions as rd
      where rd.tenant_id = v_tenant
      order by rd.created_at desc
      limit v_limit
    )
    union all
    (
      select
        al.created_at as at,
        'audit'::text as kind,
        al.action::text as action
      from public.audit_log as al
      where al.tenant_id = v_tenant
      order by al.created_at desc
      limit v_limit
    )
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'at', u.at,
        'kind', u.kind,
        'action', u.action
      )
      order by u.at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select at, kind, action
    from unioned
    order by at desc
    limit v_limit
  ) as u;

  return v_result;
end;
$$;

revoke all on function public.support_list_recent_activity(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.support_list_recent_activity(uuid, uuid, integer) to service_role;
