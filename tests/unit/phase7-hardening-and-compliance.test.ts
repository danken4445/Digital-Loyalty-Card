import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';

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
      signOut: vi.fn().mockResolvedValue({ error: null }),
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
  signOut: vi.fn().mockResolvedValue({ error: null }),
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
  getAuthenticatedCustomerCardState: vi.fn(),
}));

// Mock staff helper functions
vi.mock('@/lib/auth/staff', () => ({
  requireStaffSession: vi.fn().mockResolvedValue({
    authorized: true,
    staff: { userId: 'staff-user-id', role: 'owner', displayName: 'Staff Tester' },
  }),
  logStaffAuditEvent: vi.fn().mockResolvedValue('audit-log-uuid-1'),
  generateRandomTagId: vi.fn().mockReturnValue('tag_random_12345'),
  decorateTagWithUrls: vi.fn((tag: any) => ({
    ...tag,
    tapUrl: `http://localhost:3000/t/${tag.id}`,
    qrUrl: `http://localhost:3000/api/qr/${tag.id}`,
  })),
}));

// Mock Turnstile captcha verification
vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock NFC tap verification
vi.mock('@/lib/nfc/verifyTap', () => ({
  verifyTap: vi.fn().mockResolvedValue({
    valid: true,
    tagId: 'tag_phase7_test_tap',
    customer: { id: 'test-customer-id' },
  }),
}));

// Mock redeem token issuance
vi.mock('@/lib/security/redeemToken', () => ({
  issueRedeemToken: vi.fn().mockResolvedValue({
    redeemToken: 'tcp_redeem1.dummy.token',
    expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    displayCode: '123-456',
  }),
  verifyRedeemToken: vi.fn().mockReturnValue({
    valid: true,
    payload: { customerId: 'customer-uuid-1', iat: 100, exp: 200, nonce: 'nonce-1' },
  }),
  deriveDisplayCode: vi.fn().mockReturnValue('123-456'),
}));

// Mock merge token issuance
vi.mock('@/lib/security/mergeToken', () => ({
  issueMergeIntentToken: vi.fn().mockReturnValue({
    mergeToken: 'tcp_merge1.dummy.token',
    expiresAtIso: new Date(Date.now() + 600_000).toISOString(),
    payload: {
      sourceCustomerId: 'customer-uuid-1',
      iat: 100,
      exp: 700,
      nonce: 'nonce-merge-1',
    },
    ttlSeconds: 600,
  }),
  verifyMergeIntentToken: vi.fn().mockReturnValue({
    valid: true,
    payload: {
      sourceCustomerId: 'customer-uuid-1',
      iat: 100,
      exp: 700,
      nonce: 'nonce-merge-1',
    },
  }),
}));

// Import modules under test
import nextConfig, { buildContentSecurityPolicy, buildSecurityHeaders } from '@/next.config';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { logSecurityEvent, redactSensitiveValue, sanitizeLogContext } from '@/lib/security/logger';
import { POST as customersPost, DELETE as customersDelete } from '@/app/api/customers/route';
import { POST as claimPost } from '@/app/api/claim/route';
import { POST as redeemTokenPost } from '@/app/api/redeem-token/route';
import { POST as mergeIntentPost } from '@/app/api/customers/merge-intent/route';
import { POST as mergePost } from '@/app/api/customers/merge/route';
import { POST as staffRedeemPost } from '@/app/api/staff/redeem/route';
import { POST as staffStampPost } from '@/app/api/staff/stamp/route';
import { POST as staffTagsPost } from '@/app/api/staff/tags/route';

import { DeleteCardButton } from '@/components/card/DeleteCardButton';
import PrivacyPage from '@/app/privacy/page';
import CardPage from '@/app/card/page';

import { getVerifiedUser } from '@/lib/supabase/server';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { getAuthenticatedCustomerCardState } from '@/lib/auth/customer';
import { MERGE_INTENT_COOKIE_NAME, type CustomerCardState } from '@/lib/contracts';

const TEST_CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';

describe('Phase 7: Hardening, Compliance, and Security Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    mockCookieMap.clear();
    tableQueryHandlers = {};

    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetMs: 60_000,
    });

    mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
      if (rpcName === 'delete_customer_data') {
        return { data: true, error: null };
      }
      return { data: null, error: null };
    });

    mockServerAuth.signOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  });

  // ============================================================================
  // 1. next.config.ts SECURITY HEADERS & CSP
  // ============================================================================
  describe('1. next.config.ts Security Headers & CSP', () => {
    it('generates Content-Security-Policy with strict directives, Cloudflare, frame-ancestors none, object-src none', () => {
      const csp = buildContentSecurityPolicy();

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
      expect(csp).toContain("img-src 'self' data: blob: https:");
      expect(csp).toContain("font-src 'self' data:");
      expect(csp).toContain(
        "connect-src 'self' https://*.supabase.co https://*.supabase.in http://127.0.0.1:54321 http://localhost:54321 https://challenges.cloudflare.com",
      );
      expect(csp).toContain('frame-src https://challenges.cloudflare.com');
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("object-src 'none'");
    });

    it('builds the complete set of required security response headers', () => {
      const headers = buildSecurityHeaders();
      const headerMap = new Map(headers.map((h) => [h.key, h.value]));

      expect(headerMap.get('Content-Security-Policy')).toBe(buildContentSecurityPolicy());
      expect(headerMap.get('Strict-Transport-Security')).toBe(
        'max-age=63072000; includeSubDomains; preload',
      );
      expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
      expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(headerMap.get('X-Frame-Options')).toBe('DENY');
      expect(headerMap.get('Permissions-Policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      );
    });

    it('wires security headers to /:path* route pattern and disables x-powered-by', async () => {
      expect(nextConfig.reactStrictMode).toBe(true);
      expect(nextConfig.poweredByHeader).toBe(false);

      if (typeof nextConfig.headers === 'function') {
        const headerRoutes = await nextConfig.headers();
        expect(headerRoutes).toHaveLength(1);
        expect(headerRoutes[0]?.source).toBe('/:path*');
        expect(headerRoutes[0]?.headers).toEqual(buildSecurityHeaders());
      } else {
        throw new Error('nextConfig.headers() must be defined');
      }
    });
  });

  // ============================================================================
  // 2. lib/security/csrf.ts (verifySameOriginRequest)
  // ============================================================================
  describe('2. lib/security/csrf.ts (verifySameOriginRequest)', () => {
    it('allows requests with matching Origin', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(true);
    });

    it('allows requests matching site URL or host header', () => {
      process.env.NEXT_PUBLIC_SITE_URL = 'https://thecaffeineplug.ph';

      const reqWithSiteUrl = new Request('http://127.0.0.1:3000/api/customers', {
        method: 'POST',
        headers: {
          origin: 'https://thecaffeineplug.ph',
        },
      });
      expect(verifySameOriginRequest(reqWithSiteUrl).allowed).toBe(true);

      const reqWithHostHeader = new Request('http://internal-cluster/api/customers', {
        method: 'POST',
        headers: {
          origin: 'https://staging.thecaffeineplug.ph',
          'x-forwarded-host': 'staging.thecaffeineplug.ph, proxy-internal.ph',
        },
      });
      expect(verifySameOriginRequest(reqWithHostHeader).allowed).toBe(true);
    });

    it('allows requests with matching Referer when Origin is absent', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          referer: 'http://localhost:3000/card',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(true);
    });

    it('allows requests when neither Origin nor Referer is present (e.g., server-side or CLI invocation)', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(true);
    });

    it('blocks requests with Sec-Fetch-Site: cross-site even if origin matches', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'http://localhost:3000',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('cross-origin-blocked');
      }
    });

    it('blocks requests with Origin: null (sandboxed iframe / redirect spoofing)', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          origin: 'null',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('cross-origin-blocked');
      }
    });

    it('blocks requests with mismatched Origin (e.g. attacker domain)', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          origin: 'https://evil-attacker.com',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('cross-origin-blocked');
      }
    });

    it('blocks requests with mismatched Referer when Origin is absent', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          referer: 'https://evil-attacker.com/phish',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('cross-origin-blocked');
      }
    });

    it('blocks requests with malformed or non-URL Origin or Referer', () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          origin: 'invalid-url-schema',
        },
      });

      const result = verifySameOriginRequest(req);
      expect(result.allowed).toBe(false);
    });
  });

  // ============================================================================
  // 3. lib/security/logger.ts (PII & Secret Redaction)
  // ============================================================================
  describe('3. lib/security/logger.ts (PII & Secret Redaction)', () => {
    it('redacts values for sensitive object keys regardless of value contents', () => {
      const sensitiveKeys = [
        'token',
        'secret',
        'password',
        'cookie',
        'authorization',
        'service_role',
        'anon_key',
        'email',
        'ip',
        'phone',
        'credential',
        'signature',
      ];

      for (const key of sensitiveKeys) {
        const redacted = redactSensitiveValue('plaintext-secret-value-123', key);
        expect(redacted).toBe('[REDACTED]');
      }
    });

    it('redacts inline email addresses found inside non-sensitive string fields', () => {
      const input =
        'Customer user.name+tag@example.com requested assistance. CC: support@caffeineplug.ph';
      const output = redactSensitiveValue(input, 'message');
      expect(output).toBe('Customer [REDACTED_EMAIL] requested assistance. CC: [REDACTED_EMAIL]');
    });

    it('redacts inline security tokens (tcp_redeem1, tcp_merge1, Supabase keys, JWTs, Bearer)', () => {
      const cases: Array<[string, string]> = [
        ['tcp_redeem1.abcdef123.sig456', '[REDACTED_TOKEN]'],
        ['tcp_merge1.source789.sig012', '[REDACTED_TOKEN]'],
        ['sb_secret_abcdef1234567890', '[REDACTED_TOKEN]'],
        ['sb_publishable_qwerty987654321', '[REDACTED_TOKEN]'],
        ['Bearer my-jwt-token-access-999', '[REDACTED_TOKEN]'],
        [
          'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNxyPossL in header',
          'Token: [REDACTED_TOKEN] in header',
        ],
      ];

      for (const [raw, expected] of cases) {
        expect(redactSensitiveValue(raw, 'log_detail')).toBe(expected);
      }
    });

    it('preserves safe primitives (numbers, booleans, null, undefined)', () => {
      expect(redactSensitiveValue(42, 'count')).toBe(42);
      expect(redactSensitiveValue(true, 'active')).toBe(true);
      expect(redactSensitiveValue(null, 'result')).toBe(null);
      expect(redactSensitiveValue(undefined, 'optional')).toBe(undefined);
    });

    it('deeply sanitizes complex nested objects and arrays with sanitizeLogContext', () => {
      const context = {
        requestId: 'req_123',
        customer: {
          email: 'customer@gmail.com',
          accountAgeDays: 14,
          token: 'tcp_redeem1.xyz.abc',
          meta: {
            ip: '192.168.1.1',
            userAgent: 'Mozilla/5.0 (iPhone)',
          },
        },
        tags: ['nfc', 'verified'],
        message: 'Tap from visitor@plug.ph at terminal 2 with Bearer token_abc_123',
      };

      const sanitized = sanitizeLogContext(context);

      expect(sanitized).toEqual({
        requestId: 'req_123',
        customer: {
          email: '[REDACTED]',
          accountAgeDays: 14,
          token: '[REDACTED]',
          meta: {
            ip: '[REDACTED]',
            userAgent: 'Mozilla/5.0 (iPhone)',
          },
        },
        tags: ['nfc', 'verified'],
        message: 'Tap from [REDACTED_EMAIL] at terminal 2 with [REDACTED_TOKEN]',
      });
    });

    it('returns [UNSERIALIZABLE] for unsupported types like functions or symbols', () => {
      const fn = () => {};
      expect(redactSensitiveValue(fn, 'callback')).toBe('[UNSERIALIZABLE]');
      expect(redactSensitiveValue(Symbol('sym'), 'symbol')).toBe('[UNSERIALIZABLE]');
    });

    it('logSecurityEvent formats and returns structured log payload with PII sanitized', () => {
      const entry = logSecurityEvent('warn', 'suspicious_activity_detected', {
        ip: '203.0.113.195',
        email: 'attacker@evil.com',
        detail: 'Attempted to use tcp_merge1.source.bad_sig with password 123456',
        password: 'super-secret-password',
        attempts: 5,
      });

      expect(entry.level).toBe('warn');
      expect(entry.event).toBe('suspicious_activity_detected');
      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
      expect(entry.context).toEqual({
        ip: '[REDACTED]',
        email: '[REDACTED]',
        detail: 'Attempted to use [REDACTED_TOKEN] with password 123456',
        password: '[REDACTED]',
        attempts: 5,
      });
    });
  });

  // ============================================================================
  // 4. CSRF ENFORCEMENT ACROSS STATE-CHANGING API ENDPOINTS
  // ============================================================================
  describe('4. CSRF Enforcement Across State-Changing API Endpoints', () => {
    const evilOriginHeaders = {
      origin: 'https://evil-attacker.com',
    };

    it('blocks cross-origin request to POST /api/customers with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await customersPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to DELETE /api/customers with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: evilOriginHeaders,
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/claim with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await claimPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/redeem-token with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/redeem-token', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await redeemTokenPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/customers/merge-intent with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/customers/merge-intent', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await mergeIntentPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/customers/merge with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await mergePost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/staff/redeem with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/staff/redeem', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await staffRedeemPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/staff/stamp with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/staff/stamp', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await staffStampPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });

    it('blocks cross-origin request to POST /api/staff/tags with 403 forbidden', async () => {
      const req = new Request('http://localhost:3000/api/staff/tags', {
        method: 'POST',
        headers: evilOriginHeaders,
      });

      const res = await staffTagsPost(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      });
    });
  });

  // ============================================================================
  // 5. DELETE /api/customers (RA 10173 RIGHT TO ERASURE)
  // ============================================================================
  describe('5. DELETE /api/customers (RA 10173 Right to Erasure)', () => {
    it('rejects unauthenticated requests with 401 unauthenticated', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'unauthenticated',
        message: 'Active session required to delete customer data.',
      });
    });

    it('rejects rate-limited requests with 429 rate_limited', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
        is_anonymous: true,
      } as User);

      vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
        allowed: false,
        limit: 10,
        remaining: 0,
        resetMs: 60_000,
      });

      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'rate_limited',
        message: 'Too many requests. Please wait a moment.',
      });
    });

    it('returns 500 internal_error when delete_customer_data RPC returns error', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
        is_anonymous: true,
      } as User);

      mockAdminClient.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Failed to delete customer row due to lock timeout' },
      });

      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'internal_error',
        message: 'Failed to erase customer data.',
      });
    });

    it('returns 500 internal_error when an unhandled exception occurs', async () => {
      vi.mocked(getVerifiedUser).mockRejectedValueOnce(new Error('Network transport crash'));

      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'internal_error',
        message: 'Failed to erase customer data.',
      });
    });

    it('successfully erases customer data on happy path (200), signs out, clears cookie, returns deletedCustomerId', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
        is_anonymous: true,
      } as User);

      mockAdminClient.rpc.mockResolvedValueOnce({
        data: true,
        error: null,
      });

      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(200);

      // Verify Cache-Control header
      expect(res.headers.get('cache-control')).toBe(
        'no-store, no-cache, must-revalidate, max-age=0',
      );

      // Verify payload
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.deletedCustomerId).toBe(TEST_CUSTOMER_ID);
      expect(typeof json.data.deletedAtIso).toBe('string');
      expect(new Date(json.data.deletedAtIso).getTime()).not.toBeNaN();

      // Verify RPC was invoked with p_customer: user.id
      expect(mockAdminClient.rpc).toHaveBeenCalledWith('delete_customer_data', {
        p_customer: TEST_CUSTOMER_ID,
      });

      // Verify server client signOut was called
      expect(mockServerAuth.signOut).toHaveBeenCalled();

      // Verify tcp_merge_intent cookie was cleared with maxAge: 0
      const mergeCookie = res.cookies.get(MERGE_INTENT_COOKIE_NAME);
      expect(mergeCookie).toBeDefined();
      expect(mergeCookie?.maxAge).toBe(0);
    });

    it('gracefully completes erasure even if server auth.signOut fails', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
        is_anonymous: false,
      } as User);

      mockAdminClient.rpc.mockResolvedValueOnce({
        data: true,
        error: null,
      });

      mockServerAuth.signOut.mockRejectedValueOnce(new Error('Auth token already invalidated'));

      const req = new Request('http://localhost:3000/api/customers', {
        method: 'DELETE',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const res = await customersDelete(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.deletedCustomerId).toBe(TEST_CUSTOMER_ID);
    });
  });

  // ============================================================================
  // 6. UI COMPONENT & PAGE INTEGRATION (<DeleteCardButton />, /privacy, /card)
  // ============================================================================
  describe('6. UI Component & Page Integration (<DeleteCardButton />, /privacy, /card)', () => {
    describe('<DeleteCardButton />', () => {
      it('renders in full variant with prominent button styling', () => {
        const html = renderToStaticMarkup(
          React.createElement(DeleteCardButton, {
            customerId: TEST_CUSTOMER_ID,
            variant: 'full',
          }),
        );

        expect(html).toContain('DELETE MY CARD &amp; DATA');
        expect(html).toContain('w-full py-3 px-4');
        expect(html).toContain('bg-plug-elevated');
      });

      it('renders in compact variant with inline link-style button', () => {
        const html = renderToStaticMarkup(
          React.createElement(DeleteCardButton, {
            customerId: TEST_CUSTOMER_ID,
            variant: 'compact',
          }),
        );

        expect(html).toContain('DELETE MY CARD &amp; DATA');
        expect(html).toContain('text-[10px]');
        expect(html).toContain('hover:underline');
      });
    });

    describe('app/privacy/page.tsx', () => {
      it('renders complete privacy notice and data rights disclosures with active connected card badge', async () => {
        const mockCardState: CustomerCardState = {
          customerId: 'a1b2c3d4-1111-2222-3333-444455556666',
          isAnonymous: true,
          email: null,
          availableStamps: 4,
          totalStamps: 4,
          stampsRedeemed: 0,
          lastStampedAt: '2026-11-02T05:00:00Z',
        };

        vi.mocked(getAuthenticatedCustomerCardState).mockResolvedValue(mockCardState);

        const pageElement = await PrivacyPage();
        const html = renderToStaticMarkup(pageElement);

        // Header & Laws
        expect(html).toContain('PRIVACY &amp; DATA RIGHTS');
        expect(html).toContain('PHILIPPINES REPUBLIC ACT NO. 10173');
        expect(html).toContain('DATA PRIVACY ACT OF 2012');

        // Status badge
        expect(html).toContain('CONNECTED CARD #A1B2C3D4');
        expect(html).toContain('ANONYMOUS PASS');

        // Section 1: Data minimization
        expect(html).toContain('100% anonymous');
        expect(html).toContain('Optional Card Backup');

        // Section 2: What we never do
        expect(html).toContain('No background location tracking');
        expect(html).toContain('No third-party advertising trackers');

        // Section 3: Data retention & cleanup
        expect(html).toContain('30 days');
        expect(html).toContain('0 stamps');

        // Section 4: Data Subject Rights
        expect(html).toContain('Right to Be Informed &amp; Right to Access');
        expect(html).toContain('Right to Withdraw Consent &amp; Right to Erasure / Blocking');

        // Section 5: Self-service erasure panel with DeleteCardButton
        expect(html).toContain('5. Self-Service Data Erasure Panel');
        expect(html).toContain('DELETE MY CARD &amp; DATA');
      });

      it('renders backed up pass indicator when authenticated user has linked email', async () => {
        const mockBackedUpCard: CustomerCardState = {
          customerId: 'b2c3d4e5-9999-8888-7777-666655554444',
          isAnonymous: false,
          email: 'customer@gmail.com',
          availableStamps: 8,
          totalStamps: 18,
          stampsRedeemed: 10,
          lastStampedAt: '2026-11-02T06:00:00Z',
        };

        vi.mocked(getAuthenticatedCustomerCardState).mockResolvedValue(mockBackedUpCard);

        const pageElement = await PrivacyPage();
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('CONNECTED CARD #B2C3D4E5');
        expect(html).toContain('BACKED UP PASS');
        expect(html).toContain('DELETE MY CARD &amp; DATA');
      });

      it('renders unauthenticated state with NO ACTIVE CARD SESSION badge and accessible erasure button', async () => {
        vi.mocked(getAuthenticatedCustomerCardState).mockResolvedValue(null);

        const pageElement = await PrivacyPage();
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('NO ACTIVE CARD SESSION ON THIS DEVICE');
        expect(html).toContain('PHILIPPINES REPUBLIC ACT NO. 10173');
        expect(html).toContain('100% anonymous');
        expect(html).toContain('30 days');
        expect(html).toContain('DELETE MY CARD &amp; DATA');
      });
    });

    describe('app/card/page.tsx Integration', () => {
      it('renders confirmation banner when redirected with /card?deleted=1 in unauthenticated state', async () => {
        vi.mocked(getAuthenticatedCustomerCardState).mockResolvedValue(null);

        const pageElement = await CardPage({
          searchParams: Promise.resolve({ deleted: '1' }),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Your card and all associated data have been permanently erased.');
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('Get your loyalty card');
      });

      it('does NOT render deleted confirmation banner when /card is loaded without deleted=1 param', async () => {
        vi.mocked(getAuthenticatedCustomerCardState).mockResolvedValue(null);

        const pageElement = await CardPage({
          searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).not.toContain(
          'Your card and all associated data have been permanently erased.',
        );
        expect(html).toContain('Get your loyalty card');
      });
    });
  });
});
