import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Ensure React is globally available for components compiled with classic JSX transform
(globalThis as any).React = React;

// Provide default server environment variables for getServerEnv()
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';

// Stub 'server-only' for Vitest Node test environment
vi.mock('server-only', () => ({}));

// Mock next/navigation for router context in client sub-components
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

// Mock server auth and customer state for route and page testing
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/auth/customer', () => ({
  getCustomerCardState: vi.fn(),
  listWalletCards: vi.fn(),
  ensureCustomerRecord: vi.fn(),
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
  resetMemoryRateLimitStore: vi.fn(),
}));

import { deriveDisplayCode, issueRedeemToken, verifyRedeemToken } from '@/lib/security/redeemToken';
import { POST } from '@/app/api/redeem-token/route';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getCustomerCardState } from '@/lib/auth/customer';
import { getTenantBySlug } from '@/lib/tenants/context';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import {
  STAMP_RESULT_CODES,
  TENANT_ONE_ID,
  type CustomerCardState,
  type TenantContext,
} from '@/lib/contracts';
import { StampGrid } from '@/components/card/StampGrid';
import { RedeemRewardPanel } from '@/components/card/RedeemRewardPanel';
import { StripResultParam } from '@/components/card/StripResultParam';
import ShopPage from '@/app/s/[slug]/page';
import CardLoading from '@/app/card/loading';
import CardError from '@/app/card/error';

const TEST_SECRET = 'a'.repeat(32); // 32 characters minimum
const TEST_CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_CUSTOMER_ID_2 = '22222222-2222-2222-2222-222222222222';

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

const mockRateLimitAllowed = {
  allowed: true,
  limit: 30,
  remaining: 29,
  resetMs: 60_000,
};

const mockRateLimitBlocked = {
  allowed: false,
  limit: 30,
  remaining: 0,
  resetMs: 60_000,
};

describe('Phase 4 Customer Card UI & Signed Redemption Token Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;
    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue(mockRateLimitAllowed);
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_TENANT);
  });

  afterEach(() => {
    process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;
  });

  // ============================================================================
  // 1. lib/security/redeemToken.ts
  // ============================================================================
  describe('lib/security/redeemToken.ts', () => {
    describe('Valid Issuance & Verification Roundtrip', () => {
      it('issues a valid 5-minute (300s) HMAC token and verifies successfully in roundtrip', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

        expect(issued.token).toBeDefined();
        expect(issued.token.startsWith('tcp2.')).toBe(true);
        expect(issued.ttlSeconds).toBe(300);
        expect(issued.payload.customerId).toBe(TEST_CUSTOMER_ID);
        expect(issued.payload.exp - issued.payload.iat).toBe(300);

        const verifyResult = verifyRedeemToken(issued.token);
        expect(verifyResult.valid).toBe(true);
        if (verifyResult.valid) {
          expect(verifyResult.payload.customerId).toBe(TEST_CUSTOMER_ID);
          expect(verifyResult.payload.iat).toBe(issued.payload.iat);
          expect(verifyResult.payload.exp).toBe(issued.payload.exp);
          expect(verifyResult.displayCode).toBe(issued.displayCode);
        }
      });

      it('generates a valid, self-contained inline SVG QR code without external network calls or URLs', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

        expect(issued.qrSvg).toContain('<svg');
        expect(issued.qrSvg).toContain('</svg>');
        expect(issued.qrSvg).toContain('xmlns="http://www.w3.org/2000/svg"');

        // Verify there are no external resource URLs (href, src, external stylesheet, or non-xmlns URLs)
        const strippedXmlns = issued.qrSvg.replace('xmlns="http://www.w3.org/2000/svg"', '');
        expect(strippedXmlns).not.toMatch(/https?:\/\//i);
        expect(issued.qrSvg).not.toMatch(/href\s*=\s*['"]https?:/i);
        expect(issued.qrSvg).not.toMatch(/src\s*=\s*['"]https?:/i);
      });

      it('formats displayCode as an 8-character uppercase alphanumeric code (XXXX-XXXX)', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

        expect(issued.displayCode).toMatch(
          /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/,
        );

        const verifyResult = verifyRedeemToken(issued.token);
        expect(verifyResult.valid).toBe(true);
        if (verifyResult.valid) {
          expect(verifyResult.displayCode).toBe(issued.displayCode);
        }
      });

      it('deriveDisplayCode is deterministic and produces consistent 8-character Crockford-like codes', () => {
        const sigBuf = Buffer.from('abcdefghijklmnopqrstuvwxyz012345', 'utf8');
        const code1 = deriveDisplayCode(sigBuf);
        const code2 = deriveDisplayCode(sigBuf);

        expect(code1).toBe(code2);
        expect(code1).toMatch(
          /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/,
        );
      });
    });

    describe('Boundary Expiry & Clock Skew Verification', () => {
      const fixedNowMs = 1_700_000_000_000;
      const iatSeconds = 1_700_000_000;
      const expSeconds = iatSeconds + 300;

      it('remains valid at exactly exp * 1000 (300 seconds after iat)', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
          nowMs: fixedNowMs,
          ttlSeconds: 300,
        });

        expect(issued.payload.exp).toBe(expSeconds);

        const boundaryNowMs = expSeconds * 1000;
        const result = verifyRedeemToken(issued.token, { nowMs: boundaryNowMs });
        expect(result.valid).toBe(true);
      });

      it('remains valid at (exp - 1) * 1000 (299 seconds after iat)', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
          nowMs: fixedNowMs,
          ttlSeconds: 300,
        });

        const justBeforeNowMs = (expSeconds - 1) * 1000;
        const result = verifyRedeemToken(issued.token, { nowMs: justBeforeNowMs });
        expect(result.valid).toBe(true);
      });

      it('expires at exactly (exp + 1) * 1000 (301 seconds after iat)', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
          nowMs: fixedNowMs,
          ttlSeconds: 300,
        });

        const expiredNowMs = (expSeconds + 1) * 1000;
        const result = verifyRedeemToken(issued.token, { nowMs: expiredNowMs });
        expect(result).toEqual({
          valid: false,
          reason: 'expired-token',
        });
      });

      it('allows clock skew when iat is up to 30 seconds in the future', async () => {
        const futureIatMs = fixedNowMs + 30_000; // +30s
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
          nowMs: futureIatMs,
          ttlSeconds: 300,
        });

        const result = verifyRedeemToken(issued.token, { nowMs: fixedNowMs });
        expect(result.valid).toBe(true);
      });

      it('rejects token when iat exceeds future clock skew tolerance (> 30 seconds ahead)', async () => {
        const farFutureIatMs = fixedNowMs + 31_000; // +31s
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
          nowMs: farFutureIatMs,
          ttlSeconds: 300,
        });

        const result = verifyRedeemToken(issued.token, { nowMs: fixedNowMs });
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });
    });

    describe('Tampering & Cryptographic Negative Verification', () => {
      it('rejects token when customerId in payload is tampered with', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
        const parts = issued.token.split('.');
        const prefix = parts[0]!;
        const payloadB64 = parts[1]!;
        const sig = parts[2]!;

        const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        decoded.customerId = TEST_CUSTOMER_ID_2;
        const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded), 'utf8').toString(
          'base64url',
        );
        const tamperedToken = `${prefix}.${tamperedPayloadB64}.${sig}`;

        const result = verifyRedeemToken(tamperedToken);
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('rejects token when expiration timestamp in payload is extended', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
        const parts = issued.token.split('.');
        const prefix = parts[0]!;
        const payloadB64 = parts[1]!;
        const sig = parts[2]!;

        const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        decoded.exp += 3600; // extend by 1 hour
        const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded), 'utf8').toString(
          'base64url',
        );
        const tamperedToken = `${prefix}.${tamperedPayloadB64}.${sig}`;

        const result = verifyRedeemToken(tamperedToken);
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('rejects token when signature byte is altered or corrupted', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
        const parts = issued.token.split('.');
        const prefix = parts[0]!;
        const payloadB64 = parts[1]!;
        const sig = parts[2]!;

        const corruptedSig = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
        const tamperedToken = `${prefix}.${payloadB64}.${corruptedSig}`;

        const result = verifyRedeemToken(tamperedToken);
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('rejects token when verified with a different secret', async () => {
        const secretA = '1'.repeat(32);
        const secretB = '2'.repeat(32);
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { secretOverride: secretA });

        const result = verifyRedeemToken(issued.token, { secretOverride: secretB });
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('throws on issueRedeemToken if secret is shorter than 32 characters', async () => {
        await expect(
          issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, { secretOverride: 'short-secret' }),
        ).rejects.toThrow(/REDEEM_TOKEN_SECRET must be at least 32 characters/);
      });

      it('returns invalid-token on verifyRedeemToken if secret is shorter than 32 characters', async () => {
        const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
        const result = verifyRedeemToken(issued.token, { secretOverride: 'short-secret' });

        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('rejects token with non-UUID customerId', async () => {
        const payload = {
          customerId: 'not-a-valid-uuid',
          tenantId: TENANT_ONE_ID,
          iat: 1_700_000_000,
          exp: 1_700_000_300,
          nonce: 'testnonce123',
        };
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = Buffer.from('test-signature-fake-bytes-32chars!!').toString('base64url');
        const malformedToken = `tcp2.${payloadB64}.${sig}`;

        const result = verifyRedeemToken(malformedToken);
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('rejects token where exp <= iat', async () => {
        const payload = {
          tenantId: TENANT_ONE_ID,
          customerId: TEST_CUSTOMER_ID,
          iat: 1_700_000_300,
          exp: 1_700_000_100, // exp before iat
          nonce: 'testnonce123',
        };
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig = Buffer.from('test-signature-fake-bytes-32chars!!').toString('base64url');
        const malformedToken = `tcp2.${payloadB64}.${sig}`;

        const result = verifyRedeemToken(malformedToken);
        expect(result).toEqual({
          valid: false,
          reason: 'invalid-token',
        });
      });

      it('rejects various malformed token strings safely without throwing', () => {
        const badTokens = [
          '',
          '   ',
          'tcp2.payload.signature',
          'tcp2.payload',
          'tcp2.payload.signature.extra',
          'notatoken',
          'tcp2..signature',
          'tcp2.invalid_base64_json!@#.sig',
          null as any,
          undefined as any,
          12345 as any,
        ];

        for (const token of badTokens) {
          const result = verifyRedeemToken(token);
          expect(result).toEqual({
            valid: false,
            reason: 'invalid-token',
          });
        }
      });
    });
  });

  // ============================================================================
  // 2. POST /api/redeem-token (app/api/redeem-token/route.ts)
  // ============================================================================
  describe('POST /api/redeem-token', () => {
    const makeRequest = () =>
      new Request('http://localhost:3000/api/redeem-token', {
        method: 'POST',
        headers: {
          'x-forwarded-for': '192.168.1.100',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantSlug: 'caffeine-plug' }),
      });

    it('returns 401 unauthenticated when getVerifiedUser() returns null', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const res = await POST(makeRequest());
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'unauthenticated',
        message: 'Active session required to generate a redemption token.',
      });
    });

    it('returns 429 rate_limited when rate limit is exceeded', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue(mockRateLimitBlocked);

      const res = await POST(makeRequest());
      expect(res.status).toBe(429);

      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'rate_limited',
        message: 'Too many token requests. Please wait a moment.',
      });
    });

    it('returns 401 unauthenticated if cardState cannot be retrieved', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      vi.mocked(getCustomerCardState).mockResolvedValue(null);

      const res = await POST(makeRequest());
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'unauthenticated',
        message: 'Active session required to generate a redemption token.',
      });
    });

    it('returns 403 forbidden when customer has 0 stamps (< 10 threshold)', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      const cardState: CustomerCardState = {
        customerId: TEST_CUSTOMER_ID,
        tenant: TEST_TENANT,
        isAnonymous: true,
        totalStamps: 0,
        stampsRedeemed: 0,
        availableStamps: 0,
        lastStampedAt: null,
      };
      vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

      const res = await POST(makeRequest());
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'At least 10 stamps are required to redeem a reward.',
      });
    });

    it('returns 403 forbidden when customer has 9 stamps (< 10 threshold)', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      const cardState: CustomerCardState = {
        customerId: TEST_CUSTOMER_ID,
        tenant: TEST_TENANT,
        isAnonymous: true,
        totalStamps: 9,
        stampsRedeemed: 0,
        availableStamps: 9,
        lastStampedAt: new Date().toISOString(),
      };
      vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

      const res = await POST(makeRequest());
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'forbidden',
        message: 'At least 10 stamps are required to redeem a reward.',
      });
    });

    it('returns 200 ok and issued token when customer has exactly 10 stamps, with no-cache headers', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      const cardState: CustomerCardState = {
        customerId: TEST_CUSTOMER_ID,
        tenant: TEST_TENANT,
        isAnonymous: true,
        totalStamps: 10,
        stampsRedeemed: 0,
        availableStamps: 10,
        lastStampedAt: new Date().toISOString(),
      };
      vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

      const res = await POST(makeRequest());
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(
        'no-store, no-cache, must-revalidate, max-age=0',
      );

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data).toBeDefined();
      expect(json.data.payload.customerId).toBe(TEST_CUSTOMER_ID);
      expect(json.data.ttlSeconds).toBe(300);

      // Verify the returned token cryptographically
      const verifyResult = verifyRedeemToken(json.data.token);
      expect(verifyResult.valid).toBe(true);
      if (verifyResult.valid) {
        expect(verifyResult.displayCode).toBe(json.data.displayCode);
      }
    });

    it('returns 200 ok and issued token when customer has 12 stamps (> 10)', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      const cardState: CustomerCardState = {
        customerId: TEST_CUSTOMER_ID,
        tenant: TEST_TENANT,
        isAnonymous: false,
        totalStamps: 12,
        stampsRedeemed: 0,
        availableStamps: 12,
        lastStampedAt: new Date().toISOString(),
      };
      vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

      const res = await POST(makeRequest());
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.payload.customerId).toBe(TEST_CUSTOMER_ID);

      const verifyResult = verifyRedeemToken(json.data.token);
      expect(verifyResult.valid).toBe(true);
    });

    it('returns 500 internal_error without leaking stack trace on unexpected errors', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: TEST_CUSTOMER_ID,
      } as any);

      vi.mocked(getCustomerCardState).mockRejectedValue(
        new Error('Sensitive database connection failed with credentials in trace'),
      );

      const res = await POST(makeRequest());
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json).toEqual({
        ok: false,
        error: 'internal_error',
        message: 'Unable to issue redemption token.',
      });
      expect(JSON.stringify(json)).not.toContain('Sensitive database');
    });
  });

  // ============================================================================
  // 3. Component & Accessibility Verification
  // ============================================================================
  describe('Component & Accessibility Verification', () => {
    describe('StampGrid (components/card/StampGrid.tsx)', () => {
      it('renders 0 stamps with all 10 slots empty, correct progressbar, and first visit tip note', () => {
        const html = renderToStaticMarkup(React.createElement(StampGrid, { availableStamps: 0 }));

        // Progress bar semantic verification
        expect(html).toContain('role="progressbar"');
        expect(html).toContain('aria-label="Stamp collection progress"');
        expect(html).toContain('aria-valuenow="0"');
        expect(html).toContain('aria-valuemin="0"');
        expect(html).toContain('aria-valuemax="10"');

        // All 10 slots empty aria-labels
        expect(html).toContain('aria-label="Stamp 1 of 10, empty"');
        expect(html).toContain('aria-label="Stamp 4 of 10, empty"');
        expect(html).toContain('aria-label="Stamp 5 of 10, empty (50% off milestone)"');
        expect(html).toContain('aria-label="Stamp 10 of 10, empty (Free Coffee reward)"');

        // Empty state tip note only rendered at 0 stamps
        expect(html).toContain('role="note"');
        expect(html).toContain('aria-label="First visit tip"');
        expect(html).toContain('0 stamps collected yet');
      });

      it('renders 5 stamps with slots 1-5 filled, milestone reached, and no empty tip', () => {
        const html = renderToStaticMarkup(React.createElement(StampGrid, { availableStamps: 5 }));

        expect(html).toContain('aria-valuenow="5"');

        // Filled slots 1 to 5
        expect(html).toContain('aria-label="Stamp 1 of 10, filled"');
        expect(html).toContain('aria-label="Stamp 4 of 10, filled"');
        expect(html).toContain('aria-label="Stamp 5 of 10, filled (50% off milestone)"');

        // Empty slots 6 to 10
        expect(html).toContain('aria-label="Stamp 6 of 10, empty"');
        expect(html).toContain('aria-label="Stamp 10 of 10, empty (Free Coffee reward)"');

        // Milestone badge text
        expect(html).toContain('50% OFF');

        // No empty note
        expect(html).not.toContain('aria-label="First visit tip"');
      });

      it('renders 9 stamps with slots 1-9 filled and slot 10 empty (Free Coffee reward)', () => {
        const html = renderToStaticMarkup(React.createElement(StampGrid, { availableStamps: 9 }));

        expect(html).toContain('aria-valuenow="9"');
        expect(html).toContain('aria-label="Stamp 1 of 10, filled"');
        expect(html).toContain('aria-label="Stamp 5 of 10, filled (50% off milestone)"');
        expect(html).toContain('aria-label="Stamp 9 of 10, filled"');
        expect(html).toContain('aria-label="Stamp 10 of 10, empty (Free Coffee reward)"');

        expect(html).not.toContain('aria-label="First visit tip"');
      });

      it('renders 10 stamps with all 10 slots filled including reward slot', () => {
        const html = renderToStaticMarkup(React.createElement(StampGrid, { availableStamps: 10 }));

        expect(html).toContain('aria-valuenow="10"');
        expect(html).toContain('aria-label="Stamp 1 of 10, filled"');
        expect(html).toContain('aria-label="Stamp 5 of 10, filled (50% off milestone)"');
        expect(html).toContain('aria-label="Stamp 10 of 10, filled (Free Coffee reward)"');
        expect(html).toContain('FREE COFFEE');

        expect(html).not.toContain('aria-label="First visit tip"');
      });

      it('renders 14 stamps clamped to 10 filled slots without overflow', () => {
        const html = renderToStaticMarkup(React.createElement(StampGrid, { availableStamps: 14 }));

        expect(html).toContain('aria-valuenow="10"');
        expect(html).toContain('aria-label="Stamp 10 of 10, filled (Free Coffee reward)"');
        expect(html).toContain('FREE COFFEE');
        expect(html).not.toContain('aria-label="Stamp 11');
      });
    });

    describe('RedeemRewardPanel (components/card/RedeemRewardPanel.tsx)', () => {
      it('renders active token with QR role="img", displayCode, refresh button, and copy button', async () => {
        const token = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

        const html = renderToStaticMarkup(
          React.createElement(RedeemRewardPanel, {
            initialToken: token,
            availableStamps: 10,
            tenantSlug: 'caffeine-plug',
          }),
        );

        expect(html).toContain('role="img"');
        expect(html).toContain(
          `aria-label="Redemption QR code ${token.displayCode} for staff to scan"`,
        );
        expect(html).toContain(token.displayCode);
        expect(html).toContain('REFRESH QR CODE');
        expect(html).toContain('COPY REDEMPTION CODE');
        expect(html).toContain('Expires in');
        expect(html).not.toContain('EXPIRED');
      });

      it('renders EXPIRED overlay and expired countdown badge when exp is in the past', async () => {
        const pastNowMs = Date.now() - 400_000; // 400s ago
        const expiredToken = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
          nowMs: pastNowMs,
          ttlSeconds: 300,
        });

        const html = renderToStaticMarkup(
          React.createElement(RedeemRewardPanel, {
            initialToken: expiredToken,
            availableStamps: 10,
            tenantSlug: 'caffeine-plug',
          }),
        );

        expect(html).toContain('EXPIRED');
        expect(html).toContain('Token expired');
        expect(html).toContain('REFRESH QR CODE');
        expect(html).toContain(expiredToken.displayCode);
      });
    });

    describe('CardLoading & CardError (app/card/loading.tsx & app/card/error.tsx)', () => {
      it('renders CardLoading with role="status", aria-busy="true", and loading accessibility labels', () => {
        const html = renderToStaticMarkup(React.createElement(CardLoading));

        expect(html).toContain('role="status"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('aria-label="Loading your loyalty card"');
        expect(html).toContain('LOADING PASS...');
      });

      it('renders CardError with role="alert", aria-live="assertive", TRY AGAIN, and RETURN TO HOME', () => {
        const dummyError = new Error('Test card load failure');
        const dummyReset = vi.fn();

        const html = renderToStaticMarkup(
          React.createElement(CardError, {
            error: dummyError,
            reset: dummyReset,
          }),
        );

        expect(html).toContain('role="alert"');
        expect(html).toContain('aria-live="assertive"');
        expect(html).toContain('CARD UNAVAILABLE');
        expect(html).toContain('TRY AGAIN');
        expect(html).toContain('RETURN TO HOME');
      });
    });

    describe('StripResultParam (components/card/StripResultParam.tsx)', () => {
      it('renders status banner for all STAMP_RESULT_CODES with role="status" and aria-live="polite"', () => {
        const expectedMap: Record<
          (typeof STAMP_RESULT_CODES)[number],
          { title: string; badge: string; text: string }
        > = {
          stamped: {
            title: 'STAMP COLLECTED',
            badge: '+1 STAMP',
            text: 'Thanks for visiting.',
          },
          cooldown: {
            title: 'COOLDOWN ACTIVE',
            badge: 'COOLDOWN',
            text: 'on cooldown',
          },
          'daily-limit': {
            title: 'DAILY CAP REACHED',
            badge: 'DAILY CAP',
            text: 'come back tomorrow',
          },
          'tag-throttled': {
            title: 'TAP THROTTLED',
            badge: 'WAIT A MOMENT',
            text: 'wait a few seconds',
          },
          'invalid-tag': {
            title: 'INACTIVE NFC TAG',
            badge: 'TAG INACTIVE',
            text: 'tag is no longer active',
          },
          'no-card': {
            title: 'NO CARD YET',
            badge: 'ADD CARD',
            text: 'card to collect stamps',
          },
          'tenant-unavailable': {
            title: 'SHOP UNAVAILABLE',
            badge: 'UNAVAILABLE',
            text: 'accepting stamps right now',
          },
          unauthorized: {
            title: 'NOT ALLOWED',
            badge: 'UNAUTHORIZED',
            text: 'allowed to do that',
          },
        };

        for (const code of STAMP_RESULT_CODES) {
          const html = renderToStaticMarkup(
            React.createElement(StripResultParam, { result: code }),
          );

          expect(html).toContain('role="status"');
          expect(html).toContain('aria-live="polite"');

          const expected = expectedMap[code];
          expect(html).toContain(expected.title);
          expect(html).toContain(expected.badge);
          expect(html).toContain(expected.text);
          expect(html).not.toContain('Caffeine Plug');
          expect(html).not.toMatch(/d+-minute|max d+ stamps|d+ seconds/);
        }
      });

      it('renders nothing when result is null or undefined or unrecognized', () => {
        const htmlNull = renderToStaticMarkup(
          React.createElement(StripResultParam, { result: null }),
        );
        expect(htmlNull).toBe('');

        const htmlUndefined = renderToStaticMarkup(
          React.createElement(StripResultParam, { result: undefined }),
        );
        expect(htmlUndefined).toBe('');

        const htmlUnknown = renderToStaticMarkup(
          React.createElement(StripResultParam, { result: 'random-code' as any }),
        );
        expect(htmlUnknown).toBe('');
      });
    });

    describe('ShopPage Server Component (app/s/[slug]/page.tsx)', () => {
      it('renders no-session onboarding view when getCustomerCardState() returns null', async () => {
        vi.mocked(getCustomerCardState).mockResolvedValue(null);

        const pageElement = await ShopPage({
          params: SHOP_PARAMS,
          searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Get your The Caffeine Plug card');
        expect(html).toContain('No app download. No form.');
        expect(html).toContain('GET MY CARD');
        expect(html).not.toContain('ACTIVE WALLET');
      });

      it('renders active customer card view with 5 stamps without redemption panel', async () => {
        const cardState: CustomerCardState = {
          customerId: TEST_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: true,
          totalStamps: 5,
          stampsRedeemed: 0,
          availableStamps: 5,
          lastStampedAt: '2026-11-01T12:00:00.000Z',
        };
        vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

        const pageElement = await ShopPage({
          params: SHOP_PARAMS,
          searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('ACTIVE WALLET');
        expect(html).toContain('ANONYMOUS PASS');
        expect(html).toContain('Card #11111111');
        expect(html).toContain('Total Earned: 5');
        expect(html).toContain('Stamp 5 of 10, filled (50% off milestone)');
        expect(html).toContain('Member Since');
        expect(html).toContain('Card Completion Counter');
        expect(html).toContain('0 CARDS COMPLETED');
        expect(html).not.toContain('REWARD UNLOCKED • FREE COFFEE');
      });

      it('renders active customer card view with 10 stamps including reward redemption panel and completed cards counter', async () => {
        const cardState: CustomerCardState = {
          customerId: TEST_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: false,
          totalStamps: 10,
          stampsRedeemed: 0,
          availableStamps: 10,
          lastStampedAt: '2026-11-01T12:00:00.000Z',
          createdAt: '2026-10-15T08:00:00.000Z',
        };
        vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

        const pageElement = await ShopPage({
          params: SHOP_PARAMS,
          searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('ACTIVE WALLET');
        expect(html).toContain('Stamp 10 of 10, filled (Free Coffee reward)');
        expect(html).toContain('REWARD UNLOCKED • FREE COFFEE');
        expect(html).toContain('REFRESH QR CODE');
        expect(html).toContain('Verification Code');
        expect(html).toContain('Member Since Oct 15, 2026');
        expect(html).toContain('1 CARD COMPLETED');
        expect(html).toContain('1 Card');
      });

      it('displays joined date and lifetime card completion counter accurately for multi-card customer', async () => {
        const cardState: CustomerCardState = {
          customerId: TEST_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: false,
          totalStamps: 25,
          stampsRedeemed: 20,
          availableStamps: 5,
          lastStampedAt: '2026-11-02T03:00:00.000Z',
          createdAt: '2026-08-01T04:00:00.000Z',
          cardsCompleted: 2,
        };
        vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

        const pageElement = await ShopPage({
          params: SHOP_PARAMS,
          searchParams: Promise.resolve({}),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Member Since Aug 1, 2026');
        expect(html).toContain('2 CARDS COMPLETED');
        expect(html).toContain('2 Cards');
        expect(html).toContain('Cards Completed');
        expect(html).toContain('2 cards');
        expect(html).toContain('Card Completion Counter');
      });

      it('renders StripResultParam banner when ?r=stamped is passed in searchParams', async () => {
        const cardState: CustomerCardState = {
          customerId: TEST_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: true,
          totalStamps: 1,
          stampsRedeemed: 0,
          availableStamps: 1,
          lastStampedAt: '2026-11-01T12:00:00.000Z',
        };
        vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

        const pageElement = await ShopPage({
          params: SHOP_PARAMS,
          searchParams: Promise.resolve({ r: 'stamped' }),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('STAMP COLLECTED');
        expect(html).toContain('+1 STAMP');
      });

      it('renders StripResultParam banner when ?result=cooldown is passed in searchParams', async () => {
        const cardState: CustomerCardState = {
          customerId: TEST_CUSTOMER_ID,
          tenant: TEST_TENANT,
          isAnonymous: true,
          totalStamps: 1,
          stampsRedeemed: 0,
          availableStamps: 1,
          lastStampedAt: '2026-11-01T12:00:00.000Z',
        };
        vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

        const pageElement = await ShopPage({
          params: SHOP_PARAMS,
          searchParams: Promise.resolve({ result: 'cooldown' }),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('COOLDOWN ACTIVE');
        expect(html).toContain('COOLDOWN');
      });
    });
  });
});
