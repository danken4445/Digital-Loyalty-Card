-- Migration: 20261113000000_platform_dashboard_and_invoices.sql
-- Description: Super Admin Dashboard overview, close tenant monitoring, and invoice generator.
--              Adds:
--              1. tenants.industry and tenants.billing_due_day columns
--              2. public.tenant_invoices table (with RLS for platform admin & shop owners)
--              3. public.platform_get_dashboard_overview RPC
--              4. public.platform_generate_invoice RPC
--              5. public.platform_update_invoice_status RPC
--              6. public.platform_list_invoices RPC

-- -----------------------------------------------------------------------------
-- 1. TENANT INDUSTRY & BILLING ANCHOR EXTENSIONS
-- -----------------------------------------------------------------------------

alter table public.tenants add column if not exists industry text not null default 'cafe';
alter table public.tenants add column if not exists billing_due_day integer not null default 5;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'tenants_industry_check'
  ) then
    alter table public.tenants
      add constraint tenants_industry_check
      check (industry in ('cafe', 'sports', 'barbershop', 'fitness', 'restaurant', 'car_service', 'retail', 'other'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'tenants_billing_due_day_check'
  ) then
    alter table public.tenants
      add constraint tenants_billing_due_day_check
      check (billing_due_day between 1 and 28);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. TENANT INVOICES TABLE
-- -----------------------------------------------------------------------------

create table if not exists public.tenant_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_month date not null check (billing_month = date_trunc('month', billing_month)::date),
  status text not null default 'issued' check (status in ('draft', 'issued', 'paid', 'void')),
  plan_code text null references public.billing_plans(code),
  plan_name text not null check (char_length(btrim(plan_name)) between 1 and 60),
  active_customers integer not null default 0 check (active_customers >= 0),
  included_customers integer not null default 0 check (included_customers >= 0),
  extra_customers integer not null default 0 check (extra_customers >= 0),
  base_fee_centavos integer not null default 0 check (base_fee_centavos >= 0),
  usage_fee_centavos integer not null default 0 check (usage_fee_centavos >= 0),
  adjustment_centavos integer not null default 0,
  total_centavos integer not null default 0 check (total_centavos >= 0),
  line_items jsonb not null default '[]'::jsonb,
  notes text null check (notes is null or char_length(notes) <= 1000),
  due_date date not null,
  issued_at timestamptz not null default now(),
  paid_at timestamptz null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tenant_invoices_month_unique unique (tenant_id, billing_month)
);

create index if not exists tenant_invoices_tenant_idx on public.tenant_invoices (tenant_id);
create index if not exists tenant_invoices_month_idx on public.tenant_invoices (billing_month);
create index if not exists tenant_invoices_status_idx on public.tenant_invoices (status);

alter table public.tenant_invoices enable row level security;

revoke all on table public.tenant_invoices from public, anon, authenticated;
grant select on table public.tenant_invoices to authenticated;
grant all on table public.tenant_invoices to service_role;

drop policy if exists tenant_invoices_select_policy on public.tenant_invoices;
create policy tenant_invoices_select_policy
  on public.tenant_invoices
  for select
  to authenticated
  using (
    tenant_id in (select private.manager_tenant_ids())
  );

-- -----------------------------------------------------------------------------
-- 3. INVOICE SEQUENCE GENERATOR (helper)
-- -----------------------------------------------------------------------------

create or replace function private.next_invoice_number(
  p_month date
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_count integer;
  v_candidate text;
begin
  v_prefix := 'ODC-' || to_char(coalesce(p_month, current_date), 'YYYYMM') || '-';
  select count(*)::integer into v_count
  from public.tenant_invoices
  where invoice_number like (v_prefix || '%');

  v_candidate := v_prefix || lpad((v_count + 1)::text, 4, '0');

  -- Ensure uniqueness in case of race condition or gaps
  while exists (select 1 from public.tenant_invoices where invoice_number = v_candidate) loop
    v_count := v_count + 1;
    v_candidate := v_prefix || lpad((v_count + 1)::text, 4, '0');
  end loop;

  return v_candidate;
end;
$$;

revoke all on function private.next_invoice_number(date) from public, anon, authenticated;
grant execute on function private.next_invoice_number(date) to service_role;

-- -----------------------------------------------------------------------------
-- 4. PLATFORM GENERATE INVOICE RPC
-- -----------------------------------------------------------------------------

create or replace function public.platform_generate_invoice(
  p_actor uuid,
  p_tenant uuid,
  p_month date,
  p_due_date date,
  p_adjustment_centavos integer default 0,
  p_line_items jsonb default '[]'::jsonb,
  p_notes text default null,
  p_status text default 'issued'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_status text;
  v_tz text;
  v_month date;
  v_from timestamptz;
  v_to timestamptz;
  v_due_date date;
  v_plan public.billing_plans;
  v_active integer;
  v_extra integer;
  v_base integer;
  v_usage_fee integer;
  v_uncapped integer;
  v_total_plan integer;
  v_final_total integer;
  v_invoice_num text;
  v_invoice_id uuid;
  v_line_items jsonb;
  v_invoice_status text;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  v_is_admin := p_actor is not null and private.is_platform_admin(p_actor);
  if not v_is_admin then
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

  v_month := date_trunc('month', coalesce(p_month, now() at time zone v_tz))::date;
  v_from := v_month::timestamp at time zone v_tz;
  v_to := (v_month + interval '1 month')::timestamp at time zone v_tz;

  v_due_date := coalesce(p_due_date, (v_month + interval '1 month' + interval '4 days')::date);

  v_invoice_status := coalesce(nullif(btrim(p_status), ''), 'issued');
  if v_invoice_status not in ('draft', 'issued', 'paid', 'void') then
    v_invoice_status := 'issued';
  end if;

  -- 1. Count active billable customers in this month
  select count(distinct s.customer_id)::integer
  into v_active
  from public.stamps as s
  where s.tenant_id = p_tenant
    and s.created_at >= v_from
    and s.created_at < v_to;

  -- 2. Lookup plan in force
  select bp.*
  into v_plan
  from public.tenant_plan_selections as sel
  join public.billing_plans as bp on bp.code = sel.plan_code
  where sel.tenant_id = p_tenant
    and sel.effective_month <= v_month
  order by sel.effective_month desc
  limit 1;

  if v_plan.code is null then
    -- Fallback to default pay-as-you-go if none chosen
    select bp.* into v_plan from public.billing_plans as bp where bp.code = 'pay-as-you-go';
  end if;

  v_base := coalesce(v_plan.base_fee_centavos, 0);
  v_extra := greatest(coalesce(v_active, 0) - coalesce(v_plan.included_customers, 0), 0);
  v_usage_fee := (v_extra::bigint * coalesce(v_plan.per_customer_centavos, 0)::bigint)::integer;
  v_uncapped := v_base + v_usage_fee;

  v_total_plan := private.bill_for_usage(
    v_plan.base_fee_centavos,
    v_plan.included_customers,
    v_plan.per_customer_centavos,
    v_plan.monthly_cap_centavos,
    v_active
  );

  v_final_total := greatest(0, v_total_plan + coalesce(p_adjustment_centavos, 0));
  v_line_items := coalesce(p_line_items, '[]'::jsonb);

  -- 3. Upsert invoice for (tenant_id, billing_month)
  select id, invoice_number into v_invoice_id, v_invoice_num
  from public.tenant_invoices
  where tenant_id = p_tenant and billing_month = v_month;

  if v_invoice_id is not null then
    update public.tenant_invoices
    set status = v_invoice_status,
        plan_code = v_plan.code,
        plan_name = v_plan.name,
        active_customers = v_active,
        included_customers = v_plan.included_customers,
        extra_customers = v_extra,
        base_fee_centavos = v_base,
        usage_fee_centavos = v_usage_fee,
        adjustment_centavos = coalesce(p_adjustment_centavos, 0),
        total_centavos = v_final_total,
        line_items = v_line_items,
        notes = p_notes,
        due_date = v_due_date,
        paid_at = case when v_invoice_status = 'paid' then coalesce(paid_at, now()) else null end
    where id = v_invoice_id;

    insert into public.audit_log (tenant_id, actor, action, target, detail)
    values (
      p_tenant,
      p_actor,
      'platform_invoice_updated',
      v_invoice_num,
      pg_catalog.jsonb_build_object(
        'invoice_id', v_invoice_id,
        'billing_month', v_month,
        'total_centavos', v_final_total,
        'status', v_invoice_status
      )
    );

    return pg_catalog.jsonb_build_object(
      'result', 'updated',
      'invoiceId', v_invoice_id,
      'invoiceNumber', v_invoice_num,
      'totalCentavos', v_final_total
    );
  else
    v_invoice_num := private.next_invoice_number(v_month);
    v_invoice_id := gen_random_uuid();

    insert into public.tenant_invoices (
      id, invoice_number, tenant_id, billing_month, status,
      plan_code, plan_name, active_customers, included_customers, extra_customers,
      base_fee_centavos, usage_fee_centavos, adjustment_centavos, total_centavos,
      line_items, notes, due_date, issued_at, paid_at, created_by
    ) values (
      v_invoice_id, v_invoice_num, p_tenant, v_month, v_invoice_status,
      v_plan.code, v_plan.name, v_active, v_plan.included_customers, v_extra,
      v_base, v_usage_fee, coalesce(p_adjustment_centavos, 0), v_final_total,
      v_line_items, p_notes, v_due_date, now(),
      case when v_invoice_status = 'paid' then now() else null end,
      p_actor
    );

    insert into public.audit_log (tenant_id, actor, action, target, detail)
    values (
      p_tenant,
      p_actor,
      'platform_invoice_generated',
      v_invoice_num,
      pg_catalog.jsonb_build_object(
        'invoice_id', v_invoice_id,
        'billing_month', v_month,
        'total_centavos', v_final_total,
        'status', v_invoice_status
      )
    );

    return pg_catalog.jsonb_build_object(
      'result', 'created',
      'invoiceId', v_invoice_id,
      'invoiceNumber', v_invoice_num,
      'totalCentavos', v_final_total
    );
  end if;
end;
$$;

revoke all on function public.platform_generate_invoice(uuid, uuid, date, date, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.platform_generate_invoice(uuid, uuid, date, date, integer, jsonb, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. PLATFORM UPDATE INVOICE STATUS RPC
-- -----------------------------------------------------------------------------

create or replace function public.platform_update_invoice_status(
  p_actor uuid,
  p_invoice uuid,
  p_status text,
  p_reason text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_curr_status text;
  v_inv_num text;
begin
  if p_invoice is null then
    return 'not-found';
  end if;

  if not (p_actor is not null and private.is_platform_admin(p_actor)) then
    return 'unauthorized';
  end if;

  if p_status not in ('draft', 'issued', 'paid', 'void') then
    return 'invalid-status';
  end if;

  select tenant_id, status, invoice_number
  into v_tenant, v_curr_status, v_inv_num
  from public.tenant_invoices
  where id = p_invoice
  for update;

  if not found then
    return 'not-found';
  end if;

  update public.tenant_invoices
  set status = p_status,
      paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else null end
  where id = p_invoice;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    v_tenant,
    p_actor,
    'platform_invoice_status_changed',
    v_inv_num,
    pg_catalog.jsonb_build_object('from', v_curr_status, 'to', p_status, 'reason', p_reason)
  );

  return 'updated';
end;
$$;

revoke all on function public.platform_update_invoice_status(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.platform_update_invoice_status(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. PLATFORM LIST INVOICES RPC
-- -----------------------------------------------------------------------------

create or replace function public.platform_list_invoices(
  p_actor uuid,
  p_tenant uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_res jsonb;
begin
  if not (p_actor is not null and private.is_platform_admin(p_actor)) then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'invoiceNumber', i.invoice_number,
        'tenantId', i.tenant_id,
        'tenantName', t.name,
        'tenantSlug', t.slug,
        'billingMonth', to_char(i.billing_month, 'YYYY-MM-DD'),
        'status', i.status,
        'planCode', i.plan_code,
        'planName', i.plan_name,
        'activeCustomers', i.active_customers,
        'includedCustomers', i.included_customers,
        'extraCustomers', i.extra_customers,
        'baseFeeCentavos', i.base_fee_centavos,
        'usageFeeCentavos', i.usage_fee_centavos,
        'adjustmentCentavos', i.adjustment_centavos,
        'totalCentavos', i.total_centavos,
        'lineItems', i.line_items,
        'notes', i.notes,
        'dueDate', to_char(i.due_date, 'YYYY-MM-DD'),
        'issuedAt', i.issued_at,
        'paidAt', i.paid_at,
        'createdAt', i.created_at
      )
      order by i.issued_at desc
    ),
    '[]'::jsonb
  )
  into v_res
  from public.tenant_invoices as i
  join public.tenants as t on t.id = i.tenant_id
  where (p_tenant is null or i.tenant_id = p_tenant);

  return pg_catalog.jsonb_build_object('result', 'ok', 'invoices', v_res);
end;
$$;

revoke all on function public.platform_list_invoices(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_list_invoices(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. PLATFORM GET DASHBOARD OVERVIEW RPC
-- -----------------------------------------------------------------------------

create or replace function public.platform_get_dashboard_overview(
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_now timestamptz := clock_timestamp();
  v_current_month date := date_trunc('month', v_now)::date;
  v_last_month date := (date_trunc('month', v_now) - interval '1 month')::date;
  v_current_month_start timestamptz := v_current_month::timestamp at time zone 'Asia/Manila';
  v_last_month_start timestamptz := v_last_month::timestamp at time zone 'Asia/Manila';

  -- Executive KPI aggregates
  v_total_tenants integer := 0;
  v_active_tenants integer := 0;
  v_trial_tenants integer := 0;
  v_suspended_tenants integer := 0;
  v_total_cards integer := 0;
  v_active_customers_30d integer := 0;
  v_utilization_rate numeric := 0;
  v_monthly_stamps integer := 0;
  v_last_month_stamps integer := 0;
  v_stamps_mom_pct numeric := 0;
  v_monthly_redemptions integer := 0;
  v_monthly_revenue_centavos bigint := 0;
  v_last_month_revenue_centavos bigint := 0;
  v_revenue_mom_pct numeric := 0;
  v_unpaid_invoices_count integer := 0;
  v_due_soon_count integer := 0;

  v_industries jsonb := '{}'::jsonb;
  v_tenants_json jsonb := '[]'::jsonb;
begin
  v_is_admin := p_actor is not null and private.is_platform_admin(p_actor);
  if not v_is_admin then
    return jsonb_build_object('result', 'unauthorized');
  end if;

  -- 1. High level tenant count stats
  select
    count(*)::integer,
    count(*) filter (where status = 'active')::integer,
    count(*) filter (where status = 'trial')::integer,
    count(*) filter (where status = 'suspended')::integer
  into v_total_tenants, v_active_tenants, v_trial_tenants, v_suspended_tenants
  from public.tenants;

  -- 2. Total wallet cards across the platform
  select count(*)::integer into v_total_cards from public.customer_cards;

  -- 3. Active customers across platform in last 30 days
  select count(distinct customer_id)::integer
  into v_active_customers_30d
  from public.stamps
  where created_at >= (v_now - interval '30 days');

  if v_total_cards > 0 then
    v_utilization_rate := round((v_active_customers_30d::numeric / v_total_cards::numeric) * 100, 1);
  else
    v_utilization_rate := 0;
  end if;

  -- 4. Monthly stamps & MoM delta
  select count(*)::integer into v_monthly_stamps
  from public.stamps
  where created_at >= v_current_month_start;

  select count(*)::integer into v_last_month_stamps
  from public.stamps
  where created_at >= v_last_month_start and created_at < v_current_month_start;

  if v_last_month_stamps > 0 then
    v_stamps_mom_pct := round(((v_monthly_stamps::numeric - v_last_month_stamps::numeric) / v_last_month_stamps::numeric) * 100, 1);
  elsif v_monthly_stamps > 0 then
    v_stamps_mom_pct := 100.0;
  else
    v_stamps_mom_pct := 0;
  end if;

  -- 5. Monthly redemptions
  select count(*)::integer into v_monthly_redemptions
  from public.redemptions
  where created_at >= v_current_month_start;

  -- 6. Unpaid invoices count
  select count(*)::integer into v_unpaid_invoices_count
  from public.tenant_invoices
  where status = 'issued';

  -- 7. Industries distribution breakdown
  select jsonb_object_agg(industry, count)
  into v_industries
  from (
    select industry, count(*)::integer as count
    from public.tenants
    group by industry
  ) as ind;

  -- 8. Build enriched per-tenant rows
  with tenant_stats as (
    select
      t.id as tenant_id,
      t.slug,
      t.name,
      t.industry,
      t.status,
      t.created_at,
      t.suspended_at,
      t.billing_due_day,
      ts.timezone,
      ts.milestone_step,
      ts.brand,
      -- Primary owner email
      coalesce(
        (select u.email from public.tenant_members tm join auth.users u on u.id = tm.user_id where tm.tenant_id = t.id and tm.role = 'owner' and tm.active = true order by tm.created_at asc limit 1),
        (select inv.email from public.tenant_invites inv where inv.tenant_id = t.id and inv.role = 'owner' order by inv.created_at asc limit 1),
        'N/A'
      ) as owner_email,
      -- Active plan
      coalesce(bp.code, 'pay-as-you-go') as plan_code,
      coalesce(bp.name, 'Pay as you go') as plan_name,
      coalesce(bp.base_fee_centavos, 0) as plan_base_fee,
      coalesce(bp.included_customers, 0) as plan_included_customers,
      coalesce(bp.per_customer_centavos, 1000) as plan_per_customer,
      bp.monthly_cap_centavos as plan_monthly_cap,
      -- Card count
      coalesce((select count(*)::integer from public.customer_cards cc where cc.tenant_id = t.id), 0) as total_cards,
      -- Active stamped customers this month
      coalesce((select count(distinct s.customer_id)::integer from public.stamps s where s.tenant_id = t.id and s.created_at >= v_current_month_start), 0) as active_customers_month,
      -- Stamps last 7 days
      coalesce((select count(*)::integer from public.stamps s where s.tenant_id = t.id and s.created_at >= (v_now - interval '7 days')), 0) as stamps_7d,
      -- Last stamp
      (select max(s.created_at) from public.stamps s where s.tenant_id = t.id) as last_stamp_at,
      -- Active tags count
      coalesce((select count(*)::integer from public.tags tg where tg.tenant_id = t.id and tg.active = true), 0) as active_tags_count,
      -- Branch locations count
      coalesce((select count(*)::integer from public.locations loc where loc.tenant_id = t.id and loc.active = true), 0) as locations_count,
      -- Latest invoice for current cycle
      (
        select jsonb_build_object(
          'id', inv.id,
          'invoiceNumber', inv.invoice_number,
          'status', inv.status,
          'totalCentavos', inv.total_centavos,
          'dueDate', to_char(inv.due_date, 'YYYY-MM-DD')
        )
        from public.tenant_invoices inv
        where inv.tenant_id = t.id
        order by inv.billing_month desc, inv.created_at desc
        limit 1
      ) as latest_invoice
    from public.tenants t
    join public.tenant_settings ts on ts.tenant_id = t.id
    left join lateral (
      select plan_code from public.tenant_plan_selections sel
      where sel.tenant_id = t.id and sel.effective_month <= v_current_month
      order by sel.effective_month desc limit 1
    ) curr_plan on true
    left join public.billing_plans bp on bp.code = curr_plan.plan_code
  ),
  computed_tenants as (
    select
      ts.*,
      -- Estimated bill calculation
      private.bill_for_usage(
        ts.plan_base_fee,
        ts.plan_included_customers,
        ts.plan_per_customer,
        ts.plan_monthly_cap,
        ts.active_customers_month
      ) as estimated_bill_centavos,
      -- Billing cycle due date for current month
      (v_current_month + (ts.billing_due_day - 1) * interval '1 day')::date as calculated_due_date,
      -- Days until due date
      ((v_current_month + (ts.billing_due_day - 1) * interval '1 day')::date - current_date)::integer as days_until_due
    from tenant_stats ts
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ct.tenant_id,
        'slug', ct.slug,
        'name', ct.name,
        'industry', ct.industry,
        'status', ct.status,
        'createdAt', ct.created_at,
        'suspendedAt', ct.suspended_at,
        'ownerEmail', ct.owner_email,
        'billingDueDay', ct.billing_due_day,
        'planCode', ct.plan_code,
        'planName', ct.plan_name,
        'totalCards', ct.total_cards,
        'activeCustomersThisMonth', ct.active_customers_month,
        'stamps7d', ct.stamps_7d,
        'lastStampAt', ct.last_stamp_at,
        'estimatedBillCentavos', ct.estimated_bill_centavos,
        'capabilitiesCount', (
          (case when ct.active_tags_count > 0 then 1 else 0 end) +
          (case when ct.locations_count > 1 then 1 else 0 end) +
          (case when ct.milestone_step is not null then 1 else 0 end) +
          (case when (ct.brand->>'socialRewardEnabled')::boolean is true then 1 else 0 end) +
          (case when ct.brand->>'primaryColor' is not null then 1 else 0 end) +
          (case when ct.plan_code is not null then 1 else 0 end)
        ),
        'activeFlags', (
          select coalesce(jsonb_agg(flag), '[]'::jsonb)
          from (
            select 'NFC Tags Active' as flag where ct.active_tags_count > 0
            union all
            select 'Multi-Branch' as flag where ct.locations_count > 1
            union all
            select 'Milestone Reward' as flag where ct.milestone_step is not null
            union all
            select 'Social Perk' as flag where (ct.brand->>'socialRewardEnabled')::boolean is true
            union all
            select 'Custom Branding' as flag where ct.brand->>'primaryColor' is not null
            union all
            select 'Selected Plan' as flag where ct.plan_code is not null
          ) f
        ),
        'dueDate', to_char(ct.calculated_due_date, 'YYYY-MM-DD'),
        'daysUntilDue', ct.days_until_due,
        'isDueSoon', (ct.status = 'active' and ct.days_until_due between 0 and 5 and coalesce((ct.latest_invoice->>'status'), '') <> 'paid'),
        'isOverdue', (ct.status = 'active' and (ct.days_until_due < 0 or coalesce((ct.latest_invoice->>'status'), '') = 'issued') and coalesce((ct.latest_invoice->>'status'), '') <> 'paid'),
        'billingBadge', case
          when ct.status = 'trial' then 'trial'
          when coalesce((ct.latest_invoice->>'status'), '') = 'paid' then 'paid'
          when ct.days_until_due < 0 then 'overdue'
          when ct.days_until_due between 0 and 5 then 'due_soon'
          else 'current'
        end,
        'latestInvoice', ct.latest_invoice,
        'hasTagLeakAlert', false
      )
      order by ct.created_at desc
    ),
    '[]'::jsonb
  )
  into v_tenants_json
  from computed_tenants ct;

  -- 9. Sum up monthly revenue estimates + invoices
  select coalesce(sum(
    case
      when (t->>'status') = 'active' then coalesce((t->>'estimatedBillCentavos')::bigint, 0)
      else 0
    end
  ), 0)
  into v_monthly_revenue_centavos
  from jsonb_array_elements(v_tenants_json) as t;

  -- Count how many are due soon
  select count(*)::integer into v_due_soon_count
  from jsonb_array_elements(v_tenants_json) as t
  where (t->>'isDueSoon')::boolean = true or (t->>'isOverdue')::boolean = true;

  -- Prior month revenue from tenant_invoices
  select coalesce(sum(total_centavos), 0)::bigint
  into v_last_month_revenue_centavos
  from public.tenant_invoices
  where billing_month = v_last_month and status in ('issued', 'paid');

  if v_last_month_revenue_centavos > 0 then
    v_revenue_mom_pct := round(((v_monthly_revenue_centavos::numeric - v_last_month_revenue_centavos::numeric) / v_last_month_revenue_centavos::numeric) * 100, 1);
  elsif v_monthly_revenue_centavos > 0 then
    v_revenue_mom_pct := 100.0;
  else
    v_revenue_mom_pct := 0;
  end if;

  return jsonb_build_object(
    'result', 'ok',
    'kpis', jsonb_build_object(
      'activeTenants', v_active_tenants,
      'trialTenants', v_trial_tenants,
      'suspendedTenants', v_suspended_tenants,
      'totalTenants', v_total_tenants,
      'totalCards', v_total_cards,
      'activeCustomers30d', v_active_customers_30d,
      'utilizationRatePct', v_utilization_rate,
      'monthlyStamps', v_monthly_stamps,
      'lastMonthStamps', v_last_month_stamps,
      'stampsMoMDeltaPct', v_stamps_mom_pct,
      'monthlyRedemptions', v_monthly_redemptions,
      'monthlyRevenueCentavos', v_monthly_revenue_centavos,
      'lastMonthRevenueCentavos', v_last_month_revenue_centavos,
      'revenueMoMDeltaPct', v_revenue_mom_pct,
      'unpaidInvoicesCount', v_unpaid_invoices_count,
      'dueSoonCount', v_due_soon_count
    ),
    'industries', coalesce(v_industries, '{}'::jsonb),
    'tenants', v_tenants_json
  );
end;
$$;

revoke all on function public.platform_get_dashboard_overview(uuid) from public, anon, authenticated;
grant execute on function public.platform_get_dashboard_overview(uuid) to service_role;
