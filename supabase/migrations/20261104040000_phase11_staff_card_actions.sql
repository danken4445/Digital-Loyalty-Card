-- Migration: 20261104040000_phase11_staff_card_actions.sql
-- Description: Phase 11 tenant-checked staff actions: manual stamp, reward redemption and perk claim.
--              Each takes the acting staff member (p_actor) and verifies an active membership in
--              p_tenant, then that the customer holds a card in that tenant.
--              Check order: customer lock -> actor role -> tenant status -> card -> action rules.

-- -----------------------------------------------------------------------------
-- 1. MANUAL STAMP
-- -----------------------------------------------------------------------------

create or replace function public.stamp_card_manual(
  p_actor uuid,
  p_tenant uuid,
  p_customer uuid,
  p_reason text,
  p_now timestamptz default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_now timestamptz;
  v_status text;
  v_cooldown_minutes integer;
  v_daily_cap integer;
  v_timezone text;
  v_last_stamp timestamptz;
  v_daily_count integer;
begin
  if p_tenant is null or p_customer is null then
    raise exception 'p_tenant and p_customer must not be null';
  end if;

  v_reason := pg_catalog.btrim(p_reason);
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 500 then
    raise exception 'invalid manual stamp reason';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  if private.member_role(p_actor, p_tenant) is null then
    return 'unauthorized';
  end if;

  select tn.status, ts.cooldown_minutes, ts.daily_cap, ts.timezone
  into v_status, v_cooldown_minutes, v_daily_cap, v_timezone
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant;

  if v_status is null or v_status not in ('trial', 'active') then
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

  -- Same cooldown and daily cap as NFC stamps; no tag throttle
  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.tenant_id = p_tenant
    and s.customer_id = p_customer;

  if v_last_stamp is not null
    and v_last_stamp > (v_now - pg_catalog.make_interval(mins => v_cooldown_minutes)) then
    return 'cooldown';
  end if;

  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.tenant_id = p_tenant
    and s.customer_id = p_customer
    and (s.created_at at time zone v_timezone)::date = (v_now at time zone v_timezone)::date;

  if v_daily_count >= v_daily_cap then
    return 'daily-limit';
  end if;

  insert into public.stamps (tenant_id, customer_id, source, staff_id, reason, created_at)
  values (p_tenant, p_customer, 'manual', p_actor, v_reason, v_now);

  insert into public.audit_log (tenant_id, actor, action, target, detail, created_at)
  values (
    p_tenant,
    p_actor,
    'manual_stamp',
    p_customer::text,
    pg_catalog.jsonb_build_object('reason', v_reason),
    v_now
  );

  return 'stamped';
end;
$$;

revoke all on function public.stamp_card_manual(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.stamp_card_manual(uuid, uuid, uuid, text, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 2. REWARD REDEMPTION (per-tenant balance and current threshold)
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

  select tn.status, ts.reward_threshold
  into v_status, v_threshold
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant;

  if v_status is null or v_status not in ('trial', 'active', 'suspended') then
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

-- -----------------------------------------------------------------------------
-- 3. PERK CLAIM (perk keys come from tenant_settings.perks)
-- -----------------------------------------------------------------------------

create or replace function public.claim_card_perk(
  p_actor uuid,
  p_tenant uuid,
  p_customer uuid,
  p_perk text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perk text;
  v_status text;
  v_perks jsonb;
begin
  if p_tenant is null or p_customer is null then
    raise exception 'p_tenant and p_customer must not be null';
  end if;

  v_perk := pg_catalog.btrim(p_perk);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  if private.member_role(p_actor, p_tenant) is null then
    return 'unauthorized';
  end if;

  select tn.status, ts.perks
  into v_status, v_perks
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant;

  if v_status is null or v_status not in ('trial', 'active', 'suspended') then
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

  if v_perk is null or not (v_perks ? v_perk) then
    return 'invalid-perk';
  end if;

  if exists (
    select 1
    from public.perk_claims as pc
    where pc.tenant_id = p_tenant
      and pc.customer_id = p_customer
      and pc.perk = v_perk
  ) then
    return 'already-claimed';
  end if;

  insert into public.perk_claims (tenant_id, customer_id, perk, staff_id)
  values (p_tenant, p_customer, v_perk, p_actor);

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'claim_card_perk',
    p_customer::text,
    pg_catalog.jsonb_build_object('perk', v_perk)
  );

  return 'redeemed';
end;
$$;

revoke all on function public.claim_card_perk(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_card_perk(uuid, uuid, uuid, text) to service_role;
