import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

// Ensure React is globally available for components compiled with classic JSX transform
(globalThis as any).React = React;

// Provide default server environment variables for getServerEnv()
const TEST_SECRET = 'a'.repeat(32); // 32 characters minimum
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

// Stub 'server-only' for Vitest Node test environment
vi.mock('server-only', () => ({}));

// Mock next/navigation for router and redirect context
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
}));

// In-memory cookie store for next/headers
const mockCookieMap = new Map<string, string>();
const mockCookieStore = {
  get: vi.fn((name: string) => {
    const val = mockCookieMap.get(name);
    return val !== undefined ? { name, value: val } : undefined;
  }),
  set: vi.fn((name: string, value: string) => {
    mockCookieMap.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    mockCookieMap.delete(name);
  }),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

// Mock rate limiting
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
  resetMemoryRateLimitStore: vi.fn(),
}));

// Mock browser Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      linkIdentity: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    },
  })),
}));

// Query builder mock factory
function createMockSupabaseQuery(customData: any = null, customError: any = null) {
  const query: any = {
    select: vi.fn().mockImplementation(() => query),
    insert: vi.fn().mockImplementation(() => query),
    update: vi.fn().mockImplementation(() => query),
    delete: vi.fn().mockImplementation(() => query),
    eq: vi.fn().mockImplementation(() => query),
    order: vi.fn().mockImplementation(() => query),
    limit: vi.fn().mockImplementation(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data: customData, error: customError }),
    single: vi.fn().mockResolvedValue({ data: customData, error: customError }),
    then: (onResolve: any, onReject: any) =>
      Promise.resolve({ data: customData, error: customError }).then(onResolve, onReject),
  };
  return query;
}

let tableQueryHandlers: Record<string, (table: string) => any> = {};

const mockAdminClient = {
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    if (tableQueryHandlers[table]) {
      return tableQueryHandlers[table](table);
    }
    return createMockSupabaseQuery(null, null);
  }),
};

const mockServerAuth = {
  exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
};

const mockServerClient = {
  auth: mockServerAuth,
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    if (tableQueryHandlers[table]) {
      return tableQueryHandlers[table](table);
    }
    return createMockSupabaseQuery(null, null);
  }),
};

// Mock server auth and database clients
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => mockServerClient),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

// Mock customer helper functions
vi.mock('@/lib/auth/customer', () => ({
  ensureCustomerRecord: vi.fn().mockResolvedValue('ensured-customer-id'),
  getCustomerCardState: vi.fn(),
  listWalletCards: vi.fn(),
}));

// Import modules under test
import { issueMergeIntentToken, verifyMergeIntentToken } from '@/lib/security/mergeToken';
import { POST as mergeIntentPost } from '@/app/api/customers/merge-intent/route';
import { POST as mergePost } from '@/app/api/customers/merge/route';
import { GET as authCallbackGet } from '@/app/auth/callback/route';
import { BackupCardPanel } from '@/components/card/BackupCardPanel';
import ShopPage from '@/app/s/[slug]/page';

import { getVerifiedUser } from '@/lib/supabase/server';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { ensureCustomerRecord, getCustomerCardState, listWalletCards } from '@/lib/auth/customer';
import { getTenantBySlug } from '@/lib/tenants/context';
import {
  MERGE_INTENT_COOKIE_NAME,
  ROUTES,
  TENANT_ONE_ID,
  type CustomerCardState,
  type TenantContext,
  type WalletCardSummary,
} from '@/lib/contracts';

const TEST_TENANT: TenantContext = {
  id: TENANT_ONE_ID,
  slug: 'caffeine-plug',
  name: 'The Caffeine Plug',
  status: 'active',
  settings: {
    cooldownMinutes: 30,
    dailyCap: 2,
    rewardThreshold: 10,
    tagThrottleSeconds: 5,
    timezone: 'Asia/Manila',
    currency: 'PHP',
    rewardLabel: 'Free Coffee',
    brand: {},
    perks: {},
  },
};
const SHOP_PARAMS = Promise.resolve({ slug: 'caffeine-plug' });

function walletOf(availableStamps: number, totalStamps: number): WalletCardSummary[] {
  return [
    {
      tenantId: TENANT_ONE_ID,
      tenantSlug: 'caffeine-plug',
      tenantName: 'The Caffeine Plug',
      brand: {},
      rewardThreshold: 10,
      rewardLabel: 'Free Coffee',
      availableStamps,
      totalStamps,
      lastStampedAt: null,
      addedAt: '2026-10-15T08:00:00.000Z',
    },
  ];
}

const TEST_SOURCE_CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_TARGET_CUSTOMER_ID = '22222222-2222-2222-2222-222222222222';

describe('Phase 6: Customer Backup, Recovery & Merge Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;
    mockCookieMap.clear();
    tableQueryHandlers = {};
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_TENANT);

    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetMs: 60_000,
    });

    vi.mocked(ensureCustomerRecord).mockResolvedValue(TEST_SOURCE_CUSTOMER_ID);

    mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
      if (rpcName === 'log_audit_event') {
        return { data: 'audit-log-uuid-1', error: null };
      }
      if (rpcName === 'merge_wallets') {
        return { data: { result: 'merged', cards_moved: 1, cards_combined: 0 }, error: null };
      }
      return { data: null, error: null };
    });

    mockServerAuth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;
  });

  // ============================================================================
  // 1. HMAC MERGE INTENT TOKEN (issueMergeIntentToken & verifyMergeIntentToken)
  // ============================================================================
  describe('1. issueMergeIntentToken & verifyMergeIntentToken', () => {
    it('generates a valid token and verifies round-trip matching all payload fields', () => {
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);

      expect(issued.mergeToken).toBeDefined();
      expect(issued.mergeToken.startsWith('tcp_merge1.')).toBe(true);
      expect(issued.ttlSeconds).toBe(600);
      expect(issued.payload.sourceCustomerId).toBe(TEST_SOURCE_CUSTOMER_ID);
      expect(typeof issued.payload.iat).toBe('number');
      expect(issued.payload.exp).toBe(issued.payload.iat + 600);
      expect(typeof issued.payload.nonce).toBe('string');
      expect(issued.payload.nonce.length).toBeGreaterThanOrEqual(8);
      expect(issued.expiresAtIso).toBe(new Date(issued.payload.exp * 1000).toISOString());

      const verified = verifyMergeIntentToken(issued.mergeToken);
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        expect(verified.payload.sourceCustomerId).toBe(TEST_SOURCE_CUSTOMER_ID);
        expect(verified.payload.iat).toBe(issued.payload.iat);
        expect(verified.payload.exp).toBe(issued.payload.exp);
        expect(verified.payload.nonce).toBe(issued.payload.nonce);
      }
    });

    it('respects custom issue options: ttlSeconds, nowMs, nonceOverride, secretOverride', () => {
      const fixedNowMs = 1700000000000;
      const customSecret = 's'.repeat(40);
      const customNonce = 'custom_nonce_12345';
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID, {
        nowMs: fixedNowMs,
        ttlSeconds: 300,
        nonceOverride: customNonce,
        secretOverride: customSecret,
      });

      expect(issued.payload.iat).toBe(1700000000);
      expect(issued.payload.exp).toBe(1700000300);
      expect(issued.payload.nonce).toBe(customNonce);
      expect(issued.ttlSeconds).toBe(300);

      const verified = verifyMergeIntentToken(issued.mergeToken, {
        nowMs: fixedNowMs + 1000,
        secretOverride: customSecret,
      });
      expect(verified.valid).toBe(true);
      if (verified.valid) {
        expect(verified.payload.nonce).toBe(customNonce);
      }
    });

    it('throws when secret length is less than the required minimum of 32 characters', () => {
      expect(() => {
        issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID, {
          secretOverride: 'too-short-secret',
        });
      }).toThrow(/REDEEM_TOKEN_SECRET must be at least 32 characters/);
    });

    it('rejects tampered signatures with invalid-token', () => {
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);
      const parts = issued.mergeToken.split('.');
      expect(parts).toHaveLength(3);
      const [prefix, payloadB64, sigB64] = parts as [string, string, string];
      const tamperedSig = sigB64.slice(0, -2) + (sigB64.endsWith('A') ? 'B' : 'A');
      const tamperedToken = `${prefix}.${payloadB64}.${tamperedSig}`;

      const res = verifyMergeIntentToken(tamperedToken);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('invalid-token');
      }
    });

    it('rejects tampered payload content even if signature structure looks valid', () => {
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);
      const parts = issued.mergeToken.split('.');
      expect(parts).toHaveLength(3);
      const [prefix, payloadB64, sigB64] = parts as [string, string, string];

      // Alter sourceCustomerId in the base64url payload
      const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      decoded.sourceCustomerId = TEST_TARGET_CUSTOMER_ID;
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
      const tamperedToken = `${prefix}.${tamperedPayloadB64}.${sigB64}`;

      const res = verifyMergeIntentToken(tamperedToken);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('invalid-token');
      }
    });

    it('rejects verification if secret does not match issuance secret', () => {
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID, {
        secretOverride: 'a'.repeat(32),
      });

      const res = verifyMergeIntentToken(issued.mergeToken, {
        secretOverride: 'b'.repeat(32),
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('invalid-token');
      }
    });

    it('rejects malformed tokens: invalid prefixes, segment counts, non-strings, and corrupt base64', () => {
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);
      const parts = issued.mergeToken.split('.');

      // Wrong prefix
      expect(verifyMergeIntentToken(`wrong_prefix.${parts[1]}.${parts[2]}`).valid).toBe(false);

      // Wrong segment count (2 parts or 4 parts)
      expect(verifyMergeIntentToken(`${parts[0]}.${parts[1]}`).valid).toBe(false);
      expect(verifyMergeIntentToken(`${issued.mergeToken}.extra`).valid).toBe(false);

      // Non-string or empty inputs
      expect(verifyMergeIntentToken('' as any).valid).toBe(false);
      expect(verifyMergeIntentToken('   ' as any).valid).toBe(false);
      expect(verifyMergeIntentToken(null as any).valid).toBe(false);
      expect(verifyMergeIntentToken(undefined as any).valid).toBe(false);
      expect(verifyMergeIntentToken(12345 as any).valid).toBe(false);

      // Malformed base64 / non-JSON payload
      expect(verifyMergeIntentToken(`${parts[0]}.not-valid-base64-json.${parts[2]}`).valid).toBe(
        false,
      );
    });

    it('rejects payload with non-uuid sourceCustomerId or invalid payload schema', () => {
      const fixedNow = 1700000000;
      const secret = TEST_SECRET;
      const invalidPayload = {
        sourceCustomerId: 'not-a-uuid',
        iat: fixedNow,
        exp: fixedNow + 600,
        nonce: 'valid_nonce_123',
      };
      const b64 = Buffer.from(JSON.stringify(invalidPayload)).toString('base64url');
      const crypto = require('node:crypto');
      const sig = crypto
        .createHmac('sha256', secret)
        .update(`tcp_merge1.${b64}`)
        .digest()
        .toString('base64url');
      const token = `tcp_merge1.${b64}.${sig}`;

      const res = verifyMergeIntentToken(token);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toBe('invalid-token');
      }
    });

    it('rejects payload where exp <= iat or future clock skew > 30 seconds', () => {
      const fixedNow = 1700000000;
      const secret = TEST_SECRET;
      const crypto = require('node:crypto');

      // 1. exp <= iat
      const badExpPayload = {
        sourceCustomerId: TEST_SOURCE_CUSTOMER_ID,
        iat: fixedNow,
        exp: fixedNow - 10,
        nonce: 'valid_nonce_123',
      };
      const badExpB64 = Buffer.from(JSON.stringify(badExpPayload)).toString('base64url');
      const badExpSig = crypto
        .createHmac('sha256', secret)
        .update(`tcp_merge1.${badExpB64}`)
        .digest()
        .toString('base64url');
      expect(verifyMergeIntentToken(`tcp_merge1.${badExpB64}.${badExpSig}`).valid).toBe(false);

      // 2. future clock skew > 30s
      const futurePayload = {
        sourceCustomerId: TEST_SOURCE_CUSTOMER_ID,
        iat: fixedNow + 35,
        exp: fixedNow + 635,
        nonce: 'valid_nonce_123',
      };
      const futureB64 = Buffer.from(JSON.stringify(futurePayload)).toString('base64url');
      const futureSig = crypto
        .createHmac('sha256', secret)
        .update(`tcp_merge1.${futureB64}`)
        .digest()
        .toString('base64url');
      const resSkew = verifyMergeIntentToken(`tcp_merge1.${futureB64}.${futureSig}`, {
        nowMs: fixedNow * 1000,
      });
      expect(resSkew.valid).toBe(false);
      if (!resSkew.valid) {
        expect(resSkew.reason).toBe('invalid-token');
      }
    });

    it('handles expiration boundaries: nowMs === exp*1000 accepted; nowMs > exp*1000 rejected with expired-token', () => {
      const baseNowSeconds = 1700000000;
      const ttl = 600;
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID, {
        nowMs: baseNowSeconds * 1000,
        ttlSeconds: ttl,
      });
      const expSeconds = baseNowSeconds + ttl;

      // 1 second before expiration: accepted
      const beforeExp = verifyMergeIntentToken(issued.mergeToken, {
        nowMs: (expSeconds - 1) * 1000,
      });
      expect(beforeExp.valid).toBe(true);

      // Exactly at expiration boundary (nowSeconds === exp): accepted
      const atBoundary = verifyMergeIntentToken(issued.mergeToken, {
        nowMs: expSeconds * 1000,
      });
      expect(atBoundary.valid).toBe(true);

      // 1 millisecond beyond expiration: nowSeconds becomes expSeconds + 1 -> rejected with 'expired-token'
      const afterBoundary = verifyMergeIntentToken(issued.mergeToken, {
        nowMs: (expSeconds + 1) * 1000,
      });
      expect(afterBoundary.valid).toBe(false);
      if (!afterBoundary.valid) {
        expect(afterBoundary.reason).toBe('expired-token');
      }

      // Far expired (e.g. 5 minutes later)
      const farExpired = verifyMergeIntentToken(issued.mergeToken, {
        nowMs: (expSeconds + 300) * 1000,
      });
      expect(farExpired.valid).toBe(false);
      if (!farExpired.valid) {
        expect(farExpired.reason).toBe('expired-token');
      }
    });
  });

  // ============================================================================
  // 2. POST /api/customers/merge-intent
  // ============================================================================
  describe('2. POST /api/customers/merge-intent Route Handler', () => {
    it('returns HTTP 401 when user is unauthenticated', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const request = new Request('http://localhost:3000/api/customers/merge-intent', {
        method: 'POST',
      });

      const response = await mergeIntentPost(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('unauthenticated');
    });

    it('returns HTTP 429 when rate limit is exceeded', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_SOURCE_CUSTOMER_ID,
      } as User);

      vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetMs: 60_000,
      });

      const request = new Request('http://localhost:3000/api/customers/merge-intent', {
        method: 'POST',
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });

      const response = await mergeIntentPost(request);
      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('rate_limited');
    });

    it('returns HTTP 200 with IssuedMergeIntent, sets tcp_merge_intent cookie, and ensures customer record', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_SOURCE_CUSTOMER_ID,
      } as User);

      const request = new Request('http://localhost:3000/api/customers/merge-intent', {
        method: 'POST',
      });

      const response = await mergeIntentPost(request);
      expect(response.status).toBe(200);

      // Check ensureCustomerRecord was called
      expect(ensureCustomerRecord).toHaveBeenCalledWith(TEST_SOURCE_CUSTOMER_ID);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.data.mergeToken).toBeDefined();
      expect(json.data.payload.sourceCustomerId).toBe(TEST_SOURCE_CUSTOMER_ID);
      expect(json.data.ttlSeconds).toBe(600);

      // Check headers
      expect(response.headers.get('Cache-Control')).toBe(
        'no-store, no-cache, must-revalidate, max-age=0',
      );

      // Check cookie
      const cookie = response.cookies.get(MERGE_INTENT_COOKIE_NAME);
      expect(cookie).toBeDefined();
      expect(cookie?.value).toBe(json.data.mergeToken);
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite).toBe('lax');
      expect(cookie?.maxAge).toBe(600);
      expect(cookie?.path).toBe('/');
    });

    it('returns HTTP 500 when an unexpected internal error occurs', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_SOURCE_CUSTOMER_ID,
      } as User);

      vi.mocked(ensureCustomerRecord).mockRejectedValue(new Error('DB failure'));

      const request = new Request('http://localhost:3000/api/customers/merge-intent', {
        method: 'POST',
      });

      const response = await mergeIntentPost(request);
      expect(response.status).toBe(500);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('internal_error');
    });
  });

  // ============================================================================
  // 3. POST /api/customers/merge
  // ============================================================================
  describe('3. POST /api/customers/merge Route Handler', () => {
    it('returns HTTP 401 when target user session is missing', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
      });

      const response = await mergePost(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('unauthenticated');
    });

    it('returns HTTP 429 when rate limit is exceeded', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetMs: 60_000,
      });

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
      });

      const response = await mergePost(request);
      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('rate_limited');
    });

    it('returns HTTP 400 for malformed JSON request body', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'content-length': '20',
        },
        body: '{"invalid_json": bad',
      });

      const response = await mergePost(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
    });

    it('returns HTTP 400 for invalid body schema types', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: 12345 }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
    });

    it('returns HTTP 400 when mergeToken is missing from both body and cookie', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
      expect(json.message).toContain('Missing merge intent token');
    });

    it('returns HTTP 400 when merge token is invalid or tampered', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: 'tcp_merge1.invalidpayload.invalidsig' }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
      expect(json.message).toContain('Invalid merge token');
    });

    it('returns HTTP 400 when merge token has expired', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      // Issue token that expired 10 minutes ago
      const pastMs = Date.now() - 1000 * 1000;
      const expired = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID, {
        nowMs: pastMs,
        ttlSeconds: 60,
      });

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: expired.mergeToken }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
      expect(json.message).toContain('Merge token has expired');
    });

    it('returns HTTP 400 when token nonce has already been used (replay abuse)', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);

      // The nonce was already consumed (merge_nonce_used RPC)
      mockAdminClient.rpc.mockImplementation(async (rpcName: string) =>
        rpcName === 'merge_nonce_used' ? { data: true, error: null } : { data: null, error: null },
      );

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: issued.mergeToken }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
      expect(json.message).toContain('already been used');
    });

    it('returns HTTP 500 if nonce query encounters database error', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);

      mockAdminClient.rpc.mockImplementation(async (rpcName: string) =>
        rpcName === 'merge_nonce_used'
          ? { data: null, error: { message: 'Database connection failed' } }
          : { data: null, error: null },
      );

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
    });

    it('returns HTTP 500 when merge_wallets RPC returns an error', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);


      mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
        if (rpcName === 'merge_wallets') {
          return { data: null, error: { message: 'Lock acquisition failure' } };
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
    });

    it('happy path: merges customer, records customer_merge_token_used in audit_log, clears cookie, and returns updated stamps', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);


      mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
        if (rpcName === 'merge_wallets') {
          expect(args.p_source).toBe(TEST_SOURCE_CUSTOMER_ID);
          expect(args.p_target).toBe(TEST_TARGET_CUSTOMER_ID);
          return { data: { result: 'merged', cards_moved: 1, cards_combined: 0 }, error: null };
        }
        if (rpcName === 'log_audit_event') {
          expect(args.p_actor).toBe(TEST_TARGET_CUSTOMER_ID);
          expect(args.p_action).toBe('customer_merge_token_used');
          expect(args.p_target).toBe(issued.payload.nonce);
          expect(args.p_detail.source_customer).toBe(TEST_SOURCE_CUSTOMER_ID);
          expect(args.p_detail.target_customer).toBe(TEST_TARGET_CUSTOMER_ID);
          return { data: 'audit-log-id', error: null };
        }
        return { data: null, error: null };
      });

      vi.mocked(listWalletCards).mockResolvedValue(walletOf(7, 7));

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: issued.mergeToken }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(200);

      // Verify ensureCustomerRecord was invoked for target user
      expect(ensureCustomerRecord).toHaveBeenCalledWith(TEST_TARGET_CUSTOMER_ID);

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.data.result).toBe('merged');
      expect(json.data.sourceCustomerId).toBe(TEST_SOURCE_CUSTOMER_ID);
      expect(json.data.targetCustomerId).toBe(TEST_TARGET_CUSTOMER_ID);
      expect(json.data.availableStampsAfter).toBe(7);
      expect(json.data.totalStampsAfter).toBe(7);

      // Verify cookie is cleared (maxAge: 0)
      const cookie = response.cookies.get(MERGE_INTENT_COOKIE_NAME);
      expect(cookie).toBeDefined();
      expect(cookie?.maxAge).toBe(0);
    });

    it('reads merge token from tcp_merge_intent cookie when not present in request body', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);
      mockCookieMap.set(MERGE_INTENT_COOKIE_NAME, issued.mergeToken);


      vi.mocked(listWalletCards).mockResolvedValue(walletOf(5, 5));

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.data.result).toBe('merged');
      expect(json.data.availableStampsAfter).toBe(5);
    });

    it('handles noop-same-user cleanly without logging audit event or failing', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_SOURCE_CUSTOMER_ID,
      } as User);

      // Token where sourceCustomerId matches target user
      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);


      mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
        if (rpcName === 'merge_wallets') {
          return { data: { result: 'noop-same-user', cards_moved: 0, cards_combined: 0 }, error: null };
        }
        return { data: null, error: null };
      });

      vi.mocked(listWalletCards).mockResolvedValue(walletOf(3, 3));

      const request = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: issued.mergeToken }),
      });

      const response = await mergePost(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.data.result).toBe('noop-same-user');

      // log_audit_event should NOT have been called since no merge took place
      const auditEventCalls = mockAdminClient.rpc.mock.calls.filter(
        (call: any[]) => call[0] === 'log_audit_event',
      );
      expect(auditEventCalls.length).toBe(0);

      // Cookie is still cleared
      expect(response.cookies.get(MERGE_INTENT_COOKIE_NAME)?.maxAge).toBe(0);
    });
  });

  // ============================================================================
  // 4. GET /auth/callback
  // ============================================================================
  describe('4. GET /auth/callback Route Handler', () => {
    it('sanitizes next query param: blocks open-redirect attacks (//evil.com, /\\evil.com) and defaults to /card', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      // Protocol-relative attempt //evil.com
      const req1 = new NextRequest('http://localhost:3000/auth/callback?next=//evil.com');
      const res1 = await authCallbackGet(req1);
      expect(res1.status).toBe(303);
      expect(new URL(res1.headers.get('location')!).pathname).toBe('/card');

      // Backslash attempt /\evil.com
      const req2 = new NextRequest('http://localhost:3000/auth/callback?next=/\\evil.com');
      const res2 = await authCallbackGet(req2);
      expect(res2.status).toBe(303);
      expect(new URL(res2.headers.get('location')!).pathname).toBe('/card');

      // Absolute external domain
      const req3 = new NextRequest('http://localhost:3000/auth/callback?next=https://evil.com');
      const res3 = await authCallbackGet(req3);
      expect(res3.status).toBe(303);
      expect(new URL(res3.headers.get('location')!).pathname).toBe('/card');

      // Javascript pseudo-protocol
      const req4 = new NextRequest('http://localhost:3000/auth/callback?next=javascript:alert(1)');
      const res4 = await authCallbackGet(req4);
      expect(res4.status).toBe(303);
      expect(new URL(res4.headers.get('location')!).pathname).toBe('/card');
    });

    it('allows valid internal paths for next query param', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const req1 = new NextRequest('http://localhost:3000/auth/callback?next=/card');
      const res1 = await authCallbackGet(req1);
      expect(res1.status).toBe(303);
      expect(new URL(res1.headers.get('location')!).pathname).toBe('/card');

      const req2 = new NextRequest('http://localhost:3000/auth/callback?next=/card?r=stamped');
      const res2 = await authCallbackGet(req2);
      expect(res2.status).toBe(303);
      const url2 = new URL(res2.headers.get('location')!);
      expect(url2.pathname).toBe('/card');
      expect(url2.searchParams.get('r')).toBe('stamped');

      const req3 = new NextRequest('http://localhost:3000/auth/callback?next=/start');
      const res3 = await authCallbackGet(req3);
      expect(res3.status).toBe(303);
      expect(new URL(res3.headers.get('location')!).pathname).toBe('/start');
    });

    it('exchanges code for session via exchangeCodeForSession when code param is present', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const req = new NextRequest('http://localhost:3000/auth/callback?code=oauth-auth-code-12345');
      const res = await authCallbackGet(req);

      expect(mockServerAuth.exchangeCodeForSession).toHaveBeenCalledWith('oauth-auth-code-12345');
      expect(res.status).toBe(303);
    });

    it('catches and recovers cleanly when exchangeCodeForSession throws an error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockServerAuth.exchangeCodeForSession.mockRejectedValue(new Error('Invalid grant code'));
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const req = new NextRequest('http://localhost:3000/auth/callback?code=invalid-code');
      const res = await authCallbackGet(req);

      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/card');
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('ensures customer record and auto-merges when valid tcp_merge_intent cookie is present for different customer', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);


      mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
        if (rpcName === 'merge_wallets') {
          expect(args.p_source).toBe(TEST_SOURCE_CUSTOMER_ID);
          expect(args.p_target).toBe(TEST_TARGET_CUSTOMER_ID);
          return { data: { result: 'merged', cards_moved: 1, cards_combined: 0 }, error: null };
        }
        if (rpcName === 'log_audit_event') {
          expect(args.p_actor).toBe(TEST_TARGET_CUSTOMER_ID);
          expect(args.p_action).toBe('customer_merge_token_used');
          expect(args.p_target).toBe(issued.payload.nonce);
          return { data: 'audit-log-uuid-auto', error: null };
        }
        return { data: null, error: null };
      });

      const req = new NextRequest('http://localhost:3000/auth/callback?code=good-code', {
        headers: {
          cookie: `${MERGE_INTENT_COOKIE_NAME}=${issued.mergeToken}`,
        },
      });

      const res = await authCallbackGet(req);
      expect(res.status).toBe(303);

      expect(ensureCustomerRecord).toHaveBeenCalledWith(TEST_TARGET_CUSTOMER_ID);

      // Verify merge RPC was called
      expect(mockAdminClient.rpc).toHaveBeenCalledWith('merge_wallets', {
        p_source: TEST_SOURCE_CUSTOMER_ID,
        p_target: TEST_TARGET_CUSTOMER_ID,
      });

      // Verify audit log event was recorded
      expect(mockAdminClient.rpc).toHaveBeenCalledWith('log_audit_event', {
        p_actor: TEST_TARGET_CUSTOMER_ID,
        p_action: 'customer_merge_token_used',
        p_target: issued.payload.nonce,
        p_detail: {
          source_customer: TEST_SOURCE_CUSTOMER_ID,
          target_customer: TEST_TARGET_CUSTOMER_ID,
        },
      });

      // Verify cookie is cleared on response
      const clearedCookie = res.cookies.get(MERGE_INTENT_COOKIE_NAME);
      expect(clearedCookie).toBeDefined();
      expect(clearedCookie?.maxAge).toBe(0);
    });

    it('skips auto-merge if sourceCustomerId in token equals the current logged-in user id', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_SOURCE_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);

      const req = new NextRequest('http://localhost:3000/auth/callback', {
        headers: {
          cookie: `${MERGE_INTENT_COOKIE_NAME}=${issued.mergeToken}`,
        },
      });

      const res = await authCallbackGet(req);
      expect(res.status).toBe(303);

      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
        'merge_wallets',
        expect.anything(),
      );

      // Cookie is still cleared
      expect(res.cookies.get(MERGE_INTENT_COOKIE_NAME)?.maxAge).toBe(0);
    });

    it('skips auto-merge if token nonce has already been used', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);

      // Existing nonce (merge_nonce_used RPC reports it consumed)
      mockAdminClient.rpc.mockImplementation(async (rpcName: string) =>
        rpcName === 'merge_nonce_used' ? { data: true, error: null } : { data: null, error: null },
      );

      const req = new NextRequest('http://localhost:3000/auth/callback', {
        headers: {
          cookie: `${MERGE_INTENT_COOKIE_NAME}=${issued.mergeToken}`,
        },
      });

      const res = await authCallbackGet(req);
      expect(res.status).toBe(303);

      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
        'merge_wallets',
        expect.anything(),
      );
      expect(res.cookies.get(MERGE_INTENT_COOKIE_NAME)?.maxAge).toBe(0);
    });

    it('fails closed and skips auto-merge when the nonce check errors', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_TARGET_CUSTOMER_ID,
      } as User);

      const issued = issueMergeIntentToken(TEST_SOURCE_CUSTOMER_ID);

      mockAdminClient.rpc.mockImplementation(async (rpcName: string) =>
        rpcName === 'merge_nonce_used'
          ? { data: null, error: { message: 'Database connection failed' } }
          : { data: null, error: null },
      );

      const req = new NextRequest('http://localhost:3000/auth/callback', {
        headers: {
          cookie: `${MERGE_INTENT_COOKIE_NAME}=${issued.mergeToken}`,
        },
      });

      const res = await authCallbackGet(req);
      expect(res.status).toBe(303);

      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('merge_wallets', expect.anything());
      expect(res.cookies.get(MERGE_INTENT_COOKIE_NAME)?.maxAge).toBe(0);
    });
  });

  // ============================================================================
  // 5. BACKUP CARD PANEL & CARD PAGE INTEGRATION
  // ============================================================================
  describe('5. BackupCardPanel & app/card/page.tsx UI Integration', () => {
    describe('BackupCardPanel (Backed Up State: isAnonymous === false)', () => {
      it('renders CARD BACKED UP • PROTECTED badge and linked email', () => {
        const html = renderToStaticMarkup(
          React.createElement(BackupCardPanel, {
            customerId: TEST_TARGET_CUSTOMER_ID,
            isAnonymous: false,
            email: 'maria.customer@gmail.com',
            availableStamps: 6,
          }),
        );

        expect(html).toContain('CARD BACKED UP • PROTECTED');
        expect(html).toContain('Linked to maria.customer@gmail.com');
        expect(html).toContain('safely backed up across browser resets');

        // Does NOT render backup buttons or consent inputs
        expect(html).not.toContain('BACK UP THIS CARD');
        expect(html).not.toContain('RECOVER EXISTING CARD');
        expect(html).not.toContain('backup-consent-checkbox');
        expect(html).not.toContain('BACK UP WITH GOOGLE');
      });

      it('renders fallback Linked to Google / Email Account when email is null/undefined', () => {
        const html = renderToStaticMarkup(
          React.createElement(BackupCardPanel, {
            customerId: TEST_TARGET_CUSTOMER_ID,
            isAnonymous: false,
            email: null,
            availableStamps: 6,
          }),
        );

        expect(html).toContain('CARD BACKED UP • PROTECTED');
        expect(html).toContain('Linked to Google / Email Account');
      });
    });

    describe('BackupCardPanel (Anonymous State: isAnonymous === true)', () => {
      it('renders mode toggle buttons, mandatory privacy consent checkbox with link to /privacy, and backup controls', () => {
        const html = renderToStaticMarkup(
          React.createElement(BackupCardPanel, {
            customerId: TEST_SOURCE_CUSTOMER_ID,
            isAnonymous: true,
            availableStamps: 4,
          }),
        );

        // Toggle buttons
        expect(html).toContain('BACK UP THIS CARD');
        expect(html).toContain('RECOVER EXISTING CARD');

        // Heading and instructions
        expect(html).toContain('BACK UP MY CARD');
        expect(html).toContain('Link Google or Email so your stamps survive clearing your browser');

        // Mandatory privacy consent checkbox and link
        expect(html).toContain('id="backup-consent-checkbox"');
        expect(html).toContain('Privacy Notice');
        expect(html).toContain(`href="${ROUTES.privacy}"`);

        // Actions
        expect(html).toContain('BACK UP WITH GOOGLE');
        expect(html).toContain('Or Back Up with Email');
        expect(html).toContain('id="backup-email-input"');
        expect(html).toContain('SEND BACKUP LINK');
      });
    });

    describe('app/s/[slug]/page.tsx Integration', () => {
      it('renders onboarding view with GetCardButton when cardState is null (unauthenticated)', async () => {
        vi.mocked(getCustomerCardState).mockResolvedValue(null);

        const pageElement = await ShopPage({ params: SHOP_PARAMS, searchParams: Promise.resolve({}) });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Get a loyalty card at The Caffeine Plug');
        expect(html).toContain('No app download. No form. Instant digital stamp card.');
        expect(html).toContain('Collect 10 stamps');

        // BackupCardPanel is not rendered on onboarding screen
        expect(html).not.toContain('CARD BACKED UP • PROTECTED');
        expect(html).not.toContain('BACK UP THIS CARD');
      });

      it('renders active anonymous pass view with ANONYMOUS PASS badge and BackupCardPanel in anonymous mode', async () => {
        const mockAnonymousCard: CustomerCardState = {
          customerId: TEST_SOURCE_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: true,
          email: null,
          availableStamps: 4,
          totalStamps: 4,
          stampsRedeemed: 0,
          lastStampedAt: '2026-11-02T02:00:00.000Z',
        };

        vi.mocked(getCustomerCardState).mockResolvedValue(mockAnonymousCard);

        const pageElement = await ShopPage({ params: SHOP_PARAMS, searchParams: Promise.resolve({}) });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('ACTIVE WALLET');
        expect(html).toContain('ANONYMOUS PASS');
        expect(html).toContain('BACK UP THIS CARD');
        expect(html).toContain('RECOVER EXISTING CARD');
        expect(html).toContain('Privacy Notice');
        expect(html).toContain('Card #11111111');
      });

      it('renders active backed up pass view with BACKED UP PASS badge and BackupCardPanel with protected status', async () => {
        const mockBackedUpCard: CustomerCardState = {
          customerId: TEST_TARGET_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: false,
          email: 'saved.user@gmail.com',
          availableStamps: 8,
          totalStamps: 18,
          stampsRedeemed: 10,
          lastStampedAt: '2026-11-02T03:00:00.000Z',
        };

        vi.mocked(getCustomerCardState).mockResolvedValue(mockBackedUpCard);

        const pageElement = await ShopPage({ params: SHOP_PARAMS, searchParams: Promise.resolve({}) });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('ACTIVE WALLET');
        expect(html).toContain('BACKED UP PASS');
        expect(html).toContain('CARD BACKED UP • PROTECTED');
        expect(html).toContain('Linked to saved.user@gmail.com');
        expect(html).toContain('Card #22222222');
        expect(html).toContain('Total Earned: 18 • Redeemed: 10');
      });
    });
  });
});
