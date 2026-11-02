-- Migration: 20261102020000_phase5_atomic_redeem_nonce.sql
-- Description: Phase 5 atomic single-use redemption token nonce consumption inside public.redeem_reward

-- 1. Enforce uniqueness on consumed redemption token nonces in public.audit_log
create unique index if not exists audit_log_redeem_nonce_uidx
  on public.audit_log (target)
  where action = 'staff_redeem_token_used' and target is not null;

-- 2. Overload public.redeem_reward(p_customer uuid, p_staff uuid, p_nonce text)
--    so single-use QR token nonce check & insertion execute atomically inside the
--    customer advisory lock (pg_advisory_xact_lock 1001).
create or replace function public.redeem_reward(
  p_customer uuid,
  p_staff uuid,
  p_nonce text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available integer;
  v_clean_nonce text;
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  if p_nonce is not null then
    v_clean_nonce := pg_catalog.btrim(p_nonce);
    if pg_catalog.char_length(v_clean_nonce) = 0 then
      v_clean_nonce := null;
    end if;
  end if;

  -- 1. Lock customer row via advisory transaction lock
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 2. Verify staff is active
  if p_staff is null or not exists (
    select 1
    from public.staff as st
    where st.user_id = p_staff
      and st.active = true
  ) then
    return 'unauthorized';
  end if;

  -- 3. Atomic single-use nonce replay check inside the customer advisory lock
  if v_clean_nonce is not null and exists (
    select 1
    from public.audit_log as al
    where al.action = 'staff_redeem_token_used'
      and al.target = v_clean_nonce
  ) then
    return 'invalid-token';
  end if;

  -- 4. Calculate available stamps
  v_available := coalesce((
    select count(*)::integer
    from public.stamps
    where customer_id = p_customer
  ), 0) - coalesce((
    select sum(stamps_used)::integer
    from public.redemptions
    where customer_id = p_customer
  ), 0);

  if v_available < 10 then
    return 'insufficient-stamps';
  end if;

  -- 5. Consume single-use token nonce atomically (backed by audit_log_redeem_nonce_uidx)
  if v_clean_nonce is not null then
    insert into public.audit_log (
      actor,
      action,
      target,
      detail
    ) values (
      p_staff,
      'staff_redeem_token_used',
      v_clean_nonce,
      pg_catalog.jsonb_build_object('customer_id', p_customer::text)
    );
  end if;

  -- 6. Record redemption
  insert into public.redemptions (
    customer_id,
    stamps_used,
    staff_id
  ) values (
    p_customer,
    10,
    p_staff
  );

  -- 7. Audit log for redemption
  insert into public.audit_log (
    actor,
    action,
    target,
    detail
  ) values (
    p_staff,
    'redeem_reward',
    p_customer::text,
    pg_catalog.jsonb_build_object('stamps_used', 10, 'nonce', v_clean_nonce)
  );

  return 'redeemed';
end;
$$;

revoke all on function public.redeem_reward(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_reward(uuid, uuid, text) to service_role;
