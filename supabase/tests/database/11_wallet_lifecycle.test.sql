-- ==============================================================================
-- 11_wallet_lifecycle.test.sql
-- pgTAP Test Suite for Phase 11 Wallet Lifecycle
-- Tests:
--   1. remove_card erases one tenant's card and ledger only
--   2. delete_wallet erases everything, including the auth user
--   3. merge_wallets moves distinct cards and combines same-tenant cards
--   4. delete_wallet uses the shared customer lock (F-17) and erases redeemed-nonce audit rows
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(22);

-- ------------------------------------------------------------------------------
-- Shared fixtures: tenant A = tenant #1, tenant B = bean-there
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('5a000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'staff-a@test.local'),
    ('5b000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'staff-b@test.local'),
    ('ca000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'cust-a@test.local'),
    ('cc000000-0000-4000-8000-0000000000ab', 'authenticated', 'authenticated', 'cust-ab@test.local'),
    ('c1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'merge-src-1@test.local'),
    ('c1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'merge-tgt-1@test.local'),
    ('c1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'merge-src-2@test.local'),
    ('c1100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'merge-tgt-2@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-00000000000b', 'bean-there', 'Bean There', 'active');

insert into public.tenant_settings (tenant_id, reward_threshold, timezone)
values ('7c1f0000-0000-4000-8000-00000000000b', 8, 'Asia/Tokyo');

insert into public.customers (id)
values
    ('ca000000-0000-4000-8000-00000000000a'),
    ('cc000000-0000-4000-8000-0000000000ab'),
    ('c1100000-0000-4000-8000-000000000001'),
    ('c1100000-0000-4000-8000-000000000002'),
    ('c1100000-0000-4000-8000-000000000003'),
    ('c1100000-0000-4000-8000-000000000004');

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-00000000000b', 'c1100000-0000-4000-8000-000000000001'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000002'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000003'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000004');

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_tenant_a_0001', 'Tenant A Counter', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('tag_tenant_b_0001', 'Tenant B Counter', true, '7c1f0000-0000-4000-8000-00000000000b');

-- custAB: 2 stamps at A, 3 at B, a perk claim at A, an audit row in each tenant
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_a_0001', 'nfc',
       '2026-10-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 2) as g;

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-00000000000b', 'cc000000-0000-4000-8000-0000000000ab', 'tag_tenant_b_0001', 'nfc',
       '2026-10-01 00:00:00+09'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 3) as g;

insert into public.perk_claims (tenant_id, customer_id, perk, staff_id)
values ('7c1f0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-0000000000ab', 'instagram_follow_upsize', '5a000000-0000-4000-8000-00000000000a');

insert into public.audit_log (tenant_id, actor, action, target)
values
    ('7c1f0000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-00000000000a', 'manual_stamp', 'cc000000-0000-4000-8000-0000000000ab'),
    ('7c1f0000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-00000000000b', 'manual_stamp', 'cc000000-0000-4000-8000-0000000000ab');

-- ==============================================================================
-- 1. remove_card (8 assertions)
-- ==============================================================================

select is(
    public.remove_card('cc000000-0000-4000-8000-0000000000ab', '7c1f0000-0000-4000-8000-000000000001'),
    true,
    'remove_card_is_tenant_scoped: removing the tenant A card succeeds'
);

select is(
    (select count(*) from public.stamps
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001' and customer_id = 'cc000000-0000-4000-8000-0000000000ab'),
    0::bigint,
    'remove_card_is_tenant_scoped: tenant A stamps are erased'
);

select is(
    (select count(*) from public.customer_cards
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001' and customer_id = 'cc000000-0000-4000-8000-0000000000ab'),
    0::bigint,
    'remove_card_is_tenant_scoped: the tenant A card is gone'
);

select is(
    (select count(*) from public.stamps
     where tenant_id = '7c1f0000-0000-4000-8000-00000000000b' and customer_id = 'cc000000-0000-4000-8000-0000000000ab'),
    3::bigint,
    'remove_card_is_tenant_scoped: tenant B stamps are untouched'
);

select is(
    (select count(*) from auth.users where id = 'cc000000-0000-4000-8000-0000000000ab'),
    1::bigint,
    'remove_card_is_tenant_scoped: the wallet (auth user) remains'
);

select is(
    (select count(*) from public.audit_log
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001' and target = 'cc000000-0000-4000-8000-0000000000ab'),
    0::bigint,
    'remove_card_is_tenant_scoped: tenant A audit rows naming the customer are erased'
);

select is(
    (select count(*) from public.audit_log
     where tenant_id = '7c1f0000-0000-4000-8000-00000000000b' and target = 'cc000000-0000-4000-8000-0000000000ab'),
    1::bigint,
    'remove_card_is_tenant_scoped: tenant B audit rows are untouched'
);

select is(
    public.remove_card('ca000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-00000000000b'),
    false,
    'remove_card_missing_returns_false'
);

-- ==============================================================================
-- 2. delete_wallet (2 assertions)
-- ==============================================================================

select is(
    public.delete_wallet('cc000000-0000-4000-8000-0000000000ab'),
    true,
    'delete_wallet_removes_everything: returns true'
);

select is(
    (select count(*) from public.customer_cards where customer_id = 'cc000000-0000-4000-8000-0000000000ab')
      + (select count(*) from public.stamps where customer_id = 'cc000000-0000-4000-8000-0000000000ab')
      + (select count(*) from public.customers where id = 'cc000000-0000-4000-8000-0000000000ab')
      + (select count(*) from auth.users where id = 'cc000000-0000-4000-8000-0000000000ab'),
    0::bigint,
    'delete_wallet_removes_everything: no cards, stamps, customer or auth user remain'
);

-- ==============================================================================
-- 3a. merge_moves_distinct_cards: source holds a B card, target an A card (4 assertions)
-- ==============================================================================

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-00000000000b', 'c1100000-0000-4000-8000-000000000001', 'tag_tenant_b_0001', 'nfc',
       '2026-10-01 00:00:00+09'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 2) as g;

create temporary table merge_distinct as
select public.merge_wallets('c1100000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000002') as r;

select is((select r ->> 'result' from merge_distinct), 'merged',
    'merge_moves_distinct_cards: result is merged');

select is((select r ->> 'cards_moved' from merge_distinct), '1',
    'merge_moves_distinct_cards: one card moved');

select is(
    (select count(*) from public.customer_cards where customer_id = 'c1100000-0000-4000-8000-000000000002'),
    2::bigint,
    'merge_moves_distinct_cards: the target now holds two cards'
);

select is(
    (select total_stamps from public.card_balances
     where tenant_id = '7c1f0000-0000-4000-8000-00000000000b' and customer_id = 'c1100000-0000-4000-8000-000000000002'),
    2,
    'merge_moves_distinct_cards: the moved card keeps its stamps'
);

-- ==============================================================================
-- 3b. merge_combines_same_tenant_cards: both hold A cards and the same perk (4 assertions)
-- ==============================================================================

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000003', 'tag_tenant_a_0001', 'nfc',
       '2026-10-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 3) as g;

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000004', 'tag_tenant_a_0001', 'nfc',
       '2026-10-10 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 4) as g;

insert into public.perk_claims (tenant_id, customer_id, perk, staff_id)
values
    ('7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000003', 'instagram_follow_upsize', '5a000000-0000-4000-8000-00000000000a'),
    ('7c1f0000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000004', 'instagram_follow_upsize', '5a000000-0000-4000-8000-00000000000a');

create temporary table merge_same as
select public.merge_wallets('c1100000-0000-4000-8000-000000000003', 'c1100000-0000-4000-8000-000000000004') as r;

select is((select r ->> 'cards_combined' from merge_same), '1',
    'merge_combines_same_tenant_cards: one card combined');

select is(
    (select total_stamps from public.card_balances
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001' and customer_id = 'c1100000-0000-4000-8000-000000000004'),
    7,
    'merge_combines_same_tenant_cards: stamps are summed (3 + 4)'
);

select is(
    (select count(*) from public.perk_claims
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001' and customer_id = 'c1100000-0000-4000-8000-000000000004'),
    1::bigint,
    'merge_combines_same_tenant_cards: exactly one perk claim survives'
);

select is(
    (select count(*) from public.customers where id = 'c1100000-0000-4000-8000-000000000003'),
    0::bigint,
    'merge_combines_same_tenant_cards: the source wallet is gone'
);

-- ==============================================================================
-- 3c/4. Noop merge, shared erasure lock, privileges (3 assertions)
-- ==============================================================================

select is(
    public.merge_wallets('ca000000-0000-4000-8000-00000000000a', 'ca000000-0000-4000-8000-00000000000a') ->> 'result',
    'noop-same-user',
    'merge_noop_same_user'
);

select ok(
    pg_get_functiondef('public.delete_wallet(uuid)'::regprocedure) like '%hashtextextended(p_customer::text, 1001)%',
    'delete_uses_shared_lock: delete_wallet takes the same customer lock as stamping'
);

-- Redeemed QR nonces are recorded with the customer only in detail.customer_id
insert into public.audit_log (tenant_id, actor, action, target, detail)
values (
    '7c1f0000-0000-4000-8000-000000000001',
    '5a000000-0000-4000-8000-00000000000a',
    'staff_redeem_token_used',
    'nonce-erasure-0001',
    jsonb_build_object('customer_id', 'ca000000-0000-4000-8000-00000000000a')
);

select public.delete_wallet('ca000000-0000-4000-8000-00000000000a');

select is(
    (select count(*) from public.audit_log where detail ->> 'customer_id' = 'ca000000-0000-4000-8000-00000000000a'),
    0::bigint,
    'delete_erases_nonce_audit_rows: no audit detail still names the erased customer'
);

set local role authenticated;
select throws_ok(
    $$select public.merge_wallets('ca000000-0000-4000-8000-00000000000a', 'c1100000-0000-4000-8000-000000000002')$$,
    '42501',
    null,
    'authenticated cannot call merge_wallets'
);
reset role;

select * from finish();
rollback;
