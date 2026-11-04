-- ==============================================================================
-- 13_platform_and_suspension.test.sql
-- pgTAP Test Suite for Phase 14 platform admins and the suspension redemption window
-- Tests:
--   1. Platform admin gate on set_tenant_status (service role only, table-backed)
--   2. Status changes write an audit row with the tenant, the new status and the reason
--   3. Suspended shops block stamps immediately and redeem for 30 days from suspended_at
--   4. The tenants_suspended_at trigger stamps and clears suspended_at
--   5. platform_admins is not readable by anon or authenticated
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(38);

-- ------------------------------------------------------------------------------
-- Fixtures: one platform admin, one ordinary user, one shop with a ready-to-redeem customer
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('ad000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'platform-admin@test.local'),
    ('ad000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'plain-user@test.local'),
    ('ad000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'shop-staff@test.local'),
    ('ad000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'shop-customer@test.local')
on conflict (id) do nothing;

insert into public.platform_admins (user_id)
values ('ad000000-0000-4000-8000-0000000000a1');

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-000000000e14', 'edge-shop', 'Edge Shop', 'active');

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone)
values ('7c1f0000-0000-4000-8000-000000000e14', 30, 5, 3, 5, 'Asia/Manila');

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000c3', 'staff', 'Shop Staff', true);

insert into public.customers (id)
values ('ad000000-0000-4000-8000-0000000000d4');

insert into public.customer_cards (tenant_id, customer_id)
values ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4');

insert into public.tags (id, label, active, tenant_id)
values ('tag_edge_shop_0001', 'Edge Counter', true, '7c1f0000-0000-4000-8000-000000000e14');

-- 12 stamps at threshold 3: enough for several redemptions
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4', 'tag_edge_shop_0001', 'nfc',
       '2026-09-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 12) as g;

-- ==============================================================================
-- 1. Platform admin gate (8 assertions)
-- ==============================================================================

select is(
    private.is_platform_admin('ad000000-0000-4000-8000-0000000000a1'),
    true,
    'is_platform_admin: a listed user is a platform admin'
);

select is(
    public.is_platform_admin_user('ad000000-0000-4000-8000-0000000000b2'),
    false,
    'is_platform_admin_user: an ordinary user is not a platform admin'
);

select is(
    public.is_platform_admin_user('ad000000-0000-4000-8000-0000000000f9'),
    false,
    'is_platform_admin_user: an unknown user id is not a platform admin'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000b2', '7c1f0000-0000-4000-8000-000000000e14',
                             'suspended', 'Attempt by a non admin'),
    'unauthorized',
    'platform_admin_required_for_set_tenant_status: a non-admin user is refused'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000f9', '7c1f0000-0000-4000-8000-000000000e14',
                             'suspended', 'Attempt by an unknown id'),
    'unauthorized',
    'platform_admin_required_for_set_tenant_status: an unknown user id is refused'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000c3', '7c1f0000-0000-4000-8000-000000000e14',
                             'suspended', 'Shop staff are not platform admins'),
    'unauthorized',
    'platform_admin_required_for_set_tenant_status: a shop member is refused'
);

select is(
    (select status from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e14'),
    'active',
    'platform_admin_required_for_set_tenant_status: the tenant row was not changed'
);

select is(
    (select count(*) from public.audit_log where action = 'tenant_status_changed'),
    0::bigint,
    'platform_admin_required_for_set_tenant_status: no audit row was written'
);

-- ==============================================================================
-- 2. Input validation (5 assertions)
-- ==============================================================================

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'closed', 'Closing is not allowed here'),
    'invalid-status',
    'set_tenant_status: closed cannot be set'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'paused', 'Not a real status'),
    'invalid-status',
    'set_tenant_status: an unknown status is refused'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'suspended', '  ab  '),
    'invalid-reason',
    'set_tenant_status: a reason under 5 characters after trimming is refused'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'suspended', null),
    'invalid-reason',
    'set_tenant_status: a null reason is refused'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-0000000000ff',
                             'suspended', 'Tenant does not exist'),
    'not-found',
    'set_tenant_status: an unknown tenant is not-found'
);

-- ==============================================================================
-- 3. Audit row (4 assertions)
-- ==============================================================================

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'suspended', '  Chargeback dispute under review  '),
    'updated',
    'set_tenant_status_audits_with_tenant_and_reason: a platform admin can suspend a shop'
);

select is(
    (select count(*) from public.audit_log
     where action = 'tenant_status_changed'
       and tenant_id = '7c1f0000-0000-4000-8000-000000000e14'
       and actor = 'ad000000-0000-4000-8000-0000000000a1'
       and target = 'suspended'),
    1::bigint,
    'set_tenant_status_audits_with_tenant_and_reason: one audit row with tenant, actor and new status'
);

select is(
    (select detail from public.audit_log
     where action = 'tenant_status_changed'
       and tenant_id = '7c1f0000-0000-4000-8000-000000000e14'),
    '{"from": "active", "reason": "Chargeback dispute under review"}'::jsonb,
    'set_tenant_status_audits_with_tenant_and_reason: detail holds the previous status and the trimmed reason'
);

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e14') is not null,
    'set_tenant_status: moving into suspended stamps suspended_at'
);

-- ==============================================================================
-- 4. Suspended: stamps blocked at once, redeem window of 30 days (6 assertions)
-- ==============================================================================

select is(
    public.stamp_card_manual('ad000000-0000-4000-8000-0000000000c3', '7c1f0000-0000-4000-8000-000000000e14',
                             'ad000000-0000-4000-8000-0000000000d4', 'Forgot phone'),
    'tenant-unavailable',
    'suspended_stamp_blocked: no new stamp the moment the shop is suspended'
);

select is(
    (select count(*) from public.stamps
     where tenant_id = '7c1f0000-0000-4000-8000-000000000e14' and source = 'manual'),
    0::bigint,
    'suspended_stamp_blocked: no stamp row was written'
);

update public.tenants
set suspended_at = pg_catalog.now() - interval '29 days 23 hours'
where id = '7c1f0000-0000-4000-8000-000000000e14';

select is(
    public.redeem_card_reward('ad000000-0000-4000-8000-0000000000c3', '7c1f0000-0000-4000-8000-000000000e14',
                              'ad000000-0000-4000-8000-0000000000d4', 'nonce-edge-0001'),
    'redeemed',
    'suspended_redeem_window_edges: suspended 29 days 23 hours ago still redeems'
);

update public.tenants
set suspended_at = pg_catalog.now() - interval '30 days 1 minute'
where id = '7c1f0000-0000-4000-8000-000000000e14';

select is(
    public.redeem_card_reward('ad000000-0000-4000-8000-0000000000c3', '7c1f0000-0000-4000-8000-000000000e14',
                              'ad000000-0000-4000-8000-0000000000d4', 'nonce-edge-0002'),
    'tenant-unavailable',
    'suspended_redeem_window_edges: suspended 30 days 1 minute ago no longer redeems'
);

select is(
    (select count(*) from public.redemptions where tenant_id = '7c1f0000-0000-4000-8000-000000000e14'),
    1::bigint,
    'suspended_redeem_window_edges: only the in-window redemption was recorded'
);

update public.tenants
set suspended_at = null
where id = '7c1f0000-0000-4000-8000-000000000e14';

select is(
    public.redeem_card_reward('ad000000-0000-4000-8000-0000000000c3', '7c1f0000-0000-4000-8000-000000000e14',
                              'ad000000-0000-4000-8000-0000000000d4', 'nonce-edge-0003'),
    'redeemed',
    'suspended_redeem_window_edges: a null suspended_at counts as inside the window'
);

-- ==============================================================================
-- 5. Reactivation (5 assertions)
-- ==============================================================================

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'active', 'Dispute resolved in the shop favour'),
    'updated',
    'reactivation_clears_suspended_at: a platform admin can reactivate a shop'
);

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e14') is null,
    'reactivation_clears_suspended_at: suspended_at is cleared'
);

select is(
    public.stamp_card_manual('ad000000-0000-4000-8000-0000000000c3', '7c1f0000-0000-4000-8000-000000000e14',
                             'ad000000-0000-4000-8000-0000000000d4', 'Forgot phone'),
    'stamped',
    'reactivation_clears_suspended_at: stamping works again'
);

select is(
    (select detail from public.audit_log
     where action = 'tenant_status_changed'
       and target = 'active'
       and tenant_id = '7c1f0000-0000-4000-8000-000000000e14'),
    '{"from": "suspended", "reason": "Dispute resolved in the shop favour"}'::jsonb,
    'reactivation_clears_suspended_at: the reactivation is audited with the previous status'
);

select is(
    public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14',
                             'trial', 'Moved back onto a trial period'),
    'updated',
    'set_tenant_status: trial is a settable status'
);

-- ==============================================================================
-- 6. Trigger on direct SQL (5 assertions)
-- ==============================================================================

update public.tenants set status = 'suspended' where id = '7c1f0000-0000-4000-8000-000000000e14';

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e14')
        between pg_catalog.now() - interval '1 minute' and pg_catalog.now() + interval '1 minute',
    'tenants_suspended_at: a plain status update to suspended stamps suspended_at'
);

update public.tenants
set suspended_at = pg_catalog.now() - interval '5 days'
where id = '7c1f0000-0000-4000-8000-000000000e14';

update public.tenants set name = 'Edge Shop Renamed' where id = '7c1f0000-0000-4000-8000-000000000e14';

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e14')
        < pg_catalog.now() - interval '4 days',
    'tenants_suspended_at: an update that leaves the status alone keeps the existing suspended_at'
);

update public.tenants set status = 'closed' where id = '7c1f0000-0000-4000-8000-000000000e14';

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e14') is null,
    'tenants_suspended_at: closing clears suspended_at'
);

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-000000000e15', 'born-suspended', 'Born Suspended', 'suspended');

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e15') is not null,
    'tenants_suspended_at: a tenant inserted as suspended is stamped'
);

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-000000000e16', 'born-active', 'Born Active', 'active');

select ok(
    (select suspended_at from public.tenants where id = '7c1f0000-0000-4000-8000-000000000e16') is null,
    'tenants_suspended_at: a tenant inserted as active has no suspended_at'
);

-- ==============================================================================
-- 7. Access control (5 assertions)
-- ==============================================================================

set local role authenticated;
select throws_ok(
    $$select count(*) from public.platform_admins$$,
    '42501',
    null,
    'platform_admins_not_readable_by_authenticated: select is denied'
);
select throws_ok(
    $$select public.set_tenant_status('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', 'active', 'Called as authenticated')$$,
    '42501',
    null,
    'authenticated cannot call set_tenant_status'
);
select throws_ok(
    $$select public.is_platform_admin_user('ad000000-0000-4000-8000-0000000000a1')$$,
    '42501',
    null,
    'authenticated cannot call is_platform_admin_user'
);
reset role;

set local role anon;
select throws_ok(
    $$select count(*) from public.platform_admins$$,
    '42501',
    null,
    'platform_admins_not_readable_by_authenticated: select is denied for anon'
);
reset role;

select is(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.platform_admins'::regclass),
    true,
    'platform_admins has row level security enabled'
);

select * from finish();
rollback;
