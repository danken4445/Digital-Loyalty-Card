-- ==============================================================================
-- 17_locations.test.sql
-- pgTAP Test Suite for Phase 14 Task 2A: Branches / Locations (database)
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(34);

-- ------------------------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous)
values
    ('17000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'platform-admin-17@test.local', now(), false),
    ('17000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-main@test.local', now(), false),
    ('17000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'manager-main@test.local', now(), false),
    ('17000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'owner-other@test.local', now(), false),
    ('17000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'customer-with-card@test.local', now(), false),
    ('17000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'customer-no-card@test.local', now(), false)
on conflict (id) do nothing;

insert into public.platform_admins (user_id)
values ('17000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('17111111-0000-4000-8000-000000000001', 'brand-coffee', 'Brand Coffee', 'active'),
    ('17222222-0000-4000-8000-000000000002', 'other-coffee', 'Other Coffee', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, reward_label)
values
    ('17111111-0000-4000-8000-000000000001', 30, 5, 10, 0, 'FREE CUP'),
    ('17222222-0000-4000-8000-000000000002', 30, 5, 10, 0, 'FREE CUP')
on conflict (tenant_id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('17111111-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000002', 'owner', 'Owner Brand', true),
    ('17111111-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000003', 'manager', 'Manager Brand', true),
    ('17222222-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000004', 'owner', 'Owner Other', true)
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (id)
values
    ('17000000-0000-4000-8000-000000000005'),
    ('17000000-0000-4000-8000-000000000006')
on conflict (id) do nothing;

-- Customer 5 has card at Brand Coffee
insert into public.customer_cards (tenant_id, customer_id)
values ('17111111-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000005')
on conflict (tenant_id, customer_id) do nothing;

-- ------------------------------------------------------------------------------
-- 1. existing_tenants_get_default_location
-- ------------------------------------------------------------------------------

select is(
    exists (
      select 1 from public.locations
      where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
        and name = 'The Caffeine Plug'
    ),
    true,
    'existing_tenants_get_default_location: Tenant 1 has default location backfilled'
);

-- ------------------------------------------------------------------------------
-- 2. manager_cannot_create_location & owner_cannot_manage_other_tenant_locations
-- ------------------------------------------------------------------------------

select is(
    (public.create_location(
        '17000000-0000-4000-8000-000000000003', -- Manager Brand
        '17111111-0000-4000-8000-000000000001',
        'Manager Branch',
        '123 Street'
    )->>'result'),
    'unauthorized',
    'manager_cannot_create_location: manager is refused'
);

select is(
    (public.create_location(
        '17000000-0000-4000-8000-000000000004', -- Owner of Other Coffee
        '17111111-0000-4000-8000-000000000001', -- Brand Coffee tenant
        'Cross-Tenant Branch',
        '456 Avenue'
    )->>'result'),
    'unauthorized',
    'owner_cannot_manage_other_tenant_locations: owner of another tenant is refused'
);

-- ------------------------------------------------------------------------------
-- 3. location_names_unique_per_tenant
-- ------------------------------------------------------------------------------

do $$
declare
  v_res1 jsonb;
  v_res2 jsonb;
  v_downtown uuid;
  v_mall uuid;
begin
  v_res1 := public.create_location(
      '17000000-0000-4000-8000-000000000002',
      '17111111-0000-4000-8000-000000000001',
      'Downtown',
      '100 Main St'
  );
  v_downtown := (v_res1->>'locationId')::uuid;

  v_res2 := public.create_location(
      '17000000-0000-4000-8000-000000000002',
      '17111111-0000-4000-8000-000000000001',
      'Mall',
      '200 Mall Blvd'
  );
  v_mall := (v_res2->>'locationId')::uuid;

  perform set_config('test.downtown_id', v_downtown::text, true);
  perform set_config('test.mall_id', v_mall::text, true);
end;
$$;

select is(
    (public.create_location(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        'Downtown',
        'Duplicate Name'
    )->>'result'),
    'duplicate',
    'location_names_unique_per_tenant: duplicate name within tenant rejected'
);

-- Same name in another tenant is allowed
select is(
    (public.create_location(
        '17000000-0000-4000-8000-000000000004',
        '17222222-0000-4000-8000-000000000002',
        'Downtown',
        'Downtown for Other Coffee'
    )->>'result'),
    'created',
    'location_names_unique_per_tenant: same name in different tenant allowed'
);

-- ------------------------------------------------------------------------------
-- 4. tag_location_must_belong_to_tenant (Review Focus 6)
-- ------------------------------------------------------------------------------

-- RPC refuses another tenant's location
select is(
    public.create_tag_at(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        'tag_downtown_badloc',
        'Bad Loc',
        (select id from public.locations where tenant_id = '17222222-0000-4000-8000-000000000002' and name = 'Downtown')
    ),
    'invalid-location',
    'tag_location_must_belong_to_tenant: create_tag_at refuses another tenant location'
);

-- Composite FK direct insert refuses another tenant's location
select throws_ok(
    $$
      insert into public.tags (id, label, active, tenant_id, location_id)
      values (
        'tag_direct_bad_composite_fk',
        'Bad FK',
        true,
        '17111111-0000-4000-8000-000000000001',
        (select id from public.locations where tenant_id = '17222222-0000-4000-8000-000000000002' and name = 'Downtown')
      )
    $$,
    '23503',
    null,
    'tag_location_must_belong_to_tenant: composite FK rejects cross-tenant location_id'
);

-- ------------------------------------------------------------------------------
-- 5. Create tags for Downtown and Mall
-- ------------------------------------------------------------------------------

select is(
    public.create_tag_at(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        'tag_downtown_001',
        'Downtown Counter',
        current_setting('test.downtown_id')::uuid
    ),
    'created',
    'create_tag_at: Downtown tag created'
);

select is(
    public.create_tag_at(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        'tag_mall_001',
        'Mall Counter',
        current_setting('test.mall_id')::uuid
    ),
    'created',
    'create_tag_at: Mall tag created'
);

-- ------------------------------------------------------------------------------
-- 6. branch_stamps_share_card_and_cooldown (Review Focus 6)
-- ------------------------------------------------------------------------------

-- Stamp 1 at Downtown at T0
select is(
    (public.stamp_card_nfc('17000000-0000-4000-8000-000000000005', 'tag_downtown_001', '2026-11-06 12:00:00+08')->>'result'),
    'stamped',
    'branch_stamps_share_card_and_cooldown: stamp at Downtown succeeds'
);

-- Verify Downtown stamp recorded with Downtown location_id
select is(
    (select location_id from public.stamps where customer_id = '17000000-0000-4000-8000-000000000005' order by created_at desc limit 1),
    current_setting('test.downtown_id')::uuid,
    'branch_stamps_share_card_and_cooldown: stamp recorded with Downtown location_id'
);

-- Stamp 2 at Mall at T0 + 10 mins (cooldown is 30 mins) -> blocked by shared cooldown!
select is(
    (public.stamp_card_nfc('17000000-0000-4000-8000-000000000005', 'tag_mall_001', '2026-11-06 12:10:00+08')->>'result'),
    'cooldown',
    'branch_stamps_share_card_and_cooldown: tap at Mall within cooldown blocked by shared cooldown'
);

-- Stamp 3 at Mall at T0 + 35 mins -> succeeds!
select is(
    (public.stamp_card_nfc('17000000-0000-4000-8000-000000000005', 'tag_mall_001', '2026-11-06 12:35:00+08')->>'result'),
    'stamped',
    'branch_stamps_share_card_and_cooldown: tap at Mall after cooldown succeeds'
);

-- Verify Mall stamp recorded with Mall location_id
select is(
    (select location_id from public.stamps where customer_id = '17000000-0000-4000-8000-000000000005' order by created_at desc limit 1),
    current_setting('test.mall_id')::uuid,
    'branch_stamps_share_card_and_cooldown: stamp recorded with Mall location_id'
);

-- Total stamps on customer 5's card is 2 (both branches earn on the same card)
select is(
    (select total_stamps from public.card_balances where customer_id = '17000000-0000-4000-8000-000000000005' and tenant_id = '17111111-0000-4000-8000-000000000001'),
    2,
    'branch_stamps_share_card_and_cooldown: both branches earn on the same card'
);

-- ------------------------------------------------------------------------------
-- 7. legacy_tag_and_stamp_functions_still_work
-- ------------------------------------------------------------------------------

select is(
    public.create_tag(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        'tag_legacy_001',
        'Legacy Tag'
    ),
    'created',
    'legacy_tag_and_stamp_functions_still_work: create_tag without location succeeds'
);

select is(
    public.stamp_card_manual(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        '17000000-0000-4000-8000-000000000005',
        'Manual customer appreciation stamp',
        '2026-11-06 14:00:00+08'
    ),
    'stamped',
    'legacy_tag_and_stamp_functions_still_work: stamp_card_manual works'
);

select is(
    (select location_id from public.stamps where customer_id = '17000000-0000-4000-8000-000000000005' and source = 'manual'),
    null,
    'legacy_tag_and_stamp_functions_still_work: manual stamp has null location_id'
);

-- ------------------------------------------------------------------------------
-- 8. customer_cannot_read_locations_of_tenants_without_a_card
-- ------------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "17000000-0000-4000-8000-000000000005"}'; -- Customer with Brand Coffee card
select is(
    (select count(*)::int from public.locations where tenant_id = '17111111-0000-4000-8000-000000000001'),
    2,
    'customer_cannot_read_locations_of_tenants_without_a_card: customer with card can see active locations'
);

select is(
    (select count(*)::int from public.locations where tenant_id = '17222222-0000-4000-8000-000000000002'),
    0,
    'customer_cannot_read_locations_of_tenants_without_a_card: customer without card cannot see other tenant locations'
);
reset role;

-- ------------------------------------------------------------------------------
-- 9. preview_location_separation_counts_branch_stamps_only
-- ------------------------------------------------------------------------------

do $$
declare
  v_prev jsonb;
begin
  v_prev := public.preview_location_separation(
      '17000000-0000-4000-8000-000000000002',
      '17111111-0000-4000-8000-000000000001',
      current_setting('test.mall_id')::uuid
  );
  perform set_config('test.preview_sep', v_prev::text, true);
end;
$$;

select is(
    (current_setting('test.preview_sep')::jsonb->>'branchStamps')::int,
    1,
    'preview_location_separation_counts_branch_stamps_only: mall stamps count is 1'
);

select is(
    (current_setting('test.preview_sep')::jsonb->>'branchTags')::int,
    1,
    'preview_location_separation_counts_branch_stamps_only: mall tags count is 1'
);

-- ------------------------------------------------------------------------------
-- 10. promotion validation & card mode change
-- ------------------------------------------------------------------------------

-- Promotion requires exact branch name confirmation
select is(
    (public.set_location_card_mode(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        current_setting('test.mall_id')::uuid,
        'separate',
        'brand-coffee-mall',
        'Wrong Confirmation Name'
    )->>'result'),
    'confirmation-mismatch',
    'promotion_requires_exact_branch_name_confirmation: mismatch name rejected'
);

-- Child slug must be valid
select is(
    (public.set_location_card_mode(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        current_setting('test.mall_id')::uuid,
        'separate',
        'INVALID_SLUG!',
        'Mall'
    )->>'result'),
    'invalid-slug',
    'child_slug_must_be_valid_and_unique: invalid slug rejected'
);

-- Child slug must be unique
select is(
    (public.set_location_card_mode(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        current_setting('test.mall_id')::uuid,
        'separate',
        'other-coffee',
        'Mall'
    )->>'result'),
    'duplicate-slug',
    'child_slug_must_be_valid_and_unique: duplicate slug rejected'
);

-- Non-owner cannot promote
select is(
    (public.set_location_card_mode(
        '17000000-0000-4000-8000-000000000003', -- Manager Brand
        '17111111-0000-4000-8000-000000000001',
        current_setting('test.mall_id')::uuid,
        'separate',
        'brand-coffee-mall',
        'Mall'
    )->>'result'),
    'unauthorized',
    'card_mode_change_owner_only_and_audited_on_both_tenants: manager cannot change card mode'
);

-- Successful promotion to separate card mode
do $$
declare
  v_res jsonb;
  v_child_id uuid;
begin
  v_res := public.set_location_card_mode(
      '17000000-0000-4000-8000-000000000002',
      '17111111-0000-4000-8000-000000000001',
      current_setting('test.mall_id')::uuid,
      'separate',
      'brand-coffee-mall',
      'Mall'
  );
  v_child_id := (v_res->>'childTenantId')::uuid;
  perform set_config('test.child_tenant_id', v_child_id::text, true);
end;
$$;

-- ------------------------------------------------------------------------------
-- 11. separate_card_mode_promotes_branch_to_child_tenant
-- ------------------------------------------------------------------------------

select is(
    exists (
      select 1 from public.tenants
      where id = current_setting('test.child_tenant_id')::uuid
        and slug = 'brand-coffee-mall'
        and parent_tenant_id = '17111111-0000-4000-8000-000000000001'
    ),
    true,
    'separate_card_mode_promotes_branch_to_child_tenant: child tenant created with parent_tenant_id'
);

select is(
    (select count(*)::int from public.tenant_members where tenant_id = current_setting('test.child_tenant_id')::uuid),
    2,
    'separate_card_mode_promotes_branch_to_child_tenant: parent owner and manager copied to child'
);

select is(
    (select tenant_id from public.tags where id = 'tag_mall_001'),
    current_setting('test.child_tenant_id')::uuid,
    'separate_card_mode_promotes_branch_to_child_tenant: mall tag moved to child tenant'
);

select is(
    exists (
      select 1 from public.audit_log
      where tenant_id = '17111111-0000-4000-8000-000000000001'
        and action = 'set_location_card_mode'
    ) and exists (
      select 1 from public.audit_log
      where tenant_id = current_setting('test.child_tenant_id')::uuid
        and action = 'promoted_from_branch'
    ),
    true,
    'card_mode_change_owner_only_and_audited_on_both_tenants: audits written on both tenants'
);

-- ------------------------------------------------------------------------------
-- 12. separate_mode_cannot_revert
-- ------------------------------------------------------------------------------

select is(
    (public.set_location_card_mode(
        '17000000-0000-4000-8000-000000000002',
        '17111111-0000-4000-8000-000000000001',
        current_setting('test.mall_id')::uuid,
        'shared'
    )->>'result'),
    'cannot-revert',
    'separate_mode_cannot_revert: reverting separate branch to shared refused'
);

-- ------------------------------------------------------------------------------
-- 13. separate_branch_tap_stamps_child_card_not_parent
-- ------------------------------------------------------------------------------

-- Add card at child tenant for Customer 5
insert into public.customer_cards (tenant_id, customer_id)
values (current_setting('test.child_tenant_id')::uuid, '17000000-0000-4000-8000-000000000005');

-- Tap Mall tag now stamps the child tenant's card!
select is(
    (public.stamp_card_nfc('17000000-0000-4000-8000-000000000005', 'tag_mall_001', '2026-11-06 15:00:00+08')->>'result'),
    'stamped',
    'separate_branch_tap_stamps_child_card_not_parent: tap mall tag succeeds'
);

-- Child tenant card balance has 1 stamp
select is(
    (select total_stamps from public.card_balances where tenant_id = current_setting('test.child_tenant_id')::uuid and customer_id = '17000000-0000-4000-8000-000000000005'),
    1,
    'separate_branch_tap_stamps_child_card_not_parent: child tenant has 1 stamp'
);

-- Parent tenant card balance is unchanged (still 3 stamps: 2 NFC + 1 manual)
select is(
    (select total_stamps from public.card_balances where tenant_id = '17111111-0000-4000-8000-000000000001' and customer_id = '17000000-0000-4000-8000-000000000005'),
    3,
    'separate_branch_tap_stamps_child_card_not_parent: parent tenant stamps untouched'
);

select * from finish();
rollback;
