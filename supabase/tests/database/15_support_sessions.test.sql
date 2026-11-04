-- ==============================================================================
-- 15_support_sessions.test.sql
-- pgTAP Test Suite for Phase 14 support sessions (database)
-- Tests:
--   1. support_reason_required (reasons < 10 chars rejected)
--   2. support_session_expiry_and_scope (Review Focus 4)
--   3. support_rpcs_take_tenant_from_session
--   4. support_reads_exclude_personal_data
--   5. Table grants, RLS, and constraints
-- ==============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set search_path to extensions, public;

grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(53);

-- ------------------------------------------------------------------------------
-- Fixtures: platform admins, plain user, staff, customers, two tenants
-- ------------------------------------------------------------------------------

insert into auth.users (id, aud, role, email)
values
    ('ad000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'platform-admin-1@test.local'),
    ('ad000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'platform-admin-2@test.local'),
    ('ad000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'plain-user@test.local'),
    ('ad000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'staff-member@test.local'),
    ('ad000000-0000-4000-8000-0000000000d4', 'authenticated', 'authenticated', 'victim-customer-1@test.local'),
    ('ad000000-0000-4000-8000-0000000000d5', 'authenticated', 'authenticated', 'victim-customer-2@test.local')
on conflict (id) do nothing;

insert into public.platform_admins (user_id)
values
    ('ad000000-0000-4000-8000-0000000000a1'),
    ('ad000000-0000-4000-8000-0000000000a2')
on conflict (user_id) do nothing;

insert into public.tenants (id, slug, name, status)
values
    ('7c1f0000-0000-4000-8000-000000000e14', 'alpha-shop', 'Alpha Shop', 'active'),
    ('7c1f0000-0000-4000-8000-000000000e15', 'beta-shop', 'Beta Shop', 'trial')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone)
values
    ('7c1f0000-0000-4000-8000-000000000e14', 30, 5, 3, 5, 'Asia/Manila'),
    ('7c1f0000-0000-4000-8000-000000000e15', 30, 5, 3, 5, 'Asia/Manila')
on conflict (tenant_id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000c3', 'staff', 'Shop Staff 1', true),
    ('7c1f0000-0000-4000-8000-000000000e15', 'ad000000-0000-4000-8000-0000000000c3', 'staff', 'Shop Staff 2', true)
on conflict (tenant_id, user_id) do nothing;

insert into public.customers (id)
values
    ('ad000000-0000-4000-8000-0000000000d4'),
    ('ad000000-0000-4000-8000-0000000000d5')
on conflict (id) do nothing;

insert into public.customer_cards (tenant_id, customer_id)
values
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4'),
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d5'),
    ('7c1f0000-0000-4000-8000-000000000e15', 'ad000000-0000-4000-8000-0000000000d5')
on conflict (tenant_id, customer_id) do nothing;

insert into public.tags (id, label, active, tenant_id)
values
    ('tag_alpha_0001', 'Alpha Counter', true, '7c1f0000-0000-4000-8000-000000000e14'),
    ('tag_beta_0001', 'Beta Counter', true, '7c1f0000-0000-4000-8000-000000000e15')
on conflict (id) do nothing;

-- 3 stamps for Alpha in the last 7 days, 1 stamp 10 days ago (outside 7d window)
insert into public.stamps (tenant_id, customer_id, tag_id, source, created_at)
values
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4', 'tag_alpha_0001', 'nfc', now() - interval '1 day'),
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4', 'tag_alpha_0001', 'nfc', now() - interval '2 days'),
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4', 'tag_alpha_0001', 'nfc', now() - interval '3 days'),
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4', 'tag_alpha_0001', 'nfc', now() - interval '10 days');

-- 1 redemption for Alpha
insert into public.redemptions (tenant_id, customer_id, stamps_used, staff_id, created_at)
values
    ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000d4', 3, 'ad000000-0000-4000-8000-0000000000c3', now() - interval '1 day');

-- ==============================================================================
-- 1. support_reason_required (6 assertions)
-- ==============================================================================

select is(
    public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', null) ->> 'result',
    'invalid-reason',
    'support_reason_required: null reason is rejected'
);

select is(
    public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', '') ->> 'result',
    'invalid-reason',
    'support_reason_required: empty reason is rejected'
);

select is(
    public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', '   short   ') ->> 'result',
    'invalid-reason',
    'support_reason_required: trimmed reason < 10 chars is rejected'
);

select is(
    public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', '123456789') ->> 'result',
    'invalid-reason',
    'support_reason_required: 9 chars reason is rejected'
);

select is(
    public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', '1234567890') ->> 'result',
    'started',
    'support_reason_required: 10 chars reason is accepted'
);

select is(
    public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000fff', 'Valid reason for test') ->> 'result',
    'not-found',
    'start_support_session: nonexistent tenant returns not-found'
);

-- ==============================================================================
-- 2. support_session_expiry_and_scope (Review Focus 4) (20 assertions)
-- ==============================================================================

do $$
declare
    v_sess jsonb;
    v_sid uuid;
    v_exp uuid;
begin
    -- Start session for Alpha Shop
    v_sess := public.start_support_session(
        'ad000000-0000-4000-8000-0000000000a1',
        '7c1f0000-0000-4000-8000-000000000e14',
        'Investigating customer reward issue'
    );
    v_sid := (v_sess ->> 'sessionId')::uuid;

    perform set_config('test.sess_id', v_sid::text, true);
    perform set_config('test.expires_at', coalesce(v_sess ->> 'expiresAt', ''), true);

    -- Create an expired session directly (30m 1s ago)
    insert into public.support_sessions (
        tenant_id, admin_id, reason, mode, started_at, expires_at
    ) values (
        '7c1f0000-0000-4000-8000-000000000e14',
        'ad000000-0000-4000-8000-0000000000a1',
        'Expired session for testing',
        'read_only',
        now() - interval '31 minutes',
        now() - interval '1 second'
    ) returning id into v_exp;

    perform set_config('test.exp_sess_id', v_exp::text, true);
end;
$$;

select is(
    (select mode from public.support_sessions where id = current_setting('test.sess_id')::uuid),
    'read_only',
    'support_session_expiry_and_scope: session stored with mode read_only'
);

select ok(
    current_setting('test.expires_at') <> '',
    'support_session_expiry_and_scope: start_support_session returns expiresAt'
);

select ok(
    exists (
        select 1 from public.audit_log
        where action = 'support_session_started'
          and target = current_setting('test.sess_id')
          and tenant_id = '7c1f0000-0000-4000-8000-000000000e14'
          and actor = 'ad000000-0000-4000-8000-0000000000a1'
          and detail ->> 'reason' = 'Investigating customer reward issue'
    ),
    'support_session_expiry_and_scope: audit_log records support_session_started with tenant and reason'
);

select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_id')::uuid
    ) ->> 'slug',
    'alpha-shop',
    'support_session_expiry_and_scope: active session allows overview'
);

select is(
    jsonb_typeof(public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_id')::uuid,
        10
    )),
    'array',
    'support_session_expiry_and_scope: active session allows activity listing'
);

-- Non-admin caller refused
select is(
    public.start_support_session(
        'ad000000-0000-4000-8000-0000000000b2',
        '7c1f0000-0000-4000-8000-000000000e14',
        'Non admin trying to start'
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: non-admin cannot start session'
);

select is(
    public.end_support_session(
        'ad000000-0000-4000-8000-0000000000b2',
        current_setting('test.sess_id')::uuid
    ),
    'unauthorized',
    'support_session_expiry_and_scope: non-admin cannot end session'
);

select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000b2',
        current_setting('test.sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: non-admin refused on overview'
);

select is(
    public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000b2',
        current_setting('test.sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: non-admin refused on activity'
);

-- Admin 2 cannot use Admin 1's session
select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a2',
        current_setting('test.sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: other admin cannot access session overview'
);

select is(
    public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a2',
        current_setting('test.sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: other admin cannot access session activity'
);

-- Expired session (30m 1s ago) refused
select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.exp_sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: 30m 1s expired session refused on overview'
);

select is(
    public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.exp_sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: 30m 1s expired session refused on activity'
);

-- Ending session
select is(
    public.end_support_session(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_id')::uuid
    ),
    'ended',
    'support_session_expiry_and_scope: ending active session returns ended'
);

select ok(
    (select ended_at from public.support_sessions where id = current_setting('test.sess_id')::uuid) is not null,
    'support_session_expiry_and_scope: ended session stamps ended_at'
);

select ok(
    exists (
        select 1 from public.audit_log
        where action = 'support_session_ended'
          and target = current_setting('test.sess_id')
          and tenant_id = '7c1f0000-0000-4000-8000-000000000e14'
          and actor = 'ad000000-0000-4000-8000-0000000000a1'
    ),
    'support_session_expiry_and_scope: audit_log records support_session_ended'
);

-- After ended: RPCs refused
select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: after ended refused on overview'
);

select is(
    public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_id')::uuid
    ) ->> 'result',
    'unauthorized',
    'support_session_expiry_and_scope: after ended refused on activity'
);

select is(
    public.end_support_session(
        'ad000000-0000-4000-8000-0000000000a1',
        'ad000000-0000-4000-8000-000000000eee'
    ),
    'not-found',
    'end_support_session: unknown session returns not-found'
);

-- ==============================================================================
-- 3. support_rpcs_take_tenant_from_session (7 assertions)
-- ==============================================================================

do $$
declare
    v_sess_a jsonb;
    v_sess_b jsonb;
begin
    v_sess_a := public.start_support_session(
        'ad000000-0000-4000-8000-0000000000a1',
        '7c1f0000-0000-4000-8000-000000000e14',
        'Session for Alpha tenant'
    );
    v_sess_b := public.start_support_session(
        'ad000000-0000-4000-8000-0000000000a1',
        '7c1f0000-0000-4000-8000-000000000e15',
        'Session for Beta tenant'
    );

    perform set_config('test.sess_a', v_sess_a ->> 'sessionId', true);
    perform set_config('test.sess_b', v_sess_b ->> 'sessionId', true);
end;
$$;

select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    ) ->> 'tenantId',
    '7c1f0000-0000-4000-8000-000000000e14',
    'support_rpcs_take_tenant_from_session: session A resolves to Alpha tenant'
);

select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_b')::uuid
    ) ->> 'tenantId',
    '7c1f0000-0000-4000-8000-000000000e15',
    'support_rpcs_take_tenant_from_session: session B resolves to Beta tenant'
);

select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    ),
    jsonb_build_object(
        'tenantId', '7c1f0000-0000-4000-8000-000000000e14',
        'slug', 'alpha-shop',
        'name', 'Alpha Shop',
        'status', 'active',
        'cards', 2,
        'activeStaff', 1,
        'stampsLast7Days', 3
    ),
    'support_rpcs_take_tenant_from_session: Alpha counts match (cards=2, activeStaff=1, stampsLast7Days=3)'
);

select is(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_b')::uuid
    ),
    jsonb_build_object(
        'tenantId', '7c1f0000-0000-4000-8000-000000000e15',
        'slug', 'beta-shop',
        'name', 'Beta Shop',
        'status', 'trial',
        'cards', 1,
        'activeStaff', 1,
        'stampsLast7Days', 0
    ),
    'support_rpcs_take_tenant_from_session: Beta counts match (cards=1, activeStaff=1, stampsLast7Days=0)'
);

select ok(
    jsonb_array_length(public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    )) >= 4,
    'support_rpcs_take_tenant_from_session: Alpha activity contains stamps and redemptions'
);

select ok(
    not exists (
        select 1 from jsonb_array_elements(public.support_list_recent_activity(
            'ad000000-0000-4000-8000-0000000000a1',
            current_setting('test.sess_b')::uuid
        )) as elem
        where elem ->> 'kind' = 'stamp'
    ),
    'support_rpcs_take_tenant_from_session: Beta activity has no stamps from Alpha'
);

select is(
    jsonb_array_length(public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid,
        2
    )),
    2,
    'support_rpcs_take_tenant_from_session: limit parameter is respected'
);

-- ==============================================================================
-- 4. support_reads_exclude_personal_data (6 assertions)
-- ==============================================================================

select ok(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    )::text not like '%@test.local%',
    'support_reads_exclude_personal_data: overview excludes email addresses'
);

select ok(
    public.support_get_tenant_overview(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    )::text not like '%victim-customer%',
    'support_reads_exclude_personal_data: overview excludes customer names/handles'
);

select is(
    (
        select array_agg(key order by key)
        from jsonb_object_keys(public.support_get_tenant_overview(
            'ad000000-0000-4000-8000-0000000000a1',
            current_setting('test.sess_a')::uuid
        )) as key
    ),
    array['activeStaff', 'cards', 'name', 'slug', 'stampsLast7Days', 'status', 'tenantId'],
    'support_reads_exclude_personal_data: overview keys strictly match contract'
);

select ok(
    public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    )::text not like '%@test.local%',
    'support_reads_exclude_personal_data: activity excludes email addresses'
);

select ok(
    public.support_list_recent_activity(
        'ad000000-0000-4000-8000-0000000000a1',
        current_setting('test.sess_a')::uuid
    )::text not like '%ad000000-0000-4000-8000-0000000000d4%',
    'support_reads_exclude_personal_data: activity excludes customer IDs'
);

select ok(
    not exists (
        select 1
        from jsonb_array_elements(public.support_list_recent_activity(
            'ad000000-0000-4000-8000-0000000000a1',
            current_setting('test.sess_a')::uuid
        )) as elem,
        jsonb_object_keys(elem) as k
        where k not in ('at', 'kind', 'action')
    ),
    'support_reads_exclude_personal_data: activity objects only contain at, kind, action'
);

-- ==============================================================================
-- 5. Access control, RLS, and constraints (15 assertions)
-- ==============================================================================

set local role authenticated;

select throws_ok(
    $$select count(*) from public.support_sessions$$,
    '42501',
    null,
    'authenticated cannot select from support_sessions'
);

select throws_ok(
    $$insert into public.support_sessions (tenant_id, admin_id, reason)
      values ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000a1', 'Direct insert attempt')$$,
    '42501',
    null,
    'authenticated cannot insert into support_sessions'
);

select throws_ok(
    $$update public.support_sessions set reason = 'Hacked' where true$$,
    '42501',
    null,
    'authenticated cannot update support_sessions'
);

select throws_ok(
    $$delete from public.support_sessions where true$$,
    '42501',
    null,
    'authenticated cannot delete from support_sessions'
);

select throws_ok(
    $$select public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', 'Valid reason 123')$$,
    '42501',
    null,
    'authenticated cannot call start_support_session'
);

select throws_ok(
    $$select public.end_support_session('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-000000000eee')$$,
    '42501',
    null,
    'authenticated cannot call end_support_session'
);

select throws_ok(
    $$select public.support_get_tenant_overview('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-000000000eee')$$,
    '42501',
    null,
    'authenticated cannot call support_get_tenant_overview'
);

select throws_ok(
    $$select public.support_list_recent_activity('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-000000000eee')$$,
    '42501',
    null,
    'authenticated cannot call support_list_recent_activity'
);

reset role;

set local role anon;

select throws_ok(
    $$select count(*) from public.support_sessions$$,
    '42501',
    null,
    'anon cannot select from support_sessions'
);

select throws_ok(
    $$select public.start_support_session('ad000000-0000-4000-8000-0000000000a1', '7c1f0000-0000-4000-8000-000000000e14', 'Valid reason 123')$$,
    '42501',
    null,
    'anon cannot call start_support_session'
);

select throws_ok(
    $$select public.end_support_session('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-000000000eee')$$,
    '42501',
    null,
    'anon cannot call end_support_session'
);

select throws_ok(
    $$select public.support_get_tenant_overview('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-000000000eee')$$,
    '42501',
    null,
    'anon cannot call support_get_tenant_overview'
);

select throws_ok(
    $$select public.support_list_recent_activity('ad000000-0000-4000-8000-0000000000a1', 'ad000000-0000-4000-8000-000000000eee')$$,
    '42501',
    null,
    'anon cannot call support_list_recent_activity'
);

reset role;

select is(
    (select relrowsecurity from pg_catalog.pg_class where oid = 'public.support_sessions'::regclass),
    true,
    'support_sessions table has row level security enabled'
);

select throws_ok(
    $$insert into public.support_sessions (tenant_id, admin_id, reason, mode)
      values ('7c1f0000-0000-4000-8000-000000000e14', 'ad000000-0000-4000-8000-0000000000a1', 'Checking mode check', 'write')$$,
    '23514',
    null,
    'support_sessions mode check constraint enforces read_only'
);

select * from finish();
rollback;
