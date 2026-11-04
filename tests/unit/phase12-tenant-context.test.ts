import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getTenantById,
  getTenantBySlug,
  getTenantSlugForHost,
  mapTenantRow,
} from '@/lib/tenants/context';
import { getClientIp } from '@/lib/security/ratelimit';
import {
  calculateStampProgress,
  formatDateTimeInZone,
  formatManilaDateTime,
} from '@/lib/rules/display';

const TENANT_ID = '7c1f0000-0000-4000-8000-000000000001';

const settingsRow = {
  tenant_id: TENANT_ID,
  cooldown_minutes: 45,
  daily_cap: 3,
  reward_threshold: 8,
  tag_throttle_seconds: 20,
  timezone: 'Asia/Tokyo',
  currency: 'JPY',
  reward_label: 'Free drink',
  brand: { primaryColor: '#111111', tagline: 'Hello' },
  perks: { instagram_upsize: { label: 'Upsize', handle: '@shop' } },
  updated_at: '2026-11-04T00:00:00Z',
};

const tenantRow = {
  id: TENANT_ID,
  slug: 'caffeine-plug',
  name: 'The Caffeine Plug',
  status: 'active',
  tenant_settings: settingsRow,
};

/** Builds a chainable Supabase query mock that resolves to `result` at maybeSingle(). */
function mockQuery(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
  return { from, select, eq, maybeSingle };
}

describe('Phase 12 tenant context readers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapTenantRow', () => {
    it('maps every settings field to camelCase', () => {
      const ctx = mapTenantRow(tenantRow);
      expect(ctx).toEqual({
        id: TENANT_ID,
        slug: 'caffeine-plug',
        name: 'The Caffeine Plug',
        status: 'active',
        settings: {
          cooldownMinutes: 45,
          dailyCap: 3,
          rewardThreshold: 8,
          tagThrottleSeconds: 20,
          timezone: 'Asia/Tokyo',
          currency: 'JPY',
          rewardLabel: 'Free drink',
          brand: { primaryColor: '#111111', tagline: 'Hello' },
          perks: { instagram_upsize: { label: 'Upsize', handle: '@shop' } },
        },
      });
    });

    it('defaults brand and perks to empty objects', () => {
      const ctx = mapTenantRow({
        ...tenantRow,
        tenant_settings: { ...settingsRow, brand: null, perks: null },
      });
      expect(ctx.settings.brand).toEqual({});
      expect(ctx.settings.perks).toEqual({});
    });

    it('throws when settings are missing', () => {
      expect(() => mapTenantRow({ ...tenantRow, tenant_settings: null })).toThrow(
        'tenant settings missing',
      );
    });
  });

  describe('getTenantBySlug', () => {
    it('trims and lowercases the slug and returns the mapped tenant', async () => {
      const q = mockQuery({ data: tenantRow, error: null });
      const ctx = await getTenantBySlug(' Caffeine-Plug ');
      expect(q.from).toHaveBeenCalledWith('tenants');
      expect(q.select).toHaveBeenCalledWith('id, slug, name, status, tenant_settings(*)');
      expect(q.eq).toHaveBeenCalledWith('slug', 'caffeine-plug');
      expect(ctx?.slug).toBe('caffeine-plug');
      expect(ctx?.settings.rewardThreshold).toBe(8);
    });

    it('returns null when no row matches', async () => {
      mockQuery({ data: null, error: null });
      await expect(getTenantBySlug('nope')).resolves.toBeNull();
    });
  });

  describe('getTenantById', () => {
    it('queries by id', async () => {
      const q = mockQuery({ data: tenantRow, error: null });
      const ctx = await getTenantById(TENANT_ID);
      expect(q.eq).toHaveBeenCalledWith('id', TENANT_ID);
      expect(ctx?.id).toBe(TENANT_ID);
    });

    it('returns null when no row matches', async () => {
      mockQuery({ data: null, error: null });
      await expect(getTenantById(TENANT_ID)).resolves.toBeNull();
    });
  });

  describe('getTenantSlugForHost', () => {
    it('strips the port and lowercases before looking up the host', async () => {
      const q = mockQuery({
        data: { tenants: { slug: 'caffeine-plug' } },
        error: null,
      });
      const slug = await getTenantSlugForHost('Card.TheCaffeinePlug.ph:443');
      expect(q.from).toHaveBeenCalledWith('tenant_domains');
      expect(q.eq).toHaveBeenCalledWith('host', 'card.thecaffeineplug.ph');
      expect(slug).toBe('caffeine-plug');
    });

    it('returns null for a null host without querying', async () => {
      const q = mockQuery({ data: null, error: null });
      await expect(getTenantSlugForHost(null)).resolves.toBeNull();
      expect(q.from).not.toHaveBeenCalled();
    });

    it('returns null when the host is unknown', async () => {
      mockQuery({ data: null, error: null });
      await expect(getTenantSlugForHost('unknown.example.com')).resolves.toBeNull();
    });
  });
});

describe('Phase 12 getClientIp', () => {
  function req(headers: Record<string, string>): Request {
    return new Request('https://example.com/', { headers });
  }

  it('client_ip_prefers_cf_connecting_ip', () => {
    expect(
      getClientIp(
        req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }),
      ),
    ).toBe('203.0.113.9');
  });

  it('falls back to the first x-forwarded-for value', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('returns null when neither header is present', () => {
    expect(getClientIp(req({}))).toBeNull();
  });
});

describe('Phase 12 rule-aware display helpers', () => {
  it('calculateStampProgress honours a per-tenant reward threshold', () => {
    expect(calculateStampProgress(9, 8).isRewardReady).toBe(true);
    expect(calculateStampProgress(9).isRewardReady).toBe(false);
  });

  it('formatDateTimeInZone renders in the given zone while formatManilaDateTime stays on Manila', () => {
    const iso = '2026-11-08T15:30:00Z';
    expect(formatDateTimeInZone(iso, 'Asia/Tokyo')).toContain('Nov 9');
    expect(formatManilaDateTime(iso)).toContain('Nov 8');
    expect(formatDateTimeInZone(iso, 'Asia/Manila')).toBe(formatManilaDateTime(iso));
  });
});
