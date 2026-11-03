-- Migration: 20261104000000_phase10_tenant_foundation.sql
-- Description: Phase 10 tenant foundation (tenants, per-tenant settings, staff memberships,
--              domain aliases, wallet cards) and The Caffeine Plug as tenant #1.
--              Expand-only: no existing table, function or policy changes.

-- -----------------------------------------------------------------------------
-- 1. PRIVATE SCHEMA (helpers not exposed through the Data API)
-- -----------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. TABLES
-- -----------------------------------------------------------------------------

-- One row per shop
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'closed')),
  created_at timestamptz not null default now()
);

-- Per-shop rules, display and branding (authoritative for the SQL stamp engine)
create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  cooldown_minutes integer not null default 30 check (cooldown_minutes between 0 and 1440),
  daily_cap integer not null default 2 check (daily_cap between 1 and 20),
  reward_threshold integer not null default 10 check (reward_threshold between 3 and 50),
  tag_throttle_seconds integer not null default 5 check (tag_throttle_seconds between 0 and 60),
  timezone text not null default 'Asia/Manila',
  currency text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  reward_label text not null default 'FREE COFFEE' check (char_length(btrim(reward_label)) between 1 and 40),
  brand jsonb not null default '{}'::jsonb,
  perks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Staff memberships: one person can work at several shops
create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_members_user_idx on public.tenant_members (user_id);

-- Host aliases (e.g. a shop's own domain) resolving to a tenant
create table if not exists public.tenant_domains (
  host text primary key check (host = lower(host) and char_length(host) between 3 and 253),
  tenant_id uuid not null references public.tenants(id) on delete cascade
);

create index if not exists tenant_domains_tenant_idx on public.tenant_domains (tenant_id);

-- Wallet cards: one per (shop, customer)
create table if not exists public.customer_cards (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  added_at timestamptz not null default now(),
  consent_version text not null default 'v1' check (char_length(btrim(consent_version)) between 1 and 32),
  primary key (tenant_id, customer_id)
);

create index if not exists customer_cards_customer_idx on public.customer_cards (customer_id);

-- -----------------------------------------------------------------------------
-- 3. SETTINGS VALIDATION (CHECK constraints cannot query pg_timezone_names)
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

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists tenant_settings_validate on public.tenant_settings;
create trigger tenant_settings_validate
  before insert or update on public.tenant_settings
  for each row execute function private.validate_tenant_settings();

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY & TABLE PRIVILEGES
-- -----------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.customer_cards enable row level security;

revoke all on table public.tenants, public.tenant_settings, public.tenant_members, public.tenant_domains, public.customer_cards
  from public, anon, authenticated;
grant select on table public.tenants, public.tenant_settings, public.tenant_domains to anon, authenticated;
grant select on table public.tenant_members, public.customer_cards to authenticated;
grant all on table public.tenants, public.tenant_settings, public.tenant_members, public.tenant_domains, public.customer_cards
  to service_role;

-- Shop identity and branding are public (shop pages render them before sign-in)
drop policy if exists tenants_select_policy on public.tenants;
create policy tenants_select_policy
  on public.tenants
  for select
  to anon, authenticated
  using (true);

drop policy if exists tenant_settings_select_policy on public.tenant_settings;
create policy tenant_settings_select_policy
  on public.tenant_settings
  for select
  to anon, authenticated
  using (true);

drop policy if exists tenant_domains_select_policy on public.tenant_domains;
create policy tenant_domains_select_policy
  on public.tenant_domains
  for select
  to anon, authenticated
  using (true);

-- Own rows only; Phase 11 widens these to fellow staff of the same tenant
drop policy if exists tenant_members_select_policy on public.tenant_members;
create policy tenant_members_select_policy
  on public.tenant_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists customer_cards_select_policy on public.customer_cards;
create policy customer_cards_select_policy
  on public.customer_cards
  for select
  to authenticated
  using ((select auth.uid()) = customer_id);

-- -----------------------------------------------------------------------------
-- 5. TENANT #1: THE CAFFEINE PLUG
-- -----------------------------------------------------------------------------

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-000000000001', 'caffeine-plug', 'The Caffeine Plug', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (
  tenant_id,
  cooldown_minutes,
  daily_cap,
  reward_threshold,
  tag_throttle_seconds,
  timezone,
  currency,
  reward_label,
  perks
) values (
  '7c1f0000-0000-4000-8000-000000000001',
  30,
  2,
  10,
  5,
  'Asia/Manila',
  'PHP',
  'FREE COFFEE',
  '{"instagram_follow_upsize": {"label": "Free upsize on any drink", "handle": "@thecaffeineplug8400"}}'::jsonb
) on conflict (tenant_id) do nothing;

insert into public.tenant_domains (host, tenant_id)
values ('card.thecaffeineplug.ph', '7c1f0000-0000-4000-8000-000000000001')
on conflict (host) do nothing;
