-- ==============================================================================
-- 20261111000000_milestone_rewards.sql
-- Description: Milestone rewards system:
--   1. Adds milestone_step and milestone_reward_label to public.tenant_settings.
--   2. Updates private.validate_tenant_settings() trigger to validate milestone bounds.
--   3. Creates public.milestone_claims ledger table with unique (tenant_id, customer_id, cycle_index).
--   4. Creates public.redeem_milestone_reward RPC.
--   5. Updates public.update_tenant_rules to support milestone keys.
--   6. Updates public.remove_card and public.merge_wallets to handle milestone claims.
-- ==============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADD MILESTONE COLUMNS TO PUBLIC.TENANT_SETTINGS
-- -----------------------------------------------------------------------------

alter table public.tenant_settings
  add column if not exists milestone_step integer check (milestone_step is null or (milestone_step between 1 and 49)),
  add column if not exists milestone_reward_label text check (milestone_reward_label is null or (char_length(btrim(milestone_reward_label)) between 1 and 40));

-- Seed Tenant #1 (The Caffeine Plug) with slot 5 milestone
update public.tenant_settings
set milestone_step = 5,
    milestone_reward_label = '50% OFF'
where tenant_id = '7c1f0000-0000-4000-8000-000000000001'
  and milestone_step is null;

-- -----------------------------------------------------------------------------
-- 2. UPDATE PRIVATE.VALIDATE_TENANT_SETTINGS() TRIGGER
-- -----------------------------------------------------------------------------

create or replace function private.validate_tenant_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names as tz where tz.name = new.timezone
  ) then
    raise exception 'invalid timezone' using errcode = '22023';
  end if;

  if new.milestone_step is not null and new.milestone_step >= new.reward_threshold then
    raise exception 'milestone_step must be strictly less than reward_threshold' using errcode = '22023';
  end if;

  if (new.milestone_step is null) <> (new.milestone_reward_label is null) then
    raise exception 'milestone_step and milestone_reward_label must both be set or both be null' using errcode = '22023';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.validate_tenant_settings() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. CREATE PUBLIC.MILESTONE_CLAIMS TABLE
-- -----------------------------------------------------------------------------

create table if not exists public.milestone_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  cycle_index integer not null check (cycle_index >= 0),
  milestone_step integer not null check (milestone_step >= 1),
  staff_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, customer_id, cycle_index)
);

create index if not exists milestone_claims_customer_idx 
  on public.milestone_claims (customer_id, tenant_id);

alter table public.milestone_claims enable row level security;

revoke all on table public.milestone_claims from public, anon, authenticated;
grant select on table public.milestone_claims to authenticated, service_role;

drop policy if exists milestone_claims_select_policy on public.milestone_claims;
create policy milestone_claims_select_policy
  on public.milestone_claims
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or tenant_id in (select private.staff_tenant_ids()));

-- -----------------------------------------------------------------------------
-- 4. CREATE PUBLIC.REDEEM_MILESTONE_REWARD RPC
-- -----------------------------------------------------------------------------

create or replace function public.redeem_milestone_reward(
  p_actor uuid,
  p_tenant uuid,
  p_customer uuid,
  p_nonce text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nonce text;
  v_status text;
  v_threshold integer;
  v_milestone_step integer;
  v_total_stamps integer;
  v_cycle_index integer;
  v_current_cycle_stamps integer;
begin
  if p_tenant is null or p_customer is null then
    raise exception 'p_tenant and p_customer must not be null';
  end if;

  v_nonce := nullif(pg_catalog.btrim(p_nonce), '');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  if private.member_role(p_actor, p_tenant) is null then
    return 'unauthorized';
  end if;

  select tn.status, ts.reward_threshold, ts.milestone_step
  into v_status, v_threshold, v_milestone_step
  from public.tenants as tn
  join public.tenant_settings as ts on ts.tenant_id = tn.id
  where tn.id = p_tenant;

  if v_status is null or v_status not in ('trial', 'active') then
    return 'tenant-unavailable';
  end if;

  if v_milestone_step is null then
    return 'invalid-perk';
  end if;

  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = p_tenant
      and cc.customer_id = p_customer
  ) then
    return 'no-card';
  end if;

  -- Single-use nonce check inside the customer lock
  if v_nonce is not null and exists (
    select 1
    from public.audit_log as al
    where al.action = 'staff_redeem_token_used'
      and al.target = v_nonce
  ) then
    return 'invalid-token';
  end if;

  -- Calculate total lifetime stamps and cycle progress
  select count(*)::integer
  into v_total_stamps
  from public.stamps as s
  where s.tenant_id = p_tenant
    and s.customer_id = p_customer;

  v_cycle_index := pg_catalog.floor(v_total_stamps::numeric / v_threshold::numeric)::integer;
  v_current_cycle_stamps := v_total_stamps % v_threshold;

  -- Check if already claimed for this cycle
  if exists (
    select 1
    from public.milestone_claims as mc
    where mc.tenant_id = p_tenant
      and mc.customer_id = p_customer
      and mc.cycle_index = v_cycle_index
  ) then
    return 'milestone-already-claimed';
  end if;

  -- Check if milestone step was reached in this cycle
  if v_current_cycle_stamps < v_milestone_step then
    return 'milestone-not-reached';
  end if;

  -- Single-use nonce burn
  if v_nonce is not null then
    insert into public.audit_log (tenant_id, actor, action, target, detail)
    values (
      p_tenant,
      p_actor,
      'staff_redeem_token_used',
      v_nonce,
      pg_catalog.jsonb_build_object('customer_id', p_customer::text, 'kind', 'milestone-reward', 'cycle_index', v_cycle_index)
    );
  end if;

  -- Record milestone claim without deducting stamps
  insert into public.milestone_claims (tenant_id, customer_id, cycle_index, milestone_step, staff_id)
  values (p_tenant, p_customer, v_cycle_index, v_milestone_step, p_actor);

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    p_actor,
    'redeem_milestone_reward',
    p_customer::text,
    pg_catalog.jsonb_build_object('milestone_step', v_milestone_step, 'cycle_index', v_cycle_index, 'nonce', v_nonce)
  );

  return 'redeemed';
end;
$$;

revoke all on function public.redeem_milestone_reward(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_milestone_reward(uuid, uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 5. UPDATE PUBLIC.UPDATE_TENANT_RULES TO SUPPORT MILESTONE KEYS
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
    where k not in ('cooldown_minutes', 'daily_cap', 'reward_threshold', 'tag_throttle_seconds', 'reward_label', 'milestone_step', 'milestone_reward_label')
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
        milestone_step = case
          when p_patch ? 'milestone_step' then
            case when (p_patch->>'milestone_step') is null or pg_catalog.btrim(p_patch->>'milestone_step') = '' then null
            else (p_patch->>'milestone_step')::integer end
          else milestone_step end,
        milestone_reward_label = case
          when p_patch ? 'milestone_reward_label' then
            case when (p_patch->>'milestone_reward_label') is null or pg_catalog.btrim(p_patch->>'milestone_reward_label') = '' then null
            else pg_catalog.btrim(p_patch->>'milestone_reward_label') end
          else milestone_reward_label end,
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
-- 6. UPDATE REMOVE_CARD AND MERGE_WALLETS FOR MILESTONE CLAIMS
-- -----------------------------------------------------------------------------

create or replace function public.remove_card(
  p_customer uuid,
  p_tenant uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer is null or p_tenant is null then
    raise exception 'p_customer and p_tenant must not be null';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  if not exists (
    select 1
    from public.customer_cards as cc
    where cc.tenant_id = p_tenant
      and cc.customer_id = p_customer
  ) then
    return false;
  end if;

  delete from public.audit_log
  where tenant_id = p_tenant
    and (
      actor = p_customer
      or target = p_customer::text
      or detail ->> 'customer_id' = p_customer::text
    );

  delete from public.stamps where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.redemptions where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.perk_claims where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.milestone_claims where tenant_id = p_tenant and customer_id = p_customer;
  delete from public.customer_cards where tenant_id = p_tenant and customer_id = p_customer;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    p_tenant,
    null,
    'customer_card_removed',
    pg_catalog.md5(p_customer::text),
    pg_catalog.jsonb_build_object('compliance', 'RA_10173_erasure')
  );

  return true;
end;
$$;

revoke all on function public.remove_card(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_card(uuid, uuid) to service_role;

create or replace function public.merge_wallets(
  p_source uuid,
  p_target uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cards_moved integer := 0;
  v_stamps_moved integer := 0;
  v_redemptions_moved integer := 0;
  v_source_cards integer := 0;
begin
  if p_source is null or p_target is null then
    raise exception 'p_source and p_target must not be null';
  end if;

  if p_source = p_target then
    return pg_catalog.jsonb_build_object('result', 'noop-same-user', 'cards_moved', 0, 'cards_combined', 0);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(p_source::text, p_target::text), 1001));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(greatest(p_source::text, p_target::text), 1001));

  if not exists (select 1 from public.customers where id = p_source) then
    return pg_catalog.jsonb_build_object('result', 'source-not-found', 'cards_moved', 0, 'cards_combined', 0);
  end if;

  if not exists (select 1 from public.customers where id = p_target) then
    return pg_catalog.jsonb_build_object('result', 'target-not-found', 'cards_moved', 0, 'cards_combined', 0);
  end if;

  select count(*)::integer into v_source_cards
  from public.customer_cards
  where customer_id = p_source;

  insert into public.customer_cards (tenant_id, customer_id, added_at, consent_version)
  select cc.tenant_id, p_target, cc.added_at, cc.consent_version
  from public.customer_cards as cc
  where cc.customer_id = p_source
  on conflict (tenant_id, customer_id) do nothing;
  get diagnostics v_cards_moved = row_count;

  -- Remove duplicate perk claims
  delete from public.perk_claims as pc
  where pc.customer_id = p_source
    and exists (
      select 1
      from public.perk_claims as t
      where t.customer_id = p_target
        and t.tenant_id = pc.tenant_id
        and t.perk = pc.perk
    );

  -- Remove duplicate milestone claims
  delete from public.milestone_claims as mc
  where mc.customer_id = p_source
    and exists (
      select 1
      from public.milestone_claims as t
      where t.customer_id = p_target
        and t.tenant_id = mc.tenant_id
        and t.cycle_index = mc.cycle_index
    );

  -- Move the ledgers
  update public.stamps set customer_id = p_target where customer_id = p_source;
  get diagnostics v_stamps_moved = row_count;

  update public.redemptions set customer_id = p_target where customer_id = p_source;
  get diagnostics v_redemptions_moved = row_count;

  update public.perk_claims set customer_id = p_target where customer_id = p_source;
  update public.milestone_claims set customer_id = p_target where customer_id = p_source;

  delete from public.customer_cards where customer_id = p_source;
  delete from public.customers where id = p_source;

  insert into public.audit_log (tenant_id, actor, action, target, detail)
  values (
    null,
    p_target,
    'merge_wallets',
    p_source::text,
    pg_catalog.jsonb_build_object(
      'source_customer', p_source::text,
      'target_customer', p_target::text,
      'cards_moved', v_cards_moved,
      'cards_combined', (v_source_cards - v_cards_moved),
      'stamps_moved', v_stamps_moved,
      'redemptions_moved', v_redemptions_moved
    )
  );

  return pg_catalog.jsonb_build_object(
    'result', 'merged',
    'cards_moved', v_cards_moved,
    'cards_combined', (v_source_cards - v_cards_moved)
  );
end;
$$;

revoke all on function public.merge_wallets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_wallets(uuid, uuid) to service_role;
