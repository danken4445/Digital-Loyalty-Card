-- Migration: 20261106015000_phase14_locations.sql
-- Description: Phase 14 Task 2A: Branches / Locations (database).
--              Adds table public.locations (RLS enabled, staff and cardholder scoped),
--              expand-only columns on tenants, tags, stamps with composite FKs,
--              backfill of default locations, location management RPCs,
--              card-mode separation with child tenant promotion,
--              create_tag_at / rotate_tag_at with location support, and
--              updates stamp_card_nfc to record tag location_id.

-- -----------------------------------------------------------------------------
-- 1. PARENT TENANT REFERENCE
-- -----------------------------------------------------------------------------

alter table public.tenants add column if not exists parent_tenant_id uuid null references public.tenants(id) on delete set null;
create index if not exists tenants_parent_tenant_idx on public.tenants (parent_tenant_id);

-- -----------------------------------------------------------------------------
-- 2. LOCATIONS TABLE
-- -----------------------------------------------------------------------------

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  address text null check (address is null or char_length(btrim(address)) <= 200),
  active boolean not null default true,
  card_mode text not null default 'shared' check (card_mode in ('shared', 'separate')),
  child_tenant_id uuid null references public.tenants(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint locations_tenant_name_key unique (tenant_id, name),
  constraint locations_id_tenant_key unique (id, tenant_id)
);

create index if not exists locations_tenant_idx on public.locations (tenant_id);

alter table public.locations enable row level security;

revoke all on table public.locations from public, anon, authenticated;
grant select on table public.locations to authenticated;
grant all on table public.locations to service_role;

drop policy if exists locations_select_policy on public.locations;
create policy locations_select_policy
  on public.locations
  for select
  to authenticated
  using (
    tenant_id in (select private.staff_tenant_ids())
    or (
      active = true
      and exists (
        select 1
        from public.customer_cards as cc
        where cc.tenant_id = locations.tenant_id
          and cc.customer_id = (select auth.uid())
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. EXPAND TAGS AND STAMPS WITH COMPOSITE FK
-- -----------------------------------------------------------------------------

alter table public.tags add column if not exists location_id uuid null;
alter table public.stamps add column if not exists location_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'tags_location_tenant_fkey'
  ) then
    alter table public.tags
      add constraint tags_location_tenant_fkey
      foreign key (location_id, tenant_id)
      references public.locations (id, tenant_id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint where conname = 'stamps_location_tenant_fkey'
  ) then
    alter table public.stamps
      add constraint stamps_location_tenant_fkey
      foreign key (location_id, tenant_id)
      references public.locations (id, tenant_id)
      on delete set null;
  end if;
end;
$$;

create index if not exists tags_location_idx on public.tags (location_id);
create index if not exists stamps_location_idx on public.stamps (location_id);

-- -----------------------------------------------------------------------------
-- 4. BACKFILL DEFAULT LOCATIONS FOR EXISTING TENANTS
-- -----------------------------------------------------------------------------

insert into public.locations (tenant_id, name)
select id, name from public.tenants
on conflict (tenant_id, name) do nothing;

-- -----------------------------------------------------------------------------
-- 5. CREATE AND UPDATE LOCATION RPCS
-- -----------------------------------------------------------------------------

create or replace function public.create_location(
  p_actor uuid,
  p_tenant uuid,
  p_name text,
  p_address text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_address text;
  v_loc_id uuid;
begin
  if p_tenant is null then
    raise exception 'p_tenant must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  v_name := pg_catalog.btrim(p_name);
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80 then
    return pg_catalog.jsonb_build_object('result', 'invalid-name');
  end if;

  v_address := nullif(pg_catalog.btrim(p_address), '');
  if v_address is not null and pg_catalog.char_length(v_address) > 200 then
    return pg_catalog.jsonb_build_object('result', 'invalid-address');
  end if;

  if exists (
    select 1 from public.locations
    where tenant_id = p_tenant and name = v_name
  ) then
    return pg_catalog.jsonb_build_object('result', 'duplicate');
  end if;

  v_loc_id := gen_random_uuid();

  insert into public.locations (id, tenant_id, name, address, active, card_mode)
  values (v_loc_id, p_tenant, v_name, v_address, true, 'shared');

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'create_location',
    v_loc_id::text,
    pg_catalog.jsonb_build_object('name', v_name, 'address', v_address)
  );

  return pg_catalog.jsonb_build_object(
    'result', 'created',
    'locationId', v_loc_id
  );
end;
$$;

revoke all on function public.create_location(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_location(uuid, uuid, text, text) to service_role;

create or replace function public.update_location(
  p_actor uuid,
  p_tenant uuid,
  p_location uuid,
  p_name text,
  p_address text,
  p_active boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_address text;
begin
  if p_tenant is null or p_location is null then
    raise exception 'p_tenant and p_location must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return 'unauthorized';
  end if;

  v_name := pg_catalog.btrim(p_name);
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 80 then
    return 'invalid-name';
  end if;

  v_address := nullif(pg_catalog.btrim(p_address), '');
  if v_address is not null and pg_catalog.char_length(v_address) > 200 then
    return 'invalid-address';
  end if;

  if not exists (
    select 1 from public.locations
    where id = p_location and tenant_id = p_tenant
  ) then
    return 'not-found';
  end if;

  if exists (
    select 1 from public.locations
    where tenant_id = p_tenant
      and name = v_name
      and id is distinct from p_location
  ) then
    return 'duplicate';
  end if;

  update public.locations
  set name = v_name,
      address = v_address,
      active = coalesce(p_active, active)
  where id = p_location and tenant_id = p_tenant;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'update_location',
    p_location::text,
    pg_catalog.jsonb_build_object('name', v_name, 'address', v_address, 'active', p_active)
  );

  return 'updated';
end;
$$;

revoke all on function public.update_location(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_location(uuid, uuid, uuid, text, text, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 6. PLATFORM CREATE TENANT (AMENDED WITH DEFAULT LOCATION)
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

  insert into public.locations (tenant_id, name)
  values (v_tenant_id, v_name);

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
-- 7. SET LOCATION CARD MODE & PROMOTION
-- -----------------------------------------------------------------------------

create or replace function public.set_location_card_mode(
  p_actor uuid,
  p_tenant uuid,
  p_location uuid,
  p_mode text,
  p_child_slug text default null,
  p_confirm_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loc record;
  v_parent record;
  v_settings record;
  v_child_slug text;
  v_child_tenant_id uuid;
  v_child_default_loc_id uuid;
begin
  if p_tenant is null or p_location is null then
    raise exception 'p_tenant and p_location must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') is distinct from 'owner' then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  if p_mode is null or p_mode not in ('shared', 'separate') then
    return pg_catalog.jsonb_build_object('result', 'invalid-mode');
  end if;

  select id, tenant_id, name, address, active, card_mode, child_tenant_id
  into v_loc
  from public.locations
  where id = p_location and tenant_id = p_tenant
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('result', 'unauthorized');
  end if;

  if v_loc.card_mode = 'separate' then
    if p_mode = 'shared' then
      return pg_catalog.jsonb_build_object('result', 'cannot-revert');
    else
      return pg_catalog.jsonb_build_object('result', 'already-separate');
    end if;
  end if;

  if p_mode = 'shared' then
    return pg_catalog.jsonb_build_object('result', 'updated');
  end if;

  -- Promotion to 'separate':
  if p_confirm_name is distinct from v_loc.name then
    return pg_catalog.jsonb_build_object('result', 'confirmation-mismatch');
  end if;

  v_child_slug := pg_catalog.btrim(p_child_slug);
  if v_child_slug is null or v_child_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return pg_catalog.jsonb_build_object('result', 'invalid-slug');
  end if;

  if exists (select 1 from public.tenants where slug = v_child_slug) then
    return pg_catalog.jsonb_build_object('result', 'duplicate-slug');
  end if;

  -- Hierarchical advisory locks (1002 tag then 1001 customer)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant::text, 1002));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant::text, 1001));

  select status, name into v_parent from public.tenants where id = p_tenant;
  select cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone, currency, reward_label, brand, perks
  into v_settings
  from public.tenant_settings where tenant_id = p_tenant;

  v_child_tenant_id := gen_random_uuid();
  v_child_default_loc_id := gen_random_uuid();

  insert into public.tenants (id, slug, name, status, parent_tenant_id)
  values (v_child_tenant_id, v_child_slug, v_loc.name, v_parent.status, p_tenant);

  insert into public.tenant_settings (
    tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds,
    timezone, currency, reward_label, brand, perks
  ) values (
    v_child_tenant_id, v_settings.cooldown_minutes, v_settings.daily_cap, v_settings.reward_threshold,
    v_settings.tag_throttle_seconds, v_settings.timezone, v_settings.currency, v_settings.reward_label,
    v_settings.brand, v_settings.perks
  );

  insert into public.locations (id, tenant_id, name, address, active, card_mode)
  values (v_child_default_loc_id, v_child_tenant_id, v_loc.name, v_loc.address, true, 'shared');

  insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
  select v_child_tenant_id, tm.user_id, tm.role, tm.display_name, tm.active
  from public.tenant_members as tm
  where tm.tenant_id = p_tenant
    and tm.role in ('owner', 'manager')
    and tm.active = true;

  update public.tags
  set tenant_id = v_child_tenant_id,
      location_id = v_child_default_loc_id
  where tenant_id = p_tenant and location_id = p_location;

  update public.locations
  set card_mode = 'separate',
      child_tenant_id = v_child_tenant_id
  where id = p_location;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'set_location_card_mode',
    p_location::text,
    pg_catalog.jsonb_build_object('card_mode', 'separate', 'child_tenant_id', v_child_tenant_id, 'child_slug', v_child_slug)
  );

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    v_child_tenant_id,
    p_actor,
    'promoted_from_branch',
    p_location::text,
    pg_catalog.jsonb_build_object('parent_tenant_id', p_tenant, 'parent_location_id', p_location)
  );

  return pg_catalog.jsonb_build_object(
    'result', 'updated',
    'childTenantId', v_child_tenant_id
  );
end;
$$;

revoke all on function public.set_location_card_mode(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_location_card_mode(uuid, uuid, uuid, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 8. PREVIEW LOCATION SEPARATION
-- -----------------------------------------------------------------------------

create or replace function public.preview_location_separation(
  p_actor uuid,
  p_tenant uuid,
  p_location uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch_stamps integer;
  v_branch_tags integer;
begin
  if p_tenant is null or p_location is null then
    raise exception 'p_tenant and p_location must not be null';
  end if;

  if coalesce(private.member_role(p_actor, p_tenant), '') not in ('owner', 'manager') then
    raise exception 'unauthorized';
  end if;

  select coalesce(count(*), 0)::integer
  into v_branch_stamps
  from public.stamps
  where tenant_id = p_tenant and location_id = p_location;

  select coalesce(count(*), 0)::integer
  into v_branch_tags
  from public.tags
  where tenant_id = p_tenant and location_id = p_location;

  return pg_catalog.jsonb_build_object(
    'branchStamps', v_branch_stamps,
    'branchTags', v_branch_tags,
    'stampsCount', v_branch_stamps,
    'tagsCount', v_branch_tags
  );
end;
$$;

revoke all on function public.preview_location_separation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.preview_location_separation(uuid, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 9. CREATE TAG AT & ROTATE TAG AT
-- -----------------------------------------------------------------------------

create or replace function public.create_tag_at(
  p_actor uuid,
  p_tenant uuid,
  p_tag_id text,
  p_label text default null,
  p_location uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag text;
  v_inserted integer;
begin
  if coalesce(private.member_role(p_actor, p_tenant), '') not in ('owner', 'manager') then
    return 'unauthorized';
  end if;

  v_tag := pg_catalog.btrim(p_tag_id);
  if v_tag is null or v_tag !~ '^[A-Za-z0-9_-]{8,128}$' then
    return 'invalid-tag-id';
  end if;

  if p_location is not null and not exists (
    select 1 from public.locations
    where id = p_location and tenant_id = p_tenant
  ) then
    return 'invalid-location';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tag, 1002));

  insert into public.tags (id, label, active, tenant_id, location_id)
  values (v_tag, nullif(pg_catalog.btrim(p_label), ''), true, p_tenant, p_location)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return 'duplicate';
  end if;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'create_tag',
    v_tag,
    case when p_location is not null then pg_catalog.jsonb_build_object('location_id', p_location) else null end
  );

  return 'created';
end;
$$;

revoke all on function public.create_tag_at(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_tag_at(uuid, uuid, text, text, uuid) to service_role;

create or replace function public.rotate_tag_at(
  p_actor uuid,
  p_tenant uuid,
  p_old_tag_id text,
  p_new_tag_id text,
  p_label text default null,
  p_location uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_new text;
  v_label text;
  v_old_loc uuid;
  v_target_loc uuid;
  v_inserted integer;
begin
  if coalesce(private.member_role(p_actor, p_tenant), '') not in ('owner', 'manager') then
    return 'unauthorized';
  end if;

  v_old := pg_catalog.btrim(p_old_tag_id);
  v_new := pg_catalog.btrim(p_new_tag_id);

  if v_new is null or v_new !~ '^[A-Za-z0-9_-]{8,128}$' then
    return 'invalid-tag-id';
  end if;

  if v_old is null or v_old = '' then
    return 'not-found';
  end if;

  if p_location is not null and not exists (
    select 1 from public.locations
    where id = p_location and tenant_id = p_tenant
  ) then
    return 'invalid-location';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(v_old, v_new), 1002));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(v_old, v_new), 1002));

  select t.label, t.location_id
  into v_label, v_old_loc
  from public.tags as t
  where t.id = v_old
    and t.tenant_id = p_tenant
    and t.active = true;

  if not found then
    return 'not-found';
  end if;

  v_target_loc := coalesce(p_location, v_old_loc);

  insert into public.tags (id, label, active, tenant_id, location_id)
  values (v_new, coalesce(nullif(pg_catalog.btrim(p_label), ''), v_label), true, p_tenant, v_target_loc)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return 'duplicate';
  end if;

  update public.tags
  set active = false,
      deactivated_at = pg_catalog.now()
  where id = v_old;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'rotate_tag',
    v_old,
    pg_catalog.jsonb_build_object('new_tag_id', v_new, 'location_id', v_target_loc)
  );

  return 'rotated';
end;
$$;

revoke all on function public.rotate_tag_at(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.rotate_tag_at(uuid, uuid, text, text, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 10. REDEFINE STAMP_CARD_NFC TO RECORD LOCATION_ID
-- -----------------------------------------------------------------------------

create or replace function public.stamp_card_nfc(
  p_customer uuid,
  p_tag text,
  p_now timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag text;
  v_now timestamptz;
  v_tenant uuid;
  v_location uuid;
  v_status text;
  v_slug text;
  v_cooldown_minutes integer;
  v_daily_cap integer;
  v_throttle_seconds integer;
  v_timezone text;
  v_last_stamp timestamptz;
  v_daily_count integer;
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  v_tag := pg_catalog.btrim(p_tag);
  if v_tag is null or v_tag = '' then
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', null);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tag, 1002));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  v_now := coalesce(p_now, pg_catalog.clock_timestamp());

  select t.tenant_id, t.location_id, tn.status, tn.slug, ts.cooldown_minutes, ts.daily_cap, ts.tag_throttle_seconds, ts.timezone
  into v_tenant, v_location, v_status, v_slug, v_cooldown_minutes, v_daily_cap, v_throttle_seconds, v_timezone
  from public.tags as t
  join public.tenants as tn on tn.id = t.tenant_id
  join public.tenant_settings as ts on ts.tenant_id = t.tenant_id
  where t.id = v_tag
    and t.active = true
    and t.deactivated_at is null;

  if v_tenant is null then
    return pg_catalog.jsonb_build_object('result', 'invalid-tag', 'tenant_slug', null);
  end if;

  if v_status not in ('trial', 'active') then
    return pg_catalog.jsonb_build_object('result', 'tenant-unavailable', 'tenant_slug', v_slug);
  end if;

  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = v_tenant
      and cc.customer_id = p_customer
  ) then
    return pg_catalog.jsonb_build_object('result', 'no-card', 'tenant_slug', v_slug);
  end if;

  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.tenant_id = v_tenant
    and s.customer_id = p_customer;

  if v_last_stamp is not null
    and v_last_stamp > (v_now - pg_catalog.make_interval(mins => v_cooldown_minutes)) then
    return pg_catalog.jsonb_build_object('result', 'cooldown', 'tenant_slug', v_slug);
  end if;

  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.tenant_id = v_tenant
    and s.customer_id = p_customer
    and (s.created_at at time zone v_timezone)::date = (v_now at time zone v_timezone)::date;

  if v_daily_count >= v_daily_cap then
    return pg_catalog.jsonb_build_object('result', 'daily-limit', 'tenant_slug', v_slug);
  end if;

  if v_throttle_seconds > 0 and exists (
    select 1
    from public.stamps as s
    where s.tenant_id = v_tenant
      and s.tag_id = v_tag
      and s.created_at > (v_now - pg_catalog.make_interval(secs => v_throttle_seconds))
  ) then
    return pg_catalog.jsonb_build_object('result', 'tag-throttled', 'tenant_slug', v_slug);
  end if;

  insert into public.stamps (tenant_id, customer_id, tag_id, source, location_id, created_at)
  values (v_tenant, p_customer, v_tag, 'nfc', v_location, v_now);

  return pg_catalog.jsonb_build_object('result', 'stamped', 'tenant_slug', v_slug);
end;
$$;

revoke all on function public.stamp_card_nfc(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.stamp_card_nfc(uuid, text, timestamptz) to service_role;
