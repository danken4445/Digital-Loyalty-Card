-- ==============================================================================
-- 05_instagram_follow_upsize_perk.test.sql
-- pgTAP Test Suite for the one-time Instagram follow upsize perk
-- Tests:
--   1. Schema & privilege hardening for public.perk_claims / claim_instagram_upsize
--   2. claim_instagram_upsize: unauthorized staff, unknown customer, first claim, repeat claim
--   3. Claims never spend stamps and are audit logged
--   4. merge_anonymous_customer carries claims over without duplicating them
--   5. delete_customer_data erases claims via cascade
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 0. Environment Setup & Plan
-- ------------------------------------------------------------------------------
create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(16);

insert into auth.users (id, aud, role, email)
values
    ('a5000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'ig-a@caffeineplug.ph'),
    ('b5000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'ig-b@caffeineplug.ph'),
    ('c5000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'ig-c@caffeineplug.ph'),
    ('d5000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', 'ig-d@caffeineplug.ph'),
    ('e5000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated', 'ig-staff@caffeineplug.ph')
on conflict (id) do nothing;

insert into public.customers (id)
values
    ('a5000000-0000-0000-0000-00000000000a'),
    ('b5000000-0000-0000-0000-00000000000b'),
    ('c5000000-0000-0000-0000-00000000000c'),
    ('d5000000-0000-0000-0000-00000000000d')
on conflict (id) do nothing;

insert into public.staff (user_id, display_name, role, active)
values ('e5000000-0000-0000-0000-00000000000e', 'IG Perk Staff Tester', 'staff', true)
on conflict (user_id) do update set active = true;

-- ==============================================================================
-- 1. Schema & Privileges (4 assertions)
-- ==============================================================================
select has_table('public', 'perk_claims', 'public.perk_claims exists');

select ok(
    not has_function_privilege('anon', 'public.claim_instagram_upsize(uuid, uuid)', 'execute'),
    'anon cannot execute claim_instagram_upsize'
);

select ok(
    not has_function_privilege('authenticated', 'public.claim_instagram_upsize(uuid, uuid)', 'execute'),
    'authenticated cannot execute claim_instagram_upsize'
);

select ok(
    has_function_privilege('service_role', 'public.claim_instagram_upsize(uuid, uuid)', 'execute'),
    'service_role can execute claim_instagram_upsize'
);

-- ==============================================================================
-- 2. Claim Outcomes (5 assertions)
-- ==============================================================================
select is(
    public.claim_instagram_upsize('a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-00000000000b'),
    'unauthorized',
    'non-staff caller is unauthorized'
);

select is(
    public.claim_instagram_upsize('f5000000-0000-0000-0000-00000000000f', 'e5000000-0000-0000-0000-00000000000e'),
    'invalid-token',
    'unknown customer returns invalid-token'
);

select is(
    public.claim_instagram_upsize('a5000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000e'),
    'redeemed',
    'first claim succeeds'
);

select is(
    public.claim_instagram_upsize('a5000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000e'),
    'already-claimed',
    'second claim on the same card is refused'
);

select is(
    (select count(*)::int from public.perk_claims where customer_id = 'a5000000-0000-0000-0000-00000000000a'),
    1,
    'exactly one perk claim row recorded'
);

-- ==============================================================================
-- 3. No Stamps Spent, Audit Logged, Unique Constraint (3 assertions)
-- ==============================================================================
select is(
    (select count(*)::int from public.redemptions where customer_id = 'a5000000-0000-0000-0000-00000000000a'),
    0,
    'claiming the upsize records no stamp redemption'
);

select ok(
    exists (
        select 1 from public.audit_log
        where action = 'claim_instagram_upsize'
          and target = 'a5000000-0000-0000-0000-00000000000a'
          and actor = 'e5000000-0000-0000-0000-00000000000e'
    ),
    'claim is audit logged against the staff member'
);

select throws_ok(
    $$ insert into public.perk_claims (customer_id, perk, staff_id)
       values ('a5000000-0000-0000-0000-00000000000a', 'instagram_follow_upsize', 'e5000000-0000-0000-0000-00000000000e') $$,
    '23505',
    null,
    'unique (customer_id, perk) blocks a duplicate claim row'
);

-- ==============================================================================
-- 4. Merge Carries Claims (3 assertions)
-- ==============================================================================
insert into public.perk_claims (customer_id, perk, staff_id)
values
    ('b5000000-0000-0000-0000-00000000000b', 'instagram_follow_upsize', 'e5000000-0000-0000-0000-00000000000e'),
    ('d5000000-0000-0000-0000-00000000000d', 'instagram_follow_upsize', 'e5000000-0000-0000-0000-00000000000e');

-- A and B both claimed: merging A into B keeps a single claim on B
select public.merge_anonymous_customer('a5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-00000000000b');

select is(
    (select count(*)::int from public.perk_claims where customer_id = 'b5000000-0000-0000-0000-00000000000b'),
    1,
    'merging two claimed cards leaves one claim on the target'
);

-- D claimed, C did not: merging D into C moves the claim
select public.merge_anonymous_customer('d5000000-0000-0000-0000-00000000000d', 'c5000000-0000-0000-0000-00000000000c');

select is(
    (select count(*)::int from public.perk_claims where customer_id = 'c5000000-0000-0000-0000-00000000000c'),
    1,
    'merging a claimed card into an unclaimed one moves the claim'
);

select is(
    (select (detail->>'perk_claims_moved')::int from public.audit_log
     where action = 'merge_anonymous_customer' and target = 'd5000000-0000-0000-0000-00000000000d'
     limit 1),
    1,
    'merge audit detail records perk_claims_moved'
);

-- ==============================================================================
-- 5. Erasure Cascades (1 assertion)
-- ==============================================================================
select public.delete_customer_data('c5000000-0000-0000-0000-00000000000c');

select is(
    (select count(*)::int from public.perk_claims where customer_id = 'c5000000-0000-0000-0000-00000000000c'),
    0,
    'delete_customer_data removes the customer''s perk claims'
);

-- ------------------------------------------------------------------------------
-- 6. Finish Test Suite & Rollback Transaction
-- ------------------------------------------------------------------------------
select * from finish();

rollback;
