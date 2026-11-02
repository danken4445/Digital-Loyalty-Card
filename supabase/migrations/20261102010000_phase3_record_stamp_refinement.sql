-- Migration: 20261102010000_phase3_record_stamp_refinement.sql
-- Description: Phase 3 refinement of public.record_stamp for monotonic post-lock clock capture and customer-cooldown-first rule ordering

create or replace function public.record_stamp(
  p_customer uuid,
  p_tag text default null,
  p_source text default 'nfc',
  p_staff uuid default null,
  p_reason text default null,
  p_now timestamptz default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_last_stamp timestamptz;
  v_daily_count integer;
begin
  -- 1. Input validation & normalization
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  if p_tag is not null then
    p_tag := pg_catalog.btrim(p_tag);
  end if;

  -- 2. Hierarchical transaction-scoped advisory locks:
  -- Tag lock first (if provided) to serialize tag usage, then customer lock
  if p_tag is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tag, 1002));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 3. Capture effective timestamp AFTER acquiring locks for monotonic clock evaluation
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  -- 4. Ensure customer record exists
  insert into public.customers (id)
  values (p_customer)
  on conflict (id) do nothing;

  -- 5. Validate source & tag active state FIRST
  if p_source = 'nfc' then
    if p_tag is null or not exists (
      select 1
      from public.tags as t
      where t.id = p_tag
        and t.active = true
        and t.deactivated_at is null
    ) then
      return 'invalid-tag';
    end if;
  elsif p_source = 'manual' then
    if p_staff is null
      or not exists (
        select 1
        from public.staff as st
        where st.user_id = p_staff
          and st.active = true
      )
      or p_reason is null
      or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 500
    then
      raise exception 'invalid manual stamp parameters';
    end if;
  else
    raise exception 'invalid stamp source';
  end if;

  -- 6. Check Customer 30-minute cooldown NEXT
  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.customer_id = p_customer;

  if v_last_stamp is not null and v_last_stamp > (v_now - interval '30 minutes') then
    return 'cooldown';
  end if;

  -- 7. Check Customer daily cap (max 2 stamps per calendar day in Asia/Manila) NEXT
  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.customer_id = p_customer
    and (s.created_at at time zone 'Asia/Manila')::date = (v_now at time zone 'Asia/Manila')::date;

  if v_daily_count >= 2 then
    return 'daily-limit';
  end if;

  -- 8. Check Per-Tag 5-second throttle (for nfc stamps) NEXT
  if p_source = 'nfc' and exists (
    select 1
    from public.stamps as s
    where s.tag_id = p_tag
      and s.created_at > (v_now - interval '5 seconds')
  ) then
    return 'tag-throttled';
  end if;

  -- 9. Insert stamp record
  insert into public.stamps (
    customer_id,
    tag_id,
    source,
    staff_id,
    reason,
    created_at
  ) values (
    p_customer,
    case when p_source = 'nfc' then p_tag else null end,
    p_source,
    case when p_source = 'manual' then p_staff else null end,
    case when p_source = 'manual' then pg_catalog.btrim(p_reason) else null end,
    v_now
  );

  -- 10. Audit log for manual stamps
  if p_source = 'manual' then
    insert into public.audit_log (
      actor,
      action,
      target,
      detail,
      created_at
    ) values (
      p_staff,
      'manual_stamp',
      p_customer::text,
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)),
      v_now
    );
  end if;

  return 'stamped';
end;
$$;

revoke all on function public.record_stamp(uuid, text, text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_stamp(uuid, text, text, uuid, text, timestamptz) to service_role;
