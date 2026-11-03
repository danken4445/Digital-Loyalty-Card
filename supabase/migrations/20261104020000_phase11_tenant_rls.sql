-- Migration: 20261104020000_phase11_tenant_rls.sql
-- Description: Phase 11 tenant-scoped RLS. Staff visibility moves from the global is_staff()
--              check to tenant memberships; customers keep seeing their own rows across all
--              tenants (the wallet). Adds the per-card balance view.
--              Legacy objects the deployed app still calls are untouched: public.staff and its
--              policy, public.customer_balances and public.is_staff().

-- -----------------------------------------------------------------------------
-- 1. MEMBERSHIP HELPERS
-- -----------------------------------------------------------------------------

-- Active tenant memberships of the calling user (used inside RLS policies)
create or replace function private.staff_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.tenant_members as m
  where m.user_id = (select auth.uid())
    and m.active = true;
$$;

revoke all on function private.staff_tenant_ids() from public, anon;
grant execute on function private.staff_tenant_ids() to authenticated, service_role;

-- Role of an active membership, or null (used by SECURITY DEFINER functions with p_actor)
create or replace function private.member_role(
  p_user uuid,
  p_tenant uuid
) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.tenant_members as m
  where m.user_id = p_user
    and m.tenant_id = p_tenant
    and m.active = true;
$$;

revoke all on function private.member_role(uuid, uuid) from public, anon, authenticated;
grant execute on function private.member_role(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2. TENANT-SCOPED SELECT POLICIES
-- -----------------------------------------------------------------------------

drop policy if exists customers_select_policy on public.customers;
create policy customers_select_policy
  on public.customers
  for select
  to authenticated
  using (
    (select auth.uid()) = id
    or exists (
      select 1
      from public.customer_cards as cc
      where cc.customer_id = customers.id
        and cc.tenant_id in (select private.staff_tenant_ids())
    )
  );

drop policy if exists tags_select_policy on public.tags;
create policy tags_select_policy
  on public.tags
  for select
  to authenticated
  using (tenant_id in (select private.staff_tenant_ids()));

drop policy if exists stamps_select_policy on public.stamps;
create policy stamps_select_policy
  on public.stamps
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or tenant_id in (select private.staff_tenant_ids()));

drop policy if exists redemptions_select_policy on public.redemptions;
create policy redemptions_select_policy
  on public.redemptions
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or tenant_id in (select private.staff_tenant_ids()));

drop policy if exists perk_claims_select_policy on public.perk_claims;
create policy perk_claims_select_policy
  on public.perk_claims
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or tenant_id in (select private.staff_tenant_ids()));

drop policy if exists audit_log_select_policy on public.audit_log;
create policy audit_log_select_policy
  on public.audit_log
  for select
  to authenticated
  using (tenant_id in (select private.staff_tenant_ids()));

drop policy if exists customer_cards_select_policy on public.customer_cards;
create policy customer_cards_select_policy
  on public.customer_cards
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or tenant_id in (select private.staff_tenant_ids()));

drop policy if exists tenant_members_select_policy on public.tenant_members;
create policy tenant_members_select_policy
  on public.tenant_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id or tenant_id in (select private.staff_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 3. PER-CARD BALANCE VIEW (SECURITY INVOKER)
-- -----------------------------------------------------------------------------

create or replace view public.card_balances
with (security_invoker = true) as
select
  cc.tenant_id,
  cc.customer_id,
  coalesce(s.total_stamps, 0)::integer as total_stamps,
  coalesce(r.stamps_redeemed, 0)::integer as stamps_redeemed,
  (coalesce(s.total_stamps, 0) - coalesce(r.stamps_redeemed, 0))::integer as available_stamps,
  s.last_stamped_at
from public.customer_cards as cc
left join (
  select
    st.tenant_id,
    st.customer_id,
    count(*)::integer as total_stamps,
    max(st.created_at) as last_stamped_at
  from public.stamps as st
  group by st.tenant_id, st.customer_id
) as s on s.tenant_id = cc.tenant_id and s.customer_id = cc.customer_id
left join (
  select
    rd.tenant_id,
    rd.customer_id,
    sum(rd.stamps_used)::integer as stamps_redeemed
  from public.redemptions as rd
  group by rd.tenant_id, rd.customer_id
) as r on r.tenant_id = cc.tenant_id and r.customer_id = cc.customer_id;

revoke all on table public.card_balances from public, anon;
grant select on table public.card_balances to authenticated, service_role;
