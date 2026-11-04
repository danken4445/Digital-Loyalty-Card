-- Migration: 20261107000000_billing_plans.sql
-- Description: Flexible per-customer billing plans.
--              Adds the plan catalog (public.billing_plans, platform-wide, centavos),
--              each shop's plan choice (public.tenant_plan_selections, effective by month),
--              private.bill_for_usage, and the service-role RPCs public.choose_billing_plan and
--              public.get_billing_estimate. A "customer" is a card holder who earned at least one
--              stamp at the shop during the calendar month (shop timezone).
--              Metering and estimates only: no payment gateway (decision D4 still stands).
--              Expand-only: two new tables, new functions, one new index.

-- -----------------------------------------------------------------------------
-- 1. PLAN CATALOG (platform-wide pricing; rows are edited by the platform, not shops)
-- -----------------------------------------------------------------------------

create table if not exists public.billing_plans (
  code text primary key check (code ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  -- All money is whole centavos (PHP 1 = 100)
  base_fee_centavos integer not null default 0 check (base_fee_centavos between 0 and 10000000),
  included_customers integer not null default 0 check (included_customers between 0 and 100000),
  per_customer_centavos integer not null check (per_customer_centavos between 0 and 100000),
  -- Optional ceiling on the monthly charge; null = uncapped
  monthly_cap_centavos integer null check (monthly_cap_centavos is null or monthly_cap_centavos >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.billing_plans enable row level security;

revoke all on table public.billing_plans from public, anon, authenticated;
grant select on table public.billing_plans to authenticated;
grant all on table public.billing_plans to service_role;

drop policy if exists billing_plans_select_policy on public.billing_plans;
create policy billing_plans_select_policy
  on public.billing_plans
  for select
  to authenticated
  using (active = true);

-- Starting catalog. Prices are placeholders to tune from pilot feedback (edit rows, no redeploy).
--   pay-as-you-go: no commitment, PHP 10 per active customer
--   starter-50:    PHP 350 covers 50 customers (PHP 7 each), PHP 7 beyond
--   growth-200:    PHP 1,000 covers 200 customers (PHP 5 each), PHP 5 beyond
--   worry-free:    PHP 8 per active customer, never more than PHP 1,200 a month
insert into public.billing_plans
  (code, name, description, base_fee_centavos, included_customers, per_customer_centavos, monthly_cap_centavos, sort_order)
values
  ('pay-as-you-go', 'Pay as you go', 'No monthly fee. Pay only for customers who collect a stamp that month.', 0, 0, 1000, null, 10),
  ('starter-50', 'Starter 50', 'A small monthly fee that covers your first 50 active customers at a lower rate.', 35000, 50, 700, null, 20),
  ('growth-200', 'Growth 200', 'Best rate per customer for busy shops. Covers your first 200 active customers.', 100000, 200, 500, null, 30),
  ('worry-free', 'Worry-free cap', 'Pay per customer, but your bill never goes above the cap, however busy you get.', 0, 0, 800, 120000, 40)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. SHOP PLAN CHOICE (history by effective month; the latest row at or before a month applies)
-- -----------------------------------------------------------------------------

create table if not exists public.tenant_plan_selections (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  effective_month date not null check (effective_month = date_trunc('month', effective_month)::date),
  plan_code text not null references public.billing_plans(code),
  chosen_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, effective_month)
);

alter table public.tenant_plan_selections enable row level security;

revoke all on table public.tenant_plan_selections from public, anon, authenticated;
grant select on table public.tenant_plan_selections to authenticated;
grant all on table public.tenant_plan_selections to service_role;

-- Billing is visible to owners and managers only
drop policy if exists tenant_plan_selections_select_policy on public.tenant_plan_selections;
create policy tenant_plan_selections_select_policy
  on public.tenant_plan_selections
  for select
  to authenticated
  using (tenant_id in (select private.manager_tenant_ids()));

-- Active-customer counts range over (tenant, time)
create index if not exists stamps_tenant_created_idx on public.stamps (tenant_id, created_at);

-- -----------------------------------------------------------------------------
-- 3. PRICING (pure arithmetic, one place)
-- -----------------------------------------------------------------------------

create or replace function private.bill_for_usage(
  p_base integer,
  p_included integer,
  p_per_customer integer,
  p_cap integer,
  p_active integer
) returns integer
language sql
immutable
set search_path = ''
as $$
  select least(
    (p_base::bigint + greatest(p_active - p_included, 0)::bigint * p_per_customer::bigint),
    coalesce(p_cap::bigint, 9223372036854775807),
    2147483647
  )::integer;
$$;

revoke all on function private.bill_for_usage(integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function private.bill_for_usage(integer, integer, integer, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4. CHOOSE A PLAN (shop owner or platform admin)
--    The first choice applies to the current month. Later changes apply from next month,
--    so a shop cannot pick a cheaper plan after seeing a busy month. Platform admins may
--    apply a change immediately (p_immediate).
-- -----------------------------------------------------------------------------

create or replace function public.choose_billing_plan(
  p_actor uuid,
  p_tenant uuid,
  p_plan text,
  p_immediate boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_status text;
  v_tz text;
  v_month date;
  v_effective date;
  v_current text;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  v_is_admin := p_actor is not null and private.is_platform_admin(p_actor);

  if not v_is_admin and coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return 'unauthorized';
  end if;

  select tn.status, ts.timezone
  into v_status, v_tz
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant
  for update of tn;

  if not found then
    return 'not-found';
  end if;

  if v_status = 'closed' then
    return 'tenant-unavailable';
  end if;

  if not exists (
    select 1 from public.billing_plans as bp where bp.code = p_plan and bp.active = true
  ) then
    return 'invalid-plan';
  end if;

  v_month := pg_catalog.date_trunc('month', pg_catalog.now() at time zone v_tz)::date;

  select s.plan_code
  into v_current
  from public.tenant_plan_selections as s
  where s.tenant_id = p_tenant
    and s.effective_month <= v_month
  order by s.effective_month desc
  limit 1;

  if v_current = p_plan then
    -- Choosing the plan already in force also cancels a queued change to something else
    delete from public.tenant_plan_selections as s
    where s.tenant_id = p_tenant and s.effective_month > v_month;
    return 'unchanged';
  end if;

  v_effective := case
    when v_current is null or (v_is_admin and coalesce(p_immediate, false)) then v_month
    else (v_month + interval '1 month')::date
  end;

  -- One queued change at most: a newer choice replaces any later-dated one
  delete from public.tenant_plan_selections as s
  where s.tenant_id = p_tenant and s.effective_month > v_month;

  insert into public.tenant_plan_selections (tenant_id, effective_month, plan_code, chosen_by)
  values (p_tenant, v_effective, p_plan, p_actor)
  on conflict (tenant_id, effective_month)
  do update set plan_code = excluded.plan_code, chosen_by = excluded.chosen_by, created_at = pg_catalog.now();

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'billing_plan_chosen',
    p_plan,
    pg_catalog.jsonb_build_object('from', v_current, 'effective_month', v_effective, 'by_platform_admin', v_is_admin)
  );

  return 'updated';
end;
$$;

revoke all on function public.choose_billing_plan(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.choose_billing_plan(uuid, uuid, text, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 5. BILLING ESTIMATE (owner, manager or platform admin)
--    p_month is any date inside the month wanted; null = the current month in the shop's timezone.
--    Returns the plan in force that month, the active-customer count so far, the amount due,
--    and any queued plan change.
-- -----------------------------------------------------------------------------

create or replace function public.get_billing_estimate(
  p_actor uuid,
  p_tenant uuid,
  p_month date default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_status text;
  v_tz text;
  v_month date;
  v_from timestamptz;
  v_to timestamptz;
  v_plan public.billing_plans;
  v_active integer;
  v_base integer;
  v_extra integer;
  v_usage_fee integer;
  v_total integer;
  v_uncapped integer;
  v_next record;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  v_role := private.member_role(p_actor, p_tenant);
  if not (p_actor is not null and private.is_platform_admin(p_actor))
     and coalesce(v_role, '') not in ('owner', 'manager') then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  select tn.status, ts.timezone
  into v_status, v_tz
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'not-found');
  end if;

  v_month := pg_catalog.date_trunc('month', coalesce(p_month::timestamp, pg_catalog.now() at time zone v_tz))::date;
  v_from := v_month::timestamp at time zone v_tz;
  v_to := (v_month + interval '1 month')::timestamp at time zone v_tz;

  select count(distinct s.customer_id)::integer
  into v_active
  from public.stamps as s
  where s.tenant_id = p_tenant
    and s.created_at >= v_from
    and s.created_at < v_to;

  select bp.*
  into v_plan
  from public.tenant_plan_selections as sel
  join public.billing_plans as bp on bp.code = sel.plan_code
  where sel.tenant_id = p_tenant
    and sel.effective_month <= v_month
  order by sel.effective_month desc
  limit 1;

  select sel.plan_code, sel.effective_month
  into v_next
  from public.tenant_plan_selections as sel
  where sel.tenant_id = p_tenant
    and sel.effective_month > v_month
  order by sel.effective_month
  limit 1;

  if v_plan.code is null then
    return pg_catalog.jsonb_build_object(
      'result', 'ok',
      'month', v_month,
      'status', v_status,
      'plan', null,
      'activeCustomers', v_active,
      'pendingPlan', case when v_next.plan_code is null then null else
        pg_catalog.jsonb_build_object('code', v_next.plan_code, 'effectiveMonth', v_next.effective_month) end
    );
  end if;

  v_extra := greatest(v_active - v_plan.included_customers, 0);
  v_base := v_plan.base_fee_centavos;
  v_usage_fee := (v_extra::bigint * v_plan.per_customer_centavos)::integer;
  v_uncapped := v_base + v_usage_fee;
  v_total := private.bill_for_usage(
    v_plan.base_fee_centavos, v_plan.included_customers, v_plan.per_customer_centavos,
    v_plan.monthly_cap_centavos, v_active
  );

  return pg_catalog.jsonb_build_object(
    'result', 'ok',
    'month', v_month,
    'status', v_status,
    -- Trial shops are not billed; the figures show what the plan would cost
    'billed', v_status = 'active',
    'plan', pg_catalog.jsonb_build_object(
      'code', v_plan.code,
      'name', v_plan.name,
      'baseFeeCentavos', v_plan.base_fee_centavos,
      'includedCustomers', v_plan.included_customers,
      'perCustomerCentavos', v_plan.per_customer_centavos,
      'monthlyCapCentavos', v_plan.monthly_cap_centavos
    ),
    'activeCustomers', v_active,
    'extraCustomers', v_extra,
    'baseFeeCentavos', v_base,
    'usageFeeCentavos', v_usage_fee,
    'capApplied', v_total < v_uncapped,
    'totalCentavos', v_total,
    'pendingPlan', case when v_next.plan_code is null then null else
      pg_catalog.jsonb_build_object('code', v_next.plan_code, 'effectiveMonth', v_next.effective_month) end
  );
end;
$$;

revoke all on function public.get_billing_estimate(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.get_billing_estimate(uuid, uuid, date) to service_role;
