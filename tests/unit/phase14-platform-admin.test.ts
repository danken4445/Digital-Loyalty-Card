import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@/lib/contracts';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
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
  auth: {
    admin: {
      listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
      createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'new-user-1' } }, error: null }),
      updateUserById: vi.fn().mockResolvedValue({ data: { user: { id: 'updated-user-1' } }, error: null }),
    },
  },
};

const mockServerClient = {
  from: vi.fn((table: string) => createMockQuery(table)),
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(),
      listFactors: vi.fn(),
      challenge: vi.fn(),
      verify: vi.fn(),
      enroll: vi.fn(),
    },
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

// Route and module imports under test
import { requirePlatformAdmin, enforcePlatformPageAccess, resolveSafeMfaDestination } from '@/lib/auth/platform';
import { POST as createTenantPost } from '@/app/api/platform/tenants/route';
import { POST as tenantStatusPost } from '@/app/api/platform/tenants/[slug]/status/route';
import { POST as supportPost } from '@/app/api/platform/support/route';
import * as PlatformRootPage from '@/app/platform/page';
import * as PlatformNewPage from '@/app/platform/new/page';
import * as PlatformSlugPage from '@/app/platform/[slug]/page';
import * as PlatformSupportPage from '@/app/platform/[slug]/support/page';
import PlatformMfaPageDefault, * as PlatformMfaPage from '@/app/platform/mfa/page';

describe('Phase 14 Task 5: Platform Admin Guard, Routes, and Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryResults = {};
    verifiedUserMock = null;
  });

  it('platform_guard_rejects_non_admin', async () => {
    // 1. Unauthenticated (no verified user)
    verifiedUserMock = null;
    let auth = await requirePlatformAdmin();
    expect(auth.authorized).toBe(false);
    if (!auth.authorized) {
      expect(auth.reason).toBe('unauthenticated');
    }

    // enforcePlatformPageAccess redirects unauthenticated to staff login with next param
    await expect(enforcePlatformPageAccess('/platform')).rejects.toThrow(
      `NEXT_REDIRECT: ${ROUTES.staff.login}?next=%2Fplatform`,
    );

    // 2. Anonymous user
    verifiedUserMock = { id: 'anon-user-1', is_anonymous: true, email: null };
    auth = await requirePlatformAdmin();
    expect(auth.authorized).toBe(false);
    if (!auth.authorized) {
      expect(auth.reason).toBe('unauthenticated');
    }

    // 3. Authenticated user but NOT in platform_admins (is_platform_admin_user RPC returns false)
    verifiedUserMock = { id: 'regular-user-1', is_anonymous: false, email: 'regular@test.local' };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: false, error: null });

    auth = await requirePlatformAdmin();
    expect(auth.authorized).toBe(false);
    if (!auth.authorized) {
      expect(auth.reason).toBe('forbidden');
    }

    // enforcePlatformPageAccess redirects forbidden users to login with error=forbidden
    mockAdminClient.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(enforcePlatformPageAccess('/platform')).rejects.toThrow(
      `NEXT_REDIRECT: ${ROUTES.staff.login}?error=forbidden`,
    );
  });

  it('platform_guard_requires_aal2', async () => {
    // Authenticated admin user
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false, email: 'admin@platform.local' };
    mockAdminClient.rpc.mockResolvedValue({ data: true, error: null });

    // 1. Assurance level is aal1 (MFA required)
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });

    let auth = await requirePlatformAdmin();
    expect(auth.authorized).toBe(false);
    if (!auth.authorized) {
      expect(auth.reason).toBe('mfa-required');
    }

    // enforcePlatformPageAccess redirects mfa-required to /platform/mfa
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
    await expect(enforcePlatformPageAccess('/platform')).rejects.toThrow(
      `NEXT_REDIRECT: ${ROUTES.platform.mfa}?next=%2Fplatform`,
    );

    // 2. Assurance level is aal2 (fully authorized)
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });

    auth = await requirePlatformAdmin();
    expect(auth.authorized).toBe(true);
    if (auth.authorized) {
      expect(auth.admin.userId).toBe('admin-user-1');
      expect(auth.admin.email).toBe('admin@platform.local');
    }

    // enforcePlatformPageAccess returns admin session
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });
    const session = await enforcePlatformPageAccess('/platform');
    expect(session.userId).toBe('admin-user-1');
  });

  it('mfa_page_sanitizes_redirect_destination_against_open_redirect', async () => {
    // Authenticated admin user at AAL2 level
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false, email: 'admin@platform.local' };
    mockAdminClient.rpc.mockResolvedValue({ data: true, error: null });
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });

    // Helper sanitization checks
    expect(resolveSafeMfaDestination('https://evil.com')).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination('//evil.com')).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination('/\\evil.com')).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination('javascript:alert(1)')).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination(undefined)).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination(null)).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination('')).toBe(ROUTES.platform.root);
    expect(resolveSafeMfaDestination('/platform/tenants/alpha')).toBe(
      '/platform/tenants/alpha',
    );

    // Off-site / protocol-relative open-redirect attempts must safely fall back to ROUTES.platform.root
    await expect(
      PlatformMfaPageDefault({
        searchParams: Promise.resolve({ next: 'https://evil.com' }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT: ${ROUTES.platform.root}`);

    await expect(
      PlatformMfaPageDefault({
        searchParams: Promise.resolve({ next: '//evil.com' }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT: ${ROUTES.platform.root}`);

    await expect(
      PlatformMfaPageDefault({
        searchParams: Promise.resolve({ next: '/\\evil.com' }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT: ${ROUTES.platform.root}`);

    // Legitimate internal relative paths are preserved
    await expect(
      PlatformMfaPageDefault({
        searchParams: Promise.resolve({ next: '/platform/acme-shop' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT: /platform/acme-shop');
  });

  it('create_tenant_route_validates_slug_and_csrf', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false, email: 'admin@platform.local' };
    mockAdminClient.rpc.mockResolvedValue({ data: true, error: null });
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });

    // 1. Cross-origin CSRF blocked
    const crossOriginReq = new Request('http://localhost:3000/api/platform/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.com',
      },
      body: JSON.stringify({ slug: 'valid-slug', name: 'Valid Shop', ownerEmail: 'owner@test.local' }),
    });
    const csrfRes = await createTenantPost(crossOriginReq);
    expect(csrfRes.status).toBe(403);
    const csrfBody = await csrfRes.json();
    expect(csrfBody.ok).toBe(false);
    expect(csrfBody.error).toBe('forbidden');
    expect(csrfRes.headers.get('Cache-Control')).toContain('no-store');

    // 2. Invalid slug format rejected (e.g. UPPERCASE, starts with hyphen, symbols)
    const invalidSlugReq = new Request('http://localhost:3000/api/platform/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ slug: '-INVALID_SLUG-', name: 'Valid Shop', ownerEmail: 'owner@test.local' }),
    });
    const badSlugRes = await createTenantPost(invalidSlugReq);
    expect(badSlugRes.status).toBe(400);
    const badSlugBody = await badSlugRes.json();
    expect(badSlugBody.ok).toBe(false);
    expect(badSlugRes.headers.get('Cache-Control')).toContain('no-store');

    // 3. Valid slug and request -> successfully calls platform_create_tenant RPC
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'platform_create_tenant') {
        return {
          data: {
            result: 'created',
            tenantId: '11111111-1111-1111-1111-111111111111',
            inviteId: '22222222-2222-2222-2222-222222222222',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const validReq = new Request('http://localhost:3000/api/platform/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ slug: 'alpha-cafe', name: 'Alpha Cafe', ownerEmail: 'owner@alpha.local' }),
    });
    const validRes = await createTenantPost(validReq);
    expect(validRes.status).toBe(201);
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);
    expect(validBody.data.result).toBe('created');
    expect(validBody.data.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(validRes.headers.get('Cache-Control')).toContain('no-store');

    // Test with initial owner password
    const validWithPasswordReq = new Request('http://localhost:3000/api/platform/tenants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        slug: 'beta-cafe',
        name: 'Beta Cafe',
        ownerEmail: 'owner@beta.local',
        ownerPassword: 'SecretPassword123!',
      }),
    });
    const withPasswordRes = await createTenantPost(validWithPasswordReq);
    expect(withPasswordRes.status).toBe(201);
    expect(mockAdminClient.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'owner@beta.local',
      password: 'SecretPassword123!',
      email_confirm: true,
    });
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('accept_invite', {
      p_user: 'new-user-1',
      p_invite: '22222222-2222-2222-2222-222222222222',
      p_display_name: 'Beta Cafe',
    });
  });

  it('status_route_requires_reason', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false, email: 'admin@platform.local' };
    mockAdminClient.rpc.mockResolvedValue({ data: true, error: null });
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });

    // Mock tenant lookup in database
    queryResults['tenants'] = {
      data: { id: '11111111-1111-1111-1111-111111111111', slug: 'alpha-cafe', status: 'active' },
      error: null,
    };

    // 1. Missing or too short reason (< 5 chars)
    const shortReasonReq = new Request('http://localhost:3000/api/platform/tenants/alpha-cafe/status', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ status: 'suspended', reason: 'bad' }),
    });
    const shortRes = await tenantStatusPost(shortReasonReq, {
      params: Promise.resolve({ slug: 'alpha-cafe' }),
    });
    expect(shortRes.status).toBe(400);
    const shortBody = await shortRes.json();
    expect(shortBody.ok).toBe(false);
    expect(shortBody.error).toBe('invalid-reason');
    expect(shortRes.headers.get('Cache-Control')).toContain('no-store');

    // 2. Valid reason (>= 5 chars) -> calls set_tenant_status RPC
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'set_tenant_status') return { data: 'updated', error: null };
      return { data: null, error: null };
    });

    const validReq = new Request('http://localhost:3000/api/platform/tenants/alpha-cafe/status', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        status: 'suspended',
        reason: 'Payment overdue by 30 days per policy',
      }),
    });
    const validRes = await tenantStatusPost(validReq, {
      params: Promise.resolve({ slug: 'alpha-cafe' }),
    });
    expect(validRes.status).toBe(200);
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);
    expect(validBody.data.status).toBe('suspended');
    expect(validRes.headers.get('Cache-Control')).toContain('no-store');

    // Verified RPC was called with resolved tenant ID from DB
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'set_tenant_status',
      expect.objectContaining({
        p_actor: 'admin-user-1',
        p_tenant: '11111111-1111-1111-1111-111111111111',
        p_status: 'suspended',
        p_reason: 'Payment overdue by 30 days per policy',
      }),
    );
  });

  it('support_start_route_returns_session_and_never_a_tenant_from_body', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false, email: 'admin@platform.local' };
    mockAdminClient.rpc.mockResolvedValue({ data: true, error: null });
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    });

    // Mock tenant lookup in database for slug 'alpha-cafe'
    queryResults['tenants'] = {
      data: { id: '11111111-1111-1111-1111-111111111111', slug: 'alpha-cafe', name: 'Alpha Cafe' },
      error: null,
    };

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'start_support_session') {
        return {
          data: {
            result: 'started',
            sessionId: '99999999-9999-9999-9999-999999999999',
            expiresAt,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    // Caller maliciously attempts to pass a rogue tenantId in the body
    const rogueBody = {
      action: 'start',
      slug: 'alpha-cafe',
      tenantId: '66666666-6666-6666-6666-666666666666', // rogue tenant ID
      reason: 'Investigating customer reward redemption issue',
    };

    const req = new Request('http://localhost:3000/api/platform/support', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify(rogueBody),
    });

    const res = await supportPost(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sessionId).toBe('99999999-9999-9999-9999-999999999999');
    expect(body.data.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    // Invariant: The RPC was called with the tenant ID resolved from the DB lookup, NEVER the rogue ID from the body
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'start_support_session',
      expect.objectContaining({
        p_admin: 'admin-user-1',
        p_tenant: '11111111-1111-1111-1111-111111111111',
        p_reason: 'Investigating customer reward redemption issue',
      }),
    );
    expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
      'start_support_session',
      expect.objectContaining({
        p_tenant: '66666666-6666-6666-6666-666666666666',
      }),
    );
  });

  it('platform_pages_set_no_store', () => {
    // Platform pages must be force-dynamic so no SSR results are statically cached
    expect(PlatformRootPage.dynamic).toBe('force-dynamic');
    expect(PlatformNewPage.dynamic).toBe('force-dynamic');
    expect(PlatformSlugPage.dynamic).toBe('force-dynamic');
    expect(PlatformSupportPage.dynamic).toBe('force-dynamic');
    expect(PlatformMfaPage.dynamic).toBe('force-dynamic');
  });
});
