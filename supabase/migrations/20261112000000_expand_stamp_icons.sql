-- ==============================================================================
-- 20261112000000_expand_stamp_icons.sql
-- Expand available stamp icons to include pickleball, shoe, vape, dumbbell, and car.
-- Redefines update_tenant_brand with the expanded whitelist.
-- ==============================================================================

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
  v_stamp_icon text;
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

  if p_brand ? 'stampIcon' and p_brand->>'stampIcon' is not null then
    v_stamp_icon := pg_catalog.btrim(p_brand->>'stampIcon');
    if v_stamp_icon not in (
      'cup', 'star', 'heart', 'scissors', 'paw', 'leaf', 'utensils', 'bag', 'sparkles', 'gift',
      'pickleball', 'shoe', 'vape', 'dumbbell', 'car'
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
      'cardArtUrl', v_card_art,
      'stampIcon', v_stamp_icon
    )
  );

  update public.tenant_settings
  set brand = coalesce(brand, '{}'::jsonb) || v_clean_brand,
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
