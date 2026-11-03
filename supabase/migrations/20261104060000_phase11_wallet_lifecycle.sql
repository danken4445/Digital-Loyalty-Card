-- Migration: 20261104060000_phase11_wallet_lifecycle.sql
-- Description: Phase 11 wallet lifecycle: per-tenant card removal (shop-level erasure),
--              whole-wallet deletion (RA 10173 erasure) and wallet merge across all cards.
--              Also fixes the legacy delete_customer_data lock so it serializes with stamping (F-17).

-- -----------------------------------------------------------------------------
-- 1. REMOVE ONE CARD (one tenant's data only; the wallet remains)
-- -----------------------------------------------------------------------------

create or replace function public.remove_card(
  p_customer uuid,
  p_tenant uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer is null or p_tenant is null then
    raise exception 'p_customer and p_tenant must not be null';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = p_tenant
      and cc.customer_id = p_customer
  ) then
    return false;
  end if;

  delete from public.audit_log
  where tenant_id = p_tenant
    and (
      actor = p_customer
      or target = p_customer::text
      or detail ->> 'customer_id' = p_customer::text
    );

  delete from public.stamps where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.redemptions where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.perk_claims where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.customer_cards where tenant_id = p_tenant and customer_id = p_customer;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    null,
    'customer_card_removed',
    pg_catalog.md5(p_customer::text),
    pg_catalog.jsonb_build_object('compliance', 'RA_10173_erasure')
  );

  return true;
end;
$$;

revoke all on function public.remove_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_card(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. DELETE WALLET (every card, the customer row and the auth user)
-- -----------------------------------------------------------------------------

create or replace function public.delete_wallet(
  p_customer uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  if not exists (select 1 from public.customers where id = p_customer)
     and not exists (select 1 from auth.users where id = p_customer) then
    return false;
  end if;

  delete from public.audit_log
  where actor = p_customer
     or target = p_customer::text
     or detail ->> 'customer_id' = p_customer::text;

  -- Cascades to customer_cards, stamps, redemptions and perk_claims
  delete from public.customers where id = p_customer;
  delete from auth.users where id = p_customer;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    null,
    null,
    'customer_wallet_deleted',
    pg_catalog.md5(p_customer::text),
    pg_catalog.jsonb_build_object('compliance', 'RA_10173_erasure')
  );

  return true;
end;
$$;

revoke all on function public.delete_wallet(uuid) from public, anon, authenticated;
grant execute on function public.delete_wallet(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. MERGE WALLETS
-- -----------------------------------------------------------------------------
-- Order matters: target cards are created before ledger rows move, so the composite
-- (tenant_id, customer_id) -> customer_cards FK added in Phase 12 holds at every step.

create or replace function public.merge_wallets(
  p_source uuid,
  p_target uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_cards integer := 0;
  v_cards_moved integer := 0;
  v_stamps_moved integer := 0;
  v_redemptions_moved integer := 0;
begin
  if p_source is null or p_target is null then
    raise exception 'p_source and p_target must not be null';
  end if;

  if p_source = p_target then
    return pg_catalog.jsonb_build_object('result', 'noop-same-user', 'cards_moved', 0, 'cards_combined', 0);
  end if;

  -- Canonical ascending UUID text order (D-009). least/greatest are SQL constructs, not pg_catalog functions.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(p_source::text, p_target::text), 1001));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(p_source::text, p_target::text), 1001));

  if not exists (select 1 from public.customers where id = p_source) then
    return pg_catalog.jsonb_build_object('result', 'source-not-found', 'cards_moved', 0, 'cards_combined', 0);
  end if;

  if not exists (select 1 from public.customers where id = p_target) then
    return pg_catalog.jsonb_build_object('result', 'target-not-found', 'cards_moved', 0, 'cards_combined', 0);
  end if;

  -- 1. Give the target every card the source holds
  select count(*)::integer into v_source_cards
  from public.customer_cards
  where customer_id = p_source;

  insert into public.customer_cards (tenant_id, customer_id, added_at, consent_version)
  select cc.tenant_id, p_target, cc.added_at, cc.consent_version
  from public.customer_cards as cc
  where cc.customer_id = p_source
  on conflict (tenant_id, customer_id) do nothing;
  get diagnostics v_cards_moved = row_count;

  -- 2. Keep the target's perk claim when both claimed the same perk at the same shop
  delete from public.perk_claims as pc
  where pc.customer_id = p_source
    and exists (
      select 1
      from public.perk_claims as t
      where t.customer_id = p_target
        and t.tenant_id = pc.tenant_id
        and t.perk = pc.perk
    );

  -- 3. Move the ledgers
  update public.stamps set customer_id = p_target where customer_id = p_source;
  get diagnostics v_stamps_moved = row_count;

  update public.redemptions set customer_id = p_target where customer_id = p_source;
  get diagnostics v_redemptions_moved = row_count;

  update public.perk_claims set customer_id = p_target where customer_id = p_source;

  -- 4. Remove the source wallet
  delete from public.customer_cards where customer_id = p_source;
  delete from public.customers where id = p_source;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    null,
    p_target,
    'merge_wallets',
    p_source::text,
    pg_catalog.jsonb_build_object(
      'source_customer', p_source::text,
      'target_customer', p_target::text,
      'cards_moved', v_cards_moved,
      'cards_combined', v_source_cards - v_cards_moved,
      'stamps_moved', v_stamps_moved,
      'redemptions_moved', v_redemptions_moved
    )
  );

  return pg_catalog.jsonb_build_object(
    'result', 'merged',
    'cards_moved', v_cards_moved,
    'cards_combined', v_source_cards - v_cards_moved
  );
end;
$$;

revoke all on function public.merge_wallets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_wallets(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 4. F-17: LEGACY ERASURE TAKES THE SAME CUSTOMER LOCK AS STAMPING
-- -----------------------------------------------------------------------------
-- Identical to Phase 7 except the lock line, which used the two-argument
-- pg_advisory_xact_lock(1001, hashtext(...)) form: a different lock key from record_stamp's.

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
