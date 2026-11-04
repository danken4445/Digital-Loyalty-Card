import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { User } from '@supabase/supabase-js';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
process.env.REDEEM_TOKEN_SECRET = 'redeem-token-secret-for-tests-32chars!!';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';

// Stub 'server-only'
vi.mock('server-only', () => ({}));

// Mock Supabase Server Client
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
};

const mockServerClient = {
  from: vi.fn().mockReturnValue(mockSupabaseQuery),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => mockServerClient),
  getVerifiedUser: vi.fn(),
}));

// Mock Supabase Admin Client
const mockAdminClient = {
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

// Mock next/headers cookies
const mockCookieMap = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      const val = mockCookieMap.get(name);
      return val !== undefined ? { name, value: val } : undefined;
    }),
    set: vi.fn((name: string, value: string) => mockCookieMap.set(name, value)),
    delete: vi.fn((name: string) => mockCookieMap.delete(name)),
  })),
}));

// Mock rate limiting
vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

// Mock mergeNonce
vi.mock('@/lib/security/mergeNonce', () => ({
  isMergeNonceUsed: vi.fn().mockResolvedValue({ used: false, failed: false }),
}));

// Mock customer record and wallet cards
vi.mock('@/lib/auth/customer', () => ({
  ensureCustomerRecord: vi.fn().mockResolvedValue(undefined),
  listWalletCards: vi.fn().mockResolvedValue([]),
}));

import { getTenantSlugForHost } from '@/lib/tenants/context';
import { POST as mergePost } from '@/app/api/customers/merge/route';
import { getVerifiedUser } from '@/lib/supabase/server';
import { issueMergeIntentToken } from '@/lib/security/mergeToken';
import * as turnstileModule from '@/lib/security/turnstile';

describe('Phase 13 Robustness Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieMap.clear();
  });

  describe('IPv6 and Domain Host Parsing in getTenantSlugForHost', () => {
    it('getTenantSlugForHost_parses_ipv6_host_correctly', async () => {
      mockSupabaseQuery.maybeSingle.mockResolvedValueOnce({
        data: { tenants: { slug: 'local-shop' } },
        error: null,
      });

      const slug = await getTenantSlugForHost('[::1]:3000');
      expect(mockServerClient.from).toHaveBeenCalledWith('tenant_domains');
      // Must look up '[::1]', NOT '[' caused by naive host.split(':')[0]
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('host', '[::1]');
      expect(slug).toBe('local-shop');
    });

    it('getTenantSlugForHost_parses_standard_host_with_port', async () => {
      mockSupabaseQuery.maybeSingle.mockResolvedValueOnce({
        data: { tenants: { slug: 'the-caffeine-plug' } },
        error: null,
      });

      const slug = await getTenantSlugForHost('card.thecaffeineplug.ph:443');
      expect(mockServerClient.from).toHaveBeenCalledWith('tenant_domains');
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('host', 'card.thecaffeineplug.ph');
      expect(slug).toBe('the-caffeine-plug');
    });
  });

  describe('Merge Wallets Route Validation', () => {
    it('merge_route_validates_rpc_outcome_runtime_shape', async () => {
      const targetUserId = '22222222-2222-2222-2222-222222222222';
      const sourceUserId = '11111111-1111-1111-1111-111111111111';

      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: targetUserId,
      } as User);

      const issued = issueMergeIntentToken(sourceUserId);

      // RPC returns an object that does NOT match MergeWalletsOutcome runtime contract
      mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
        if (rpcName === 'merge_wallets') {
          return {
            data: { unexpected_field: true, status: 'ok' }, // missing result, cards_moved, cards_combined
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: issued.mergeToken }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('internal_error');
      expect(json.message).toBe('Unable to complete customer merge.');
    });
  });

  describe('Turnstile Dead Code Cleanup', () => {
    it('turnstile_file_contains_no_unused_verify_function', () => {
      // Runtime module check: verifyTurnstileToken should not be exported
      expect(turnstileModule).not.toHaveProperty('verifyTurnstileToken');
      expect(turnstileModule).not.toHaveProperty('TurnstileVerificationResult');

      // Static source inspection
      const turnstilePath = path.resolve(process.cwd(), 'lib/security/turnstile.ts');
      const content = fs.readFileSync(turnstilePath, 'utf-8');
      expect(content).not.toMatch(/function\s+verifyTurnstileToken/);
      expect(content).not.toMatch(/export\s+(async\s+)?function\s+verifyTurnstileToken/);
    });
  });
});
