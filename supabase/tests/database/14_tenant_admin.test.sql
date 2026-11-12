-- ==============================================================================
-- 14_tenant_admin.test.sql
-- pgTAP Test Suite for Phase 14 tenant admin, invites, rules patch/preview, and brand RPCs
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(67);

-- ------------------------------------------------------------------------------
-- Fixtures
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous)
values
    ('14000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'platform-admin@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'owner-a@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'owner-a2@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'manager-a@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'staff-a@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'owner-b@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'invitee-alice@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'invitee-unconfirmed@test.local', null, false),
    ('14000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'invitee-anon@test.local', now(), true),
    ('14000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'customer-1@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'customer-2@test.local', now(), false),
    ('14000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'customer-3@test.local', now(), false)
on conflict (id) do nothing;

insert into public.platform_admins (user_id)
values ('14000000-0000-4000-8000-000000000001');

insert into public.tenants (id, slug, name, status)
values
    ('14111111-0000-4000-8000-000000000001', 'shop-a', 'Shop A', 'active'),
    ('14222222-0000-4000-8000-000000000002', 'shop-b', 'Shop B', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, reward_label)
values
    ('14111111-0000-4000-8000-000000000001', 30, 3, 10, 5, 'FREE COFFEE'),
    ('14222222-0000-4000-8000-000000000002', 30, 3, 10, 5, 'FREE PASTRY')
on conflict (tenant_id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'owner', 'Owner Alice', true),
    ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000004', 'manager', 'Manager Bob', true),
    ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000005', 'staff', 'Staff Charlie', true),
    ('14222222-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000006', 'owner', 'Owner Dave', true)
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (id)
values
    ('14000000-0000-4000-8000-000000000010'),
    ('14000000-0000-4000-8000-000000000011'),
    ('14000000-0000-4000-8000-000000000012')
on conflict (id) do nothing;

insert into public.customer_cards (tenant_id, customer_id)
values
    ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000010'),
    ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000011'),
    ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000012')
on conflict (tenant_id, customer_id) do nothing;

insert into public.tags (id, label, active, tenant_id)
values ('tag_shop_a_001', 'Counter A', true, '14111111-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------
-- 1. platform_create_tenant_makes_settings_and_invite
-- ------------------------------------------------------------------------------

select is(
    (public.platform_create_tenant('14000000-0000-4000-8000-000000000002', 'new-shop', 'New Shop', 'owner@new.local')->>'result'),
    'unauthorized',
    'platform_create_tenant: unauthorized for non platform admin'
);

select is(
    (public.platform_create_tenant('14000000-0000-4000-8000-000000000001', 'Invalid_Slug!', 'New Shop', 'owner@new.local')->>'result'),
    'invalid-slug',
    'platform_create_tenant: invalid slug rejected'
);

select is(
    (public.platform_create_tenant('14000000-0000-4000-8000-000000000001', 'shop-a', 'Shop A Duplicate', 'owner@new.local')->>'result'),
    'duplicate-slug',
    'platform_create_tenant: duplicate slug rejected'
);

select is(
    (public.platform_create_tenant('14000000-0000-4000-8000-000000000001', 'valid-slug', 'Valid Shop', 'bad-email')->>'result'),
    'invalid-email',
    'platform_create_tenant: invalid email rejected'
);

do $$
declare
  v_res jsonb;
  v_tid uuid;
  v_iid uuid;
begin
  v_res := public.platform_create_tenant('14000000-0000-4000-8000-000000000001', 'created-shop', 'Created Shop', 'owner@created.local');
  v_tid := (v_res->>'tenantId')::uuid;
  v_iid := (v_res->>'inviteId')::uuid;

  perform set_config('test.created_tenant_id', v_tid::text, true);
  perform set_config('test.created_invite_id', v_iid::text, true);
end;
$$;

select is(
    exists (
      select 1 from public.tenants
      where id = current_setting('test.created_tenant_id')::uuid
        and slug = 'created-shop'
        and status = 'trial'
    ),
    true,
    'platform_create_tenant_makes_settings_and_invite: tenant created with status trial'
);

select is(
    exists (
      select 1 from public.tenant_settings
      where tenant_id = current_setting('test.created_tenant_id')::uuid
    ),
    true,
    'platform_create_tenant_makes_settings_and_invite: tenant_settings row created'
);

select is(
    exists (
      select 1 from public.tenant_invites
      where id = current_setting('test.created_invite_id')::uuid
        and tenant_id = current_setting('test.created_tenant_id')::uuid
        and email = 'owner@created.local'
        and role = 'owner'
    ),
    true,
    'platform_create_tenant_makes_settings_and_invite: owner invite row created'
);

select is(
    exists (
      select 1 from public.audit_log
      where tenant_id = current_setting('test.created_tenant_id')::uuid
        and actor = '14000000-0000-4000-8000-000000000001'
    ),
    true,
    'platform_create_tenant_makes_settings_and_invite: audit row logged'
);

-- ------------------------------------------------------------------------------
-- 2. owner_cannot_write_other_tenant (Review Focus 2)
-- ------------------------------------------------------------------------------

select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000002', -- Owner A
        '14222222-0000-4000-8000-000000000002', -- Shop B
        '{"cooldown_minutes": 10}'::jsonb
    ),
    'unauthorized',
    'owner_cannot_write_other_tenant: rules update on other tenant refused'
);

select is(
    (select cooldown_minutes from public.tenant_settings where tenant_id = '14222222-0000-4000-8000-000000000002'),
    30,
    'owner_cannot_write_other_tenant: shop b rules unchanged'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14222222-0000-4000-8000-000000000002',
        '{"primaryColor": "#123456"}'::jsonb
    ),
    'unauthorized',
    'owner_cannot_write_other_tenant: brand update on other tenant refused'
);

select is(
    public.invite_member(
        '14000000-0000-4000-8000-000000000002',
        '14222222-0000-4000-8000-000000000002',
        'stranger@test.local',
        'staff'
    ),
    'unauthorized',
    'owner_cannot_write_other_tenant: invite on other tenant refused'
);

select is(
    public.set_member_role(
        '14000000-0000-4000-8000-000000000002',
        '14222222-0000-4000-8000-000000000002',
        '14000000-0000-4000-8000-000000000006',
        'staff'
    ),
    'unauthorized',
    'owner_cannot_write_other_tenant: set role on other tenant refused'
);

select is(
    public.set_member_active(
        '14000000-0000-4000-8000-000000000002',
        '14222222-0000-4000-8000-000000000002',
        '14000000-0000-4000-8000-000000000006',
        false
    ),
    'unauthorized',
    'owner_cannot_write_other_tenant: set active on other tenant refused'
);

-- ------------------------------------------------------------------------------
-- 3. last_owner_cannot_be_removed (Review Focus 3)
-- ------------------------------------------------------------------------------

select is(
    public.set_member_role(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '14000000-0000-4000-8000-000000000002',
        'manager'
    ),
    'last-owner',
    'last_owner_cannot_be_removed: demoting sole active owner refused'
);

select is(
    public.set_member_active(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '14000000-0000-4000-8000-000000000002',
        false
    ),
    'last-owner',
    'last_owner_cannot_be_removed: deactivating sole active owner refused'
);

-- Add second owner, now demoting first owner works
insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values ('14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003', 'owner', 'Owner Alice 2', true);

select is(
    public.set_member_role(
        '14000000-0000-4000-8000-000000000003',
        '14111111-0000-4000-8000-000000000001',
        '14000000-0000-4000-8000-000000000002',
        'manager'
    ),
    'updated',
    'last_owner_cannot_be_removed: demoting owner succeeds when another active owner exists'
);

-- Now only Owner 2 remains. Demoting Owner 2 is refused
select is(
    public.set_member_role(
        '14000000-0000-4000-8000-000000000003',
        '14111111-0000-4000-8000-000000000001',
        '14000000-0000-4000-8000-000000000003',
        'staff'
    ),
    'last-owner',
    'last_owner_cannot_be_removed: demoting newly sole active owner refused'
);

-- Restore Owner 1 as owner
update public.tenant_members
set role = 'owner'
where tenant_id = '14111111-0000-4000-8000-000000000001' and user_id = '14000000-0000-4000-8000-000000000002';

-- ------------------------------------------------------------------------------
-- 4. manager_cannot_change_rules
-- ------------------------------------------------------------------------------

select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000004', -- Manager Bob
        '14111111-0000-4000-8000-000000000001',
        '{"cooldown_minutes": 15}'::jsonb
    ),
    'unauthorized',
    'manager_cannot_change_rules: manager updating rules refused'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000004', -- Manager Bob
        '14111111-0000-4000-8000-000000000001',
        '{"primaryColor": "#223344"}'::jsonb
    ),
    'updated',
    'manager_cannot_change_rules: manager updating brand is permitted'
);

-- ------------------------------------------------------------------------------
-- 5. invite_accept_requires_matching_confirmed_email & expired_invite_rejected
-- ------------------------------------------------------------------------------

select is(
    public.invite_member(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        'invitee-alice@test.local',
        'staff'
    ),
    'invited',
    'invite_member: owner invites new email successfully'
);

do $$
declare
  v_iid uuid;
begin
  select id into v_iid from public.tenant_invites where email = 'invitee-alice@test.local' and tenant_id = '14111111-0000-4000-8000-000000000001';
  perform set_config('test.alice_invite_id', v_iid::text, true);
end;
$$;

-- Mismatch email
select is(
    public.accept_invite(
        '14000000-0000-4000-8000-000000000006', -- Dave's user id
        current_setting('test.alice_invite_id')::uuid,
        'Dave Stranger'
    ),
    'email-mismatch',
    'invite_accept_requires_matching_confirmed_email: mismatch email rejected'
);

-- Unconfirmed email
insert into public.tenant_invites (tenant_id, email, role, invited_by)
values ('14111111-0000-4000-8000-000000000001', 'invitee-unconfirmed@test.local', 'staff', '14000000-0000-4000-8000-000000000002');

select is(
    public.accept_invite(
        '14000000-0000-4000-8000-000000000008',
        (select id from public.tenant_invites where email = 'invitee-unconfirmed@test.local'),
        'Unconfirmed User'
    ),
    'email-mismatch',
    'invite_accept_requires_matching_confirmed_email: unconfirmed email rejected'
);

-- Anonymous user
insert into public.tenant_invites (tenant_id, email, role, invited_by)
values ('14111111-0000-4000-8000-000000000001', 'invitee-anon@test.local', 'staff', '14000000-0000-4000-8000-000000000002');

select is(
    public.accept_invite(
        '14000000-0000-4000-8000-000000000009',
        (select id from public.tenant_invites where email = 'invitee-anon@test.local'),
        'Anon User'
    ),
    'email-mismatch',
    'invite_accept_requires_matching_confirmed_email: anonymous user rejected'
);

-- Expired invite
insert into public.tenant_invites (tenant_id, email, role, invited_by, expires_at)
values ('14111111-0000-4000-8000-000000000001', 'invitee-alice@test.local', 'staff', '14000000-0000-4000-8000-000000000002', now() - interval '1 hour');

select is(
    public.accept_invite(
        '14000000-0000-4000-8000-000000000007',
        (select id from public.tenant_invites where email = 'invitee-alice@test.local' and expires_at < now()),
        'Alice Expired'
    ),
    'expired',
    'expired_invite_rejected: expired invite is rejected'
);

-- Successful accept
select is(
    public.accept_invite(
        '14000000-0000-4000-8000-000000000007',
        current_setting('test.alice_invite_id')::uuid,
        'Alice Worker'
    ),
    'accepted',
    'accept_invite: valid confirmed non-anon user accepted'
);

-- Re-accept rejected
select is(
    public.accept_invite(
        '14000000-0000-4000-8000-000000000007',
        current_setting('test.alice_invite_id')::uuid,
        'Alice Worker'
    ),
    'invalid-invite',
    'accept_invite: already accepted invite returns invalid-invite'
);

-- Already member invite rejected
select is(
    public.invite_member(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        'invitee-alice@test.local',
        'staff'
    ),
    'already-member',
    'invite_member: already active member returns already-member'
);

-- ------------------------------------------------------------------------------
-- 6. rules_patch_rejects_out_of_bounds_and_unknown_keys
-- ------------------------------------------------------------------------------

select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"unknown_key": 123}'::jsonb
    ),
    'invalid-patch',
    'rules_patch_rejects_out_of_bounds_and_unknown_keys: unknown key rejected'
);

select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"cooldown_minutes": 2000}'::jsonb
    ),
    'invalid-patch',
    'rules_patch_rejects_out_of_bounds_and_unknown_keys: cooldown > 1440 rejected'
);

select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"reward_threshold": 1}'::jsonb
    ),
    'invalid-patch',
    'rules_patch_rejects_out_of_bounds_and_unknown_keys: reward_threshold < 3 rejected'
);

select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"reward_label": ""}'::jsonb
    ),
    'invalid-patch',
    'rules_patch_rejects_out_of_bounds_and_unknown_keys: empty reward label rejected'
);

-- ------------------------------------------------------------------------------
-- 7. rules_change_applies_on_next_stamp
-- ------------------------------------------------------------------------------

-- Set initial cooldown to 30 mins
update public.tenant_settings set cooldown_minutes = 30 where tenant_id = '14111111-0000-4000-8000-000000000001';

-- Customer 1 stamps at T0
select is(
    (public.stamp_card_nfc('14000000-0000-4000-8000-000000000010', 'tag_shop_a_001', '2026-11-06 10:00:00+08')->>'result'),
    'stamped',
    'rules_change_applies_on_next_stamp: initial stamp succeeds at T0'
);

-- Customer 1 stamps at T0 + 10 mins: rejected by 30 min cooldown
select is(
    (public.stamp_card_nfc('14000000-0000-4000-8000-000000000010', 'tag_shop_a_001', '2026-11-06 10:10:00+08')->>'result'),
    'cooldown',
    'rules_change_applies_on_next_stamp: tap at +10m blocked by 30m cooldown'
);

-- Owner updates cooldown to 5 minutes
select is(
    public.update_tenant_rules(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"cooldown_minutes": 5}'::jsonb
    ),
    'updated',
    'rules_change_applies_on_next_stamp: owner updates cooldown to 5m'
);

-- Next tap at T0 + 10 mins: now succeeds because 10m > 5m cooldown!
select is(
    (public.stamp_card_nfc('14000000-0000-4000-8000-000000000010', 'tag_shop_a_001', '2026-11-06 10:10:00+08')->>'result'),
    'stamped',
    'rules_change_applies_on_next_stamp: next tap obeys updated cooldown'
);

-- ------------------------------------------------------------------------------
-- 8. preview_counts_newly_redeemable
-- ------------------------------------------------------------------------------

-- Reset stamps for preview test:
-- Threshold is 10.
-- Customer 1: 9 stamps (was not redeemable, becomes redeemable at threshold 8)
-- Customer 2: 5 stamps (partial progress at 8)
-- Customer 3: 12 stamps (was already redeemable at 10)
delete from public.stamps where tenant_id = '14111111-0000-4000-8000-000000000001';

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000010', 'tag_shop_a_001', 'nfc', '2026-11-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 9) as g;

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000011', 'tag_shop_a_001', 'nfc', '2026-11-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 5) as g;

insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
select '14111111-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000012', 'tag_shop_a_001', 'nfc', '2026-11-01 00:00:00+08'::timestamptz + pg_catalog.make_interval(days => g)
from generate_series(1, 12) as g;

-- Current threshold = 10; preview patch with reward_threshold = 8
do $$
declare
  v_prev jsonb;
begin
  v_prev := public.preview_tenant_rules(
      '14000000-0000-4000-8000-000000000004', -- Manager Bob (read-only allowed for manager)
      '14111111-0000-4000-8000-000000000001',
      '{"reward_threshold": 8}'::jsonb
  );
  perform set_config('test.preview_json', v_prev::text, true);
end;
$$;

select is(
    (current_setting('test.preview_json')::jsonb->>'currentThreshold')::int,
    10,
    'preview_counts_newly_redeemable: current threshold is 10'
);

select is(
    (current_setting('test.preview_json')::jsonb->>'newThreshold')::int,
    8,
    'preview_counts_newly_redeemable: new threshold is 8'
);

select is(
    (current_setting('test.preview_json')::jsonb->>'cardsNewlyRedeemable')::int,
    1,
    'preview_counts_newly_redeemable: cardsNewlyRedeemable is 1'
);

select is(
    (current_setting('test.preview_json')::jsonb->>'cardsWithPartialProgress')::int,
    1,
    'preview_counts_newly_redeemable: cardsWithPartialProgress is 1'
);

-- ------------------------------------------------------------------------------
-- 9. brand_rejects_bad_color_and_foreign_url
-- ------------------------------------------------------------------------------

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"primaryColor": "blue"}'::jsonb
    ),
    'invalid-brand',
    'brand_rejects_bad_color_and_foreign_url: non-hex color rejected'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"logoUrl": "https://evil.com/phish.png"}'::jsonb
    ),
    'invalid-brand',
    'brand_rejects_bad_color_and_foreign_url: foreign url rejected'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"logoUrl": "https://supabase.co/storage/v1/object/public/tenant-brand/14222222-0000-4000-8000-000000000002/logo.png"}'::jsonb
    ),
    'invalid-brand',
    'brand_rejects_bad_color_and_foreign_url: foreign tenant storage url rejected'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"tagline": "This tagline is deliberately way too long to pass the 60 characters limit check"}'::jsonb
    ),
    'invalid-brand',
    'brand_rejects_bad_color_and_foreign_url: tagline > 60 chars rejected'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"primaryColor": "#112233", "accentColor": "#ffffff", "tagline": "Best Coffee", "logoUrl": "/images/logo.png", "cardArtUrl": "https://supabase.co/storage/v1/object/public/tenant-brand/14111111-0000-4000-8000-000000000001/art.png"}'::jsonb
    ),
    'updated',
    'brand_rejects_bad_color_and_foreign_url: valid brand accepted'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"stampIcon": "rocket-launcher"}'::jsonb
    ),
    'invalid-brand',
    'brand_stamp_icon: unknown icon rejected'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"stampIcon": "scissors"}'::jsonb
    ),
    'updated',
    'brand_stamp_icon: known icon accepted'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"stampIcon": "pickleball"}'::jsonb
    ),
    'updated',
    'brand_stamp_icon: pickleball icon accepted'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"stampIcon": "shoe"}'::jsonb
    ),
    'updated',
    'brand_stamp_icon: shoe icon accepted'
);

select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"stampIcon": "vape"}'::jsonb
    ),
    'updated',
    'brand_stamp_icon: vape icon accepted'
);

-- Partial brand update preserves omitted existing fields
select is(
    public.update_tenant_brand(
        '14000000-0000-4000-8000-000000000002',
        '14111111-0000-4000-8000-000000000001',
        '{"primaryColor": "#abcdef"}'::jsonb
    ),
    'updated',
    'brand_partial_update: partial update with only primaryColor succeeds'
);

select is(
    (select brand->>'primaryColor' from public.tenant_settings where tenant_id = '14111111-0000-4000-8000-000000000001'),
    '#abcdef',
    'brand_partial_update: primaryColor updated'
);

select is(
    (select brand->>'accentColor' from public.tenant_settings where tenant_id = '14111111-0000-4000-8000-000000000001'),
    '#ffffff',
    'brand_partial_update: accentColor preserved'
);

select is(
    (select brand->>'tagline' from public.tenant_settings where tenant_id = '14111111-0000-4000-8000-000000000001'),
    'Best Coffee',
    'brand_partial_update: tagline preserved'
);

select is(
    (select brand->>'logoUrl' from public.tenant_settings where tenant_id = '14111111-0000-4000-8000-000000000001'),
    '/images/logo.png',
    'brand_partial_update: logoUrl preserved'
);

-- ------------------------------------------------------------------------------
-- 10. tenant_invites RLS
-- ------------------------------------------------------------------------------

set local role anon;
select throws_ok(
    $$select count(*) from public.tenant_invites$$,
    '42501',
    null,
    'tenant_invites RLS: anon select denied'
);
reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000005"}'; -- Staff Charlie
select is(
    (select count(*)::int from public.tenant_invites where tenant_id = '14111111-0000-4000-8000-000000000001'),
    0,
    'tenant_invites RLS: staff cannot see tenant invites'
);
reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000002"}'; -- Owner Alice
select is(
    (select count(*)::int from public.tenant_invites where tenant_id = '14111111-0000-4000-8000-000000000001') > 0,
    true,
    'tenant_invites RLS: owner can see tenant invites'
);
reset role;

-- ------------------------------------------------------------------------------
-- 11. brand_upload_scoped_to_own_tenant_folder
-- ------------------------------------------------------------------------------

-- Owner can upload to own tenant folder
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000002"}';
select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('tenant-brand', '14111111-0000-4000-8000-000000000001/logo.png')$$,
    'brand_upload_scoped_to_own_tenant_folder: owner can upload to own tenant folder'
);
reset role;

-- Manager can upload to own tenant folder
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000004"}';
select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('tenant-brand', '14111111-0000-4000-8000-000000000001/banner.webp')$$,
    'brand_upload_scoped_to_own_tenant_folder: manager can upload to own tenant folder'
);
reset role;

-- Staff role cannot upload to own tenant folder
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000005"}';
select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('tenant-brand', '14111111-0000-4000-8000-000000000001/staff-denied.png')$$,
    '42501',
    null,
    'brand_upload_scoped_to_own_tenant_folder: staff cannot upload to own tenant folder'
);
reset role;

-- Owner cannot upload to other tenant folder
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000002"}';
select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('tenant-brand', '14222222-0000-4000-8000-000000000002/cross-tenant.png')$$,
    '42501',
    null,
    'brand_upload_scoped_to_own_tenant_folder: owner cannot upload to other tenant folder'
);
reset role;

-- Manager can update own tenant object
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000004"}';
select lives_ok(
    $$update storage.objects set metadata = '{"size": 1024}'::jsonb
      where bucket_id = 'tenant-brand' and name = '14111111-0000-4000-8000-000000000001/banner.webp'$$,
    'brand_upload_scoped_to_own_tenant_folder: manager can update own tenant object'
);

-- Manager can delete own tenant object
set local "storage.allow_delete_query" to 'true';
select lives_ok(
    $$delete from storage.objects
      where bucket_id = 'tenant-brand' and name = '14111111-0000-4000-8000-000000000001/banner.webp'$$,
    'brand_upload_scoped_to_own_tenant_folder: manager can delete own tenant object'
);
reset role;

-- Public select allows anon to read tenant-brand objects
set local role anon;
select is(
    (select count(*)::int from storage.objects where bucket_id = 'tenant-brand'),
    1,
    'brand_upload_scoped_to_own_tenant_folder: public select allows anon to read tenant-brand objects'
);
reset role;

-- ------------------------------------------------------------------------------
-- 12. brand_bucket_rejects_svg
-- ------------------------------------------------------------------------------

-- Bucket exists and is public
select is(
    (select public from storage.buckets where id = 'tenant-brand'),
    true,
    'brand_bucket_rejects_svg: tenant-brand bucket is public'
);

-- File size limit is 512 KB
select is(
    (select file_size_limit from storage.buckets where id = 'tenant-brand'),
    524288::bigint,
    'brand_bucket_rejects_svg: file_size_limit is 512KB'
);

-- Allowed mime types match specification
select is(
    (select allowed_mime_types from storage.buckets where id = 'tenant-brand'),
    array['image/png', 'image/jpeg', 'image/webp']::text[],
    'brand_bucket_rejects_svg: allowed_mime_types match specification'
);

-- SVG mime type is not allowed
select is(
    (select ('image/svg+xml' = any(allowed_mime_types) or 'image/svg' = any(allowed_mime_types))
     from storage.buckets where id = 'tenant-brand'),
    false,
    'brand_bucket_rejects_svg: svg mime type rejected from bucket'
);

-- SVG extension upload rejected
set local role authenticated;
set local "request.jwt.claims" to '{"sub": "14000000-0000-4000-8000-000000000002"}';
select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('tenant-brand', '14111111-0000-4000-8000-000000000001/logo.svg')$$,
    '42501',
    null,
    'brand_bucket_rejects_svg: svg extension rejected'
);
reset role;

select * from finish();
rollback;
