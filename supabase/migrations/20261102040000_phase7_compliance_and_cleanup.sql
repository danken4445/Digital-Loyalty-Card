-- Migration: 20261102040000_phase7_compliance_and_cleanup.sql
-- Description: Phase 7 Compliance and Cleanup SQL Migration (delete_customer_data, cleanup_stale_anonymous_customers)

-- -----------------------------------------------------------------------------
-- 1. DELETE CUSTOMER DATA (RIGHT TO ERASURE / RA 10173 COMPLIANCE)
-- -----------------------------------------------------------------------------

create or replace function public.delete_customer_data(
  p_customer uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Validate inputs
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  -- 2. Acquire transaction-scoped advisory lock for the customer
  perform pg_catalog.pg_advisory_xact_lock(1001, pg_catalog.hashtext(p_customer::text));

  -- 3. Check if customer exists in public.customers OR auth.users
  if not exists (select 1 from public.customers where id = p_customer)
     and not exists (select 1 from auth.users where id = p_customer) then
    return false;
  end if;

  -- 4. Delete any prior public.audit_log rows referencing p_customer
  --    so no customer-identifiable trace remains after erasure
  delete from public.audit_log
  where actor = p_customer or target = p_customer::text;

  -- 5. Delete from public.customers (cascades to public.stamps and public.redemptions)
  delete from public.customers
  where id = p_customer;

  -- 6. Delete from auth.users
  delete from auth.users
  where id = p_customer;

  -- 7. Insert single anonymized erasure compliance log
  insert into public.audit_log (
    actor,
    action,
    target,
    detail
  ) values (
    null,
    'customer_self_deleted',
    pg_catalog.md5(p_customer::text),
    pg_catalog.jsonb_build_object('compliance', 'RA_10173_erasure')
  );

  -- 8. Return true
  return true;
end;
$$;

revoke all on function public.delete_customer_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_customer_data(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. CLEANUP STALE ANONYMOUS CUSTOMERS
-- -----------------------------------------------------------------------------

create or replace function public.cleanup_stale_anonymous_customers(
  p_older_than interval default interval '30 days'
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count integer := 0;
  v_candidate_ids uuid[];
begin
  -- 1. Validate / default retention interval
  if p_older_than is null then
    p_older_than := interval '30 days';
  end if;

  -- 2. Find candidate anonymous customer IDs in auth.users:
  --    - anonymous account
  --    - created_at older than threshold
  --    - no stamps recorded
  --    - no redemptions recorded
  --    - not a staff member
  select pg_catalog.coalesce(pg_catalog.array_agg(u.id), array[]::uuid[])
  into v_candidate_ids
  from auth.users as u
  where pg_catalog.coalesce(u.is_anonymous, false) = true
    and u.created_at < (pg_catalog.now() - p_older_than)
    and not exists (
      select 1 from public.stamps as s where s.customer_id = u.id
    )
    and not exists (
      select 1 from public.redemptions as r where r.customer_id = u.id
    )
    and not exists (
      select 1 from public.staff as st where st.user_id = u.id
    );

  -- 3. Delete matching candidates from public.customers and auth.users
  if pg_catalog.cardinality(v_candidate_ids) > 0 then
    delete from public.customers
    where id = any(v_candidate_ids);

    delete from auth.users
    where id = any(v_candidate_ids);
    get diagnostics v_deleted_count = row_count;
  end if;

  -- 4. Clean up any orphaned public.customers rows without stamps older than now() - p_older_than
  --    that have no corresponding auth.users row
  delete from public.customers as c
  where c.created_at < (pg_catalog.now() - p_older_than)
    and not exists (
      select 1 from public.stamps as s where s.customer_id = c.id
    )
    and not exists (
      select 1 from public.redemptions as r where r.customer_id = c.id
    )
    and not exists (
      select 1 from auth.users as u where u.id = c.id
    );

  -- 5. Audit log entry if any anonymous accounts were deleted
  if v_deleted_count > 0 then
    insert into public.audit_log (
      actor,
      action,
      target,
      detail
    ) values (
      null,
      'stale_anonymous_cleanup',
      null,
      pg_catalog.jsonb_build_object(
        'deleted_count', v_deleted_count,
        'older_than', p_older_than::text
      )
    );
  end if;

  return v_deleted_count;
end;
$$;

revoke all on function public.cleanup_stale_anonymous_customers(interval) from public, anon, authenticated;
grant execute on function public.cleanup_stale_anonymous_customers(interval) to service_role;
