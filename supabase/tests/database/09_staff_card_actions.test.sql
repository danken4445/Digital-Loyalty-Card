-- ==============================================================================
-- 09_staff_card_actions.test.sql
-- pgTAP Test Suite for Phase 11 Tenant-Checked Staff Actions
-- Tests:
--   1. Manual stamps need a membership in the tenant and a card there
--   2. Staff with two memberships cannot cross tenants
--   3. Redemption uses each tenant's own balance and current threshold
--   4. Single-use nonces, suspended and closed tenants
--   5. Perks must be configured for the tenant; inactive members are refused
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(26);

-- Additional tenants are blocked in production until Phase 12; tests opt in.
select set_config('app.allow_multi_tenant', 'on', true);

-- ------------------------------------------------------------------------------
-- Shared fixtures: tenant A = tenant #1, tenant B = bean-there (threshold 8, no perks)
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('5a000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'staff-a@test.local'),
    ('5b000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'staff-b@test.local'),
    ('5d000000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'dual-staff@test.local'),
    ('ca000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'cust-a@test.local'),
    ('cb000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'cust-b@test.local'),
    ('cc000000-0000-4000-8000-0000000000ab', 'authenticated', 'authenticated', 'cust-ab@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-00000000000b', 'bean-there', 'Bean There', 'active');

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone)
values ('7c1f0000-0000-4000-8000-00000000000b', 60, 1, 8, 5, 'Asia/Tokyo');

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('7c1f0000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-00000000000a', 'staff', 'Staff A', true),
    ('7c1f0000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-00000000000b', 'staff', 'Staff B', true),
    ('7c1f0000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-00000000000d', 'staff', 'Dual Staff', true),
    ('7c1f0000-0000-4000-8000-00000000000b', '5d000000-0000-4000-8000-00000000000d', 'staff', 'Dual Staff', true);

insert into public.customers (id)
values
    ('ca000000-0000-4000-8000-00000000000a'),
    ('cb000000-0000-4000-8000-00000000000b'),
    ('cc000000-0000-4000-8000-0000000000ab');

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b'),
    ('7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab');

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_tenant_a_0001', 'Tenant A Counter', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('tag_tenant_b_0001', 'Tenant B Counter', true, '7c1f0000-0000-4000-8000-00000000000b');

-- ==============================================================================
-- 1. Manual stamps (6 assertions)
-- ==============================================================================

select is(
    public.stamp_card_manual('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-000000000001',
                             'ca000000-0000-4000-8000-00000000000a', 'Forgot phone'),
    'unauthorized',
    'manual_stamp_requires_membership: tenant B staff cannot stamp at tenant A'
);

select is(
    (select count(*) from public.stamps where customer_id = 'ca000000-0000-4000-8000-00000000000a'),
    0::bigint,
    'manual_stamp_requires_membership: no stamp was written'
);

select is(
    public.stamp_card_manual('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                             'cb000000-0000-4000-8000-00000000000b', 'Forgot phone'),
    'no-card',
    'manual_stamp_requires_card_in_tenant: customer has no tenant A card'
);

select is(
    public.stamp_card_manual('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                             'ca000000-0000-4000-8000-00000000000a', 'Forgot phone', '2026-11-04 10:00:00+08'),
    'stamped',
    'Tenant A staff can manually stamp a tenant A card'
);

select is(
    (select count(*) from public.audit_log
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
       and action = 'manual_stamp'
       and target = 'ca000000-0000-4000-8000-00000000000a'),
    1::bigint,
    'The manual stamp is audited under tenant A'
);

select throws_ok(
    $$select public.stamp_card_manual('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                                      'ca000000-0000-4000-8000-00000000000a', '   ')$$,
    'P0001',
    'invalid manual stamp reason',
    'A blank reason is rejected'
);

-- ==============================================================================
-- 2. dual_member_cannot_cross_tenants (3 assertions)
-- ==============================================================================

select is(
    public.stamp_card_manual('5d000000-0000-4000-8000-00000000000d', '7c1f0000-0000-4000-8000-000000000001',
                             'cb000000-0000-4000-8000-00000000000b', 'Forgot phone'),
    'no-card',
    'dual_member_cannot_cross_tenants: manual stamp acting for A on a B-only customer'
);

select is(
    public.redeem_card_reward('5d000000-0000-4000-8000-00000000000d', '7c1f0000-0000-4000-8000-000000000001',
                              'cb000000-0000-4000-8000-00000000000b', 'nonce-dual-0001'),
    'no-card',
    'dual_member_cannot_cross_tenants: redemption acting for A on a B-only customer'
);

select is(
    (select count(*) from public.stamps where customer_id = 'cb000000-0000-4000-8000-00000000000b')
      + (select count(*) from public.redemptions where customer_id = 'cb000000-0000-4000-8000-00000000000b'),
    0::bigint,
    'dual_member_cannot_cross_tenants: nothing was written for the B-only customer'
);

-- ==============================================================================
-- 3. Per-tenant balances and thresholds (6 assertions)
-- ==============================================================================

-- 8 tenant B stamps for custAB
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_b_0001', 'nfc',
       '2026-10-01 00:00:00+09'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 8) as g;

select is(
    public.redeem_card_reward('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                              'cc000000-0000-4000-8000-0000000000ab', 'nonce-b-0002'),
    'redeemed',
    'redeem_threshold_per_tenant: 8 stamps reach tenant B''s threshold of 8'
);

select is(
    (select stamps_used from public.redemptions
     where tenant_id = '7c1f0000-0000-4000-8000-00000000000b'
       and customer_id = 'cc000000-0000-4000-8000-0000000000ab'),
    8,
    'redeem_threshold_per_tenant: the redemption uses tenant B''s threshold'
);

-- 8 tenant A stamps for custAB
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_a_0001', 'nfc',
       '2026-10-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 8) as g;

select is(
    public.redeem_card_reward('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                              'cc000000-0000-4000-8000-0000000000ab', 'nonce-a-0003'),
    'insufficient-stamps',
    'redeem_threshold_per_tenant: 8 stamps do not reach tenant A''s threshold of 10'
);

-- 2 more tenant A stamps: A balance 10, B balance 0
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_a_0001', 'nfc',
       '2026-10-20 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 2) as g;

select is(
    public.redeem_card_reward('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                              'cc000000-0000-4000-8000-0000000000ab', 'nonce-b-0004'),
    'insufficient-stamps',
    'redeem_balance_is_per_tenant: 10 stamps at A do not pay for a reward at B'
);

-- custA: 1 manual stamp (section 1) + 8 more = 9 at tenant A; owner lowers the threshold to 8
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a', 'tag_tenant_a_0001', 'nfc',
       '2026-10-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 8) as g;

update public.tenant_settings set reward_threshold = 8 where tenant_id = '7c1f0000-0000-4000-8000-000000000001';

select is(
    public.redeem_card_reward('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                              'ca000000-0000-4000-8000-00000000000a', 'nonce-a-0005'),
    'redeemed',
    'redeem_uses_current_threshold: 9 stamps redeem after the threshold drops to 8'
);

select is(
    (select available_stamps from public.card_balances
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
       and customer_id = 'ca000000-0000-4000-8000-00000000000a'),
    1,
    'redeem_uses_current_threshold: 8 stamps are used and 1 remains'
);

update public.tenant_settings set reward_threshold = 10 where tenant_id = '7c1f0000-0000-4000-8000-000000000001';

-- ==============================================================================
-- 4. Nonces and tenant status (4 assertions)
-- ==============================================================================

select is(
    public.redeem_card_reward('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                              'cc000000-0000-4000-8000-0000000000ab', 'nonce-b-0002'),
    'invalid-token',
    'redeem_nonce_single_use: a used nonce is rejected'
);

-- 8 tenant B stamps for custB; tenant B suspended
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b', 'tag_tenant_b_0001', 'nfc',
       '2026-10-01 00:00:00+09'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 8) as g;

update public.tenants set status = 'suspended' where id = '7c1f0000-0000-4000-8000-00000000000b';

select is(
    public.redeem_card_reward('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                              'cb000000-0000-4000-8000-00000000000b', 'nonce-b-0006'),
    'redeemed',
    'redeem_allowed_when_suspended: customers can still redeem at a suspended shop'
);

select is(
    public.stamp_card_manual('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                             'cb000000-0000-4000-8000-00000000000b', 'Forgot phone'),
    'tenant-unavailable',
    'redeem_allowed_when_suspended: but no new stamps'
);

update public.tenants set status = 'closed' where id = '7c1f0000-0000-4000-8000-00000000000b';

select is(
    public.redeem_card_reward('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                              'cc000000-0000-4000-8000-0000000000ab', 'nonce-b-0007'),
    'tenant-unavailable',
    'A closed shop accepts no redemptions'
);

update public.tenants set status = 'active' where id = '7c1f0000-0000-4000-8000-00000000000b';

-- ==============================================================================
-- 5. Perks and inactive members (7 assertions)
-- ==============================================================================

select is(
    public.claim_card_perk('5b000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b',
                           'cc000000-0000-4000-8000-0000000000ab', 'instagram_follow_upsize'),
    'invalid-perk',
    'perk_must_be_configured: tenant B offers no Instagram perk'
);

select is(
    public.claim_card_perk('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                           'cc000000-0000-4000-8000-0000000000ab', 'instagram_follow_upsize'),
    'redeemed',
    'perk_must_be_configured: tenant A grants its configured perk'
);

select is(
    public.claim_card_perk('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                           'cc000000-0000-4000-8000-0000000000ab', 'instagram_follow_upsize'),
    'already-claimed',
    'A perk can be claimed once per card'
);

update public.tenant_members set active = false
where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
  and user_id = '5a000000-0000-4000-8000-00000000000a';

select is(
    public.stamp_card_manual('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                             'ca000000-0000-4000-8000-00000000000a', 'Forgot phone'),
    'unauthorized',
    'inactive_member_unauthorized: manual stamp'
);

select is(
    public.redeem_card_reward('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                              'ca000000-0000-4000-8000-00000000000a', 'nonce-a-0008'),
    'unauthorized',
    'inactive_member_unauthorized: redemption'
);

select is(
    public.claim_card_perk('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                           'ca000000-0000-4000-8000-00000000000a', 'instagram_follow_upsize'),
    'unauthorized',
    'inactive_member_unauthorized: perk'
);

set local role authenticated;
select throws_ok(
    $$select public.redeem_card_reward('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                                       'ca000000-0000-4000-8000-00000000000a', 'nonce-a-0009')$$,
    '42501',
    null,
    'authenticated cannot call redeem_card_reward'
);
reset role;

select * from finish();
rollback;
