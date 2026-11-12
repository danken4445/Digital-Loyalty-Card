import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STAFF_TENANT_COOKIE_NAME } from '@/lib/contracts';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
});

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
  notFound: () => mockNotFound(),
}));

let mockCookieMap = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const val = mockCookieMap.get(name);
      return val !== undefined ? { name, value: val } : undefined;
    },
    getAll: () => Array.from(mockCookieMap.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      mockCookieMap.set(name, value);
    },
  })),
}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? '127.0.0.1',
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

interface QueryState {
  table: string;
  filters: Array<{ type: string; column: string; value: unknown }>;
}

let queryResults: Record<string, { data: unknown; error: unknown }> = {};

function createMockQuery(table: string) {
  const state: QueryState = { table, filters: [] };
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push({ type: 'eq', column, value });
    return query;
  });
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => queryResults[table] ?? { data: null, error: null });
  query.single = vi.fn(async () => queryResults[table] ?? { data: null, error: null });
  query.then = (onResolve: (val: unknown) => unknown, onReject: (err: unknown) => unknown) =>
    Promise.resolve(queryResults[table] ?? { data: null, error: null }).then(onResolve, onReject);

  return query;
}

const mockAdminClient = {
  rpc: vi.fn(),
};

const mockServerClient = {
  from: vi.fn((table: string) => createMockQuery(table)),
  auth: {
    getUser: vi.fn(),
  },
};

let verifiedUserMock: unknown = null;

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(() => Promise.resolve(verifiedUserMock)),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

import { PATCH as rulesPatch } from '@/app/api/staff/[slug]/rules/route';
import { POST as rulesPreviewPost } from '@/app/api/staff/[slug]/rules/preview/route';

const SHOP_A = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'shop-a',
  name: 'Shop A',
  status: 'active',
};

function setupOwnerUser() {
  verifiedUserMock = {
    id: 'user-owner-1',
    email: 'owner@shop-a.com',
    is_anonymous: false,
  };

  queryResults['tenant_members'] = {
    data: [
      {
        tenant_id: SHOP_A.id,
        role: 'owner',
        display_name: 'Shop A Owner',
        tenants: SHOP_A,
      },
    ],
    error: null,
  };
}

describe('Owner Milestone Rules API & Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieMap.clear();
    queryResults = {};
    verifiedUserMock = null;
  });

  it('owner can save milestone reward settings', async () => {
    setupOwnerUser();
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        reward_threshold: 10,
        milestone_step: 5,
        milestone_reward_label: '50% OFF Drink',
      }),
    });

    const res = await rulesPatch(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockAdminClient.rpc).toHaveBeenCalledWith('update_tenant_rules', {
      p_actor: 'user-owner-1',
      p_tenant: SHOP_A.id,
      p_patch: {
        reward_threshold: 10,
        milestone_step: 5,
        milestone_reward_label: '50% OFF Drink',
      },
    });
  });

  it('owner can disable milestone reward by sending null', async () => {
    setupOwnerUser();
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        milestone_step: null,
        milestone_reward_label: null,
      }),
    });

    const res = await rulesPatch(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockAdminClient.rpc).toHaveBeenCalledWith('update_tenant_rules', {
      p_actor: 'user-owner-1',
      p_tenant: SHOP_A.id,
      p_patch: {
        milestone_step: null,
        milestone_reward_label: null,
      },
    });
  });

  it('rejects milestone_step >= reward_threshold when both are submitted', async () => {
    setupOwnerUser();

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        reward_threshold: 10,
        milestone_step: 10,
        milestone_reward_label: 'Free Drink',
      }),
    });

    const res = await rulesPatch(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid-patch');
    expect(body.message).toContain('Milestone step must be strictly less than reward threshold');
  });

  it('preview endpoint accepts milestone fields in payload without schema violation', async () => {
    setupOwnerUser();

    const previewData = {
      cardsNewlyRedeemable: 2,
      cardsWithPartialProgress: 10,
      currentThreshold: 10,
      newThreshold: 10,
    };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: previewData, error: null });

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        reward_threshold: 10,
        milestone_step: 5,
        milestone_reward_label: '50% OFF',
      }),
    });

    const res = await rulesPreviewPost(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
