-- Migration: 20261104010000_phase10_tenant_columns_backfill.sql
-- Description: Phase 10 tenant_id on the legacy ledgers (defaulting to tenant #1 so the deployed
--              app and legacy functions keep working), tenant-leading indexes, wallet-card and
--              membership backfill, and a transition-only staff -> tenant_members mirror.
--              Phase 12 removes the defaults, the mirror trigger and the legacy staff table.

-- -----------------------------------------------------------------------------
-- 1. TENANT COLUMNS (constant default: metadata-only, no table rewrite)
-- -----------------------------------------------------------------------------

alter table public.tags
  add column if not exists tenant_id uuid not null default '7c1f0000-0000-4000-8000-000000000001'
  references public.tenants(id);

alter table public.stamps
  add column if not exists tenant_id uuid not null default '7c1f0000-0000-4000-8000-000000000001'
  references public.tenants(id);

alter table public.redemptions
  add column if not exists tenant_id uuid not null default '7c1f0000-0000-4000-8000-000000000001'
  references public.tenants(id);

alter table public.perk_claims
  add column if not exists tenant_id uuid not null default '7c1f0000-0000-4000-8000-000000000001'
  references public.tenants(id);

-- Nullable: null marks a platform-level event (erasure, cleanup, wallet merge)
alter table public.audit_log
  add column if not exists tenant_id uuid default '7c1f0000-0000-4000-8000-000000000001'
  references public.tenants(id);

-- -----------------------------------------------------------------------------
-- 2. TENANT-LEADING INDEXES
-- -----------------------------------------------------------------------------

create index if not exists stamps_tenant_customer_created_idx on public.stamps (tenant_id, customer_id, created_at desc);
create index if not exists stamps_tenant_tag_created_idx on public.stamps (tenant_id, tag_id, created_at desc);
create index if not exists redemptions_tenant_customer_idx on public.redemptions (tenant_id, customer_id, created_at desc);
create index if not exists tags_tenant_idx on public.tags (tenant_id);
create index if not exists audit_log_tenant_created_idx on public.audit_log (tenant_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. PERK CLAIMS: ONE CLAIM PER (TENANT, CUSTOMER, PERK); PERK KEYS COME FROM TENANT SETTINGS
-- -----------------------------------------------------------------------------

alter table public.perk_claims drop constraint if exists perk_claims_customer_perk_key;
alter table public.perk_claims drop constraint if exists perk_claims_perk_check;

alter table public.perk_claims
  add constraint perk_claims_tenant_customer_perk_key unique (tenant_id, customer_id, perk);

alter table public.perk_claims
  add constraint perk_claims_perk_format_chk check (perk ~ '^[a-z0-9_]{3,64}$');

-- -----------------------------------------------------------------------------
-- 4. BACKFILL (idempotent; Phase 12's contract migration runs it again)
-- -----------------------------------------------------------------------------

create or replace function private.backfill_tenant1()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.customer_cards (tenant_id, customer_id)
  select '7c1f0000-0000-4000-8000-000000000001'::uuid, c.id
  from public.customers as c
  on conflict (tenant_id, customer_id) do nothing;

  insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
  select '7c1f0000-0000-4000-8000-000000000001'::uuid, s.user_id, s.role, s.display_name, s.active
  from public.staff as s
  on conflict (tenant_id, user_id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      active = excluded.active;
end;
$$;

revoke all on function private.backfill_tenant1() from public, anon, authenticated;
grant execute on function private.backfill_tenant1() to service_role;

select private.backfill_tenant1();

-- -----------------------------------------------------------------------------
-- 5. TRANSITION-ONLY MIRROR: LEGACY STAFF ROWS -> TENANT #1 MEMBERSHIPS
-- -----------------------------------------------------------------------------

create or replace function private.mirror_staff_to_tenant1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
  values ('7c1f0000-0000-4000-8000-000000000001', new.user_id, new.role, new.display_name, new.active)
  on conflict (tenant_id, user_id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      active = excluded.active;

  return new;
end;
$$;

revoke all on function private.mirror_staff_to_tenant1() from public, anon, authenticated;

drop trigger if exists staff_mirror_to_tenant1 on public.staff;
create trigger staff_mirror_to_tenant1
  after insert or update on public.staff
  for each row execute function private.mirror_staff_to_tenant1();
