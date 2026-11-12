import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_SECRET = 'a'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

const { mockStaff, mockTenant, mockRpc, mockFrom } = vi.hoisted(() => ({
  mockStaff: {
    userId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    tenantSlug: 'test-shop',
    tenantName: 'Test Shop',
    role: 'staff',
  },
  mockTenant: {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'test-shop',
    name: 'Test Shop',
    status: 'active',
    settings: {
      rewardThreshold: 10,
      rewardLabel: 'FREE COFFEE',
      milestoneStep: 5,
      milestoneRewardLabel: '50% OFF',
      brand: {},
      perks: {},
    },
  },
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: () => '127.0.0.1',
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@/lib/security/csrf', () => ({
  verifySameOriginRequest: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock('@/lib/auth/staff', () => ({
  requireStaffSession: vi.fn().mockResolvedValue({
    authorized: true,
    staff: mockStaff,
  }),
}));

vi.mock('@/lib/security/reward-token-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/reward-token-helpers')>();
  return {
    ...actual,
    resolveTenantForRedeem: vi.fn().mockResolvedValue({
      ok: true,
      tenant: mockTenant,
    }),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: mockRpc,
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    from: mockFrom,
  }),
}));

import { POST } from '@/app/api/staff/redeem/route';
import { issueRedeemToken } from '@/lib/security/redeemToken';

const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

describe('Staff Redeem API - Milestone Rewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previews a valid milestone reward token', async () => {
    const token = await issueRedeemToken(
      CUSTOMER_ID,
      mockStaff.tenantId,
      {
        kind: 'milestone-reward',
        secretOverride: TEST_SECRET,
        cycleIndex: 0,
      },
    );

    mockFrom.mockImplementation((table: string) => {
      if (table === 'audit_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'card_balances') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    total_stamps: 5,
                    stamps_redeemed: 0,
                    available_stamps: 5,
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'milestone_claims') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: vi.fn() }) }) };
    });

    const req = new Request('http://localhost:3000/api/staff/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'preview',
        token: token.token,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.rewardKind).toBe('milestone-reward');
    expect(json.data.canRedeem).toBe(true);
  });

  it('confirms a milestone reward redemption calling redeem_milestone_reward RPC', async () => {
    const token = await issueRedeemToken(
      CUSTOMER_ID,
      mockStaff.tenantId,
      {
        kind: 'milestone-reward',
        secretOverride: TEST_SECRET,
        cycleIndex: 0,
      },
    );

    mockFrom.mockImplementation((table: string) => {
      if (table === 'audit_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'card_balances') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { available_stamps: 5 },
                }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: vi.fn() }) }) };
    });

    mockRpc.mockResolvedValue({ data: 'redeemed', error: null });

    const req = new Request('http://localhost:3000/api/staff/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'confirm',
        token: token.token,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.result).toBe('redeemed');
    expect(json.data.rewardKind).toBe('milestone-reward');
    expect(mockRpc).toHaveBeenCalledWith('redeem_milestone_reward', {
      p_actor: mockStaff.userId,
      p_tenant: mockStaff.tenantId,
      p_customer: CUSTOMER_ID,
      p_nonce: expect.any(String),
    });
  });
});
