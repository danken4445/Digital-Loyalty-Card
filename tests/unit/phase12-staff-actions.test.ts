import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TAG_MANAGER_ROLES,
  TENANT_ONE_ID,
  type StaffRole,
  type StaffSession,
  type StampRow,
  type TenantContext,
} from '@/lib/contracts';

(globalThis as any).React = React;

const TEST_SECRET = 'c'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
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

interface RecordedQuery {
  table: string;
  eqs: Array<[string, unknown]>;
}

const recordedQueries: RecordedQuery[] = [];
let tableResults: Record<string, { data: unknown; error: unknown }> = {};

function makeQuery(table: string) {
  const recorded: RecordedQuery = { table, eqs: [] };
  recordedQueries.push(recorded);
  const result = () => tableResults[table] ?? { data: null, error: null };
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    recorded.eqs.push([column, value]);
    return query;
  });
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result());
  query.single = vi.fn(async () => result());
  query.then = (onResolve: (value: unknown) => unknown, onReject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(onResolve, onReject);
  return query;
}

const mockAdminClient = {
  rpc: vi.fn(),
  from: vi.fn(),
};

const mockServerClient = {
  from: vi.fn((table: string) => makeQuery(table)),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/auth/staff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/staff')>();
  return { ...actual, requireStaffSession: vi.fn() };
});

vi.mock('@/lib/tenants/context', () => ({
  getTenantById: vi.fn(),
}));

import { POST as staffRedeemPost } from '@/app/api/staff/redeem/route';
import { POST as staffStampPost } from '@/app/api/staff/stamp/route';
import { POST as staffTagsPost } from '@/app/api/staff/tags/route';
import {
  decorateTagWithUrls,
  detectActivityAnomalies,
  generateRandomTagId,
  getTenantAliasHost,
  requireStaffSession,
} from '@/lib/auth/staff';
import { ineligibleRedeemMessage } from '@/components/staff/RedeemRewardForm';
import { TagManagerClient } from '@/components/staff/TagManagerClient';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getTenantById } from '@/lib/tenants/context';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const SHOP_B_ID = '7c1f0000-0000-4000-8000-00000000000b';
const SHOP_B_NAME = 'Bean There';

function staffSession(role: StaffRole = 'staff', tenantId: string = SHOP_B_ID): StaffSession {
  return {
    userId: STAFF_ID,
    email: 'barista@example.com',
    displayName: 'Maria',
    role,
    active: true,
    tenantId,
    tenantSlug: 'bean-there',
    tenantName: SHOP_B_NAME,
    memberships: [
      { tenantId: TENANT_ONE_ID, tenantSlug: 'caffeine-plug', tenantName: 'Plug', role },
      { tenantId: SHOP_B_ID, tenantSlug: 'bean-there', tenantName: SHOP_B_NAME, role },
    ],
  };
}

function useStaff(role: StaffRole = 'staff', tenantId: string = SHOP_B_ID) {
  vi.mocked(requireStaffSession).mockResolvedValue({
    authorized: true,
    staff: staffSession(role, tenantId),
  });
}

function shopB(overrides: Partial<TenantContext['settings']> = {}): TenantContext {
  return {
    id: SHOP_B_ID,
    slug: 'bean-there',
    name: SHOP_B_NAME,
    status: 'active',
    settings: {
      cooldownMinutes: 30,
      dailyCap: 1,
      rewardThreshold: 6,
      tagThrottleSeconds: 5,
      timezone: 'America/New_York',
      currency: 'USD',
      rewardLabel: 'FREE LATTE',
      brand: {},
      perks: { instagram_follow_upsize: { label: 'Free upsize', handle: '@beanthere' } },
      ...overrides,
    },
  };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function rpcCalls(name: string) {
  return mockAdminClient.rpc.mock.calls.filter((call) => call[0] === name);
}

function eqsFor(table: string): Array<[string, unknown]> {
  return recordedQueries.filter((q) => q.table === table).flatMap((q) => q.eqs);
}

beforeEach(() => {
  vi.clearAllMocks();
  recordedQueries.length = 0;
  tableResults = {};
  mockAdminClient.rpc.mockReset();
  mockAdminClient.from.mockReset();
  mockServerClient.from.mockImplementation((table: string) => makeQuery(table));
  vi.mocked(getTenantById).mockResolvedValue(shopB());
  useStaff();
});

describe('Phase 12: staff manual stamp on the active shop', () => {
  it('manual_stamp_uses_active_tenant', async () => {
    mockAdminClient.rpc.mockResolvedValue({ data: 'stamped', error: null });
    tableResults['card_balances'] = { data: { available_stamps: 4 }, error: null };

    const res = await staffStampPost(
      jsonRequest('/api/staff/stamp', { customerId: CUSTOMER_ID, reason: 'NFC antenna broken' }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.result).toBe('stamped');
    expect(json.data.availableStampsAfter).toBe(4);

    expect(mockAdminClient.rpc).toHaveBeenCalledTimes(1);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('stamp_card_manual', {
      p_actor: STAFF_ID,
      p_tenant: SHOP_B_ID,
      p_customer: CUSTOMER_ID,
      p_reason: 'NFC antenna broken',
    });
    // No legacy audit RPC (SQL audits) and no admin table reads
    expect(rpcCalls('log_audit_event')).toHaveLength(0);
    expect(mockAdminClient.from).not.toHaveBeenCalled();
    // Balance comes from the session client, scoped to the active shop and customer
    expect(eqsFor('card_balances')).toEqual(
      expect.arrayContaining([
        ['tenant_id', SHOP_B_ID],
        ['customer_id', CUSTOMER_ID],
      ]),
    );
  });

  it('manual_stamp_no_card_404', async () => {
    mockAdminClient.rpc.mockResolvedValue({ data: 'no-card', error: null });

    const res = await staffStampPost(
      jsonRequest('/api/staff/stamp', { customerId: CUSTOMER_ID, reason: 'NFC antenna broken' }),
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('invalid_input');
    expect(json.message).toBe(`This customer has no ${SHOP_B_NAME} card.`);
  });

  it('maps unauthorized to 403 and cooldown to a 200 result', async () => {
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'unauthorized', error: null });
    const denied = await staffStampPost(
      jsonRequest('/api/staff/stamp', { customerId: CUSTOMER_ID, reason: 'NFC antenna broken' }),
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('forbidden');

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'cooldown', error: null });
    tableResults['card_balances'] = { data: { available_stamps: 2 }, error: null };
    const cooled = await staffStampPost(
      jsonRequest('/api/staff/stamp', { customerId: CUSTOMER_ID, reason: 'NFC antenna broken' }),
    );
    expect(cooled.status).toBe(200);
    expect((await cooled.json()).data.result).toBe('cooldown');
  });
});

describe('Phase 12: staff redemption on the active shop', () => {
  it('redeem_rejects_other_tenant_token', async () => {
    useStaff('staff', SHOP_B_ID);
    const issued = await issueRedeemToken(CUSTOMER_ID, TENANT_ONE_ID);

    const preview = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'preview', token: issued.token }),
    );
    expect(preview.status).toBe(400);
    expect((await preview.json()).message).toBe('This reward belongs to another shop.');

    const confirm = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'confirm', token: issued.token }),
    );
    expect(confirm.status).toBe(200);
    const confirmJson = await confirm.json();
    expect(confirmJson.data.result).toBe('wrong-tenant');

    const ig = await issueRedeemToken(CUSTOMER_ID, TENANT_ONE_ID, { kind: 'instagram-upsize' });
    const igConfirm = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'confirm', token: ig.token }),
    );
    expect((await igConfirm.json()).data.result).toBe('wrong-tenant');

    expect(mockAdminClient.rpc).not.toHaveBeenCalled();
    expect(mockAdminClient.from).not.toHaveBeenCalled();
  });

  it('accepts a token for the active shop after the staff member switches shops', async () => {
    useStaff('staff', TENANT_ONE_ID);
    const issued = await issueRedeemToken(CUSTOMER_ID, SHOP_B_ID);
    const res = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'preview', token: issued.token }),
    );
    // Token is for shop B but the active shop is shop one: rejected
    expect(res.status).toBe(400);

    useStaff('staff', SHOP_B_ID);
    tableResults['card_balances'] = {
      data: { available_stamps: 6, total_stamps: 6, stamps_redeemed: 0 },
      error: null,
    };
    const ok = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'preview', token: issued.token }),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    // Shop B's threshold is 6, not the platform default 10
    expect(json.data.canRedeem).toBe(true);
    expect(eqsFor('card_balances')).toEqual(expect.arrayContaining([['tenant_id', SHOP_B_ID]]));
    expect(eqsFor('audit_log')).toEqual(expect.arrayContaining([['tenant_id', SHOP_B_ID]]));
  });

  it('redeem_confirm_calls_redeem_card_reward_with_active_tenant', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, SHOP_B_ID);
    mockAdminClient.rpc.mockResolvedValue({ data: 'redeemed', error: null });
    tableResults['card_balances'] = { data: { available_stamps: 0 }, error: null };

    const res = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'confirm', token: issued.token }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.result).toBe('redeemed');
    expect(json.data.rewardKind).toBe('free-coffee');
    expect(json.data.availableStampsAfter).toBe(0);
    expect(json.data.message).toBe('FREE LATTE redeemed successfully! 6 stamps deducted.');

    expect(mockAdminClient.rpc).toHaveBeenCalledTimes(1);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('redeem_card_reward', {
      p_actor: STAFF_ID,
      p_tenant: SHOP_B_ID,
      p_customer: CUSTOMER_ID,
      p_nonce: issued.payload.nonce,
    });
    // The SQL function records the nonce; no extra audit RPC
    expect(rpcCalls('log_audit_event')).toHaveLength(0);
    expect(mockAdminClient.from).not.toHaveBeenCalled();
  });

  it('uses the shop threshold in the insufficient-stamps message', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, SHOP_B_ID);
    mockAdminClient.rpc.mockResolvedValue({ data: 'insufficient-stamps', error: null });
    const res = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'confirm', token: issued.token }),
    );
    const json = await res.json();
    expect(json.data.result).toBe('insufficient-stamps');
    expect(json.data.message).toBe('Customer does not have enough stamps (6 required).');
  });

  it('perk_confirm_calls_claim_card_perk', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, SHOP_B_ID, { kind: 'instagram-upsize' });
    mockAdminClient.rpc.mockResolvedValue({ data: 'redeemed', error: null });
    tableResults['card_balances'] = { data: { available_stamps: 3 }, error: null };

    const res = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'confirm', token: issued.token }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.result).toBe('redeemed');
    expect(json.data.rewardKind).toBe('instagram-upsize');
    expect(json.data.availableStampsAfter).toBe(3);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('claim_card_perk', {
      p_actor: STAFF_ID,
      p_tenant: SHOP_B_ID,
      p_customer: CUSTOMER_ID,
      p_perk: 'instagram_follow_upsize',
    });
    expect(rpcCalls('redeem_card_reward')).toHaveLength(0);
  });

  it('previews a perk as redeemable only when the shop has no claim for the card', async () => {
    const issued = await issueRedeemToken(CUSTOMER_ID, SHOP_B_ID, { kind: 'instagram-upsize' });
    tableResults['perk_claims'] = { data: { id: 'claim-1' }, error: null };
    const res = await staffRedeemPost(
      jsonRequest('/api/staff/redeem', { action: 'preview', token: issued.token }),
    );
    const json = await res.json();
    expect(json.data.canRedeem).toBe(false);
    expect(eqsFor('perk_claims')).toEqual(
      expect.arrayContaining([
        ['tenant_id', SHOP_B_ID],
        ['customer_id', CUSTOMER_ID],
        ['perk', 'instagram_follow_upsize'],
      ]),
    );
  });
});

describe('Phase 12: staff tag management', () => {
  it('tag_actions_require_owner_or_manager', async () => {
    useStaff('staff');
    for (const body of [
      { action: 'create', label: 'Front' },
      { action: 'deactivate', tagId: 'tcp_tag_abcd1234' },
      { action: 'rotate', tagId: 'tcp_tag_abcd1234' },
    ]) {
      const res = await staffTagsPost(jsonRequest('/api/staff/tags', body));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('forbidden');
      expect(json.message).toBe('Only owners and managers can manage tags.');
    }
    expect(mockAdminClient.rpc).not.toHaveBeenCalled();

    for (const role of TAG_MANAGER_ROLES) {
      useStaff(role);
      mockAdminClient.rpc.mockResolvedValue({ data: 'created', error: null });
      tableResults['tags'] = {
        data: {
          id: 'tcp_tag_new',
          label: 'Front',
          active: true,
          created_at: '2026-11-04T00:00:00Z',
          deactivated_at: null,
        },
        error: null,
      };
      const res = await staffTagsPost(
        jsonRequest('/api/staff/tags', { action: 'create', label: 'Front' }),
      );
      expect(res.status).toBe(200);
    }
  });

  it('creates, deactivates and rotates through the tag RPCs for the active shop', async () => {
    useStaff('manager');
    const tagRow = {
      id: 'tcp_tag_row',
      label: 'Front',
      active: true,
      created_at: '2026-11-04T00:00:00Z',
      deactivated_at: null,
    };

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'created', error: null });
    tableResults['tags'] = { data: tagRow, error: null };
    const created = await staffTagsPost(
      jsonRequest('/api/staff/tags', { action: 'create', label: ' Front ' }),
    );
    expect(created.status).toBe(200);
    const createdJson = await created.json();
    expect(createdJson.data.action).toBe('create');
    expect(createdJson.data.tag.id).toBe('tcp_tag_row');
    const createArgs = rpcCalls('create_tag')[0]![1];
    expect(createArgs).toEqual({
      p_actor: STAFF_ID,
      p_tenant: SHOP_B_ID,
      p_tag_id: expect.stringMatching(/^tcp_tag_[0-9a-z]{16}$/),
      p_label: 'Front',
    });
    // The returned tag is re-read through the session client, scoped to the shop
    expect(eqsFor('tags')).toEqual(expect.arrayContaining([['tenant_id', SHOP_B_ID]]));

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'deactivated', error: null });
    tableResults['tags'] = { data: { ...tagRow, active: false }, error: null };
    const deactivated = await staffTagsPost(
      jsonRequest('/api/staff/tags', { action: 'deactivate', tagId: 'tcp_tag_row' }),
    );
    expect(deactivated.status).toBe(200);
    expect((await deactivated.json()).data.deactivatedTagId).toBe('tcp_tag_row');
    expect(rpcCalls('deactivate_tag')[0]![1]).toEqual({
      p_actor: STAFF_ID,
      p_tenant: SHOP_B_ID,
      p_tag_id: 'tcp_tag_row',
    });

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'rotated', error: null });
    tableResults['tags'] = { data: { ...tagRow, id: 'tcp_tag_next' }, error: null };
    const rotated = await staffTagsPost(
      jsonRequest('/api/staff/tags', {
        action: 'rotate',
        tagId: 'tcp_tag_row',
        newLabel: 'Back',
      }),
    );
    expect(rotated.status).toBe(200);
    const rotateJson = await rotated.json();
    expect(rotateJson.data.deactivatedTagId).toBe('tcp_tag_row');
    expect(rpcCalls('rotate_tag')[0]![1]).toEqual({
      p_actor: STAFF_ID,
      p_tenant: SHOP_B_ID,
      p_old_tag_id: 'tcp_tag_row',
      p_new_tag_id: expect.stringMatching(/^tcp_tag_[0-9a-z]{16}$/),
      p_label: 'Back',
    });
    expect(mockAdminClient.from).not.toHaveBeenCalled();
  });

  it('tag_create_retries_duplicate_once', async () => {
    useStaff('owner');
    tableResults['tags'] = {
      data: {
        id: 'tcp_tag_ok',
        label: null,
        active: true,
        created_at: '2026-11-04T00:00:00Z',
        deactivated_at: null,
      },
      error: null,
    };

    mockAdminClient.rpc
      .mockResolvedValueOnce({ data: 'duplicate', error: null })
      .mockResolvedValueOnce({ data: 'created', error: null });
    const retried = await staffTagsPost(jsonRequest('/api/staff/tags', { action: 'create' }));
    expect(retried.status).toBe(200);
    const calls = rpcCalls('create_tag');
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].p_tag_id).not.toBe(calls[1]![1].p_tag_id);

    mockAdminClient.rpc.mockReset();
    mockAdminClient.rpc.mockResolvedValue({ data: 'duplicate', error: null });
    const exhausted = await staffTagsPost(jsonRequest('/api/staff/tags', { action: 'create' }));
    expect(exhausted.status).toBe(500);
    expect(rpcCalls('create_tag')).toHaveLength(2);
  });

  it('maps tag RPC results to HTTP outcomes', async () => {
    useStaff('owner');
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'not-found', error: null });
    const missing = await staffTagsPost(
      jsonRequest('/api/staff/tags', { action: 'deactivate', tagId: 'tcp_tag_nope' }),
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).message).toBe('NFC tag not found.');

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'unauthorized', error: null });
    const denied = await staffTagsPost(
      jsonRequest('/api/staff/tags', { action: 'rotate', tagId: 'tcp_tag_nope' }),
    );
    expect(denied.status).toBe(403);

    mockAdminClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const failed = await staffTagsPost(
      jsonRequest('/api/staff/tags', { action: 'deactivate', tagId: 'tcp_tag_nope' }),
    );
    expect(failed.status).toBe(500);
  });
});

describe('Phase 12: activity anomalies and tap URLs', () => {
  function nfcStamp(id: string, createdAt: string): StampRow {
    return {
      id,
      customer_id: CUSTOMER_ID,
      tag_id: 'tag1',
      source: 'nfc',
      staff_id: null,
      reason: null,
      created_at: createdAt,
    };
  }

  it('activity_anomalies_use_tenant_cap', () => {
    const stamps = [nfcStamp('s1', '2026-11-01T15:00:00Z'), nfcStamp('s2', '2026-11-02T15:00:00Z')];
    const input = { stamps, redemptions: [], auditLogs: [] };

    const capOne = detectActivityAnomalies(input, { dailyCap: 1, timezone: 'Asia/Manila' });
    expect(capOne).toHaveLength(1);
    expect(capOne[0]!.category).toBe('repeated-daily-cap');
    expect(capOne[0]!.description).toContain('reached the 1-stamp daily cap on 2 recent day(s)');

    expect(detectActivityAnomalies(input, { dailyCap: 2, timezone: 'Asia/Manila' })).toEqual([]);
  });

  it('groups stamps into days using the shop timezone', () => {
    // Two stamps an hour apart, on each of two UTC days. In UTC each day holds a pair (cap 2 hit
    // twice); in Manila (UTC+8) the pairs straddle midnight, so only one day reaches 2 stamps.
    const stamps = [
      nfcStamp('a', '2026-11-01T15:30:00Z'),
      nfcStamp('b', '2026-11-01T16:30:00Z'),
      nfcStamp('c', '2026-11-02T15:30:00Z'),
      nfcStamp('d', '2026-11-02T16:30:00Z'),
    ];
    const input = { stamps, redemptions: [], auditLogs: [] };
    expect(detectActivityAnomalies(input, { dailyCap: 2, timezone: 'UTC' })).toHaveLength(1);
    expect(detectActivityAnomalies(input, { dailyCap: 2, timezone: 'Asia/Manila' })).toEqual([]);
  });

  it('production_tap_url_uses_site_url', () => {
    const previous = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com/';
    try {
      const tag = {
        id: 'tcp_tag_abc',
        label: null,
        active: true,
        created_at: '2026-11-04T00:00:00Z',
        deactivated_at: null,
      };
      const decorated = decorateTagWithUrls(tag);
      expect(decorated.productionTapUrl).toBe('https://app.example.com/t/tcp_tag_abc');
      expect(decorated.localTapUrl).toBe('https://app.example.com/t/tcp_tag_abc');
      expect(decorated.productionTapUrl).not.toContain('thecaffeineplug.ph');
    } finally {
      process.env.NEXT_PUBLIC_SITE_URL = previous;
    }
  });

  it('generates tag ids in the expected shape', () => {
    expect(generateRandomTagId()).toMatch(/^tcp_tag_[0-9a-z]{16}$/);
  });
});

describe('Phase 12: tag manager UI by role', () => {
  const tags = [
    {
      id: 'tcp_tag_a',
      label: 'Front',
      active: true,
      created_at: '2026-11-04T00:00:00Z',
      deactivated_at: null,
      productionTapUrl: 'https://app.example.com/t/tcp_tag_a',
      localTapUrl: 'http://localhost:3000/t/tcp_tag_a',
    },
  ];

  it('hides create, rotate and deactivate when canManage is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(TagManagerClient, { initialTags: tags, canManage: false }),
    );
    expect(html).not.toContain('Provision NTAG215 Hardware Tag');
    expect(html).not.toContain('Rotate Tag');
    expect(html).not.toContain('Deactivate Tag');
    expect(html).toContain('Only owners and managers can create, rotate or deactivate tags.');
    // Staff can still copy the URLs to write onto a card
    expect(html).toContain('Copy Production URL');
  });

  it('shows the management controls for owners and managers', () => {
    const html = renderToStaticMarkup(
      React.createElement(TagManagerClient, { initialTags: tags, canManage: true }),
    );
    expect(html).toContain('Provision NTAG215 Hardware Tag');
    expect(html).toContain('Rotate Tag');
    expect(html).toContain('Deactivate Tag');
  });
});

describe('Phase 12 final fixes', () => {
  const TAG = {
    id: 'tcp_tag_abc',
    label: null,
    active: true,
    created_at: '2026-11-04T00:00:00Z',
    deactivated_at: null,
  };

  it('tag_url_uses_alias_host_when_the_shop_has_one', () => {
    const decorated = decorateTagWithUrls(TAG, 'card.beanthere.example');
    expect(decorated.productionTapUrl).toBe('https://card.beanthere.example/t/tcp_tag_abc');
    // local URL is never an alias
    expect(decorated.localTapUrl).toBe('http://localhost:3000/t/tcp_tag_abc');
  });

  it('tag_url_falls_back_to_site_url_without_alias', () => {
    expect(decorateTagWithUrls(TAG, null).productionTapUrl).toBe('http://localhost:3000/t/tcp_tag_abc');
    expect(decorateTagWithUrls(TAG).productionTapUrl).toBe('http://localhost:3000/t/tcp_tag_abc');
  });

  it('getTenantAliasHost reads tenant_domains with the session client for that shop', async () => {
    tableResults['tenant_domains'] = { data: { host: 'card.beanthere.example' }, error: null };
    await expect(getTenantAliasHost(SHOP_B_ID)).resolves.toBe('card.beanthere.example');
    expect(eqsFor('tenant_domains')).toEqual([['tenant_id', SHOP_B_ID]]);
    expect(mockAdminClient.from).not.toHaveBeenCalled();

    tableResults['tenant_domains'] = { data: null, error: null };
    await expect(getTenantAliasHost(SHOP_B_ID)).resolves.toBeNull();
    tableResults['tenant_domains'] = { data: null, error: { message: 'rls' } };
    await expect(getTenantAliasHost(SHOP_B_ID)).resolves.toBeNull();
  });

  it('tags_post_returns_alias_url_for_a_shop_with_alias', async () => {
    useStaff('manager');
    tableResults['tenant_domains'] = { data: { host: 'card.beanthere.example' }, error: null };
    mockAdminClient.rpc.mockResolvedValue({ data: 'created', error: null });
    tableResults['tags'] = {
      data: { id: 'tcp_tag_x', label: 'Door', active: true, created_at: 'x', deactivated_at: null },
      error: null,
    };
    const res = await staffTagsPost(
      jsonRequest('/api/staff/tags', { action: 'create', label: 'Door' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tag.productionTapUrl).toBe('https://card.beanthere.example/t/tcp_tag_x');
  });

  it.each([null, 'weird-result', 42])(
    'manual_stamp_unknown_rpc_result_is_500_not_stamped (%s)',
    async (rpcResult) => {
      mockAdminClient.rpc.mockResolvedValue({ data: rpcResult, error: null });
      tableResults['card_balances'] = { data: { available_stamps: 4 }, error: null };

      const res = await staffStampPost(
        jsonRequest('/api/staff/stamp', { customerId: CUSTOMER_ID, reason: 'NFC antenna broken' }),
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('internal_error');
    },
  );

  it('redeem_ineligible_message_has_a_space_before_the_reward_label', () => {
    const text = ineligibleRedeemMessage(4, 10, 'FREE COFFEE');
    expect(text).toBe('Customer has 4 stamps. 10 stamps are required to redeem: FREE COFFEE.');
    expect(text).not.toMatch(/redeem:[^ ]/);
  });
});
