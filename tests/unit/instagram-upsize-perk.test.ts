import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';

(globalThis as any).React = React;

const TEST_SECRET = 'a'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    getAll: () => [],
    set: vi.fn(),
  })),
}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) =>
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null,
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

function createMockSupabaseQuery(customData: any = null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data: customData, error: null }),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: customData, error: null }).then(resolve, reject),
  };
  return query;
}

let tableData: Record<string, any> = {};

const mockAdminClient = {
  rpc: vi.fn(),
  from: vi.fn((table: string) => createMockSupabaseQuery(tableData[table] ?? null)),
};

const mockServerClient = {
  rpc: vi.fn(),
  from: vi.fn((table: string) => createMockSupabaseQuery(tableData[table] ?? null)),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/auth/customer', () => ({
  getCustomerCardState: vi.fn(),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
}));

import { issueRedeemToken, verifyRedeemToken } from '@/lib/security/redeemToken';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getCustomerCardState } from '@/lib/auth/customer';
import { getTenantBySlug } from '@/lib/tenants/context';
import { POST as upsizeTokenPost } from '@/app/api/perks/instagram-upsize/route';
import { POST as staffRedeemPost } from '@/app/api/staff/redeem/route';
import { InstagramUpsizePanel } from '@/components/card/InstagramUpsizePanel';
import { SHOP_CONFIG } from '@/lib/config';
import {
  ROUTES,
  TENANT_ONE_ID,
  TENANT_ONE_SLUG,
  type CustomerCardState,
  type TenantContext,
} from '@/lib/contracts';

const TEST_STAFF_ID = '99999999-9999-9999-9999-999999999999';
const TEST_CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';

const TEST_TENANT: TenantContext = {
  id: TENANT_ONE_ID,
  slug: TENANT_ONE_SLUG,
  name: SHOP_CONFIG.name,
  status: 'active',
  settings: {
    cooldownMinutes: 30,
    dailyCap: 2,
    rewardThreshold: 10,
    tagThrottleSeconds: 5,
    timezone: 'Asia/Manila',
    currency: 'PHP',
    rewardLabel: 'FREE COFFEE',
    brand: {},
    perks: {
      instagram_follow_upsize: { label: 'Free upsize on any drink', handle: SHOP_CONFIG.instagramHandle },
    },
  },
};

function cardState(overrides: Partial<CustomerCardState> = {}): CustomerCardState {
  return {
    customerId: TEST_CUSTOMER_ID,
    tenant: TEST_TENANT,
    isAnonymous: true,
    totalStamps: 0,
    stampsRedeemed: 0,
    availableStamps: 0,
    lastStampedAt: null,
    instagramUpsizeClaimed: false,
    ...overrides,
  };
}

function mockActiveStaff() {
  vi.mocked(getVerifiedUser).mockResolvedValue({
    id: TEST_STAFF_ID,
    email: 'barista@thecaffeineplug.ph',
    is_anonymous: false,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  } as User);
  tableData.tenant_members = [
    {
      tenant_id: TEST_TENANT.id,
      role: 'staff',
      display_name: 'Maria Barista',
      tenants: {
        id: TEST_TENANT.id,
        slug: TEST_TENANT.slug,
        name: TEST_TENANT.name,
        status: 'active',
      },
    },
  ];
}

function post(url: string, body?: unknown) {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Instagram follow upsize perk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableData = {};
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_TENANT);
    mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
      if (rpcName === 'claim_instagram_upsize') return { data: 'redeemed', error: null };
      if (rpcName === 'redeem_reward') return { data: 'redeemed', error: null };
      if (rpcName === 'log_audit_event') return { data: 'audit-1', error: null };
      return { data: null, error: null };
    });
  });

  describe('signed token kinds', () => {
    it('defaults to free-coffee with the v2 tcp2 prefix', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
      expect(issued.kind).toBe('free-coffee');
      expect(issued.token.startsWith('tcp2.')).toBe(true);
      const verified = verifyRedeemToken(issued.token);
      expect(verified.valid && verified.kind).toBe('free-coffee');
    });

    it('issues and verifies instagram-upsize tokens with their own prefix', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
      expect(issued.token.startsWith('tcpig2.')).toBe(true);
      const verified = verifyRedeemToken(issued.token);
      expect(verified.valid).toBe(true);
      expect(verified.valid && verified.kind).toBe('instagram-upsize');
    });

    it('rejects an upsize token relabelled as a free-coffee token', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
      const relabelled = issued.token.replace(/^tcpig2\./, 'tcp2.');
      expect(verifyRedeemToken(relabelled)).toEqual({ valid: false, reason: 'invalid-token' });
    });

    it('rejects unknown prefixes', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
      expect(verifyRedeemToken(issued.token.replace(/^tcp2\./, 'tcpx9.')).valid).toBe(false);
    });
  });

  describe(`POST ${ROUTES.api.instagramUpsizeToken}`, () => {
    it('returns 401 without a session', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);
      const res = await upsizeTokenPost(post(ROUTES.api.instagramUpsizeToken, { tenantSlug: TENANT_ONE_SLUG }));
      expect(res.status).toBe(401);
    });

    it('returns 400 invalid_input for an unknown shop', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({ id: TEST_CUSTOMER_ID } as User);
      vi.mocked(getTenantBySlug).mockResolvedValue(null);
      const res = await upsizeTokenPost(post(ROUTES.api.instagramUpsizeToken, { tenantSlug: 'nope' }));
      expect(res.status).toBe(400);
    });

    it('returns 403 once the card has already claimed the upsize', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({ id: TEST_CUSTOMER_ID } as User);
      vi.mocked(getCustomerCardState).mockResolvedValue(
        cardState({ instagramUpsizeClaimed: true }),
      );
      const res = await upsizeTokenPost(post(ROUTES.api.instagramUpsizeToken, { tenantSlug: TENANT_ONE_SLUG }));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toBe('This card has already used its Instagram upsize.');
    });

    it('issues an instagram-upsize token with zero stamps', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({ id: TEST_CUSTOMER_ID } as User);
      vi.mocked(getCustomerCardState).mockResolvedValue(cardState());
      const res = await upsizeTokenPost(post(ROUTES.api.instagramUpsizeToken, { tenantSlug: TENANT_ONE_SLUG }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('no-store');
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.kind).toBe('instagram-upsize');
      expect(json.data.qrSvg).toContain('<svg');
    });
  });

  describe('POST /api/staff/redeem with an upsize token', () => {
    beforeEach(() => {
      mockActiveStaff();
    });

    it('previews as eligible when the perk is unclaimed, regardless of stamps', async () => {
      tableData.customer_balances = { available_stamps: 0, total_stamps: 0, stamps_redeemed: 0 };
      const { token } = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
      const res = await staffRedeemPost(
        post(ROUTES.api.staff.redeem, { action: 'preview', token }),
      );
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.rewardKind).toBe('instagram-upsize');
      expect(json.data.canRedeem).toBe(true);
    });

    it('previews as not eligible when a perk claim already exists', async () => {
      tableData.perk_claims = { id: 'perk-claim-1' };
      const { token } = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
      const res = await staffRedeemPost(
        post(ROUTES.api.staff.redeem, { action: 'preview', token }),
      );
      const json = await res.json();
      expect(json.data.canRedeem).toBe(false);
    });

    it('confirms through claim_instagram_upsize and never touches redeem_reward', async () => {
      const { token } = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
      const res = await staffRedeemPost(
        post(ROUTES.api.staff.redeem, { action: 'confirm', token }),
      );
      const json = await res.json();
      expect(json.data).toMatchObject({
        mode: 'confirm',
        result: 'redeemed',
        rewardKind: 'instagram-upsize',
      });
      expect(mockAdminClient.rpc).toHaveBeenCalledWith('claim_instagram_upsize', {
        p_customer: TEST_CUSTOMER_ID,
        p_staff: TEST_STAFF_ID,
      });
      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('redeem_reward', expect.anything());
    });

    it('reports already-claimed from the database', async () => {
      mockAdminClient.rpc.mockResolvedValueOnce({ data: 'already-claimed', error: null });
      const { token } = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
      const res = await staffRedeemPost(
        post(ROUTES.api.staff.redeem, { action: 'confirm', token }),
      );
      const json = await res.json();
      expect(json.data.result).toBe('already-claimed');
      expect(json.data.message).toBe('This card has already used its Instagram upsize.');
    });

    it('still routes free-coffee tokens to redeem_reward', async () => {
      const { token } = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
      const res = await staffRedeemPost(
        post(ROUTES.api.staff.redeem, { action: 'confirm', token }),
      );
      const json = await res.json();
      expect(json.data.rewardKind).toBe('free-coffee');
      expect(mockAdminClient.rpc).toHaveBeenCalledWith('redeem_reward', expect.anything());
      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
        'claim_instagram_upsize',
        expect.anything(),
      );
    });
  });

  describe('InstagramUpsizePanel', () => {
    it('invites the customer to follow and links to the Instagram profile', () => {
      const html = renderToStaticMarkup(
        React.createElement(InstagramUpsizePanel, {
          claimed: false,
          tenantSlug: TENANT_ONE_SLUG,
          handle: SHOP_CONFIG.instagramHandle,
        }),
      );
      expect(html).toContain(`href="${SHOP_CONFIG.instagramUrl}"`);
      expect(html).toContain('FREE UPSIZE');
      expect(html).toContain(SHOP_CONFIG.instagramHandle);
      expect(html).toContain('CLAIM');
    });

    it('shows a claimed state without claim actions once used', () => {
      const html = renderToStaticMarkup(
        React.createElement(InstagramUpsizePanel, {
          claimed: true,
          tenantSlug: TENANT_ONE_SLUG,
          handle: SHOP_CONFIG.instagramHandle,
        }),
      );
      expect(html).toContain('INSTAGRAM UPSIZE • CLAIMED');
      expect(html).not.toContain('<button');
    });
  });
});
