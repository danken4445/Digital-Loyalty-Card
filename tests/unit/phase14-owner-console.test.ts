import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES, STAFF_TENANT_COOKIE_NAME, type StaffRole } from '@/lib/contracts';

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

// Import modules under test
import { requireConsoleAccess, enforceConsolePageAccess } from '@/lib/console/guard';
import { PATCH as rulesPatch } from '@/app/api/staff/[slug]/rules/route';
import { POST as rulesPreviewPost } from '@/app/api/staff/[slug]/rules/preview/route';
import { POST as invitesPost } from '@/app/api/staff/[slug]/invites/route';
import { PATCH as membersPatch } from '@/app/api/staff/[slug]/members/route';
import { POST as acceptInvitePost } from '@/app/auth/accept-invite/route';
import SettingsLayoutDefault, * as SettingsLayout from '@/app/staff/[slug]/settings/layout';
import RulesSettingsPageDefault, * as RulesSettingsPage from '@/app/staff/[slug]/settings/page';
import StaffSettingsPageDefault, * as StaffSettingsPage from '@/app/staff/[slug]/settings/staff/page';

const SHOP_A = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'shop-a',
  name: 'Shop A',
  status: 'active',
};

const SHOP_B = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'shop-b',
  name: 'Shop B',
  status: 'active',
};

function setupStandardUserMemberships() {
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
      {
        tenant_id: SHOP_B.id,
        role: 'manager',
        display_name: 'Shop B Manager',
        tenants: SHOP_B,
      },
    ],
    error: null,
  };
}

describe('Phase 14 Task 6: Owner Console Shell, Rules, Staff, Invites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieMap.clear();
    queryResults = {};
    verifiedUserMock = null;
  });

  it('console_guard_resolves_tenant_from_slug_not_cookie', async () => {
    setupStandardUserMemberships();
    // Cookie points to Shop B
    mockCookieMap.set(STAFF_TENANT_COOKIE_NAME, SHOP_B.id);

    // Call console guard requesting Shop A access as owner
    const access = await requireConsoleAccess('shop-a', 'owner');

    // Must resolve Shop A, NOT Shop B from the cookie
    expect(access.tenantId).toBe(SHOP_A.id);
    expect(access.staff.tenantId).toBe(SHOP_A.id);
    expect(access.staff.tenantSlug).toBe('shop-a');
    expect(access.staff.role).toBe('owner');
  });

  it('console_guard_404s_for_non_member_slug', async () => {
    setupStandardUserMemberships();

    // Call console guard with a slug the user has no membership for
    await expect(requireConsoleAccess('non-member-slug', 'staff')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('rules_route_owner_only', async () => {
    setupStandardUserMemberships();

    // In Shop B, user is only 'manager'
    const managerReq = new Request('http://localhost:3000/api/staff/shop-b/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ reward_threshold: 8 }),
    });

    const managerRes = await rulesPatch(managerReq, { params: Promise.resolve({ slug: 'shop-b' }) });
    expect(managerRes.status).toBe(403);
    const managerBody = await managerRes.json();
    expect(managerBody.ok).toBe(false);
    expect(managerBody.error).toBe('forbidden');

    // In Shop A, user is 'owner'
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });

    const ownerReq = new Request('http://localhost:3000/api/staff/shop-a/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ reward_threshold: 8 }),
    });

    const ownerRes = await rulesPatch(ownerReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(ownerRes.status).toBe(200);
    const ownerBody = await ownerRes.json();
    expect(ownerBody.ok).toBe(true);
    expect(ownerRes.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rules_preview_shows_newly_redeemable_count', async () => {
    setupStandardUserMemberships();

    const previewData = {
      cardsNewlyRedeemable: 14,
      cardsWithPartialProgress: 42,
      currentThreshold: 10,
      newThreshold: 7,
    };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: previewData, error: null });

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ reward_threshold: 7 }),
    });

    const res = await rulesPreviewPost(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.cardsNewlyRedeemable).toBe(14);
    expect(body.data.cardsWithPartialProgress).toBe(42);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('preview_tenant_rules', {
      p_actor: 'user-owner-1',
      p_tenant: SHOP_A.id,
      p_patch: { reward_threshold: 7 },
    });
  });

  it('rules_route_rejects_unknown_keys', async () => {
    setupStandardUserMemberships();

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        reward_threshold: 8,
        unauthorized_extra_field: 'malicious',
      }),
    });

    const res = await rulesPatch(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid-patch');
    expect(mockAdminClient.rpc).not.toHaveBeenCalled();
  });

  it('invite_route_creates_invite_and_audits', async () => {
    setupStandardUserMemberships();

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'invited', error: null });

    const req = new Request('http://localhost:3000/api/staff/shop-a/invites', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        email: 'barista@shop-a.com',
        role: 'staff',
      }),
    });

    const res = await invitesPost(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.result).toBe('invited');
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('invite_member', {
      p_actor: 'user-owner-1',
      p_tenant: SHOP_A.id,
      p_email: 'barista@shop-a.com',
      p_role: 'staff',
    });
  });

  it('accept_invite_requires_signed_in_matching_email', async () => {
    // 1. Unauthenticated -> 401
    verifiedUserMock = null;
    const unauthReq = new Request('http://localhost:3000/auth/accept-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        inviteId: '33333333-3333-3333-3333-333333333333',
        displayName: 'New Barista',
      }),
    });
    const unauthRes = await acceptInvitePost(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 2. Signed in, but email mismatch
    verifiedUserMock = {
      id: 'user-new-1',
      email: 'wrong-email@other.com',
      is_anonymous: false,
    };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'email-mismatch', error: null });

    const mismatchReq = new Request('http://localhost:3000/auth/accept-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        inviteId: '33333333-3333-3333-3333-333333333333',
        displayName: 'New Barista',
      }),
    });
    const mismatchRes = await acceptInvitePost(mismatchReq);
    expect(mismatchRes.status).toBe(403);
    const mismatchBody = await mismatchRes.json();
    expect(mismatchBody.ok).toBe(false);
    expect(mismatchBody.error).toBe('email-mismatch');

    // 3. Signed in with matching email -> accepted
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'accepted', error: null });

    const matchReq = new Request('http://localhost:3000/auth/accept-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        inviteId: '33333333-3333-3333-3333-333333333333',
        displayName: 'New Barista',
      }),
    });
    const matchRes = await acceptInvitePost(matchReq);
    expect(matchRes.status).toBe(200);
    const matchBody = await matchRes.json();
    expect(matchBody.ok).toBe(true);
    expect(matchBody.data.result).toBe('accepted');
  });

  it('members_route_refuses_last_owner_removal', async () => {
    setupStandardUserMemberships();

    // 1. Demoting last owner -> RPC returns 'last-owner'
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'last-owner', error: null });

    const demoteReq = new Request('http://localhost:3000/api/staff/shop-a/members', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        userId: '44444444-4444-4444-4444-444444444444',
        role: 'manager',
      }),
    });

    const demoteRes = await membersPatch(demoteReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(demoteRes.status).toBe(400);
    const demoteBody = await demoteRes.json();
    expect(demoteBody.ok).toBe(false);
    expect(demoteBody.error).toBe('last-owner');

    // 2. Deactivating last owner -> RPC returns 'last-owner'
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'last-owner', error: null });

    const deactReq = new Request('http://localhost:3000/api/staff/shop-a/members', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        userId: '44444444-4444-4444-4444-444444444444',
        active: false,
      }),
    });

    const deactRes = await membersPatch(deactReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(deactRes.status).toBe(400);
    const deactBody = await deactRes.json();
    expect(deactBody.ok).toBe(false);
    expect(deactBody.error).toBe('last-owner');
  });

  it('console_pages_and_layout_force_dynamic_and_render', async () => {
    expect(SettingsLayout.dynamic).toBe('force-dynamic');
    expect(RulesSettingsPage.dynamic).toBe('force-dynamic');
    expect(StaffSettingsPage.dynamic).toBe('force-dynamic');

    setupStandardUserMemberships();
    queryResults['tenant_settings'] = {
      data: {
        cooldown_minutes: 60,
        daily_cap: 3,
        reward_threshold: 10,
        tag_throttle_seconds: 15,
        reward_label: 'Free Coffee',
      },
      error: null,
    };
    queryResults['tenant_invites'] = {
      data: [],
      error: null,
    };

    const layoutJsx = await SettingsLayoutDefault({
      children: React.createElement('div', null, 'Settings Content'),
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(layoutJsx).toBeDefined();

    const rulesPageJsx = await RulesSettingsPageDefault({
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(rulesPageJsx).toBeDefined();

    const staffPageJsx = await StaffSettingsPageDefault({
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(staffPageJsx).toBeDefined();

    // Staff role cannot access RulesSettingsPage (requires manager)
    queryResults['tenant_members'] = {
      data: [
        {
          tenant_id: SHOP_A.id,
          role: 'staff',
          display_name: 'Shop A Barista',
          tenants: SHOP_A,
        },
      ],
      error: null,
    };
    await expect(
      RulesSettingsPageDefault({ params: Promise.resolve({ slug: 'shop-a' }) }),
    ).rejects.toThrow(`NEXT_REDIRECT: ${ROUTES.staff.login}?error=forbidden`);
  });

  it('routes_return_500_on_unexpected_guard_exceptions', async () => {
    setupStandardUserMemberships();

    // Force an unexpected exception (e.g. database error in requireStaffSession query)
    queryResults['tenant_members'] = {
      data: null,
      error: { message: 'DB connection failure' },
    };

    const req = new Request('http://localhost:3000/api/staff/shop-a/rules', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ reward_threshold: 10 }),
    });

    // When requireStaffSession encounters DB error, auth.authorized is false (forbidden)
    // Now test unexpected runtime exception in requireConsoleAccess
    const consoleGuardMod = await import('@/lib/console/guard');
    const spy = vi.spyOn(consoleGuardMod, 'requireConsoleAccess').mockRejectedValueOnce(
      new Error('Unexpected disk read error'),
    );

    const res = await rulesPatch(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('internal_error');
    spy.mockRestore();
  });

  describe('enforceConsolePageAccess streamlined guard', () => {
    it('returns staff and tenantId when authorized', async () => {
      setupStandardUserMemberships();
      const access = await enforceConsolePageAccess('shop-a', 'owner');
      expect(access.tenantId).toBe(SHOP_A.id);
      expect(access.staff.role).toBe('owner');
    });

    it('redirects unauthenticated users to staff login with next param', async () => {
      verifiedUserMock = null;
      await expect(enforceConsolePageAccess('shop-a', 'staff')).rejects.toThrow(
        `NEXT_REDIRECT: ${ROUTES.staff.login}?next=${encodeURIComponent(ROUTES.staff.settings('shop-a'))}`,
      );
    });

    it('redirects forbidden users (insufficient role) to staff login with error=forbidden', async () => {
      setupStandardUserMemberships();
      // User is only manager in shop-b, requires owner
      await expect(enforceConsolePageAccess('shop-b', 'owner')).rejects.toThrow(
        `NEXT_REDIRECT: ${ROUTES.staff.login}?error=forbidden`,
      );
    });

    it('throws not found when user has no membership for slug', async () => {
      setupStandardUserMemberships();
      await expect(enforceConsolePageAccess('unknown-slug', 'staff')).rejects.toThrow('NEXT_NOT_FOUND');
    });
  });
});
