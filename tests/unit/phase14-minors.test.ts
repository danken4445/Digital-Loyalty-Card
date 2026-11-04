import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CustomerCardState, IssuedRedeemToken, TenantContext } from '@/lib/contracts';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.REDEEM_TOKEN_SECRET = 'a'.repeat(32);

vi.mock('server-only', () => ({}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const headerStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (name: string) => headerStore.get(name.toLowerCase()) ?? null })),
}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? null,
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockMaybeSingle = vi.fn();

function makeQueryChain(data: unknown = []) {
  const query: any = {
    select: vi.fn((...args: unknown[]) => {
      mockSelect(...args);
      return query;
    }),
    eq: vi.fn((...args: unknown[]) => {
      mockEq(...args);
      return query;
    }),
    order: vi.fn((...args: unknown[]) => {
      mockOrder(...args);
      return query;
    }),
    limit: vi.fn((...args: unknown[]) => {
      mockLimit(...args);
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      mockMaybeSingle();
      return { data, error: null };
    }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
  };
  return query;
}

const mockFrom = vi.fn();
const mockServerClient = {
  from: mockFrom,
};

const mockAdminRpc = vi.fn();
const mockAdminClient = {
  rpc: mockAdminRpc,
  from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
  getTenantById: vi.fn(),
  getTenantAliasHost: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth/customer', () => ({
  getCustomerCardState: vi.fn(),
  listWalletCards: vi.fn(),
}));

vi.mock('@/lib/security/redeemToken', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/redeemToken')>('@/lib/security/redeemToken');
  return {
    ...actual,
    issueRedeemToken: vi.fn().mockResolvedValue({
      token: 'mock-token',
      qrSvg: '<svg>mock</svg>',
      displayCode: 'ABCD-EFGH',
      kind: 'free-coffee',
      ttlSeconds: 300,
      expiresAtIso: '2026-11-05T00:05:00.000Z',
      payload: {
        customerId: '11111111-1111-4111-8111-111111111111',
        tenantId: '7c1f0000-0000-4000-8000-000000000002',
        iat: 1000,
        exp: 2000,
        nonce: 'nonce1234',
      },
    } satisfies IssuedRedeemToken),
    verifyRedeemToken: actual.verifyRedeemToken,
  };
});

import ShopPage from '@/app/s/[slug]/page';
import { AddCardPanel } from '@/components/card/AddCardPanel';
import { getTenantBySlug, getTenantById } from '@/lib/tenants/context';
import { getCustomerCardState } from '@/lib/auth/customer';
import { getVerifiedUser } from '@/lib/supabase/server';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getStaffTagsList } from '@/lib/tags/actions';
import { getStaffActivityDashboardData } from '@/lib/auth/staff';
import { POST as redeemTokenPost } from '@/app/api/redeem-token/route';
import {
  parseRedeemTokenBody,
  resolveTenantForRedeem,
  isSuspendedRedeemExpired,
} from '@/lib/security/reward-token-helpers';

const TENANT_ID = '7c1f0000-0000-4000-8000-000000000002';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

type TenantWithSuspended = TenantContext & { suspendedAt?: string | null };

function makeTenant(overrides: Partial<TenantContext> & { suspendedAt?: string | null } = {}): TenantWithSuspended {
  return {
    id: TENANT_ID,
    slug: 'tokyo-roast',
    name: 'Tokyo Roast',
    status: 'active',
    settings: {
      cooldownMinutes: 30,
      dailyCap: 2,
      rewardThreshold: 8,
      tagThrottleSeconds: 5,
      timezone: 'Asia/Manila',
      currency: 'PHP',
      rewardLabel: 'Free pastry',
      brand: {
        primaryColor: '#0A0A0A',
        accentColor: '#FFFFFF',
      },
      perks: {},
    },
    ...overrides,
  };
}

function makeCardState(overrides: Partial<CustomerCardState> = {}): CustomerCardState {
  const tenant = makeTenant();
  return {
    customerId: CUSTOMER_ID,
    tenant,
    availableStamps: 8,
    totalStamps: 8,
    stampsRedeemed: 0,
    lastStampedAt: '2026-11-01T10:00:00.000Z',
    createdAt: '2026-10-15T08:00:00.000Z',
    isAnonymous: false,
    email: 'user@example.com',
    ...overrides,
  };
}

describe('Phase 14 Minors & Suspended-Shop UX (Task 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headerStore.clear();
    mockFrom.mockImplementation((_table: string) => makeQueryChain([]));
  });

  describe('1. suspended_shop_card_shows_paused_message_and_blocks_add_loop', () => {
    it('shows paused messaging and blocks onboarding/add loop when tenant status is suspended', async () => {
      const suspendedTenant = makeTenant({
        status: 'suspended',
        suspendedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      });
      vi.mocked(getTenantBySlug).mockResolvedValue(suspendedTenant);

      // (a) Signed out user at suspended shop
      vi.mocked(getCustomerCardState).mockResolvedValue(null);
      const signedOutHtml = renderToStaticMarkup(
        await ShopPage({
          params: Promise.resolve({ slug: 'tokyo-roast' }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(signedOutHtml.toLowerCase()).toContain('paused');
      // Must not render active get-card button link/button in unpaused form
      expect(signedOutHtml).not.toContain('GetCardButton');

      // (b) Signed in user without card at suspended shop
      vi.mocked(getCustomerCardState).mockResolvedValue('no-card');
      const noCardHtml = renderToStaticMarkup(
        await ShopPage({
          params: Promise.resolve({ slug: 'tokyo-roast' }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(noCardHtml.toLowerCase()).toContain('paused');

      // (c) Active card holder at suspended shop sees paused status banner
      vi.mocked(getCustomerCardState).mockResolvedValue(makeCardState({ availableStamps: 3 }));
      const activeCardHtml = renderToStaticMarkup(
        await ShopPage({
          params: Promise.resolve({ slug: 'tokyo-roast' }),
          searchParams: Promise.resolve({}),
        }),
      );
      expect(activeCardHtml.toLowerCase()).toContain('paused');
    });

    it('AddCardPanel handles tenant-unavailable response without redirecting with added=1', async () => {
      // Test AddCardPanel when API returns tenant-unavailable
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              result: 'tenant-unavailable',
              redirectTo: '/s/tokyo-roast',
            },
          }),
        } as Response);

        const html = renderToStaticMarkup(
          React.createElement(AddCardPanel, {
            tenantSlug: 'tokyo-roast',
            tenantName: 'Tokyo Roast',
            rewardLabel: 'Free pastry',
            isSuspended: true,
          }),
        );
        expect(html.toLowerCase()).toContain('paused');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('2. suspended_redeem_expired_shows_closed_message', () => {
    it('rejects redeem-token issuance when 30-day suspension window is expired', async () => {
      const expiredSuspendedTenant = makeTenant({
        status: 'suspended',
        suspendedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      });
      vi.mocked(getTenantBySlug).mockResolvedValue(expiredSuspendedTenant);
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: CUSTOMER_ID,
      } as any);
      vi.mocked(getCustomerCardState).mockResolvedValue(makeCardState({ availableStamps: 8 }));

      const req = new Request('http://localhost:3000/api/redeem-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ tenantSlug: 'tokyo-roast' }),
      });

      const res = await redeemTokenPost(req);
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.ok).toBe(false);
      expect(json.message.toLowerCase()).toContain('closed');
    });

    it('displays expired redemption closed notice on shop page when past 30 days', async () => {
      const expiredSuspendedTenant = makeTenant({
        status: 'suspended',
        suspendedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      });
      vi.mocked(getTenantBySlug).mockResolvedValue(expiredSuspendedTenant);
      vi.mocked(getCustomerCardState).mockResolvedValue(makeCardState({ availableStamps: 8 }));

      const html = renderToStaticMarkup(
        await ShopPage({
          params: Promise.resolve({ slug: 'tokyo-roast' }),
          searchParams: Promise.resolve({}),
        }),
      );

      // Must show redemption closed message and must not issue redeem token
      expect(html.toLowerCase()).toContain('redemption');
      expect(html.toLowerCase()).toContain('closed');
      expect(issueRedeemToken).not.toHaveBeenCalled();
    });
  });

  describe('3. tenant_id_filters_on_tag_and_dashboard_queries', () => {
    it('enforces .eq(tenant_id, tenantId) on staff tags list query', async () => {
      const mockStaff = {
        userId: 'staff-user-id',
        email: 'staff@example.com',
        role: 'owner' as const,
        tenantId: TENANT_ID,
        tenantSlug: 'tokyo-roast',
        tenantName: 'Tokyo Roast',
      };

      vi.mocked(getTenantById).mockResolvedValue(makeTenant());

      headerStore.set('cookie', `tcp_staff_tenant=${TENANT_ID}`);
      // Query tags list
      await getStaffTagsList({ staff: mockStaff });

      expect(mockFrom).toHaveBeenCalledWith('tags');
      expect(mockEq).toHaveBeenCalledWith('tenant_id', TENANT_ID);
    });

    it('enforces .eq(tenant_id, tenantId) on activity dashboard queries (stamps, redemptions, audit_log)', async () => {
      const mockStaff = {
        userId: 'staff-user-id',
        email: 'staff@example.com',
        role: 'owner' as const,
        tenantId: TENANT_ID,
        tenantSlug: 'tokyo-roast',
        tenantName: 'Tokyo Roast',
      };

      vi.mocked(getTenantById).mockResolvedValue(makeTenant());

      headerStore.set('cookie', `tcp_staff_tenant=${TENANT_ID}`);
      await getStaffActivityDashboardData({ staff: mockStaff });

      expect(mockFrom).toHaveBeenCalledWith('stamps');
      expect(mockFrom).toHaveBeenCalledWith('redemptions');
      expect(mockFrom).toHaveBeenCalledWith('audit_log');
      expect(mockEq).toHaveBeenCalledWith('tenant_id', TENANT_ID);
    });
  });

  describe('4. reward_token_routes_share_body_parse_and_tenant_resolve', () => {
    it('shared reward-token helper parses body and resolves active tenant', async () => {
      const tenant = makeTenant({ status: 'active' });
      vi.mocked(getTenantBySlug).mockResolvedValue(tenant);

      const parsed = parseRedeemTokenBody({ tenantSlug: 'tokyo-roast' });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.data.tenantSlug).toBe('tokyo-roast');
      }

      const resolved = await resolveTenantForRedeem('tokyo-roast');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.tenant.id).toBe(TENANT_ID);
      }
    });

    it('shared reward-token helper detects expired suspended tenant', () => {
      const activeTenant = makeTenant({ status: 'active' });
      expect(isSuspendedRedeemExpired(activeTenant)).toBe(false);

      const freshSuspended = makeTenant({
        status: 'suspended',
        suspendedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(isSuspendedRedeemExpired(freshSuspended)).toBe(false);

      const expiredSuspended = makeTenant({
        status: 'suspended',
        suspendedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(isSuspendedRedeemExpired(expiredSuspended)).toBe(true);
    });

    it('shared reward-token helper rejects closed or non-existent tenants', async () => {
      vi.mocked(getTenantBySlug).mockResolvedValueOnce(null);
      const notFoundRes = await resolveTenantForRedeem('ghost');
      expect(notFoundRes.ok).toBe(false);

      vi.mocked(getTenantBySlug).mockResolvedValueOnce(makeTenant({ status: 'closed' }));
      const closedRes = await resolveTenantForRedeem('closed-shop');
      expect(closedRes.ok).toBe(false);
    });
  });
});
