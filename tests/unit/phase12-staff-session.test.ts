import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => null,
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
    set: vi.fn(),
  })),
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

let memberRows: unknown[] = [];
let memberError: unknown = null;
const queriedTables: string[] = [];
const eqCalls: Array<[string, unknown]> = [];

function createQuery() {
  const result = () => ({ data: memberRows, error: memberError });
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    }),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject),
  };
  return query;
}

const mockServerClient = {
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    queriedTables.push(table);
    return createQuery();
  }),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ rpc: vi.fn(), from: vi.fn() })),
}));

const ssrClient = {
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn((table: string) => {
    queriedTables.push(table);
    return createQuery();
  }),
};
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ssrClient),
}));

import { POST as switchTenantPost } from '@/app/api/staff/tenant/route';
import { StaffNav } from '@/components/staff/StaffNav';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { requireStaffSession } from '@/lib/auth/staff';
import {
  ROUTES,
  STAFF_TENANT_COOKIE_NAME,
  type StaffSession,
  type StaffSwitchTenantResponse,
} from '@/lib/contracts';
import { updateSession } from '@/lib/supabase/middleware';
import { getVerifiedUser } from '@/lib/supabase/server';
import { NextRequest as RealNextRequest } from 'next/server';

const STAFF_ID = '99999999-9999-4999-8999-999999999999';
const TENANT_A = '7c1f0000-0000-4000-8000-00000000000a';
const TENANT_B = '7c1f0000-0000-4000-8000-00000000000b';
const TENANT_C = '7c1f0000-0000-4000-8000-00000000000c';

function memberRow(
  tenantId: string,
  name: string,
  overrides: { role?: string; status?: string; displayName?: string } = {},
) {
  return {
    tenant_id: tenantId,
    role: overrides.role ?? 'staff',
    display_name: overrides.displayName ?? `Maria at ${name}`,
    tenants: {
      id: tenantId,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      status: overrides.status ?? 'active',
    },
  };
}

function mockSignedInStaff() {
  vi.mocked(getVerifiedUser).mockResolvedValue({
    id: STAFF_ID,
    email: 'barista@example.com',
    is_anonymous: false,
  } as User);
}

function postSwitch(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/staff/tenant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('Phase 12 staff memberships and active shop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    memberRows = [];
    memberError = null;
    queriedTables.length = 0;
    eqCalls.length = 0;
    mockSignedInStaff();
  });

  describe('requireStaffSession', () => {
    it('active_tenant_from_cookie', async () => {
      memberRows = [
        memberRow(TENANT_A, 'Alpha Cafe', { role: 'owner' }),
        memberRow(TENANT_B, 'Beta Bakery', { role: 'manager', displayName: 'Maria B' }),
      ];
      cookieJar.set(STAFF_TENANT_COOKIE_NAME, TENANT_B);

      const result = await requireStaffSession();

      expect(result.authorized).toBe(true);
      if (!result.authorized) return;
      expect(result.staff).toMatchObject({
        userId: STAFF_ID,
        email: 'barista@example.com',
        displayName: 'Maria B',
        role: 'manager',
        active: true,
        tenantId: TENANT_B,
        tenantSlug: 'beta-bakery',
        tenantName: 'Beta Bakery',
      });
      expect(result.staff.memberships.map((m) => m.tenantId)).toEqual([TENANT_A, TENANT_B]);
      expect(queriedTables).toEqual(['tenant_members']);
      expect(eqCalls).toContainEqual(['user_id', STAFF_ID]);
      expect(eqCalls).toContainEqual(['active', true]);
      expect(mockServerClient.rpc).not.toHaveBeenCalled();
    });

    it('stale_tenant_cookie_falls_back', async () => {
      memberRows = [memberRow(TENANT_B, 'Beta Bakery'), memberRow(TENANT_A, 'Alpha Cafe')];
      cookieJar.set(STAFF_TENANT_COOKIE_NAME, TENANT_C);

      const result = await requireStaffSession();

      expect(result.authorized).toBe(true);
      if (!result.authorized) return;
      // First membership by shop name, not by row order.
      expect(result.staff.tenantId).toBe(TENANT_A);
      expect(result.staff.tenantName).toBe('Alpha Cafe');
    });

    it('falls back to the first shop by name when there is no cookie', async () => {
      memberRows = [memberRow(TENANT_B, 'Beta Bakery'), memberRow(TENANT_A, 'Alpha Cafe')];

      const result = await requireStaffSession();

      expect(result.authorized && result.staff.tenantId).toBe(TENANT_A);
    });

    it('excludes closed shops from memberships', async () => {
      memberRows = [
        memberRow(TENANT_A, 'Alpha Cafe', { status: 'closed' }),
        memberRow(TENANT_B, 'Beta Bakery'),
      ];
      cookieJar.set(STAFF_TENANT_COOKIE_NAME, TENANT_A);

      const result = await requireStaffSession();

      expect(result.authorized).toBe(true);
      if (!result.authorized) return;
      expect(result.staff.tenantId).toBe(TENANT_B);
      expect(result.staff.memberships).toHaveLength(1);
    });

    it('no_memberships_forbidden', async () => {
      memberRows = [];
      expect(await requireStaffSession()).toEqual({ authorized: false, reason: 'forbidden' });
    });

    it('is forbidden when only closed shops remain', async () => {
      memberRows = [memberRow(TENANT_A, 'Alpha Cafe', { status: 'closed' })];
      expect(await requireStaffSession()).toEqual({ authorized: false, reason: 'forbidden' });
    });

    it('is forbidden on a database error', async () => {
      memberError = { message: 'boom' };
      expect(await requireStaffSession()).toEqual({ authorized: false, reason: 'forbidden' });
    });

    it('is unauthenticated for signed-out and anonymous users', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);
      expect(await requireStaffSession()).toEqual({
        authorized: false,
        reason: 'unauthenticated',
      });
      vi.mocked(getVerifiedUser).mockResolvedValue({ id: STAFF_ID, is_anonymous: true } as User);
      expect(await requireStaffSession()).toEqual({
        authorized: false,
        reason: 'unauthenticated',
      });
    });
  });

  describe('POST /api/staff/tenant', () => {
    beforeEach(() => {
      memberRows = [memberRow(TENANT_A, 'Alpha Cafe'), memberRow(TENANT_B, 'Beta Bakery')];
    });

    it('switch_tenant_rejects_non_member', async () => {
      const res = await switchTenantPost(postSwitch({ tenantId: TENANT_C }));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error: 'forbidden' });
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('switch_tenant_sets_cookie', async () => {
      const res = await switchTenantPost(postSwitch({ tenantId: TENANT_B }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: true; data: StaffSwitchTenantResponse };
      expect(body).toEqual({
        ok: true,
        data: { tenantId: TENANT_B, tenantSlug: 'beta-bakery' },
      });

      const cookie = res.cookies.get(STAFF_TENANT_COOKIE_NAME);
      expect(cookie).toMatchObject({
        name: STAFF_TENANT_COOKIE_NAME,
        value: TENANT_B,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
    });

    it('rejects cross-origin requests before reading the session', async () => {
      const res = await switchTenantPost(
        postSwitch({ tenantId: TENANT_B }, { 'sec-fetch-site': 'cross-site' }),
      );
      expect(res.status).toBe(403);
      expect(getVerifiedUser).not.toHaveBeenCalled();
    });

    it('rejects an invalid body', async () => {
      const res = await switchTenantPost(postSwitch({ tenantId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, error: 'invalid_input' });
    });

    it('requires a staff session', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);
      const res = await switchTenantPost(postSwitch({ tenantId: TENANT_B }));
      expect(res.status).toBe(401);
    });
  });

  describe('middleware', () => {
    function staffRequest() {
      return new RealNextRequest('http://localhost:3000/staff/redeem') as NextRequest;
    }

    it('middleware_uses_memberships_not_is_staff', async () => {
      ssrClient.auth.getUser.mockResolvedValue({
        data: { user: { id: STAFF_ID, is_anonymous: false } },
      });
      memberRows = [{ tenant_id: TENANT_A }];

      const res = await updateSession(staffRequest());

      expect(res.status).toBe(200);
      expect(ssrClient.rpc).not.toHaveBeenCalled();
      expect(queriedTables).toEqual(['tenant_members']);
      expect(eqCalls).toContainEqual(['user_id', STAFF_ID]);
      expect(eqCalls).toContainEqual(['active', true]);
    });

    it('redirects a signed-in user without memberships to login?error=forbidden', async () => {
      ssrClient.auth.getUser.mockResolvedValue({
        data: { user: { id: STAFF_ID, is_anonymous: false } },
      });
      memberRows = [];

      const res = await updateSession(staffRequest());

      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.pathname).toBe(ROUTES.staff.login);
      expect(location.searchParams.get('error')).toBe('forbidden');
    });

    it('redirects anonymous users to login with next', async () => {
      ssrClient.auth.getUser.mockResolvedValue({
        data: { user: { id: STAFF_ID, is_anonymous: true } },
      });

      const res = await updateSession(staffRequest());

      expect(res.status).toBe(303);
      expect(new URL(res.headers.get('location') ?? '').searchParams.get('next')).toBe(
        '/staff/redeem',
      );
      expect(queriedTables).toEqual([]);
    });
  });

  describe('StaffNav shop switcher', () => {
    function session(memberships: StaffSession['memberships']): StaffSession {
      return {
        userId: STAFF_ID,
        email: null,
        displayName: 'Maria',
        role: 'staff',
        active: true,
        tenantId: TENANT_A,
        tenantSlug: 'alpha-cafe',
        tenantName: 'Alpha Cafe',
        memberships,
      };
    }
    const alpha = { tenantId: TENANT_A, tenantSlug: 'alpha-cafe', tenantName: 'Alpha Cafe', role: 'staff' as const };
    const beta = { tenantId: TENANT_B, tenantSlug: 'beta-bakery', tenantName: 'Beta Bakery', role: 'staff' as const };

    it('hides the switcher with a single membership', () => {
      const html = renderToStaticMarkup(
        React.createElement(StaffNav, { staff: session([alpha]), currentPath: ROUTES.staff.root }),
      );
      expect(html).not.toContain('<select');
    });

    it('shows the active shop name in the page shell', () => {
      const html = renderToStaticMarkup(
        React.createElement(StaffPageShell, {
          staff: session([alpha]),
          currentPath: ROUTES.staff.root,
          title: 'Overview',
          description: 'd',
          headerLabel: 'h',
          children: null,
        }),
      );
      expect(html).toContain('Alpha Cafe');
    });

    it('shows a labelled Shop select with several memberships', () => {
      const html = renderToStaticMarkup(
        React.createElement(StaffNav, {
          staff: session([alpha, beta]),
          currentPath: ROUTES.staff.root,
        }),
      );
      expect(html).toContain('<select');
      expect(html).toContain('Shop');
      expect(html).toContain('Beta Bakery');
    });
  });
});
