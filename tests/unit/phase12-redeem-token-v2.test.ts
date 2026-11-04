import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TENANT_ONE_ID } from '@/lib/contracts';

const TEST_SECRET = 'b'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

vi.mock('server-only', () => ({}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? null,
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

const mockAdminClient = {
  rpc: vi.fn(),
  from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve({ rpc: vi.fn(), from: vi.fn() })),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/auth/staff', () => ({
  requireStaffSession: vi.fn().mockResolvedValue({
    authorized: true,
    staff: { userId: '11111111-1111-4111-8111-111111111111' },
  }),
  logStaffAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { POST as staffRedeemPost } from '@/app/api/staff/redeem/route';
import { issueRedeemToken, verifyRedeemToken } from '@/lib/security/redeemToken';

const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT_ID = '7c1f0000-0000-4000-8000-00000000000b';

function signToken(prefix: string, payload: Record<string, unknown>): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', TEST_SECRET)
    .update(`${prefix}.${payloadB64}`)
    .digest()
    .toString('base64url');
  return `${prefix}.${payloadB64}.${sig}`;
}

function makeRedeemRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/staff/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Phase 12: shop-bound redeem tokens (v2)', () => {
  beforeEach(() => {
    mockAdminClient.rpc.mockReset();
    mockAdminClient.from.mockReset();
  });

  it('round-trips a token with its tenantId', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, OTHER_TENANT_ID);
    expect(issued.payload.tenantId).toBe(OTHER_TENANT_ID);

    const verified = verifyRedeemToken(issued.token);
    expect(verified.valid).toBe(true);
    if (verified.valid) {
      expect(verified.kind).toBe('free-coffee');
      expect(verified.payload.customerId).toBe(CUSTOMER_ID);
      expect(verified.payload.tenantId).toBe(OTHER_TENANT_ID);
    }
  });

  it('uses the tcp2 / tcpig2 prefixes', async () => {
    const coffee = await issueRedeemToken(CUSTOMER_ID, TENANT_ONE_ID);
    expect(coffee.token.startsWith('tcp2.')).toBe(true);

    const upsize = await issueRedeemToken(CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
    expect(upsize.token.startsWith('tcpig2.')).toBe(true);
  });

  it('rejects a legacy tcp1 token even with a valid HMAC', () => {
    const now = Math.floor(Date.now() / 1000);
    const legacy = signToken('tcp1', {
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ONE_ID,
      iat: now,
      exp: now + 300,
      nonce: 'legacynonce123',
    });
    expect(verifyRedeemToken(legacy)).toEqual({ valid: false, reason: 'invalid-token' });

    const legacyIg = signToken('tcpig1', {
      customerId: CUSTOMER_ID,
      iat: now,
      exp: now + 300,
      nonce: 'legacynonce456',
    });
    expect(verifyRedeemToken(legacyIg)).toEqual({ valid: false, reason: 'invalid-token' });
  });

  it('rejects a tcp2 token whose payload has no UUID tenantId', () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { customerId: CUSTOMER_ID, iat: now, exp: now + 300, nonce: 'notenantnonce1' };
    expect(verifyRedeemToken(signToken('tcp2', base))).toEqual({
      valid: false,
      reason: 'invalid-token',
    });
    expect(verifyRedeemToken(signToken('tcp2', { ...base, tenantId: 'not-a-uuid' }))).toEqual({
      valid: false,
      reason: 'invalid-token',
    });
  });

  it('does not let tcp2 and tcpig2 kinds be swapped', async () => {
    const upsize = await issueRedeemToken(CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
    expect(verifyRedeemToken(upsize.token.replace(/^tcpig2\./, 'tcp2.'))).toEqual({
      valid: false,
      reason: 'invalid-token',
    });

    const coffee = await issueRedeemToken(CUSTOMER_ID, TENANT_ONE_ID);
    expect(verifyRedeemToken(coffee.token.replace(/^tcp2\./, 'tcpig2.'))).toEqual({
      valid: false,
      reason: 'invalid-token',
    });
  });

  it('redeem_rejects_other_tenant_token_interim', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, OTHER_TENANT_ID);

    const preview = await staffRedeemPost(makeRedeemRequest({ action: 'preview', token: issued.token }));
    expect(preview.status).toBe(400);
    const previewJson = await preview.json();
    expect(previewJson.ok).toBe(false);
    expect(previewJson.message).toBe('This reward belongs to another shop.');

    const confirm = await staffRedeemPost(makeRedeemRequest({ action: 'confirm', token: issued.token }));
    expect(confirm.status).toBe(200);
    const confirmJson = await confirm.json();
    expect(confirmJson.ok).toBe(true);
    expect(confirmJson.data.mode).toBe('confirm');
    expect(confirmJson.data.result).toBe('wrong-tenant');
    expect(confirmJson.data.message).toBe('This reward belongs to another shop.');

    const igIssued = await issueRedeemToken(CUSTOMER_ID, OTHER_TENANT_ID, {
      kind: 'instagram-upsize',
    });
    const igConfirm = await staffRedeemPost(
      makeRedeemRequest({ action: 'confirm', token: igIssued.token }),
    );
    expect((await igConfirm.json()).data.result).toBe('wrong-tenant');

    expect(mockAdminClient.rpc).not.toHaveBeenCalled();
    expect(mockAdminClient.from).not.toHaveBeenCalled();
  });
});
