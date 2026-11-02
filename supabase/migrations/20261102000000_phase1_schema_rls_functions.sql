-- Migration: 20261102000000_phase1_schema_rls_functions.sql
-- Description: Phase 1 Schema, Row Level Security, Indexes, Views, and SECURITY DEFINER Functions

-- -----------------------------------------------------------------------------
-- 1. TABLES
-- -----------------------------------------------------------------------------

-- Customers ledger anchor (one-to-one with auth.users)
create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Registered NFC tags
create table if not exists public.tags (
  id text primary key check (char_length(btrim(id)) between 8 and 128),
  label text check (label is null or char_length(btrim(label)) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

-- Staff members (one-to-one with auth.users)
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  role text not null default 'staff' check (role in ('staff', 'owner')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Append-only stamp ledger
create table if not exists public.stamps (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id text references public.tags(id),
  source text not null default 'nfc' check (source in ('nfc', 'manual')),
  staff_id uuid references auth.users(id),
  reason text check (reason is null or char_length(btrim(reason)) <= 500),
  created_at timestamptz not null default now(),
  constraint stamps_source_fields_chk check (
    (source = 'nfc' and tag_id is not null) or
    (source = 'manual' and staff_id is not null and reason is not null and char_length(btrim(reason)) between 1 and 500)
  )
);

-- Append-only reward redemptions ledger
create table if not exists public.redemptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  stamps_used integer not null check (stamps_used > 0),
  staff_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- System audit log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor uuid references auth.users(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 1 and 120),
  target text check (target is null or char_length(target) <= 255),
  detail jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. INDEXES
-- -----------------------------------------------------------------------------

create index if not exists stamps_customer_created_idx on public.stamps (customer_id, created_at desc);
create index if not exists stamps_tag_created_idx on public.stamps (tag_id, created_at desc);
create index if not exists stamps_staff_idx on public.stamps (staff_id);
create index if not exists redemptions_customer_created_idx on public.redemptions (customer_id, created_at desc);
create index if not exists redemptions_staff_idx on public.redemptions (staff_id);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor);

-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) & TABLE PRIVILEGES
-- -----------------------------------------------------------------------------

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.customers enable row level security;
alter table public.tags enable row level security;
alter table public.stamps enable row level security;
alter table public.redemptions enable row level security;
alter table public.staff enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.customers, public.tags, public.stamps, public.redemptions, public.staff, public.audit_log from public, anon, authenticated;
grant select on table public.customers, public.tags, public.stamps, public.redemptions, public.staff, public.audit_log to authenticated;
grant all on table public.customers, public.tags, public.stamps, public.redemptions, public.staff, public.audit_log to service_role;

-- -----------------------------------------------------------------------------
-- 4. STAFF VERIFICATION HELPER FUNCTION
-- -----------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff as s
    where s.user_id = (select auth.uid())
      and s.active = true
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS POLICIES (SELECT-ONLY FOR AUTHENTICATED USERS)
-- -----------------------------------------------------------------------------

drop policy if exists customers_select_policy on public.customers;
create policy customers_select_policy
  on public.customers
  for select
  to authenticated
  using ((select auth.uid()) = id or public.is_staff());

drop policy if exists tags_select_policy on public.tags;
create policy tags_select_policy
  on public.tags
  for select
  to authenticated
  using (public.is_staff());

drop policy if exists stamps_select_policy on public.stamps;
create policy stamps_select_policy
  on public.stamps
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or public.is_staff());

drop policy if exists redemptions_select_policy on public.redemptions;
create policy redemptions_select_policy
  on public.redemptions
  for select
  to authenticated
  using ((select auth.uid()) = customer_id or public.is_staff());

drop policy if exists staff_select_policy on public.staff;
create policy staff_select_policy
  on public.staff
  for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_staff());

drop policy if exists audit_log_select_policy on public.audit_log;
create policy audit_log_select_policy
  on public.audit_log
  for select
  to authenticated
  using (public.is_staff());

-- -----------------------------------------------------------------------------
-- 6. BALANCE VIEW (SECURITY INVOKER)
-- -----------------------------------------------------------------------------

create or replace view public.customer_balances
with (security_invoker = true) as
select
  c.id as customer_id,
  coalesce(s.total_stamps, 0)::integer as total_stamps,
  coalesce(r.stamps_redeemed, 0)::integer as stamps_redeemed,
  (coalesce(s.total_stamps, 0) - coalesce(r.stamps_redeemed, 0))::integer as available_stamps,
  s.last_stamped_at
from public.customers as c
left join (
  select
    st.customer_id,
    count(*)::integer as total_stamps,
    max(st.created_at) as last_stamped_at
  from public.stamps as st
  group by st.customer_id
) as s on s.customer_id = c.id
left join (
  select
    rd.customer_id,
    coalesce(sum(rd.stamps_used), 0)::integer as stamps_redeemed
  from public.redemptions as rd
  group by rd.customer_id
) as r on r.customer_id = c.id;

revoke all on table public.customer_balances from public, anon;
grant select on table public.customer_balances to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. MUTATION & RPC FUNCTIONS (SECURITY DEFINER, SERVICE_ROLE ONLY)
-- -----------------------------------------------------------------------------

-- Audit Event Logger
create or replace function public.log_audit_event(
  p_actor uuid,
  p_action text,
  p_target text default null,
  p_detail jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (actor, action, target, detail)
  values (p_actor, p_action, p_target, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_audit_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_audit_event(uuid, text, text, jsonb) to service_role;

-- Customer Record Provisioner
create or replace function public.ensure_customer(
  p_customer uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  insert into public.customers (id)
  values (p_customer)
  on conflict (id) do nothing;

  return p_customer;
end;
$$;

revoke all on function public.ensure_customer(uuid) from public, anon, authenticated;
grant execute on function public.ensure_customer(uuid) to service_role;

-- Stamp Mutation Function
create or replace function public.record_stamp(
  p_customer uuid,
  p_tag text default null,
  p_source text default 'nfc',
  p_staff uuid default null,
  p_reason text default null,
  p_now timestamptz default now()
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_stamp timestamptz;
  v_daily_count integer;
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  if p_tag is not null then
    p_tag := pg_catalog.btrim(p_tag);
  end if;

  -- 1. Advisory locking: tag first (if tag provided), then customer
  if p_tag is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tag, 1002));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 2. Ensure customer exists
  insert into public.customers (id)
  values (p_customer)
  on conflict (id) do nothing;

  -- 3. Source-specific validation
  if p_source = 'nfc' then
    if p_tag is null or not exists (
      select 1
      from public.tags as t
      where t.id = p_tag
        and t.active = true
        and t.deactivated_at is null
    ) then
      return 'invalid-tag';
    end if;

    if exists (
      select 1
      from public.stamps as s
      where s.tag_id = p_tag
        and s.created_at > (p_now - interval '5 seconds')
    ) then
      return 'tag-throttled';
    end if;
  elsif p_source = 'manual' then
    if p_staff is null
      or not exists (
        select 1
        from public.staff as st
        where st.user_id = p_staff
          and st.active = true
      )
      or p_reason is null
      or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 500
    then
      raise exception 'invalid manual stamp parameters';
    end if;
  else
    raise exception 'invalid stamp source';
  end if;

  -- 4. Customer cooldown check (30 minutes)
  select max(s.created_at)
  into v_last_stamp
  from public.stamps as s
  where s.customer_id = p_customer;

  if v_last_stamp is not null and v_last_stamp > (p_now - interval '30 minutes') then
    return 'cooldown';
  end if;

  -- 5. Customer daily cap check (max 2 per calendar day in Asia/Manila)
  select count(*)::integer
  into v_daily_count
  from public.stamps as s
  where s.customer_id = p_customer
    and (s.created_at at time zone 'Asia/Manila')::date = (p_now at time zone 'Asia/Manila')::date;

  if v_daily_count >= 2 then
    return 'daily-limit';
  end if;

  -- 6. Insert stamp row
  insert into public.stamps (
    customer_id,
    tag_id,
    source,
    staff_id,
    reason,
    created_at
  ) values (
    p_customer,
    case when p_source = 'nfc' then p_tag else null end,
    p_source,
    case when p_source = 'manual' then p_staff else null end,
    case when p_source = 'manual' then pg_catalog.btrim(p_reason) else null end,
    p_now
  );

  -- 7. Audit log for manual stamps
  if p_source = 'manual' then
    insert into public.audit_log (
      actor,
      action,
      target,
      detail,
      created_at
    ) values (
      p_staff,
      'manual_stamp',
      p_customer::text,
      pg_catalog.jsonb_build_object('reason', pg_catalog.btrim(p_reason)),
      p_now
    );
  end if;

  return 'stamped';
end;
$$;

revoke all on function public.record_stamp(uuid, text, text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_stamp(uuid, text, text, uuid, text, timestamptz) to service_role;

-- Reward Redemption Function
create or replace function public.redeem_reward(
  p_customer uuid,
  p_staff uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available integer;
begin
  if p_customer is null then
    raise exception 'p_customer must not be null';
  end if;

  -- 1. Lock customer row via advisory transaction lock
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_customer::text, 1001));

  -- 2. Verify staff is active
  if not exists (
    select 1
    from public.staff as st
    where st.user_id = p_staff
      and st.active = true
  ) then
    return 'unauthorized';
  end if;

  -- 3. Calculate available stamps
  v_available := coalesce((
    select count(*)::integer
    from public.stamps
    where customer_id = p_customer
  ), 0) - coalesce((
    select sum(stamps_used)::integer
    from public.redemptions
    where customer_id = p_customer
  ), 0);

  if v_available < 10 then
    return 'insufficient-stamps';
  end if;

  -- 4. Record redemption
  insert into public.redemptions (
    customer_id,
    stamps_used,
    staff_id
  ) values (
    p_customer,
    10,
    p_staff
  );

  -- 5. Audit log
  insert into public.audit_log (
    actor,
    action,
    target,
    detail
  ) values (
    p_staff,
    'redeem_reward',
    p_customer::text,
    pg_catalog.jsonb_build_object('stamps_used', 10)
  );

  return 'redeemed';
end;
$$;

revoke all on function public.redeem_reward(uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_reward(uuid, uuid) to service_role;
