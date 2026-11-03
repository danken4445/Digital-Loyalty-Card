-- ==============================================================================
-- 10_tag_management.test.sql
-- pgTAP Test Suite for Phase 11 Owner/Manager Tag Management
-- Tests:
--   1. Only owners and managers manage tags
--   2. Tags are created in the actor's tenant; IDs are globally unique and well-formed
--   3. Another tenant's tags are invisible (not-found)
--   4. Deactivate and rotate, with audit rows under the tenant
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(17);

-- Additional tenants are blocked in production until Phase 12; tests opt in.
select set_config('app.allow_multi_tenant', 'on', true);

-- ------------------------------------------------------------------------------
-- Shared fixtures: tenant A = tenant #1, tenant B = bean-there
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('5a000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'staff-a@test.local'),
    ('5e000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'manager-a@test.local'),
    ('5c000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'owner-b@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-00000000000b', 'bean-there', 'Bean There', 'active');

insert into public.tenant_settings (tenant_id, timezone)
values ('7c1f0000-0000-4000-8000-00000000000b', 'Asia/Tokyo');

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('7c1f0000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-00000000000a', 'staff', 'Staff A', true),
    ('7c1f0000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-00000000000a', 'manager', 'Manager A', true),
    ('7c1f0000-0000-4000-8000-00000000000b', '5c000000-0000-4000-8000-00000000000b', 'owner', 'Owner B', true);

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_tenant_a_0001', 'Tenant A Counter', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('tag_tenant_a_0002', 'Tenant A Bar', true, '7c1f0000-0000-4000-8000-000000000001'),
    ('tag_tenant_b_0001', 'Tenant B Counter', true, '7c1f0000-0000-4000-8000-00000000000b');

-- ==============================================================================
-- 1. Roles (4 assertions)
-- ==============================================================================

select is(
    public.create_tag('5a000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001', 'tag_new_000001', null),
    'unauthorized',
    'staff_cannot_manage_tags: staff role cannot create tags'
);

select is(
    public.create_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001', 'tag_new_000001', 'Window'),
    'created',
    'manager_creates_tag_in_own_tenant'
);

select is(
    (select tenant_id from public.tags where id = 'tag_new_000001'),
    '7c1f0000-0000-4000-8000-000000000001'::uuid,
    'The new tag belongs to the manager''s tenant'
);

select is(
    public.create_tag('5c000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b', 'tag_new_000003', null),
    'created',
    'An owner can create tags in their tenant'
);

-- ==============================================================================
-- 2. ID rules (2 assertions)
-- ==============================================================================

select is(
    public.create_tag('5c000000-0000-4000-8000-00000000000b', '7c1f0000-0000-4000-8000-00000000000b', 'tag_new_000001', null),
    'duplicate',
    'duplicate_tag_id_rejected: tag IDs are unique across tenants'
);

select is(
    public.create_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001', 'bad id!', null),
    'invalid-tag-id',
    'invalid_tag_id_rejected'
);

-- ==============================================================================
-- 3. Other tenants' tags (2 assertions)
-- ==============================================================================

select is(
    public.deactivate_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001', 'tag_tenant_b_0001'),
    'not-found',
    'cannot_touch_other_tenant_tag: deactivating tenant B''s tag returns not-found'
);

select is(
    (select active from public.tags where id = 'tag_tenant_b_0001'),
    true,
    'cannot_touch_other_tenant_tag: tenant B''s tag stays active'
);

-- ==============================================================================
-- 4. Deactivate and rotate (9 assertions)
-- ==============================================================================

select is(
    public.deactivate_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001', 'tag_tenant_a_0002'),
    'deactivated',
    'A manager can deactivate their tenant''s tag'
);

select ok(
    (select not active and deactivated_at is not null from public.tags where id = 'tag_tenant_a_0002'),
    'A deactivated tag is inactive with deactivated_at set'
);

select is(
    public.rotate_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                      'tag_tenant_a_0001', 'tag_new_000002', null),
    'rotated',
    'rotate_is_atomic: rotate returns rotated'
);

select ok(
    (select not active and deactivated_at is not null from public.tags where id = 'tag_tenant_a_0001'),
    'rotate_is_atomic: the old tag is deactivated'
);

select ok(
    (select active and tenant_id = '7c1f0000-0000-4000-8000-000000000001'::uuid from public.tags where id = 'tag_new_000002'),
    'rotate_is_atomic: the new tag is active in the same tenant'
);

select is(
    public.rotate_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001',
                      'tag_new_000002', 'tag_tenant_b_0001', null),
    'duplicate',
    'Rotating to an existing ID returns duplicate'
);

select is(
    (select active from public.tags where id = 'tag_new_000002'),
    true,
    'A failed rotation leaves the old tag active'
);

select is(
    (select count(*) from public.audit_log
     where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
       and action in ('create_tag', 'deactivate_tag', 'rotate_tag')),
    3::bigint,
    'Each successful tag change in tenant A is audited under tenant A'
);

set local role authenticated;
select throws_ok(
    $$select public.create_tag('5e000000-0000-4000-8000-00000000000a', '7c1f0000-0000-4000-8000-000000000001', 'tag_new_000009', null)$$,
    '42501',
    null,
    'authenticated cannot call create_tag'
);
reset role;

select * from finish();
rollback;
