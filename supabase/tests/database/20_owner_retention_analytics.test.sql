-- ==============================================================================
-- 20_owner_retention_analytics.test.sql
-- pgTAP Test Suite for Owner Retention & Loyalty Card Analytics
-- Tests:
--   1. owner_analytics_rejects_manager_staff_and_other_tenant_owner
--   2. empty_shop_returns_zero_safe_analytics
--   3. same_day_stamps_count_as_single_visit_day
--   4. retention_health_buckets_sum_to_total_cards
--   5. top_customers_resolves_names_and_masks_anonymous
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(24);

-- ------------------------------------------------------------------------------
-- Fixtures: Tenants, Owners, Managers, Staff, Customers
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous, raw_user_meta_data)
values
    ('20000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-a@test.local', now(), false, '{"full_name": "Owner A"}'),
    ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'manager-a@test.local', now(), false, '{"full_name": "Manager A"}'),
    ('20000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'staff-a@test.local', now(), false, '{"full_name": "Staff A"}'),
    ('20000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'owner-b@test.local', now(), false, '{"full_name": "Owner B"}'),
    ('20000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unaffiliated@test.local', now(), false, '{}'),
    -- Customers with different name metadata patterns
    ('20000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'google-full@test.local', now(), false, '{"full_name": "Marco Santos"}'),
    ('20000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'google-display@test.local', now(), false, '{"display_name": "Maria Clara"}'),
    ('20000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'juan.delacruz@test.local', now(), false, '{}'),
    ('20000000-0000-4000-8000-0000000000c4', 'authenticated', 'authenticated', null, null, true, '{}'),
    ('20000000-0000-4000-8000-0000000000c5', 'authenticated', 'authenticated', 'cust-multi@test.local', now(), false, '{"name": "Multi Day Reg"}')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('20111111-0000-4000-8000-000000000001', 'analytics-shop-a', 'Analytics Shop A', 'active'),
    ('20222222-0000-4000-8000-000000000002', 'analytics-shop-b', 'Analytics Shop B', 'active'),
    ('20333333-0000-4000-8000-000000000003', 'empty-shop', 'Empty Shop', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, timezone, reward_threshold, reward_label)
values
    ('20111111-0000-4000-8000-000000000001', 'Asia/Manila', 10, 'FREE COFFEE'),
    ('20222222-0000-4000-8000-000000000002', 'Asia/Manila', 10, 'FREE COFFEE'),
    ('20333333-0000-4000-8000-000000000003', 'Asia/Manila', 10, 'FREE COFFEE')
on conflict (tenant_id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner', 'Owner A', true),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'manager', 'Manager A', true),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'staff', 'Staff A', true),
    ('20222222-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004', 'owner', 'Owner B', true),
    ('20333333-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'owner', 'Owner A', true)
on conflict (tenant_id, user_id) do nothing;

-- ------------------------------------------------------------------------------
-- Test 1: owner_analytics_rejects_manager_staff_and_other_tenant_owner
-- ------------------------------------------------------------------------------

select is(
    public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000002'::uuid, -- Manager of Shop A
        '20111111-0000-4000-8000-000000000001'::uuid
    ),
    '{"result": "unauthorized"}'::jsonb,
    'manager cannot access get_owner_analytics'
);

select is(
    public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000003'::uuid, -- Staff of Shop A
        '20111111-0000-4000-8000-000000000001'::uuid
    ),
    '{"result": "unauthorized"}'::jsonb,
    'staff cannot access get_owner_analytics'
);

select is(
    public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000004'::uuid, -- Owner of Shop B
        '20111111-0000-4000-8000-000000000001'::uuid
    ),
    '{"result": "unauthorized"}'::jsonb,
    'owner of another tenant cannot access get_owner_analytics'
);

select is(
    public.get_owner_analytics(
        null,
        '20111111-0000-4000-8000-000000000001'::uuid
    ),
    '{"result": "unauthorized"}'::jsonb,
    'null actor is unauthorized'
);

-- ------------------------------------------------------------------------------
-- Test 2: empty_shop_returns_zero_safe_analytics
-- ------------------------------------------------------------------------------

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) ->> 'result'),
    'ok',
    'empty shop returns result = ok'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) -> 'pulse' ->> 'totalCards')::integer,
    0,
    'empty shop has 0 total cards'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) -> 'pulse' ->> 'repeatRate30dPct')::numeric,
    0.0::numeric,
    'empty shop has 0.0 repeat rate'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) -> 'pulse' ->> 'medianDaysBetweenVisits'),
    null,
    'empty shop has null medianDaysBetweenVisits'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) -> 'cardFunnel' ->> 'medianDaysToReward'),
    null,
    'empty shop has null medianDaysToReward'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) -> 'cohorts'),
    '[]'::jsonb,
    'empty shop has empty cohorts array'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20333333-0000-4000-8000-000000000003'::uuid
    ) -> 'topCustomers'),
    '[]'::jsonb,
    'empty shop has empty topCustomers array'
);

-- ------------------------------------------------------------------------------
-- Populate Shop A for Tests 3, 4, 5
-- ------------------------------------------------------------------------------

-- Ensure customers
insert into public.customers (id) values
    ('20000000-0000-4000-8000-0000000000c1'),
    ('20000000-0000-4000-8000-0000000000c2'),
    ('20000000-0000-4000-8000-0000000000c3'),
    ('20000000-0000-4000-8000-0000000000c4'),
    ('20000000-0000-4000-8000-0000000000c5')
on conflict (id) do nothing;

-- Add cards in Shop A
-- c1: added 20 days ago, last stamped 2 days ago (active regular: 3 distinct days)
-- c2: added 10 days ago, 2 stamps on the SAME DAY (same_day test customer)
-- c3: added 20 days ago, stamped 20 days ago, inactive since (at-risk)
-- c4: added 45 days ago, stamped 45 days ago, inactive since (dormant)
-- c5: added 2 days ago, 1 stamp yesterday (newFirstVisit)
insert into public.customer_cards (tenant_id, customer_id, added_at)
values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c1', '2026-10-18T08:00:00+08:00'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c2', '2026-10-28T08:00:00+08:00'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c3', '2026-10-18T08:00:00+08:00'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c4', '2026-09-23T08:00:00+08:00'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c5', '2026-11-05T08:00:00+08:00')
on conflict (tenant_id, customer_id) do nothing;

-- Insert stamps
-- c1: visits on Oct 18, Oct 25, Nov 5 (3 distinct days, 15 lifetime stamps, 1 redemption on Nov 5)
insert into public.stamps (tenant_id, customer_id, created_at, source) values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c1', '2026-10-18T09:00:00+08:00', 'nfc'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c1', '2026-10-25T10:00:00+08:00', 'nfc'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c1', '2026-11-05T14:00:00+08:00', 'nfc');

-- c2: 2 stamps on the SAME CALENDAR DAY (2026-10-28 at 09:00 and 15:00 Manila time)
insert into public.stamps (tenant_id, customer_id, created_at, source) values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c2', '2026-10-28T09:00:00+08:00', 'nfc'),
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c2', '2026-10-28T15:00:00+08:00', 'nfc');

-- c3: 1 stamp on Oct 18 (20 days ago)
insert into public.stamps (tenant_id, customer_id, created_at, source) values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c3', '2026-10-18T11:00:00+08:00', 'nfc');

-- c4: 1 stamp on Sep 23 (45 days ago)
insert into public.stamps (tenant_id, customer_id, created_at, source) values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c4', '2026-09-23T11:00:00+08:00', 'nfc');

-- c5: 1 stamp on Nov 6 (yesterday)
insert into public.stamps (tenant_id, customer_id, created_at, source) values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c5', '2026-11-06T11:00:00+08:00', 'nfc');

-- c1 redemption on Nov 5
insert into public.redemptions (tenant_id, customer_id, staff_id, stamps_used, created_at) values
    ('20111111-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-000000000003', 10, '2026-11-05T15:00:00+08:00');

-- Reference time: 2026-11-07 12:00:00+08:00
-- ------------------------------------------------------------------------------
-- Test 3: same_day_stamps_count_as_single_visit_day
-- ------------------------------------------------------------------------------

-- Customer c2 collected 2 stamps on 2026-10-28. They have 1 distinct visit day.
-- Only c1 has >= 2 distinct visit days (Oct 18, Oct 25, Nov 5).
-- Thus, of 5 stamped customers (c1, c2, c3, c4, c5), exactly 1 returned for a 2nd distinct visit day (c1).
-- c1's 2nd visit was Oct 25, which is 7 days from Oct 18 (<= 14d and <= 30d).
-- Repeat rate is 1 / 5 = 20.0%.

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'pulse' ->> 'repeatRate14dPct')::numeric,
    20.0::numeric,
    'repeatRate14dPct is 20.0% (same day stamps count as single visit day)'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'pulse' ->> 'repeatRate30dPct')::numeric,
    20.0::numeric,
    'repeatRate30dPct is 20.0%'
);

-- ------------------------------------------------------------------------------
-- Test 4: retention_health_buckets_sum_to_total_cards
-- ------------------------------------------------------------------------------
-- Total cards = 5
-- c1: >= 2 visit days, last stamped Nov 5 (<= 14d ago) -> activeRegulars (1)
-- c2: 1 visit day, last stamped Oct 28 (10d ago <= 14d ago) -> newFirstVisit (c2 is newFirstVisit, NOT activeRegulars!)
-- c5: 1 visit day, last stamped Nov 6 (1d ago <= 14d ago) -> newFirstVisit (total newFirstVisit = 2: c2, c5)
-- c3: last stamped Oct 18 (20d ago: between 14d and 30d ago) -> atRisk (1)
-- c4: last stamped Sep 23 (45d ago: > 30d ago) -> dormant (1)
-- Total = 1 + 2 + 1 + 1 = 5

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'retentionHealth' ->> 'activeRegulars')::integer,
    1,
    'activeRegulars count is 1'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'retentionHealth' ->> 'newFirstVisit')::integer,
    2,
    'newFirstVisit count is 2 (includes c2 with same-day stamps)'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'retentionHealth' ->> 'atRisk')::integer,
    1,
    'atRisk count is 1'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'retentionHealth' ->> 'dormant')::integer,
    1,
    'dormant count is 1'
);

select is(
    (
        ((public.get_owner_analytics(
            '20000000-0000-4000-8000-000000000001'::uuid,
            '20111111-0000-4000-8000-000000000001'::uuid,
            '2026-11-07T12:00:00+08:00'::timestamptz
        ) -> 'retentionHealth' ->> 'activeRegulars')::integer) +
        ((public.get_owner_analytics(
            '20000000-0000-4000-8000-000000000001'::uuid,
            '20111111-0000-4000-8000-000000000001'::uuid,
            '2026-11-07T12:00:00+08:00'::timestamptz
        ) -> 'retentionHealth' ->> 'newFirstVisit')::integer) +
        ((public.get_owner_analytics(
            '20000000-0000-4000-8000-000000000001'::uuid,
            '20111111-0000-4000-8000-000000000001'::uuid,
            '2026-11-07T12:00:00+08:00'::timestamptz
        ) -> 'retentionHealth' ->> 'atRisk')::integer) +
        ((public.get_owner_analytics(
            '20000000-0000-4000-8000-000000000001'::uuid,
            '20111111-0000-4000-8000-000000000001'::uuid,
            '2026-11-07T12:00:00+08:00'::timestamptz
        ) -> 'retentionHealth' ->> 'dormant')::integer)
    ),
    5,
    'retention health buckets sum to totalCards (5)'
);

-- ------------------------------------------------------------------------------
-- Test 5: top_customers_resolves_names_and_masks_anonymous
-- ------------------------------------------------------------------------------

-- c1 has 3 stamps (total_stamps = 3) -> rank 1, name = 'Marco Santos' (from full_name)
-- c2 has 2 stamps (total_stamps = 2) -> rank 2, name = 'Maria Clara' (from display_name)
-- c3 has 1 stamp (total_stamps = 1) -> rank 3, email = 'juan.delacruz@test.local' -> name = 'juan.delacruz'
-- c4 is anonymous -> name = 'Guest (Unbacked)'

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'topCustomers' -> 0 ->> 'customerName'),
    'Marco Santos',
    'rank 1 resolves full_name Marco Santos'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'topCustomers' -> 0 ->> 'cardCode'),
    '20000000',
    'rank 1 cardCode is upper 8-char hex'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'topCustomers' -> 0 ->> 'isBackedUp'),
    'true',
    'rank 1 isBackedUp is true'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'topCustomers' -> 1 ->> 'customerName'),
    'Maria Clara',
    'rank 2 resolves display_name Maria Clara'
);

select is(
    (public.get_owner_analytics(
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20111111-0000-4000-8000-000000000001'::uuid,
        '2026-11-07T12:00:00+08:00'::timestamptz
    ) -> 'topCustomers' -> 2 ->> 'customerName'),
    'juan.delacruz',
    'rank 3 resolves email username juan.delacruz without domain'
);

rollback;
