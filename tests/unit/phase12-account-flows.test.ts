import { createRequire } from 'node:module';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { MERGE_INTENT_COOKIE_NAME, TENANT_ONE_ID, type WalletCardSummary } from '@/lib/contracts';

// ESLint 8 ships no type declarations; describe only the slice of the API this test uses.
interface LintMessage {
  ruleId: string | null;
  line: number;
  message: string;
}
const { ESLint } = createRequire(import.meta.url)('eslint') as {
  ESLint: new (options: { cwd: string }) => {
    lintText(
      code: string,
      options: { filePath: string },
    ): Promise<Array<{ messages: LintMessage[] }>>;
  };
};

const TEST_SECRET = 'd'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

vi.mock('server-only', () => ({}));

const mockCookieStore = { get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
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

function nonceQuery(existing: unknown) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  return query;
}

let existingNonce: unknown = null;
const mockAdminClient = {
  rpc: vi.fn(),
  from: vi.fn(() => nonceQuery(existingNonce)),
};
const mockServerClient = {
  auth: {
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => mockServerClient),
  getVerifiedUser: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));
vi.mock('@/lib/auth/customer', () => ({
  ensureCustomerRecord: vi.fn().mockResolvedValue('ok'),
  listWalletCards: vi.fn(),
}));
vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: vi.fn().mockResolvedValue({ success: true }),
}));

import { GET as authCallbackGet } from '@/app/auth/callback/route';
import { POST as mergePost } from '@/app/api/customers/merge/route';
import { DELETE as customersDelete, POST as customersPost } from '@/app/api/customers/route';
import { issueMergeIntentToken } from '@/lib/security/mergeToken';
import { verifyTurnstileToken } from '@/lib/security/turnstile';
import { listWalletCards } from '@/lib/auth/customer';
import { getVerifiedUser } from '@/lib/supabase/server';

const SOURCE = '11111111-1111-1111-1111-111111111111';
const TARGET = '22222222-2222-2222-2222-222222222222';

function wallet(available: number, total: number): WalletCardSummary {
  return {
    tenantId: TENANT_ONE_ID,
    tenantSlug: 'caffeine-plug',
    tenantName: 'The Caffeine Plug',
    brand: {},
    rewardThreshold: 10,
    rewardLabel: 'Free Coffee',
    availableStamps: available,
    totalStamps: total,
    lastStampedAt: null,
    addedAt: '2026-10-15T08:00:00.000Z',
  };
}

function rpcByName(results: Record<string, unknown>) {
  mockAdminClient.rpc.mockImplementation(async (name: string) => ({
    data: name in results ? results[name] : null,
    error: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  existingNonce = null;
  vi.mocked(getVerifiedUser).mockResolvedValue({ id: TARGET } as User);
});

describe('Phase 12: wallet merge, deletion and Turnstile dedupe', () => {
  it('callback_merges_with_merge_wallets', async () => {
    const issued = issueMergeIntentToken(SOURCE);
    rpcByName({
      merge_wallets: { result: 'merged', cards_moved: 1, cards_combined: 0 },
      log_audit_event: 'audit-id',
    });

    const req = new NextRequest('http://localhost:3000/auth/callback?code=ok', {
      headers: { cookie: `${MERGE_INTENT_COOKIE_NAME}=${issued.mergeToken}` },
    });
    const res = await authCallbackGet(req);

    expect(res.status).toBe(303);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('merge_wallets', {
      p_source: SOURCE,
      p_target: TARGET,
    });
    expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
      'merge_anonymous_customer',
      expect.anything(),
    );
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'log_audit_event',
      expect.objectContaining({
        p_action: 'customer_merge_token_used',
        p_target: issued.payload.nonce,
      }),
    );
  });

  it('callback does not mark the nonce when merge_wallets does not merge', async () => {
    const issued = issueMergeIntentToken(SOURCE);
    rpcByName({ merge_wallets: { result: 'source-not-found', cards_moved: 0, cards_combined: 0 } });

    const req = new NextRequest('http://localhost:3000/auth/callback', {
      headers: { cookie: `${MERGE_INTENT_COOKIE_NAME}=${issued.mergeToken}` },
    });
    await authCallbackGet(req);

    expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('log_audit_event', expect.anything());
  });

  it('merge_route_maps_merge_wallets_result', async () => {
    const issued = issueMergeIntentToken(SOURCE);
    rpcByName({
      merge_wallets: { result: 'merged', cards_moved: 1, cards_combined: 1 },
      log_audit_event: 'audit-id',
    });
    vi.mocked(listWalletCards).mockResolvedValue([wallet(4, 9), wallet(3, 5)]);

    const res = await mergePost(
      new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: issued.mergeToken }),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({
      result: 'merged',
      sourceCustomerId: SOURCE,
      targetCustomerId: TARGET,
      availableStampsAfter: 7,
      totalStampsAfter: 14,
    });
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('merge_wallets', {
      p_source: SOURCE,
      p_target: TARGET,
    });
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'log_audit_event',
      expect.objectContaining({ p_action: 'customer_merge_token_used' }),
    );
  });

  it('merge route passes through non-merged results without marking the nonce', async () => {
    const issued = issueMergeIntentToken(SOURCE);
    rpcByName({ merge_wallets: { result: 'target-not-found', cards_moved: 0, cards_combined: 0 } });
    vi.mocked(listWalletCards).mockResolvedValue([]);

    const res = await mergePost(
      new Request('http://localhost:3000/api/customers/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mergeToken: issued.mergeToken }),
      }),
    );

    const json = await res.json();
    expect(json.data.result).toBe('target-not-found');
    expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('log_audit_event', expect.anything());
  });

  it('delete_calls_delete_wallet', async () => {
    rpcByName({ delete_wallet: true });

    const res = await customersDelete(
      new Request('http://localhost:3000/api/customers', { method: 'DELETE' }),
    );

    expect(res.status).toBe(200);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('delete_wallet', { p_customer: TARGET });
    expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
      'delete_customer_data',
      expect.anything(),
    );
  });

  it('customers_post_ignores_captcha_token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await customersPost(
      new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken: 'single-use-token' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('siteverify'),
      expect.anything(),
    );
    fetchSpy.mockRestore();
  });

  it('eslint_bans_admin_from', { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, '../..') });
    const [result] = await eslint.lintText(
      "const admin = createSupabaseAdminClient();\nadmin.from('x');\nadmin.rpc('y');\n",
      { filePath: path.resolve(__dirname, '../../lib/__lint_probe.ts') },
    );

    const restricted = (result?.messages ?? []).filter((m: LintMessage) => m.ruleId === 'no-restricted-syntax');
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.line).toBe(2);
    expect(restricted[0]?.message).toContain('Service-role reads bypass RLS');
  });
});
