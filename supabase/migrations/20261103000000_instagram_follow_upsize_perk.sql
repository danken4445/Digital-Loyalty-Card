-- Migration: 20261103000000_instagram_follow_upsize_perk.sql
-- Description: One-time "follow us on Instagram" free upsize perk (perk_claims ledger,
--              claim_instagram_upsize RPC) and merge support for perk claims.
--
-- Instagram exposes no API to verify that a given person follows an account, so the follow is
-- verified by the barista at the counter. The database guarantees the perk is granted at most
-- once per customer via the (customer_id, perk) unique constraint.

-- -----------------------------------------------------------------------------
-- 1. PERK CLAIMS LEDGER
-- -----------------------------------------------------------------------------

create table if not exists public.perk_claims (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  perk text not null check (perk in ('instagram_follow_upsize')),
  staff_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint perk_claims_customer_perk_key unique (customer_id, perk)
);

create index if not exists perk_claims_staff_idx on public.perk_claims (staff_id);

alter table public.perk_claims enable row level security;

revoke all on table public.perk_claims from public, anon, authenticated;
grant select on table public.perk_claims to authenticated;
grant all on table public.perk_claims to service_role;

drop policy if exists perk_claims_select_policy on public.perk_claims;
create policy perk_claims_select_policy
  on public.perk_claims
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or public.is_staff());

-- -----------------------------------------------------------------------------
-- 2. CLAIM INSTAGRAM UPSIZE (SERVICE_ROLE ONLY)
-- -----------------------------------------------------------------------------

create or replace function public.claim_instagram_upsize(
  p_customer uuid,
  p_staff uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  -- 1. Same customer lock namespace as record_stamp / redeem_reward (D-005)
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

  -- 3. Customer must exist (tokens are only issued to provisioned customers)
  if not exists (select 1 from public.customers as c where c.id = p_customer) then
    return 'invalid-token';
  end if;

  -- 4. One claim per customer
  if exists (
    select 1
    from public.perk_claims as pc
    where pc.customer_id = p_customer
      and pc.perk = 'instagram_follow_upsize'
  ) then
    return 'already-claimed';
  end if;

  -- 5. Record claim
  insert into public.perk_claims (customer_id, perk, staff_id)
  values (p_customer, 'instagram_follow_upsize', p_staff);

  -- 6. Audit log
  insert into public.audit_log (
    actor,
    action,
    target,
    detail
  ) values (
    p_staff,
    'claim_instagram_upsize',
    p_customer::text,
    pg_catalog.jsonb_build_object('perk', 'instagram_follow_upsize')
  );

  return 'redeemed';
end;
$$;

revoke all on function public.claim_instagram_upsize(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_instagram_upsize(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. MERGE: CARRY PERK CLAIMS ACROSS ACCOUNT MERGES
-- -----------------------------------------------------------------------------
-- Identical to the Phase 6 function, plus step 4b: perk claims move to the target. When both
-- accounts already claimed the same perk, the target's claim is kept and the source's dropped.

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
  v_perk_claims_moved integer := 0;
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

  -- 4b. Reassign perk claims, dropping source claims the target already holds
  delete from public.perk_claims as pc
  where pc.customer_id = p_source_customer
    and exists (
      select 1
      from public.perk_claims as t
      where t.customer_id = p_target_customer
        and t.perk = pc.perk
    );

  update public.perk_claims
  set customer_id = p_target_customer
  where customer_id = p_source_customer;
  get diagnostics v_perk_claims_moved = row_count;

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
      'redemptions_moved', v_redemptions_moved,
      'perk_claims_moved', v_perk_claims_moved
    )
  );

  -- 7. Return merged
  return 'merged';
end;
$$;

revoke all on function public.merge_anonymous_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_customer(uuid, uuid) to service_role;
