-- ==============================================================================
-- 18_billing_plans.test.sql
-- pgTAP Test Suite for flexible per-customer billing plans
--   1. Pricing arithmetic (private.bill_for_usage)
--   2. Choosing a plan (who may, first choice vs queued change, immediate override)
--   3. Estimates (active customers, included allowance, cap, tenant scoping, trial flag)
--   4. Row level security and function privileges
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(53);

-- ------------------------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('18000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'platform-admin@test.local'),
    ('18000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-a@test.local'),
    ('18000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'manager-a@test.local'),
    ('18000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'staff-a@test.local'),
    ('18000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'owner-b@test.local'),
    ('18000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'nobody@test.local'),
    ('18000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'cust-1@test.local'),
    ('18000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'cust-2@test.local'),
    ('18000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'cust-3@test.local'),
    ('18000000-0000-4000-8000-0000000000c4', 'authenticated', 'authenticated', 'cust-4@test.local'),
    ('18000000-0000-4000-8000-0000000000c5', 'authenticated', 'authenticated', 'cust-5@test.local')
on conflict (id) do nothing;

insert into public.platform_admins (user_id) values ('18000000-0000-4000-8000-000000000001');

insert into public.tenants (id, slug, name, status)
values
    ('18111111-0000-4000-8000-000000000001', 'bill-a', 'Billing A', 'active'),
    ('18222222-0000-4000-8000-000000000002', 'bill-b', 'Billing B', 'active'),
    ('18333333-0000-4000-8000-000000000003', 'bill-trial', 'Billing Trial', 'trial'),
    ('18444444-0000-4000-8000-000000000004', 'bill-closed', 'Billing Closed', 'closed');

insert into public.tenant_settings (tenant_id, timezone)
values
    ('18111111-0000-4000-8000-000000000001', 'Asia/Manila'),
    ('18222222-0000-4000-8000-000000000002', 'Asia/Manila'),
    ('18333333-0000-4000-8000-000000000003', 'Asia/Manila'),
    ('18444444-0000-4000-8000-000000000004', 'Asia/Manila');

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'owner', 'Owner A', true),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'manager', 'Manager A', true),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', 'staff', 'Staff A', true),
    ('18222222-0000-4000-8000-000000000002', '18000000-0000-4000-8000-000000000005', 'owner', 'Owner B', true),
    ('18333333-0000-4000-8000-000000000003', '18000000-0000-4000-8000-000000000002', 'owner', 'Owner A trial', true);

insert into public.customers (id)
values
    ('18000000-0000-4000-8000-0000000000c1'),
    ('18000000-0000-4000-8000-0000000000c2'),
    ('18000000-0000-4000-8000-0000000000c3'),
    ('18000000-0000-4000-8000-0000000000c4'),
    ('18000000-0000-4000-8000-0000000000c5');

insert into public.customer_cards (tenant_id, customer_id)
select t.id, c.id
from (values ('18111111-0000-4000-8000-000000000001'::uuid), ('18222222-0000-4000-8000-000000000002'::uuid)) as t(id)
cross join public.customers as c
where c.id::text like '18000000-%';

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_bill_a_0001', 'A Counter', true, '18111111-0000-4000-8000-000000000001'),
    ('tag_bill_b_0001', 'B Counter', true, '18222222-0000-4000-8000-000000000002');

-- Shop A, this month: customers 1-4 stamp (customer 1 twice). Customer 5 stamped only 40 days ago.
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
values
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000c1', 'tag_bill_a_0001', 'nfc', now()),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000c1', 'tag_bill_a_0001', 'nfc', now() - interval '1 second'),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000c2', 'tag_bill_a_0001', 'nfc', now()),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000c3', 'tag_bill_a_0001', 'nfc', now()),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000c4', 'tag_bill_a_0001', 'nfc', now()),
    ('18111111-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000c5', 'tag_bill_a_0001', 'nfc', now() - interval '40 days'),
    -- Shop B has its own activity that must not leak into A
    ('18222222-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c1', 'tag_bill_b_0001', 'nfc', now()),
    ('18222222-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c2', 'tag_bill_b_0001', 'nfc', now());

-- Test plans with small numbers so every branch is reachable with five customers
insert into public.billing_plans
  (code, name, base_fee_centavos, included_customers, per_customer_centavos, monthly_cap_centavos, active, sort_order)
values
    ('test-flat', 'Test flat', 10000, 2, 500, null, true, 900),
    ('test-capped', 'Test capped', 0, 0, 1000, 2500, true, 901),
    ('test-retired', 'Test retired', 0, 0, 1000, null, false, 902);

-- ==============================================================================
-- 1. Seed catalog and pricing arithmetic (9 assertions)
-- ==============================================================================

select is(
    (select count(*)::integer from public.billing_plans where code in ('pay-as-you-go', 'starter-50', 'growth-200', 'worry-free')),
    4,
    'seeded catalog has the four starting plans'
);
select is(
    (select count(*)::integer from public.billing_plans
     where active and code in ('pay-as-you-go', 'starter-50', 'growth-200', 'worry-free')
       and per_customer_centavos between 500 and 1000),
    4,
    'seeded plans charge PHP 5 to 10 per customer'
);
select is(private.bill_for_usage(0, 0, 1000, null, 0), 0, 'no customers on pay-as-you-go costs nothing');
select is(private.bill_for_usage(0, 0, 1000, null, 37), 37000, 'pay-as-you-go is per customer');
select is(private.bill_for_usage(35000, 50, 700, null, 50), 35000, 'allowance exactly used costs the base fee only');
select is(private.bill_for_usage(35000, 50, 700, null, 20), 35000, 'unused allowance is not refunded or reduced');
select is(private.bill_for_usage(35000, 50, 700, null, 60), 42000, 'customers beyond the allowance are charged per customer');
select is(private.bill_for_usage(0, 0, 800, 120000, 500), 120000, 'cap limits the monthly charge');
select is(private.bill_for_usage(0, 0, 100000, null, 100000), 2147483647, 'huge usage saturates instead of overflowing');

-- ==============================================================================
-- 2. Choosing a plan (16 assertions)
-- ==============================================================================

select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000006', '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'unauthorized', 'a non-member cannot choose a plan'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000004', '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'unauthorized', 'staff cannot choose a plan'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000003', '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'unauthorized', 'a manager cannot choose a plan'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000005', '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'unauthorized', 'the owner of another shop cannot choose a plan'
);
select is(
    public.choose_billing_plan(null, '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'unauthorized', 'a null actor is rejected'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001', 'no-such-plan'),
    'invalid-plan', 'an unknown plan is rejected'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001', 'test-retired'),
    'invalid-plan', 'a retired plan cannot be chosen'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000001', '18999999-0000-4000-8000-000000000009', 'test-flat'),
    'not-found', 'an unknown shop is reported as not found'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000001', '18444444-0000-4000-8000-000000000004', 'test-flat'),
    'tenant-unavailable', 'a closed shop cannot choose a plan'
);
select throws_ok(
    $$select public.choose_billing_plan('18000000-0000-4000-8000-000000000002', null, 'test-flat')$$,
    'P0001', 'p_tenant must not be null', 'a null tenant raises'
);

select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'updated', 'the owner makes a first choice'
);
select is(
    (select effective_month from public.tenant_plan_selections where tenant_id = '18111111-0000-4000-8000-000000000001'),
    date_trunc('month', now() at time zone 'Asia/Manila')::date,
    'a first choice applies to the current month'
);
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001', 'test-flat'),
    'unchanged', 'choosing the plan already in force changes nothing'
);

select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001', 'test-capped'),
    'updated', 'the owner switches plans'
);
select is(
    (select effective_month from public.tenant_plan_selections
     where tenant_id = '18111111-0000-4000-8000-000000000001' and plan_code = 'test-capped'),
    (date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month')::date,
    'a later change applies from next month'
);
select is(
    (select count(*)::integer from public.audit_log
     where tenant_id = '18111111-0000-4000-8000-000000000001' and action = 'billing_plan_chosen'),
    2,
    'each accepted choice is audited'
);

-- ==============================================================================
-- 3. Estimates (15 assertions)
-- ==============================================================================

select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000004', '18111111-0000-4000-8000-000000000001') ->> 'result',
    'unauthorized', 'staff cannot read billing'
);
select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000005', '18111111-0000-4000-8000-000000000001') ->> 'result',
    'unauthorized', 'the owner of another shop cannot read billing'
);
select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000001', '18999999-0000-4000-8000-000000000009') ->> 'result',
    'not-found', 'estimate for an unknown shop is not found'
);
select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000003', '18111111-0000-4000-8000-000000000001') ->> 'result',
    'ok', 'a manager can read billing'
);

select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') ->> 'activeCustomers')::integer,
    4, 'active customers are distinct stamped customers this month, for this shop only'
);
select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') #>> '{plan,code}',
    'test-flat', 'the queued change does not apply to the current month'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') ->> 'totalCentavos')::integer,
    11000, 'base 10000 + (4 active - 2 included) x 500'
);
select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') #>> '{pendingPlan,code}',
    'test-capped', 'the queued plan is reported'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') ->> 'billed')::boolean,
    true, 'an active shop is billed'
);

-- Next month the queued plan is in force: 4 x 1000 = 4000, capped at 2500
select is(
    public.get_billing_estimate(
        '18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001',
        (date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month')::date
    ) #>> '{plan,code}',
    'test-capped', 'the queued plan applies to next month'
);

-- Admin override makes the capped plan apply to this month
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000001', '18111111-0000-4000-8000-000000000001', 'test-capped', true),
    'updated', 'a platform admin applies a change immediately'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') ->> 'totalCentavos')::integer,
    2500, 'the cap limits the estimate'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001') ->> 'capApplied')::boolean,
    true, 'the estimate says when the cap applied'
);

-- A past month counts only that month's stamps (customer 5, 40 days ago)
select is(
    (public.get_billing_estimate(
        '18000000-0000-4000-8000-000000000002', '18111111-0000-4000-8000-000000000001',
        ((now() - interval '40 days') at time zone 'Asia/Manila')::date
    ) ->> 'activeCustomers')::integer,
    1, 'a past month counts only its own stamps'
);

-- Owner choosing the plan in force cancels nothing here (no queue left); trial and no-plan shops:
select is(
    public.choose_billing_plan('18000000-0000-4000-8000-000000000002', '18333333-0000-4000-8000-000000000003', 'test-flat'),
    'updated', 'a trial shop can choose a plan'
);

-- ==============================================================================
-- 4. No plan, trial flag, isolation (5 assertions)
-- ==============================================================================

select is(
    public.get_billing_estimate('18000000-0000-4000-8000-000000000005', '18222222-0000-4000-8000-000000000002') -> 'plan',
    'null'::jsonb, 'a shop with no plan reports plan null'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000005', '18222222-0000-4000-8000-000000000002') ->> 'activeCustomers')::integer,
    2, 'a shop with no plan still reports its own active customers'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18333333-0000-4000-8000-000000000003') ->> 'billed')::boolean,
    false, 'a trial shop is not billed'
);
select is(
    (public.get_billing_estimate('18000000-0000-4000-8000-000000000002', '18333333-0000-4000-8000-000000000003') ->> 'totalCentavos')::integer,
    10000, 'a trial shop still sees what the plan would cost'
);
select is(
    (select count(*)::integer from public.tenant_plan_selections where tenant_id = '18222222-0000-4000-8000-000000000002'),
    0, 'shop B has no selection from shop A activity'
);

-- ==============================================================================
-- 5. Access control (8 assertions)
-- ==============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"18000000-0000-4000-8000-000000000003","role":"authenticated"}';
set local "request.jwt.claim.sub" = '18000000-0000-4000-8000-000000000003';
set local "request.jwt.claim.role" = 'authenticated';

select ok(
    (select count(*) from public.tenant_plan_selections) >= 1,
    'a manager reads their shop plan history'
);
select is(
    (select count(*)::integer from public.tenant_plan_selections where tenant_id <> '18111111-0000-4000-8000-000000000001'),
    0, 'a manager never sees another shop plan history'
);
select is(
    (select count(*)::integer from public.billing_plans where code = 'test-retired'),
    0, 'retired plans are hidden from the catalog'
);
select ok(
    (select count(*) from public.billing_plans where active) >= 4,
    'active plans are readable by signed-in users'
);

set local "request.jwt.claims" = '{"sub":"18000000-0000-4000-8000-000000000004","role":"authenticated"}';
set local "request.jwt.claim.sub" = '18000000-0000-4000-8000-000000000004';

select is(
    (select count(*)::integer from public.tenant_plan_selections),
    0, 'staff cannot read plan history'
);
select throws_ok(
    $$select public.choose_billing_plan('18000000-0000-4000-8000-000000000004', '18111111-0000-4000-8000-000000000001', 'test-flat')$$,
    '42501', null, 'authenticated cannot call choose_billing_plan directly'
);
select throws_ok(
    $$select public.get_billing_estimate('18000000-0000-4000-8000-000000000004', '18111111-0000-4000-8000-000000000001')$$,
    '42501', null, 'authenticated cannot call get_billing_estimate directly'
);

reset role;
set local role anon;
select throws_ok(
    $$select count(*) from public.tenant_plan_selections$$,
    '42501', null, 'anon cannot read plan history'
);
reset role;

select * from finish();
rollback;
