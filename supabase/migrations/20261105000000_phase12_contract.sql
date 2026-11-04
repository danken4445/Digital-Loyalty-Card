-- Migration: 20261105000000_phase12_contract.sql
-- Description: Phase 12 contract. The app no longer calls any legacy single-shop SQL object, so this
--              migration removes them: the transition triggers and guards, record_stamp, redeem_reward,
--              claim_instagram_upsize, merge_anonymous_customer, delete_customer_data, is_staff, the
--              customer_balances view and the staff table. It also locks the ledgers to wallet cards
--              (composite foreign keys), removes the tenant #1 column defaults, reclassifies platform
--              audit rows, gives log_audit_event a tenant argument and fixes the stale anonymous cleanup.
--              merge_nonce_used lives in 20261104080000 (additive), so the app can deploy before this file.

-- -----------------------------------------------------------------------------
-- 1. FINAL BACKFILL (insert-only), THEN RETIRE THE BACKFILL FUNCTION
-- -----------------------------------------------------------------------------

create or replace function private.backfill_tenant1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.customer_cards (tenant_id, customer_id)
  select '7c1f0000-0000-4000-8000-000000000001'::uuid, c.id
  from public.customers as c
  on conflict (tenant_id, customer_id) do nothing;

  insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
  select '7c1f0000-0000-4000-8000-000000000001'::uuid, s.user_id, s.role, s.display_name, s.active
  from public.staff as s
  on conflict (tenant_id, user_id) do nothing;
end;
$$;

revoke all on function private.backfill_tenant1() from public, anon, authenticated;
grant execute on function private.backfill_tenant1() to service_role;

select private.backfill_tenant1();

-- -----------------------------------------------------------------------------
-- 2. LEDGER ROWS MUST BELONG TO A WALLET CARD
-- -----------------------------------------------------------------------------

alter table public.stamps
  add constraint stamps_card_fkey
  foreign key (tenant_id, customer_id)
  references public.customer_cards (tenant_id, customer_id) on delete cascade;

alter table public.redemptions
  add constraint redemptions_card_fkey
  foreign key (tenant_id, customer_id)
  references public.customer_cards (tenant_id, customer_id) on delete cascade;

alter table public.perk_claims
  add constraint perk_claims_card_fkey
  foreign key (tenant_id, customer_id)
  references public.customer_cards (tenant_id, customer_id) on delete cascade;

-- -----------------------------------------------------------------------------
-- 3. DROP THE TRANSITION TRIGGERS AND THEIR FUNCTIONS
-- -----------------------------------------------------------------------------

drop trigger if exists staff_mirror_to_tenant1 on public.staff;
drop trigger if exists tenants_single_tenant_guard on public.tenants;

drop function if exists private.mirror_staff_to_tenant1();
drop function if exists private.guard_single_tenant();
drop function if exists private.backfill_tenant1();

-- -----------------------------------------------------------------------------
-- 4. DROP THE LEGACY SINGLE-SHOP FUNCTIONS
-- -----------------------------------------------------------------------------

drop function if exists public.record_stamp(uuid, text, text, uuid, text, timestamptz);
drop function if exists public.redeem_reward(uuid, uuid);
drop function if exists public.redeem_reward(uuid, uuid, text);
drop function if exists public.claim_instagram_upsize(uuid, uuid);
drop function if exists public.merge_anonymous_customer(uuid, uuid);
drop function if exists public.delete_customer_data(uuid);

-- -----------------------------------------------------------------------------
-- 5. DROP THE LEGACY VIEW, STAFF TABLE AND is_staff()
--    The staff table's RLS policy calls is_staff(), so the table (and its policy) goes first.
-- -----------------------------------------------------------------------------

drop view if exists public.customer_balances;
drop table if exists public.staff;
drop function if exists public.is_staff();

-- -----------------------------------------------------------------------------
-- 6. NO MORE TENANT #1 DEFAULTS: EVERY WRITER NAMES ITS TENANT
-- -----------------------------------------------------------------------------

alter table public.tags alter column tenant_id drop default;
alter table public.stamps alter column tenant_id drop default;
alter table public.redemptions alter column tenant_id drop default;
alter table public.perk_claims alter column tenant_id drop default;
alter table public.audit_log alter column tenant_id drop default;

-- -----------------------------------------------------------------------------
-- 7. PLATFORM AUDIT ROWS BELONG TO NO SHOP
-- -----------------------------------------------------------------------------

update public.audit_log
set tenant_id = null
where action in ('customer_self_deleted', 'stale_anonymous_cleanup', 'merge_anonymous_customer', 'customer_merge_token_used');

-- -----------------------------------------------------------------------------
-- 8. log_audit_event TAKES A TENANT (null = platform event)
-- -----------------------------------------------------------------------------

drop function if exists public.log_audit_event(uuid, text, text, jsonb);

create or replace function public.log_audit_event(
  p_actor uuid,
  p_action text,
  p_target text default null,
  p_detail jsonb default null,
  p_tenant uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (p_tenant, p_actor, p_action, p_target, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_audit_event(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.log_audit_event(uuid, text, text, jsonb, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 9. STALE ANONYMOUS CLEANUP (unqualified coalesce; spares anyone with a shop membership)
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
  --    - not a member of any shop
  select coalesce(pg_catalog.array_agg(u.id), array[]::uuid[])
  into v_candidate_ids
  from auth.users as u
  where coalesce(u.is_anonymous, false) = true
    and u.created_at < (pg_catalog.now() - p_older_than)
    and not exists (
      select 1 from public.stamps as s where s.customer_id = u.id
    )
    and not exists (
      select 1 from public.redemptions as r where r.customer_id = u.id
    )
    and not exists (
      select 1 from public.tenant_members as tm where tm.user_id = u.id
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

  -- 5. Platform audit entry (tenant_id stays null) if any anonymous accounts were deleted
  if v_deleted_count > 0 then
    insert into public.audit_log (
      tenant_id,
      actor,
      action,
      target,
      detail
    ) values (
      null,
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
