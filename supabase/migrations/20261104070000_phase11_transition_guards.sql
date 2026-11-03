-- Migration: 20261104070000_phase11_transition_guards.sql
-- Description: Guards for the transition period while the deployed app still calls the
--              tenant-blind legacy functions (removed in Phase 12):
--              1. Removing or reassigning a legacy staff row deactivates the tenant #1 membership,
--                 so tenant-scoped RLS no longer grants that person access.
--              2. No tenant other than tenant #1 can be created unless app.allow_multi_tenant = 'on'
--                 (set by pgTAP tests and the local seed only).
--              3. Legacy erasure also removes audit rows naming the customer in detail.customer_id
--                 (redeemed QR nonce rows), matching delete_wallet and remove_card.

-- -----------------------------------------------------------------------------
-- 1. STAFF MIRROR HANDLES DELETE AND USER REASSIGNMENT
-- -----------------------------------------------------------------------------

create or replace function private.mirror_staff_to_tenant1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or new.user_id is distinct from old.user_id) then
    update public.tenant_members
    set active = false
    where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
      and user_id = old.user_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
  values ('7c1f0000-0000-4000-8000-000000000001', new.user_id, new.role, new.display_name, new.active)
  on conflict (tenant_id, user_id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      active = excluded.active;

  return new;
end;
$$;

revoke all on function private.mirror_staff_to_tenant1() from public, anon, authenticated;

drop trigger if exists staff_mirror_to_tenant1 on public.staff;
create trigger staff_mirror_to_tenant1
  after insert or update or delete on public.staff
  for each row execute function private.mirror_staff_to_tenant1();

-- -----------------------------------------------------------------------------
-- 2. SINGLE-TENANT GUARD UNTIL PHASE 12
-- -----------------------------------------------------------------------------

create or replace function private.guard_single_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> '7c1f0000-0000-4000-8000-000000000001'
    and coalesce(pg_catalog.current_setting('app.allow_multi_tenant', true), '') <> 'on' then
    raise exception 'additional tenants are blocked until Phase 12';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_single_tenant() from public, anon, authenticated;

drop trigger if exists tenants_single_tenant_guard on public.tenants;
create trigger tenants_single_tenant_guard
  before insert on public.tenants
  for each row execute function private.guard_single_tenant();

-- -----------------------------------------------------------------------------
-- 3. LEGACY ERASURE COVERS detail.customer_id
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

  -- 2. Acquire transaction-scoped advisory lock for the customer (shared key with record_stamp)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 3. Check if customer exists in public.customers OR auth.users
  if not exists (select 1 from public.customers where id = p_customer)
     and not exists (select 1 from auth.users where id = p_customer) then
    return false;
  end if;

  -- 4. Delete any prior public.audit_log rows referencing p_customer
  --    (as actor, target, or detail.customer_id on redeemed QR nonce rows)
  --    so no customer-identifiable trace remains after erasure
  delete from public.audit_log
  where actor = p_customer
     or target = p_customer::text
     or detail ->> 'customer_id' = p_customer::text;

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
