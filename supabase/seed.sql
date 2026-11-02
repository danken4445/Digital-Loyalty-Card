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

-- 2. Corresponding row in public.staff
insert into public.staff (
  user_id,
  display_name,
  role,
  active,
  created_at
) values (
  '00000000-0000-0000-0000-000000000001',
  'Dan (Owner)',
  'owner',
  true,
  now()
) on conflict (user_id) do nothing;

-- 3. Active demo NFC tag in public.tags
insert into public.tags (
  id,
  label,
  active,
  created_at
) values (
  'tcp_tag_demo_9x8k2m4p7q1w',
  'Counter Main NTAG215',
  true,
  now()
) on conflict (id) do nothing;
