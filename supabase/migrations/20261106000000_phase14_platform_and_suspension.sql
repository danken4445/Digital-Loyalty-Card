-- Migration: 20261106000000_phase14_platform_and_suspension.sql
-- Description: Phase 14 platform admins and the suspension redemption window.
--              Adds platform_admins (service role only), tenants.suspended_at stamped by a trigger,
--              private.is_platform_admin and its public wrapper, public.set_tenant_status, and
--              redefines public.redeem_card_reward so a suspended shop redeems for 30 days only.
--              Expand-only: one new table, one new nullable column, new functions; the single
--              changed function keeps its signature and body apart from the status gate.

-- -----------------------------------------------------------------------------
-- 1. PLATFORM ADMINS (service role only: RLS on, no policies, no client grants)
-- -----------------------------------------------------------------------------

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

revoke all on table public.platform_admins from public, anon, authenticated;
grant all on table public.platform_admins to service_role;

-- -----------------------------------------------------------------------------
-- 2. SUSPENSION TIMESTAMP (stamped by trigger so direct SQL is covered too)
-- -----------------------------------------------------------------------------

alter table public.tenants add column if not exists suspended_at timestamptz null;

create or replace function private.stamp_tenant_suspended_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'suspended' then
    if tg_op = 'INSERT' then
      new.suspended_at := coalesce(new.suspended_at, pg_catalog.now());
    elsif old.status is distinct from 'suspended' then
      new.suspended_at := pg_catalog.now();
    end if;
  else
    new.suspended_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.stamp_tenant_suspended_at() from public, anon, authenticated;

drop trigger if exists tenants_suspended_at on public.tenants;
create trigger tenants_suspended_at
  before insert or update on public.tenants
  for each row execute function private.stamp_tenant_suspended_at();

-- -----------------------------------------------------------------------------
-- 3. PLATFORM ADMIN CHECK (table lookup only; aal2 is enforced in the app guard)
-- -----------------------------------------------------------------------------

create or replace function private.is_platform_admin(
  p_user uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins as pa
    where pa.user_id = p_user
  );
$$;

revoke all on function private.is_platform_admin(uuid) from public, anon, authenticated;
grant execute on function private.is_platform_admin(uuid) to service_role;

create or replace function public.is_platform_admin_user(
  p_user uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin(p_user);
$$;

revoke all on function public.is_platform_admin_user(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin_user(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. SET TENANT STATUS (platform admin only; closed is not settable here)
-- -----------------------------------------------------------------------------

create or replace function public.set_tenant_status(
  p_actor uuid,
  p_tenant uuid,
  p_status text,
  p_reason text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_from text;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  if p_actor is null or not private.is_platform_admin(p_actor) then
    return 'unauthorized';
  end if;

  if p_status is null or p_status not in ('trial', 'active', 'suspended') then
    return 'invalid-status';
  end if;

  v_reason := pg_catalog.btrim(p_reason);
  if v_reason is null or pg_catalog.char_length(v_reason) < 5 then
    return 'invalid-reason';
  end if;

  select tn.status
  into v_from
  from public.tenants as tn
  where tn.id = p_tenant
  for update;

  if not found then
    return 'not-found';
  end if;

  -- The tenants_suspended_at trigger stamps or clears suspended_at from the new status
  update public.tenants
  set status = p_status
  where id = p_tenant;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'tenant_status_changed',
    p_status,
    pg_catalog.jsonb_build_object('from', v_from, 'reason', v_reason)
  );

  return 'updated';
end;
$$;

revoke all on function public.set_tenant_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_tenant_status(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. REWARD REDEMPTION: suspended shops redeem for 30 days from suspended_at
--    (body copied from 20261104040000_phase11_staff_card_actions.sql; only the status gate changes;
--     a null suspended_at counts as inside the window)
-- -----------------------------------------------------------------------------

create or replace function public.redeem_card_reward(
  p_actor uuid,
  p_tenant uuid,
  p_customer uuid,
  p_nonce text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nonce text;
  v_status text;
  v_suspended_at timestamptz;
  v_threshold integer;
  v_available integer;
begin
  if p_tenant is null or p_customer is null then
    raise exception 'p_tenant and p_customer must not be null';
  end if;

  v_nonce := nullif(pg_catalog.btrim(p_nonce), '');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  if private.member_role(p_actor, p_tenant) is null then
    return 'unauthorized';
  end if;

  select tn.status, tn.suspended_at, ts.reward_threshold
  into v_status, v_suspended_at, v_threshold
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant;

  if v_status is null or v_status not in ('trial', 'active', 'suspended') then
    return 'tenant-unavailable';
  end if;

  -- Suspended shops keep redemptions open for 30 days from the suspension (null = inside the window)
  if v_status = 'suspended'
    and coalesce(v_suspended_at, pg_catalog.now()) + interval '30 days' <= pg_catalog.now() then
    return 'tenant-unavailable';
  end if;

  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = p_tenant
      and cc.customer_id = p_customer
  ) then
    return 'no-card';
  end if;

  -- Single-use nonce check inside the customer lock (backed by audit_log_redeem_nonce_uidx)
  if v_nonce is not null and exists (
    select 1
    from public.audit_log as al
    where al.action = 'staff_redeem_token_used'
      and al.target = v_nonce
  ) then
    return 'invalid-token';
  end if;

  v_available := coalesce((
    select count(*)::integer
    from public.stamps as s
    where s.tenant_id = p_tenant
      and s.customer_id = p_customer
  ), 0) - coalesce((
    select sum(r.stamps_used)::integer
    from public.redemptions as r
    where r.tenant_id = p_tenant
      and r.customer_id = p_customer
  ), 0);

  if v_available < v_threshold then
    return 'insufficient-stamps';
  end if;

  if v_nonce is not null then
    insert into public.audit_log (tenant_id, actor, action, target, detail)
    values (
      p_tenant,
      p_actor,
      'staff_redeem_token_used',
      v_nonce,
      pg_catalog.jsonb_build_object('customer_id', p_customer::text)
    );
  end if;

  insert into public.redemptions (tenant_id, customer_id, stamps_used, staff_id)
  values (p_tenant, p_customer, v_threshold, p_actor);

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'redeem_reward',
    p_customer::text,
    pg_catalog.jsonb_build_object('stamps_used', v_threshold, 'nonce', v_nonce)
  );

  return 'redeemed';
end;
$$;

revoke all on function public.redeem_card_reward(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_card_reward(uuid, uuid, uuid, text) to service_role;
