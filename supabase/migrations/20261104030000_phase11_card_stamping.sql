-- Migration: 20261104030000_phase11_card_stamping.sql
-- Description: Phase 11 wallet cards (add_card) and tenant-aware NFC stamping (stamp_card_nfc).
--              The tenant is read from the tag inside SQL; rules come from tenant_settings.
--              New names (not overloads of record_stamp) so calls are never ambiguous.

-- -----------------------------------------------------------------------------
-- 1. ADD CARD (explicit "Add <shop> to your wallet" consent)
-- -----------------------------------------------------------------------------

create or replace function public.add_card(
  p_customer uuid,
  p_tenant uuid,
  p_consent_version text default 'v1'
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_inserted integer;
begin
  if p_customer is null or p_tenant is null then
    raise exception 'p_customer and p_tenant must not be null';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  select t.status into v_status
  from public.tenants as t
  where t.id = p_tenant;

  if v_status is null or v_status not in ('trial', 'active') then
    return 'tenant-unavailable';
  end if;

  insert into public.customers (id)
  values (p_customer)
  on conflict (id) do nothing;

  insert into public.customer_cards (tenant_id, customer_id, consent_version)
  values (p_tenant, p_customer, coalesce(nullif(pg_catalog.btrim(p_consent_version), ''), 'v1'))
  on conflict (tenant_id, customer_id) do nothing;
  get diagnostics v_inserted = row_count;

  return case when v_inserted > 0 then 'added' else 'already-added' end;
end;
$$;

revoke all on function public.add_card(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_card(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 2. NFC STAMP (tenant derived from the tag)
-- -----------------------------------------------------------------------------

create or replace function public.stamp_card_nfc(
  p_customer uuid,
  p_tag text,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag text;
  v_now timestamptz;
  v_tenant uuid;
  v_status text;
  v_slug text;
  v_cooldown_minutes integer;
  v_daily_cap integer;
  v_throttle_seconds integer;
  v_timezone text;
  v_last_stamp timestamptz;
  v_daily_count integer;
begin
  -- 1. Input validation & normalization
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  v_tag := pg_catalog.btrim(p_tag);
  if v_tag is null or v_tag = '' then
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', null);
  end if;

  -- 2. Hierarchical advisory locks (D-005): tag first, then customer
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tag, 1002));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 3. Capture effective timestamp after acquiring locks
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  -- 4. The tag decides the tenant and its rules
  select t.tenant_id, tn.status, tn.slug, ts.cooldown_minutes, ts.daily_cap, ts.tag_throttle_seconds, ts.timezone
  into v_tenant, v_status, v_slug, v_cooldown_minutes, v_daily_cap, v_throttle_seconds, v_timezone
  from public.tags as t
  join public.tenants as tn on tn.id = t.tenant_id
  join public.tenant_settings as ts on ts.tenant_id = t.tenant_id
  where t.id = v_tag
    and t.active = true
    and t.deactivated_at is null;

  if v_tenant is null then
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', null);
  end if;

  if v_status not in ('trial', 'active') then
    return pg_catalog.jsonb_build_object('result', 'tenant-unavailable', 'tenant_slug', v_slug);
  end if;

  -- 5. The customer must hold this shop's card
  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = v_tenant
      and cc.customer_id = p_customer
  ) then
    return pg_catalog.jsonb_build_object('result', 'no-card', 'tenant_slug', v_slug);
  end if;

  -- 6. Customer cooldown within this tenant
  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.tenant_id = v_tenant
    and s.customer_id = p_customer;

  if v_last_stamp is not null
    and v_last_stamp > (v_now - pg_catalog.make_interval(mins => v_cooldown_minutes)) then
    return pg_catalog.jsonb_build_object('result', 'cooldown', 'tenant_slug', v_slug);
  end if;

  -- 7. Daily cap on the tenant's calendar day
  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.tenant_id = v_tenant
    and s.customer_id = p_customer
    and (s.created_at at time zone v_timezone)::date = (v_now at time zone v_timezone)::date;

  if v_daily_count >= v_daily_cap then
    return pg_catalog.jsonb_build_object('result', 'daily-limit', 'tenant_slug', v_slug);
  end if;

  -- 8. Per-tag throttle (0 disables it)
  if v_throttle_seconds > 0 and exists (
    select 1
    from public.stamps as s
    where s.tenant_id = v_tenant
      and s.tag_id = v_tag
      and s.created_at > (v_now - pg_catalog.make_interval(secs => v_throttle_seconds))
  ) then
    return pg_catalog.jsonb_build_object('result', 'tag-throttled', 'tenant_slug', v_slug);
  end if;

  -- 9. Record the stamp
  insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
  values (v_tenant, p_customer, v_tag, 'nfc', v_now);

  return pg_catalog.jsonb_build_object('result', 'stamped', 'tenant_slug', v_slug);
end;
$$;

revoke all on function public.stamp_card_nfc(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.stamp_card_nfc(uuid, text, timestamptz) to service_role;
