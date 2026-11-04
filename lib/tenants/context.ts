import 'server-only';
import type { TenantBrand, TenantContext, TenantPerks, TenantStatus } from '@/lib/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Raw `tenant_settings` row as returned by PostgREST (snake_case columns). */
export interface TenantSettingsRow {
  cooldown_minutes: number;
  daily_cap: number;
  reward_threshold: number;
  tag_throttle_seconds: number;
  timezone: string;
  currency: string;
  reward_label: string;
  brand: unknown;
  perks: unknown;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  tenant_settings: TenantSettingsRow | null;
}

const TENANT_SELECT = 'id, slug, name, status, tenant_settings(*)';

/**
 * Pure mapper from a `tenants` row with embedded `tenant_settings` to the shared TenantContext.
 * Throws when settings are missing: every tenant is created with a settings row.
 */
export function mapTenantRow(row: TenantRow): TenantContext {
  const settings = row.tenant_settings;
  if (!settings) {
    throw new Error('tenant settings missing');
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status as TenantStatus,
    settings: {
      cooldownMinutes: settings.cooldown_minutes,
      dailyCap: settings.daily_cap,
      rewardThreshold: settings.reward_threshold,
      tagThrottleSeconds: settings.tag_throttle_seconds,
      timezone: settings.timezone,
      currency: settings.currency,
      rewardLabel: settings.reward_label,
      brand: (settings.brand ?? {}) as TenantBrand,
      perks: (settings.perks ?? {}) as TenantPerks,
    },
  };
}

/** Public read (RLS allows anon/authenticated SELECT) of a tenant and its settings by slug. */
export async function getTenantBySlug(slug: string): Promise<TenantContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('tenants')
    .select(TENANT_SELECT)
    .eq('slug', slug.trim().toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`tenant lookup failed: ${error.message}`);
  }
  return data ? mapTenantRow(data as unknown as TenantRow) : null;
}

/** Public read of a tenant and its settings by id. */
export async function getTenantById(id: string): Promise<TenantContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('tenants')
    .select(TENANT_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`tenant lookup failed: ${error.message}`);
  }
  return data ? mapTenantRow(data as unknown as TenantRow) : null;
}

/** Resolves a custom domain (port ignored, case-insensitive) to its tenant slug, or null. */
export async function getTenantSlugForHost(host: string | null): Promise<string | null> {
  if (!host) {
    return null;
  }
  const normalizedHost = host.split(':')[0]?.trim().toLowerCase();
  if (!normalizedHost) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('tenant_domains')
    .select('tenants(slug)')
    .eq('host', normalizedHost)
    .maybeSingle();

  if (error) {
    throw new Error(`tenant domain lookup failed: ${error.message}`);
  }
  const row = data as unknown as { tenants: { slug: string } | null } | null;
  return row?.tenants?.slug ?? null;
}
