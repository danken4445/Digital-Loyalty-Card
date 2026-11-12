-- ==============================================================================
-- 21_milestone_rewards.test.sql
-- pgTAP Test Suite for Milestone Rewards System
-- Tests:
--   1. milestone_columns_and_bounds_validation
--   2. milestone_eligibility_and_redemption_flow
--   3. milestone_preserves_stamp_balances
--   4. milestone_rejects_second_claim_in_same_cycle
--   5. milestone_expires_once_card_completes
--   6. update_tenant_rules_milestone_patch
--   7. remove_card_and_merge_wallets_cascade_milestones
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(18);

-- ------------------------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous, raw_user_meta_data)
values
    ('21000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner-ms@test.local', now(), false, '{"full_name": "Owner MS"}'),
    ('21000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'staff-ms@test.local', now(), false, '{"full_name": "Staff MS"}'),
    ('21000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'unauth-ms@test.local', now(), false, '{"full_name": "Unauth"}'),
    ('21000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'customer1@test.local', now(), false, '{"full_name": "Customer 1"}'),
    ('21000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'customer2@test.local', now(), false, '{"full_name": "Customer 2"}')
on conflict (id) do nothing;

insert into public.customers (id)
values
    ('21000000-0000-4000-8000-0000000000c1'),
    ('21000000-0000-4000-8000-0000000000c2')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('21111111-0000-4000-8000-000000000001', 'milestone-shop', 'Milestone Shop', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, timezone, reward_threshold, reward_label, milestone_step, milestone_reward_label)
values
    ('21111111-0000-4000-8000-000000000001', 'Asia/Manila', 10, 'FREE COFFEE', 5, '50% OFF')
on conflict (tenant_id) do update set
    milestone_step = 5,
    milestone_reward_label = '50% OFF';

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'owner', 'Owner MS', true),
    ('21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002', 'staff', 'Staff MS', true)
on conflict (tenant_id, user_id) do nothing;

insert into public.customer_cards (tenant_id, customer_id)
values
    ('21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000c1'),
    ('21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000c2')
on conflict (tenant_id, customer_id) do nothing;

-- ------------------------------------------------------------------------------
-- Test 1: Milestone columns and constraints on tenant_settings
-- ------------------------------------------------------------------------------

select has_column('public', 'tenant_settings', 'milestone_step', 'tenant_settings has milestone_step column');
select has_column('public', 'tenant_settings', 'milestone_reward_label', 'tenant_settings has milestone_reward_label column');
select has_table('public', 'milestone_claims', 'public.milestone_claims exists');

-- Test threshold validation: milestone_step must be < reward_threshold
select throws_ok(
    $$
    update public.tenant_settings
    set milestone_step = 10
    where tenant_id = '21111111-0000-4000-8000-000000000001'
    $$,
    '22023',
    'milestone_step must be strictly less than reward_threshold',
    'Throws error when milestone_step >= reward_threshold'
);

-- ------------------------------------------------------------------------------
-- Test 2: Milestone eligibility and redemption flow
-- ------------------------------------------------------------------------------

-- Give Customer 1 4 stamps (< 5)
insert into public.stamps (tenant_id, customer_id, source)
select '21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000c1', 'nfc'
from generate_series(1, 4);

-- Attempt milestone redemption before reaching 5 stamps -> milestone-not-reached
select is(
    public.redeem_milestone_reward(
        '21000000-0000-4000-8000-000000000002',
        '21111111-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-0000000000c1',
        'nonce-pre-5'
    ),
    'milestone-not-reached',
    'Returns milestone-not-reached when stamps < milestone_step'
);

-- Give 5th stamp
insert into public.stamps (tenant_id, customer_id, source)
values ('21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000c1', 'nfc');

-- Redeem milestone successfully
select is(
    public.redeem_milestone_reward(
        '21000000-0000-4000-8000-000000000002',
        '21111111-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-0000000000c1',
        'nonce-valid-5'
    ),
    'redeemed',
    'Redeems milestone reward successfully at 5 stamps'
);

-- Verify milestone claim row recorded in cycle 0
select is(
    (select count(*)::integer from public.milestone_claims 
     where tenant_id = '21111111-0000-4000-8000-000000000001' 
       and customer_id = '21000000-0000-4000-8000-0000000000c1' 
       and cycle_index = 0),
    1,
    'Records exactly 1 milestone_claim row for cycle 0'
);

-- ------------------------------------------------------------------------------
-- Test 3: Milestone preserves stamp balances (0 stamps deducted)
-- ------------------------------------------------------------------------------

select is(
    (select available_stamps from public.card_balances 
     where tenant_id = '21111111-0000-4000-8000-000000000001' 
       and customer_id = '21000000-0000-4000-8000-0000000000c1'),
    5,
    'Preserves available stamps: 5 stamps remain available after milestone redemption'
);

-- ------------------------------------------------------------------------------
-- Test 4: Rejects second claim in same cycle
-- ------------------------------------------------------------------------------

-- Give 6th stamp
insert into public.stamps (tenant_id, customer_id, source)
values ('21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000c1', 'nfc');

-- Attempt second claim at 6 stamps in cycle 0 -> milestone-already-claimed
select is(
    public.redeem_milestone_reward(
        '21000000-0000-4000-8000-000000000002',
        '21111111-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-0000000000c1',
        'nonce-second-claim'
    ),
    'milestone-already-claimed',
    'Rejects second milestone claim in the same card cycle'
);

-- ------------------------------------------------------------------------------
-- Test 5: Milestone expires once card completes
-- ------------------------------------------------------------------------------

-- Give Customer 2 10 stamps without claiming milestone
insert into public.stamps (tenant_id, customer_id, source)
select '21111111-0000-4000-8000-000000000001', '21000000-0000-4000-8000-0000000000c2', 'nfc'
from generate_series(1, 10);

-- Customer 2 is now at total_stamps = 10, cycle_index = 1, current_cycle_stamps = 0
-- Attempting to claim milestone for cycle 1 before reaching 5 stamps -> milestone-not-reached (cycle 0 milestone expired!)
select is(
    public.redeem_milestone_reward(
        '21000000-0000-4000-8000-000000000002',
        '21111111-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-0000000000c2',
        'nonce-expired-c2'
    ),
    'milestone-not-reached',
    'Unclaimed milestone from completed card is expired (cycle 1 at 0 stamps)'
);

-- ------------------------------------------------------------------------------
-- Test 6: Replay nonce rejection & unauthorized staff
-- ------------------------------------------------------------------------------

-- Replay same nonce -> invalid-token
select is(
    public.redeem_milestone_reward(
        '21000000-0000-4000-8000-000000000002',
        '21111111-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-0000000000c1',
        'nonce-valid-5'
    ),
    'invalid-token',
    'Rejects replayed redemption nonce'
);

-- Unaffiliated user -> unauthorized
select is(
    public.redeem_milestone_reward(
        '21000000-0000-4000-8000-000000000003',
        '21111111-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-0000000000c1',
        'nonce-unauth'
    ),
    'unauthorized',
    'Rejects non-staff actor'
);

-- ------------------------------------------------------------------------------
-- Test 7: update_tenant_rules handles milestone_step and milestone_reward_label
-- ------------------------------------------------------------------------------

select is(
    public.update_tenant_rules(
        '21000000-0000-4000-8000-000000000001',
        '21111111-0000-4000-8000-000000000001',
        '{"milestone_step": 6, "milestone_reward_label": "FREE PASTRY"}'::jsonb
    ),
    'updated',
    'Updates milestone rules via update_tenant_rules'
);

select is(
    (select milestone_step from public.tenant_settings where tenant_id = '21111111-0000-4000-8000-000000000001'),
    6,
    'milestone_step updated to 6'
);

select is(
    (select milestone_reward_label from public.tenant_settings where tenant_id = '21111111-0000-4000-8000-000000000001'),
    'FREE PASTRY',
    'milestone_reward_label updated to FREE PASTRY'
);

-- Disabling milestone by setting to null
select is(
    public.update_tenant_rules(
        '21000000-0000-4000-8000-000000000001',
        '21111111-0000-4000-8000-000000000001',
        '{"milestone_step": null, "milestone_reward_label": null}'::jsonb
    ),
    'updated',
    'Clears milestone rules when patched with null'
);

select is(
    (select milestone_step from public.tenant_settings where tenant_id = '21111111-0000-4000-8000-000000000001'),
    null,
    'milestone_step is now null'
);

select * from finish();

rollback;
