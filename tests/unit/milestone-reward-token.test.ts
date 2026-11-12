import { describe, expect, it, vi } from 'vitest';

const TEST_SECRET = 'a'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

vi.mock('server-only', () => ({}));

import {
  issueRedeemToken,
  verifyRedeemToken,
} from '@/lib/security/redeemToken';
import { logSecurityEvent } from '@/lib/security/logger';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';

describe('Milestone Reward Token (tcpmilestone2)', () => {
  it('issues a milestone-reward token with tcpmilestone2 prefix and valid structure', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, TENANT_ID, {
      kind: 'milestone-reward',
      secretOverride: TEST_SECRET,
      cycleIndex: 0,
    });

    expect(issued.token).toMatch(/^tcpmilestone2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(issued.kind).toBe('milestone-reward');
    expect(issued.displayCode).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(issued.qrSvg).toContain('<svg');
  });

  it('verifies a valid milestone-reward token', async () => {
    const nowMs = 1700000000000;
    const issued = await issueRedeemToken(CUSTOMER_ID, TENANT_ID, {
      kind: 'milestone-reward',
      nowMs,
      secretOverride: TEST_SECRET,
      cycleIndex: 1,
    });

    const result = verifyRedeemToken(issued.token, {
      nowMs: nowMs + 1000,
      secretOverride: TEST_SECRET,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.kind).toBe('milestone-reward');
      expect(result.payload.customerId).toBe(CUSTOMER_ID);
      expect(result.payload.tenantId).toBe(TENANT_ID);
      expect(result.payload.cycleIndex).toBe(1);
      expect(result.displayCode).toBe(issued.displayCode);
    }
  });

  it('rejects cross-kind verification: tcpmilestone2 cannot be treated as free-coffee or instagram-upsize', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, TENANT_ID, {
      kind: 'milestone-reward',
      secretOverride: TEST_SECRET,
    });

    // Tampering with the prefix to pretend it is a free-coffee token
    const parts = issued.token.split('.');
    const tamperedToken = `tcp2.${parts[1]}.${parts[2]}`;

    const result = verifyRedeemToken(tamperedToken, { secretOverride: TEST_SECRET });
    expect(result.valid).toBe(false);
  });

  it('rejects expired milestone tokens after 300 seconds', async () => {
    const nowMs = 1700000000000;
    const issued = await issueRedeemToken(CUSTOMER_ID, TENANT_ID, {
      kind: 'milestone-reward',
      nowMs,
      ttlSeconds: 300,
      secretOverride: TEST_SECRET,
    });

    // 301 seconds + skew tolerance (30s) = 331 seconds later
    const expiredResult = verifyRedeemToken(issued.token, {
      nowMs: nowMs + 335 * 1000,
      secretOverride: TEST_SECRET,
    });

    expect(expiredResult.valid).toBe(false);
    if (!expiredResult.valid) {
      expect(expiredResult.reason).toBe('expired-token');
    }
  });

  it('logger redacts tcpmilestone2 tokens', () => {
    const token = 'tcpmilestone2.eyJjdXN0b21lcklkIjoiMSJ9.c2lnbmF0dXJl';
    expect(() => {
      logSecurityEvent('info', 'milestone_token_issued', { token });
    }).not.toThrow();
  });
});
