-- ==============================================================================
-- 20261106020000_phase14_brand_storage.sql
-- Phase 14: Tenant brand storage bucket and manager-scoped RLS policies.
-- ==============================================================================

-- 1. Brand storage bucket: public read, 512KB limit, images only (PNG, JPEG, WebP - NO SVG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-brand',
  'tenant-brand',
  true,
  524288,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. Helper function: returns tenant IDs where current user is an active owner or manager
create or replace function private.manager_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.tenant_id
  from public.tenant_members as m
  where m.user_id = (select auth.uid())
    and m.active = true
    and m.role in ('owner', 'manager');
$$;

revoke all on function private.manager_tenant_ids() from public, anon;
grant execute on function private.manager_tenant_ids() to authenticated, service_role;

-- 3. Storage RLS policies on storage.objects

-- Read policy: allow public select on bucket_id = 'tenant-brand'
drop policy if exists "tenant_brand_public_select" on storage.objects;
create policy "tenant_brand_public_select"
on storage.objects for select
using (bucket_id = 'tenant-brand');

-- Insert policy: authenticated owner/manager only, scoped to own tenant folder, image types only (no SVG)
drop policy if exists "tenant_brand_manager_insert" on storage.objects;
create policy "tenant_brand_manager_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tenant-brand'
  and (storage.foldername(name))[1]::uuid in (select private.manager_tenant_ids())
  and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'webp')
);

-- Update policy: authenticated owner/manager only, scoped to own tenant folder, image types only (no SVG)
drop policy if exists "tenant_brand_manager_update" on storage.objects;
create policy "tenant_brand_manager_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'tenant-brand'
  and (storage.foldername(name))[1]::uuid in (select private.manager_tenant_ids())
)
with check (
  bucket_id = 'tenant-brand'
  and (storage.foldername(name))[1]::uuid in (select private.manager_tenant_ids())
  and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'webp')
);

-- Delete policy: authenticated owner/manager only, scoped to own tenant folder
drop policy if exists "tenant_brand_manager_delete" on storage.objects;
create policy "tenant_brand_manager_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'tenant-brand'
  and (storage.foldername(name))[1]::uuid in (select private.manager_tenant_ids())
);
