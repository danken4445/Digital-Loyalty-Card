-- Migration: 20261107020000_nfc_anti_replay_and_audit.sql
-- Description: Add hardware counter auto-latch, hardware UID validation, audit logging for all stamp rejections,
--              and counter replay detection in public.stamp_card_nfc and public.tag_leak_signals.

-- -----------------------------------------------------------------------------
-- 1. EXPAND PUBLIC.TAGS WITH COUNTER AND HARDWARE UID COLUMNS
-- -----------------------------------------------------------------------------

alter table public.tags
  add column if not exists last_tap_counter bigint null
    check (last_tap_counter is null or (last_tap_counter >= 0 and last_tap_counter <= 16777215)),
  add column if not exists hardware_uid text null
    check (hardware_uid is null or hardware_uid ~ '^[0-9A-F]{14}$');

comment on column public.tags.last_tap_counter is
  'Monotonically increasing 24-bit NFC tap counter from NTAG215/NTAG424 mirror. Null until first mirrored tap auto-latches.';

comment on column public.tags.hardware_uid is
  '14-character uppercase hex factory UID (7 bytes) mirrored from the card. Null until first mirrored tap auto-latches.';

-- -----------------------------------------------------------------------------
-- 2. UPGRADE PUBLIC.STAMP_CARD_NFC
-- -----------------------------------------------------------------------------

drop function if exists public.stamp_card_nfc(uuid, text, timestamptz);

create or replace function public.stamp_card_nfc(
  p_customer uuid,
  p_tag text,
  p_now timestamptz default null,
  p_tap_counter bigint default null,
  p_hardware_uid text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag text;
  v_now timestamptz;
  v_tenant uuid;
  v_location uuid;
  v_status text;
  v_slug text;
  v_cooldown_minutes integer;
  v_daily_cap integer;
  v_throttle_seconds integer;
  v_timezone text;
  v_last_stamp timestamptz;
  v_daily_count integer;
  v_last_tap_counter bigint;
  v_hardware_uid text;
  v_clean_hw_uid text;
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  v_tag := pg_catalog.btrim(p_tag);
  if v_tag is null or v_tag = '' then
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', null);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tag, 1002));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  select t.tenant_id, t.location_id, tn.status, tn.slug, ts.cooldown_minutes, ts.daily_cap, ts.tag_throttle_seconds, ts.timezone,
         t.last_tap_counter, t.hardware_uid
  into v_tenant, v_location, v_status, v_slug, v_cooldown_minutes, v_daily_cap, v_throttle_seconds, v_timezone,
       v_last_tap_counter, v_hardware_uid
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

  -- 4. Check customer_cards existence (no-card) BEFORE consuming the tap counter.
  -- If the customer doesn't have the card yet, return no-card without advancing last_tap_counter
  -- so the immediate follow-up claim from /start or AddCardPanel with that same tap's counter succeeds.
  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = v_tenant
      and cc.customer_id = p_customer
  ) then
    return pg_catalog.jsonb_build_object('result', 'no-card', 'tenant_slug', v_slug);
  end if;

  -- 5. Enforce Counter & UID Latch
  v_clean_hw_uid := nullif(pg_catalog.upper(pg_catalog.btrim(p_hardware_uid)), '');

  -- If the tag has already latched onto a hardware UID, any tap claiming to be from this tag
  -- must present that identical hardware UID.
  if v_hardware_uid is not null and (v_clean_hw_uid is null or v_clean_hw_uid <> v_hardware_uid) then
    insert into public.audit_log (tenant_id, actor, action, target, detail, created_at)
    values (
      v_tenant,
      p_customer,
      'stamp_rejected_counter_replay',
      v_tag,
      pg_catalog.jsonb_build_object(
        'reason', 'hardware_uid_mismatch',
        'expected_uid', v_hardware_uid,
        'presented_uid', v_clean_hw_uid,
        'presented_counter', p_tap_counter,
        'last_counter', v_last_tap_counter
      ),
      v_now
    );
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', v_slug);
  end if;

  -- If the tag has already latched onto a tap counter, any subsequent tap must be strictly greater.
  if v_last_tap_counter is not null and (p_tap_counter is null or p_tap_counter <= v_last_tap_counter) then
    insert into public.audit_log (tenant_id, actor, action, target, detail, created_at)
    values (
      v_tenant,
      p_customer,
      'stamp_rejected_counter_replay',
      v_tag,
      pg_catalog.jsonb_build_object(
        'reason', 'counter_replay_or_stale',
        'last_counter', v_last_tap_counter,
        'presented_counter', p_tap_counter
      ),
      v_now
    );
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', v_slug);
  end if;

  -- Auto-latch or advance counter:
  -- If p_tap_counter is present, advance the tag's counter immediately so even rejections
  -- like cooldown or daily-limit burn the physical counter value and cannot be replayed later.
  if p_tap_counter is not null then
    update public.tags
    set last_tap_counter = p_tap_counter,
        hardware_uid = coalesce(tags.hardware_uid, v_clean_hw_uid)
    where id = v_tag;
  end if;

  -- 6. Enforce Cooldown, Daily Cap, and Tag Throttle — and log rejections to public.audit_log
  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.tenant_id = v_tenant
    and s.customer_id = p_customer;

  if v_last_stamp is not null
    and v_last_stamp > (v_now - pg_catalog.make_interval(mins => v_cooldown_minutes)) then
    insert into public.audit_log (tenant_id, actor, action, target, detail, created_at)
    values (
      v_tenant,
      p_customer,
      'stamp_rejected_cooldown',
      p_customer::text,
      pg_catalog.jsonb_build_object('tag_id', v_tag, 'last_stamp', v_last_stamp),
      v_now
    );
    return pg_catalog.jsonb_build_object('result', 'cooldown', 'tenant_slug', v_slug);
  end if;

  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.tenant_id = v_tenant
    and s.customer_id = p_customer
    and (s.created_at at time zone v_timezone)::date = (v_now at time zone v_timezone)::date;

  if v_daily_count >= v_daily_cap then
    insert into public.audit_log (tenant_id, actor, action, target, detail, created_at)
    values (
      v_tenant,
      p_customer,
      'stamp_rejected_daily_limit',
      p_customer::text,
      pg_catalog.jsonb_build_object('tag_id', v_tag, 'daily_count', v_daily_count, 'daily_cap', v_daily_cap),
      v_now
    );
    return pg_catalog.jsonb_build_object('result', 'daily-limit', 'tenant_slug', v_slug);
  end if;

  if v_throttle_seconds > 0 and exists (
    select 1
    from public.stamps as s
    where s.tenant_id = v_tenant
      and s.tag_id = v_tag
      and s.created_at > (v_now - pg_catalog.make_interval(secs => v_throttle_seconds))
  ) then
    insert into public.audit_log (tenant_id, actor, action, target, detail, created_at)
    values (
      v_tenant,
      p_customer,
      'stamp_rejected_tag_throttled',
      v_tag,
      pg_catalog.jsonb_build_object('customer_id', p_customer),
      v_now
    );
    return pg_catalog.jsonb_build_object('result', 'tag-throttled', 'tenant_slug', v_slug);
  end if;

  -- 7. Record stamp
  insert into public.stamps (tenant_id, customer_id, tag_id, source, location_id, created_at)
  values (v_tenant, p_customer, v_tag, 'nfc', v_location, v_now);

  return pg_catalog.jsonb_build_object('result', 'stamped', 'tenant_slug', v_slug);
end;
$$;

revoke all on function public.stamp_card_nfc(uuid, text, timestamptz, bigint, text) from public, anon, authenticated;
grant execute on function public.stamp_card_nfc(uuid, text, timestamptz, bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. UPGRADE PUBLIC.TAG_LEAK_SIGNALS TO INCLUDE COUNTER REPLAYS
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
      and al.action in ('tag_throttled', 'tag-throttled', 'stamp_rejected_tag_throttled', 'stamp_rejected_counter_replay')
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
      and t.active = true
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

