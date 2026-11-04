-- Phase 1 Seed Data for The Caffeine Plug NFC Digital Loyalty System

-- 1. Deterministic demo staff auth user in auth.users
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'owner@thecaffeineplug.ph',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"display_name": "Dan (Owner)"}'::jsonb,
  now(),
  now(),
  '',
  ''
) on conflict (id) do nothing;

-- Ensure auth.identities has matching entry if auth.identities exists
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'auth' and table_name = 'identities'
  ) then
    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'email', 'owner@thecaffeineplug.ph'),
      'email',
      '00000000-0000-0000-0000-000000000001',
      now(),
      now(),
      now()
    ) on conflict do nothing;
  end if;
exception
  when others then
    null;
end;
$$;

-- 2. Owner membership of tenant #1 (The Caffeine Plug)
insert into public.tenant_members (
  tenant_id,
  user_id,
  role,
  display_name,
  active
) values (
  '7c1f0000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'owner',
  'Dan (Owner)',
  true
) on conflict (tenant_id, user_id) do nothing;

-- 3. Active demo NFC tag in public.tags
insert into public.tags (
  id,
  tenant_id,
  label,
  active,
  created_at
) values (
  'tcp_tag_demo_9x8k2m4p7q1w',
  '7c1f0000-0000-4000-8000-000000000001',
  'Counter Main NTAG215',
  true,
  now()
) on conflict (id) do nothing;

-- 4. Second demo tenant (multi-tenant local testing only)

insert into public.tenants (id, slug, name, status)
values ('7c1f0000-0000-4000-8000-0000000000d1', 'demo-roastery', 'Demo Roastery', 'active')
on conflict (id) do nothing;

insert into public.tenant_settings (tenant_id, cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, timezone, reward_label)
values ('7c1f0000-0000-4000-8000-0000000000d1', 60, 1, 8, 5, 'Asia/Manila', 'FREE PASTRY')
on conflict (tenant_id) do nothing;

-- 5. Demo owner for the second tenant (local Docker development only, like the seed owner above)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000b1',
  'authenticated',
  'authenticated',
  'owner@demoroastery.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"display_name": "Demo Roastery Owner"}'::jsonb,
  now(),
  now(),
  '',
  ''
) on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000b1',
  jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'email', 'owner@demoroastery.test'),
  'email',
  '00000000-0000-0000-0000-0000000000b1',
  now(),
  now(),
  now()
) on conflict do nothing;

-- Demo Roastery owner, plus the Caffeine Plug seed owner as a manager (one person, two shops)
insert into public.tenant_members (tenant_id, user_id, role, display_name, active)
values
  ('7c1f0000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'owner', 'Demo Roastery Owner', true),
  ('7c1f0000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'manager', 'Dan (Owner)', true)
on conflict (tenant_id, user_id) do nothing;

insert into public.tags (id, label, active, tenant_id)
values ('tcp_tag_demo_roastery01', 'Demo Roastery Counter NTAG215', true, '7c1f0000-0000-4000-8000-0000000000d1')
on conflict (id) do nothing;
