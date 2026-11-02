-- Migration: 20261102030000_phase6_merge_anonymous_customer.sql
-- Description: Phase 6 Atomic Account Merge SQL Migration (merge_anonymous_customer)

create or replace function public.merge_anonymous_customer(
  p_source_customer uuid,
  p_target_customer uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stamps_moved integer := 0;
  v_redemptions_moved integer := 0;
begin
  -- 1. Validate inputs
  if p_source_customer is null or p_target_customer is null then
    raise exception 'p_source_customer and p_target_customer must not be null';
  end if;

  if p_source_customer = p_target_customer then
    return 'noop-same-user';
  end if;

  -- 2. Acquire transaction-scoped advisory locks in canonical ascending UUID text order
  --    (pg_advisory_xact_lock namespace 1001) to guarantee deadlock freedom
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.least(p_source_customer::text, p_target_customer::text), 1001)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.greatest(p_source_customer::text, p_target_customer::text), 1001)
  );

  -- 3. Verify both customers exist in public.customers
  if not exists (
    select 1 from public.customers as c where c.id = p_source_customer
  ) then
    return 'source-not-found';
  end if;

  if not exists (
    select 1 from public.customers as c where c.id = p_target_customer
  ) then
    return 'target-not-found';
  end if;

  -- 4. Reassign all public.stamps and public.redemptions from p_source_customer to p_target_customer and capture counts
  update public.stamps
  set customer_id = p_target_customer
  where customer_id = p_source_customer;
  get diagnostics v_stamps_moved = row_count;

  update public.redemptions
  set customer_id = p_target_customer
  where customer_id = p_source_customer;
  get diagnostics v_redemptions_moved = row_count;

  -- 5. Delete the merged source customer row from public.customers
  delete from public.customers
  where id = p_source_customer;

  -- 6. Record an immutable audit log entry in public.audit_log
  insert into public.audit_log (
    actor,
    action,
    target,
    detail
  ) values (
    p_target_customer,
    'merge_anonymous_customer',
    p_source_customer::text,
    pg_catalog.jsonb_build_object(
      'source_customer', p_source_customer::text,
      'target_customer', p_target_customer::text,
      'stamps_moved', v_stamps_moved,
      'redemptions_moved', v_redemptions_moved
    )
  );

  -- 7. Return merged
  return 'merged';
end;
$$;

revoke all on function public.merge_anonymous_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_customer(uuid, uuid) to service_role;
