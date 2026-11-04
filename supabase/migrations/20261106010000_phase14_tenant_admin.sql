-- Migration: 20261106010000_phase14_tenant_admin.sql
-- Description: Phase 14 tenant admin, invites, rules patch/preview, and brand RPCs.
--              Adds table public.tenant_invites (RLS enabled, owner/manager scoped),
--              public.platform_create_tenant, public.invite_member, public.accept_invite,
--              public.set_member_role, public.set_member_active, public.update_tenant_rules,
--              public.preview_tenant_rules, and public.update_tenant_brand.

-- -----------------------------------------------------------------------------
-- 1. TENANT INVITES TABLE
-- -----------------------------------------------------------------------------

create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('owner', 'manager', 'staff')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists tenant_invites_tenant_idx on public.tenant_invites (tenant_id);
create index if not exists tenant_invites_email_idx on public.tenant_invites (email);

alter table public.tenant_invites enable row level security;

revoke all on table public.tenant_invites from public, anon, authenticated;
grant select on table public.tenant_invites to authenticated;
grant all on table public.tenant_invites to service_role;

drop policy if exists tenant_invites_select_policy on public.tenant_invites;
create policy tenant_invites_select_policy
  on public.tenant_invites
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tenant_members as tm
      where tm.tenant_id = tenant_invites.tenant_id
        and tm.user_id = (select auth.uid())
        and tm.active = true
        and tm.role in ('owner', 'manager')
    )
  );

-- -----------------------------------------------------------------------------
-- 2. PLATFORM CREATE TENANT
-- -----------------------------------------------------------------------------

create or replace function public.platform_create_tenant(
  p_actor uuid,
  p_slug text,
  p_name text,
  p_owner_email text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_name text;
  v_email text;
  v_tenant_id uuid;
  v_invite_id uuid;
begin
  if p_actor is null or not private.is_platform_admin(p_actor) then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_slug := pg_catalog.btrim(p_slug);
  if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return pg_catalog.jsonb_build_object('result', 'invalid-slug');
  end if;

  if exists (select 1 from public.tenants as t where t.slug = v_slug) then
    return pg_catalog.jsonb_build_object('result', 'duplicate-slug');
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_owner_email));
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return pg_catalog.jsonb_build_object('result', 'invalid-email');
  end if;

  v_name := pg_catalog.btrim(p_name);
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80 then
    return pg_catalog.jsonb_build_object('result', 'invalid-name');
  end if;

  v_tenant_id := gen_random_uuid();
  v_invite_id := gen_random_uuid();

  insert into public.tenants (id, slug, name, status)
  values (v_tenant_id, v_slug, v_name, 'trial');

  insert into public.tenant_settings (tenant_id)
  values (v_tenant_id);

  insert into public.tenant_invites (id, tenant_id, email, role, invited_by)
  values (v_invite_id, v_tenant_id, v_email, 'owner', p_actor);

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    v_tenant_id,
    p_actor,
    'platform_create_tenant',
    v_tenant_id::text,
    pg_catalog.jsonb_build_object('slug', v_slug, 'name', v_name, 'owner_email', v_email, 'invite_id', v_invite_id)
  );

  return pg_catalog.jsonb_build_object(
    'result', 'created',
    'tenantId', v_tenant_id,
    'inviteId', v_invite_id
  );
end;
$$;

revoke all on function public.platform_create_tenant(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.platform_create_tenant(uuid, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. INVITE MEMBER
-- -----------------------------------------------------------------------------

create or replace function public.invite_member(
  p_actor uuid,
  p_tenant uuid,
  p_email text,
  p_role text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_invite_id uuid;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return 'unauthorized';
  end if;

  if p_role is null or p_role not in ('owner', 'manager', 'staff') then
    return 'invalid-role';
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid-email';
  end if;

  if exists (
    select 1
    from public.tenant_members as tm
    join auth.users as u on u.id = tm.user_id
    where tm.tenant_id = p_tenant
      and pg_catalog.lower(u.email) = v_email
      and tm.active = true
  ) then
    return 'already-member';
  end if;

  v_invite_id := gen_random_uuid();

  insert into public.tenant_invites (id, tenant_id, email, role, invited_by)
  values (v_invite_id, p_tenant, v_email, p_role, p_actor);

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'invite_member',
    v_email,
    pg_catalog.jsonb_build_object('role', p_role, 'invite_id', v_invite_id)
  );

  return 'invited';
end;
$$;

revoke all on function public.invite_member(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.invite_member(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. ACCEPT INVITE
-- -----------------------------------------------------------------------------

create or replace function public.accept_invite(
  p_user uuid,
  p_invite uuid,
  p_display_name text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_invite_email text;
  v_role text;
  v_expires_at timestamptz;
  v_accepted_at timestamptz;
  v_user_email text;
  v_is_anon boolean;
  v_is_confirmed boolean;
  v_display_name text;
begin
  if p_user is null or p_invite is null then
    return 'invalid-invite';
  end if;

  select inv.tenant_id, inv.email, inv.role, inv.expires_at, inv.accepted_at
  into v_tenant, v_invite_email, v_role, v_expires_at, v_accepted_at
  from public.tenant_invites as inv
  where inv.id = p_invite
  for update;

  if not found or v_accepted_at is not null then
    return 'invalid-invite';
  end if;

  if v_expires_at < pg_catalog.now() then
    return 'expired';
  end if;

  select
    u.email,
    coalesce(u.is_anonymous, false),
    (u.email_confirmed_at is not null or u.confirmed_at is not null)
  into v_user_email, v_is_anon, v_is_confirmed
  from auth.users as u
  where u.id = p_user;

  if not found or v_is_anon or not v_is_confirmed or pg_catalog.lower(v_user_email) is distinct from v_invite_email then
    return 'email-mismatch';
  end if;

  v_display_name := pg_catalog.btrim(p_display_name);
  if v_display_name is null or pg_catalog.char_length(v_display_name) not between 1 and 120 then
    v_display_name := pg_catalog.split_part(v_user_email, '@', 1);
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
  values (v_tenant, p_user, v_role, v_display_name, true)
  on conflict (tenant_id, user_id)
  do update set role = excluded.role, display_name = excluded.display_name, active = true;

  update public.tenant_invites
  set accepted_at = pg_catalog.now()
  where id = p_invite;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    v_tenant,
    p_user,
    'accept_invite',
    p_invite::text,
    pg_catalog.jsonb_build_object('role', v_role, 'email', v_invite_email)
  );

  return 'accepted';
end;
$$;

revoke all on function public.accept_invite(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_invite(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. SET MEMBER ROLE
-- -----------------------------------------------------------------------------

create or replace function public.set_member_role(
  p_actor uuid,
  p_tenant uuid,
  p_user uuid,
  p_role text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_target_active boolean;
  v_owner_count integer;
begin
  if p_tenant is null or p_user is null then
    raise exception 'p_tenant and p_user must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return 'unauthorized';
  end if;

  if p_role is null or p_role not in ('owner', 'manager', 'staff') then
    return 'invalid-role';
  end if;

  select tm.role, tm.active
  into v_target_role, v_target_active
  from public.tenant_members as tm
  where tm.tenant_id = p_tenant
    and tm.user_id = p_user
  for update;

  if not found then
    return 'not-found';
  end if;

  if v_target_role = 'owner' and v_target_active = true and p_role is distinct from 'owner' then
    select count(*)::integer
    into v_owner_count
    from public.tenant_members
    where tenant_id = p_tenant
      and role = 'owner'
      and active = true;

    if v_owner_count <= 1 then
      return 'last-owner';
    end if;
  end if;

  update public.tenant_members
  set role = p_role
  where tenant_id = p_tenant
    and user_id = p_user;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'set_member_role',
    p_user::text,
    pg_catalog.jsonb_build_object('role', p_role, 'previous_role', v_target_role)
  );

  return 'updated';
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_role(uuid, uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. SET MEMBER ACTIVE
-- -----------------------------------------------------------------------------

create or replace function public.set_member_active(
  p_actor uuid,
  p_tenant uuid,
  p_user uuid,
  p_active boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role text;
  v_target_active boolean;
  v_owner_count integer;
begin
  if p_tenant is null or p_user is null then
    raise exception 'p_tenant and p_user must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return 'unauthorized';
  end if;

  if p_active is null then
    raise exception 'p_active must not be null';
  end if;

  select tm.role, tm.active
  into v_target_role, v_target_active
  from public.tenant_members as tm
  where tm.tenant_id = p_tenant
    and tm.user_id = p_user
  for update;

  if not found then
    return 'not-found';
  end if;

  if v_target_role = 'owner' and v_target_active = true and p_active = false then
    select count(*)::integer
    into v_owner_count
    from public.tenant_members
    where tenant_id = p_tenant
      and role = 'owner'
      and active = true;

    if v_owner_count <= 1 then
      return 'last-owner';
    end if;
  end if;

  update public.tenant_members
  set active = p_active
  where tenant_id = p_tenant
    and user_id = p_user;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'set_member_active',
    p_user::text,
    pg_catalog.jsonb_build_object('active', p_active)
  );

  return 'updated';
end;
$$;

revoke all on function public.set_member_active(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_member_active(uuid, uuid, uuid, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 7. UPDATE TENANT RULES
-- -----------------------------------------------------------------------------

create or replace function public.update_tenant_rules(
  p_actor uuid,
  p_tenant uuid,
  p_patch jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return 'unauthorized';
  end if;

  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) != 'object' then
    return 'invalid-patch';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_patch) as k
    where k not in ('cooldown_minutes', 'daily_cap', 'reward_threshold', 'tag_throttle_seconds', 'reward_label')
  ) then
    return 'invalid-patch';
  end if;

  begin
    update public.tenant_settings
    set cooldown_minutes = case when p_patch ? 'cooldown_minutes' then (p_patch->>'cooldown_minutes')::integer else cooldown_minutes end,
        daily_cap = case when p_patch ? 'daily_cap' then (p_patch->>'daily_cap')::integer else daily_cap end,
        reward_threshold = case when p_patch ? 'reward_threshold' then (p_patch->>'reward_threshold')::integer else reward_threshold end,
        tag_throttle_seconds = case when p_patch ? 'tag_throttle_seconds' then (p_patch->>'tag_throttle_seconds')::integer else tag_throttle_seconds end,
        reward_label = case when p_patch ? 'reward_label' then pg_catalog.btrim(p_patch->>'reward_label') else reward_label end,
        updated_at = pg_catalog.now()
    where tenant_id = p_tenant;

    if not found then
      return 'unauthorized';
    end if;
  exception
    when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
      return 'invalid-patch';
  end;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'update_tenant_rules',
    p_tenant::text,
    p_patch
  );

  return 'updated';
end;
$$;

revoke all on function public.update_tenant_rules(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_tenant_rules(uuid, uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 8. PREVIEW TENANT RULES
-- -----------------------------------------------------------------------------

create or replace function public.preview_tenant_rules(
  p_actor uuid,
  p_tenant uuid,
  p_patch jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_curr_threshold integer;
  v_new_threshold integer;
  v_newly_redeemable integer;
  v_partial_progress integer;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') not in ('owner', 'manager') then
    raise exception 'unauthorized';
  end if;

  select ts.reward_threshold
  into v_curr_threshold
  from public.tenant_settings as ts
  where ts.tenant_id = p_tenant;

  if not found then
    raise exception 'tenant not found';
  end if;

  if p_patch is not null and p_patch ? 'reward_threshold' then
    begin
      v_new_threshold := (p_patch->>'reward_threshold')::integer;
    exception
      when others then
        v_new_threshold := v_curr_threshold;
    end;
  else
    v_new_threshold := v_curr_threshold;
  end if;

  select
    coalesce(count(*) filter (where cb.available_stamps < v_curr_threshold and cb.available_stamps >= v_new_threshold), 0)::integer,
    coalesce(count(*) filter (where cb.available_stamps > 0 and cb.available_stamps < v_new_threshold), 0)::integer
  into v_newly_redeemable, v_partial_progress
  from public.card_balances as cb
  where cb.tenant_id = p_tenant;

  return pg_catalog.jsonb_build_object(
    'cardsNewlyRedeemable', v_newly_redeemable,
    'cardsWithPartialProgress', v_partial_progress,
    'currentThreshold', v_curr_threshold,
    'newThreshold', v_new_threshold
  );
end;
$$;

revoke all on function public.preview_tenant_rules(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.preview_tenant_rules(uuid, uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 9. UPDATE TENANT BRAND
-- -----------------------------------------------------------------------------

create or replace function public.update_tenant_brand(
  p_actor uuid,
  p_tenant uuid,
  p_brand jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary text;
  v_accent text;
  v_tagline text;
  v_logo text;
  v_card_art text;
  v_storage_pattern text;
  v_clean_brand jsonb;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') not in ('owner', 'manager') then
    return 'unauthorized';
  end if;

  if p_brand is null or pg_catalog.jsonb_typeof(p_brand) != 'object' then
    return 'invalid-brand';
  end if;

  -- Regex pattern for storage object public URL for this tenant:
  v_storage_pattern := '^https://[^/\s]+/storage/v1/object/public/tenant-brand/' || p_tenant::text || '/.*$';

  if p_brand ? 'primaryColor' and p_brand->>'primaryColor' is not null then
    v_primary := pg_catalog.btrim(p_brand->>'primaryColor');
    if v_primary !~ '^#[0-9A-Fa-f]{6}$' then
      return 'invalid-brand';
    end if;
  end if;

  if p_brand ? 'accentColor' and p_brand->>'accentColor' is not null then
    v_accent := pg_catalog.btrim(p_brand->>'accentColor');
    if v_accent !~ '^#[0-9A-Fa-f]{6}$' then
      return 'invalid-brand';
    end if;
  end if;

  if p_brand ? 'tagline' and p_brand->>'tagline' is not null then
    v_tagline := pg_catalog.btrim(p_brand->>'tagline');
    if pg_catalog.char_length(v_tagline) > 60 then
      return 'invalid-brand';
    end if;
  end if;

  if p_brand ? 'logoUrl' and p_brand->>'logoUrl' is not null then
    v_logo := pg_catalog.btrim(p_brand->>'logoUrl');
    if not (
      (v_logo ~ '^/([^/\\].*)?$' and v_logo !~ '^//')
      or v_logo ~ v_storage_pattern
    ) then
      return 'invalid-brand';
    end if;
  end if;

  if p_brand ? 'cardArtUrl' and p_brand->>'cardArtUrl' is not null then
    v_card_art := pg_catalog.btrim(p_brand->>'cardArtUrl');
    if not (
      (v_card_art ~ '^/([^/\\].*)?$' and v_card_art !~ '^//')
      or v_card_art ~ v_storage_pattern
    ) then
      return 'invalid-brand';
    end if;
  end if;

  v_clean_brand := pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'primaryColor', v_primary,
      'accentColor', v_accent,
      'tagline', v_tagline,
      'logoUrl', v_logo,
      'cardArtUrl', v_card_art
    )
  );

  update public.tenant_settings
  set brand = v_clean_brand,
      updated_at = pg_catalog.now()
  where tenant_id = p_tenant;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'update_tenant_brand',
    p_tenant::text,
    v_clean_brand
  );

  return 'updated';
end;
$$;

revoke all on function public.update_tenant_brand(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_tenant_brand(uuid, uuid, jsonb) to service_role;
