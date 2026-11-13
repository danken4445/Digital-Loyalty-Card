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
  usePathname: () => null,
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT: ${url}`);
    (error as any).digest = `NEXT_REDIRECT;replace;${url};307;`;
    (error as any).url = url;
    throw error;
  }),
}));

// Mock next/headers cookies (the active-shop cookie is read by requireStaffSession)
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
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
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

const mockServerClient = {
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
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

// Import modules under test
import {
  decorateTagWithUrls,
  detectActivityAnomalies,
  enforceStaffPageAccess,
  generateRandomTagId,
  getStaffActivityDashboardData,
  getStaffTagsList,
  logStaffAuditEvent,
  requireStaffSession,
} from '@/lib/auth/staff';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getVerifiedUser } from '@/lib/supabase/server';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import {
  ROUTES,
  TENANT_ONE_ID,
  TENANT_ONE_SLUG,
  type AuditLogRow,
  type RedemptionRow,
  type StaffSession,
  type StampRow,
  type TagRow,
  type TagWithUrls,
} from '@/lib/contracts';
import { POST as staffRedeemPost } from '@/app/api/staff/redeem/route';
import { POST as staffStampPost } from '@/app/api/staff/stamp/route';
import { GET as staffTagsGet, POST as staffTagsPost } from '@/app/api/staff/tags/route';

// UI components & pages
import { StaffNav } from '@/components/staff/StaffNav';
import { StaffLoginForm } from '@/components/staff/StaffLoginForm';
import { RedeemRewardForm } from '@/components/staff/RedeemRewardForm';
import { ManualStampForm } from '@/components/staff/ManualStampForm';
import StaffOverviewPage from '@/app/staff/page';
import StaffRedeemPage from '@/app/staff/redeem/page';
import StaffManualStampPage from '@/app/staff/stamp/page';
import StaffTagsPage from '@/app/staff/tags/page';
import StaffActivityPage from '@/app/staff/activity/page';
import StaffLoginPage from '@/app/staff/login/page';

const TEST_STAFF_ID = '99999999-9999-9999-9999-999999999999';
const TEST_CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_CUSTOMER_ID_2 = '22222222-2222-2222-2222-222222222222';
const TENANT_RULES = { dailyCap: 2, timezone: 'Asia/Manila' };

/** Raw tenants row (with embedded tenant_settings) as read by getTenantById. */
function tenantRow() {
  return {
    id: TENANT_ONE_ID,
    slug: TENANT_ONE_SLUG,
    name: 'The Caffeine Plug',
    status: 'active',
    tenant_settings: {
      cooldown_minutes: 30,
      daily_cap: 2,
      reward_threshold: 10,
      tag_throttle_seconds: 5,
      timezone: 'Asia/Manila',
      currency: 'PHP',
      reward_label: 'FREE COFFEE',
      brand: {},
      perks: {},
    },
  };
}

function membershipRow(
  role: 'staff' | 'owner' | 'manager' = 'staff',
  overrides: { status?: string; displayName?: string } = {},
) {
  return {
    tenant_id: TENANT_ONE_ID,
    role,
    display_name: overrides.displayName ?? 'Maria Barista',
    tenants: {
      id: TENANT_ONE_ID,
      slug: TENANT_ONE_SLUG,
      name: 'The Caffeine Plug',
      status: overrides.status ?? 'active',
    },
  };
}

function mockActiveStaff(role: 'staff' | 'owner' = 'staff') {
  vi.mocked(getVerifiedUser).mockResolvedValue({
    id: TEST_STAFF_ID,
    email: 'barista@thecaffeineplug.ph',
    is_anonymous: false,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  } as User);

  tableQueryHandlers['tenant_members'] = () => createMockSupabaseQuery([membershipRow(role)], null);
}

function mockUnauthenticated() {
  vi.mocked(getVerifiedUser).mockResolvedValue(null);
}

function mockAnonymousCustomer() {
  vi.mocked(getVerifiedUser).mockResolvedValue({
    id: TEST_CUSTOMER_ID,
    is_anonymous: true,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  } as User);
}

function mockNonStaffUser() {
  vi.mocked(getVerifiedUser).mockResolvedValue({
    id: TEST_CUSTOMER_ID,
    email: 'customer@gmail.com',
    is_anonymous: false,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  } as User);

  tableQueryHandlers['tenant_members'] = () => createMockSupabaseQuery([], null);
}

describe('Phase 5 Staff Area Unit & Authorization Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;
    tableQueryHandlers = {};
    tableQueryHandlers['tenants'] = () => createMockSupabaseQuery(tenantRow(), null);
    cookieJar.clear();

    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetMs: 60_000,
    });

    mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
      if (rpcName === 'log_audit_event') {
        return { data: 'audit-event-uuid-1', error: null };
      }
      if (rpcName === 'redeem_card_reward') {
        return { data: 'redeemed', error: null };
      }
      if (rpcName === 'stamp_card_manual') {
        return { data: 'stamped', error: null };
      }
      return { data: null, error: null };
    });

    // Default to active staff session
    mockActiveStaff();
  });

  afterEach(() => {
    process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;
  });

  // ============================================================================
  // 1. lib/auth/staff.ts
  // ============================================================================
  describe('1. lib/auth/staff.ts: Unit & Authorization Logic', () => {
    describe('requireStaffSession()', () => {
      it('returns unauthenticated when getVerifiedUser() returns null', async () => {
        mockUnauthenticated();
        const result = await requireStaffSession();
        expect(result).toEqual({
          authorized: false,
          reason: 'unauthenticated',
        });
      });

      it('returns unauthenticated when user.is_anonymous === true', async () => {
        mockAnonymousCustomer();
        const result = await requireStaffSession();
        expect(result).toEqual({
          authorized: false,
          reason: 'unauthenticated',
        });
      });

      it('returns forbidden when the user has no active tenant memberships', async () => {
        mockNonStaffUser();
        const result = await requireStaffSession();
        expect(result).toEqual({
          authorized: false,
          reason: 'forbidden',
        });
      });

      it('returns forbidden when the tenant_members query encounters a database error', async () => {
        vi.mocked(getVerifiedUser).mockResolvedValue({
          id: TEST_STAFF_ID,
          email: 'barista@thecaffeineplug.ph',
          is_anonymous: false,
        } as User);

        tableQueryHandlers['tenant_members'] = () =>
          createMockSupabaseQuery(null, { message: 'query execution failed' });

        const result = await requireStaffSession();
        expect(result).toEqual({
          authorized: false,
          reason: 'forbidden',
        });
      });

      it('no longer consults the legacy is_staff RPC or public.staff table', async () => {
        mockActiveStaff('staff');
        await requireStaffSession();
        expect(mockServerClient.rpc).not.toHaveBeenCalled();
        expect(mockServerClient.from).not.toHaveBeenCalledWith('staff');
      });

      it('only queries active memberships of the signed-in user', async () => {
        mockActiveStaff('staff');
        const query = createMockSupabaseQuery([membershipRow('staff')], null);
        tableQueryHandlers['tenant_members'] = () => query;

        await requireStaffSession();

        expect(query.eq).toHaveBeenCalledWith('user_id', TEST_STAFF_ID);
        expect(query.eq).toHaveBeenCalledWith('active', true);
      });

      it('returns forbidden when the only membership belongs to a closed shop', async () => {
        vi.mocked(getVerifiedUser).mockResolvedValue({
          id: TEST_STAFF_ID,
          email: 'barista@thecaffeineplug.ph',
          is_anonymous: false,
        } as User);

        tableQueryHandlers['tenant_members'] = () =>
          createMockSupabaseQuery([membershipRow('staff', { status: 'closed' })], null);

        const result = await requireStaffSession();
        expect(result).toEqual({
          authorized: false,
          reason: 'forbidden',
        });
      });

      it('returns authorized true with staff session payload for active staff member', async () => {
        mockActiveStaff('staff');
        const result = await requireStaffSession();

        expect(result.authorized).toBe(true);
        if (result.authorized) {
          expect(result.staff).toEqual({
            userId: TEST_STAFF_ID,
            email: 'barista@thecaffeineplug.ph',
            displayName: 'Maria Barista',
            role: 'staff',
            active: true,
            tenantId: TENANT_ONE_ID,
            tenantSlug: TENANT_ONE_SLUG,
            tenantName: 'The Caffeine Plug',
            memberships: [
              {
                tenantId: TENANT_ONE_ID,
                tenantSlug: TENANT_ONE_SLUG,
                tenantName: 'The Caffeine Plug',
                role: 'staff',
              },
            ],
          });
        }
      });

      it('handles staff account with null email gracefully', async () => {
        vi.mocked(getVerifiedUser).mockResolvedValue({
          id: TEST_STAFF_ID,
          email: undefined,
          is_anonymous: false,
        } as User);

        tableQueryHandlers['tenant_members'] = () =>
          createMockSupabaseQuery([membershipRow('owner', { displayName: 'Owner Bob' })], null);

        const result = await requireStaffSession();
        expect(result.authorized).toBe(true);
        if (result.authorized) {
          expect(result.staff.email).toBeNull();
          expect(result.staff.role).toBe('owner');
        }
      });
    });

    describe('enforceStaffPageAccess()', () => {
      it('redirects unauthenticated caller to /staff/login?next=...', async () => {
        mockUnauthenticated();
        await expect(enforceStaffPageAccess('/staff/redeem')).rejects.toThrow(
          'NEXT_REDIRECT: /staff/login?next=%2Fstaff%2Fredeem',
        );
      });

      it('redirects non-staff user to /staff/login?error=forbidden', async () => {
        mockNonStaffUser();
        await expect(enforceStaffPageAccess('/staff/activity')).rejects.toThrow(
          'NEXT_REDIRECT: /staff/login?error=forbidden',
        );
      });

      it('returns staff session without redirecting when caller is authorized', async () => {
        mockActiveStaff('owner');
        const session = await enforceStaffPageAccess('/staff');
        expect(session.userId).toBe(TEST_STAFF_ID);
        expect(session.role).toBe('owner');
      });
    });

    describe('generateRandomTagId()', () => {
      it('matches regex pattern /^tcp_tag_[0-9a-z]{16}$/', () => {
        const tagPattern = /^tcp_tag_[0-9a-z]{16}$/;
        for (let i = 0; i < 20; i++) {
          const id = generateRandomTagId();
          expect(id).toMatch(tagPattern);
        }
      });

      it('generates 50 unique, non-colliding tag IDs in 50 calls', () => {
        const set = new Set<string>();
        for (let i = 0; i < 50; i++) {
          set.add(generateRandomTagId());
        }
        expect(set.size).toBe(50);
      });
    });

    describe('decorateTagWithUrls()', () => {
      it('decorates TagRow with production and local dev tap URLs', () => {
        const tag: TagRow = {
          id: 'tcp_tag_test_counter_1',
          label: 'Counter Barista Tag 1',
          active: true,
          created_at: '2026-11-01T10:00:00Z',
          deactivated_at: null,
        };

        const decorated = decorateTagWithUrls(tag);
        expect(decorated.productionTapUrl).toBe('http://localhost:3000/t/tcp_tag_test_counter_1');
        expect(decorated.localTapUrl).toBe('http://localhost:3000/t/tcp_tag_test_counter_1');
        expect(decorated.id).toBe(tag.id);
        expect(decorated.label).toBe(tag.label);
      });

      it('properly encodes special URI characters in tag identifier', () => {
        const tag: TagRow = {
          id: 'tcp_tag_hello/world?foo=bar#1',
          label: 'Special Tag',
          active: true,
          created_at: '2026-11-01T10:00:00Z',
          deactivated_at: null,
        };

        const decorated = decorateTagWithUrls(tag);
        expect(decorated.productionTapUrl).toBe(
          `http://localhost:3000/t/${encodeURIComponent(tag.id)}`,
        );
      });
    });

    describe('logStaffAuditEvent()', () => {
      it('records audit event via service_role RPC and returns generated audit id', async () => {
        mockAdminClient.rpc.mockResolvedValueOnce({
          data: 'audit-id-uuid-5555',
          error: null,
        });

        const id = await logStaffAuditEvent({
          actorId: TEST_STAFF_ID,
          action: 'tag_created',
          target: 'tcp_tag_123',
          detail: { label: 'Front Register' },
        });

        expect(id).toBe('audit-id-uuid-5555');
        expect(mockAdminClient.rpc).toHaveBeenCalledWith('log_audit_event', {
          p_actor: TEST_STAFF_ID,
          p_action: 'tag_created',
          p_target: 'tcp_tag_123',
          p_detail: { label: 'Front Register' },
        });
      });

      it('throws descriptive error when log_audit_event RPC fails', async () => {
        mockAdminClient.rpc.mockResolvedValueOnce({
          data: null,
          error: { message: 'Database connection dropped' },
        });

        await expect(
          logStaffAuditEvent({
            actorId: TEST_STAFF_ID,
            action: 'tag_created',
          }),
        ).rejects.toThrow(
          'Failed to record staff audit event "tag_created": Database connection dropped',
        );
      });
    });

    describe('detectActivityAnomalies()', () => {
      it('returns empty array [] for normal activity below all thresholds', () => {
        const stamps: StampRow[] = [
          {
            id: 's1',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag_counter',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-01T08:00:00Z',
          },
        ];

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs: [],
        }, TENANT_RULES);

        expect(anomalies).toEqual([]);
      });

      it('detects repeated-daily-cap anomaly when customer hits 2 NFC stamps across 2 Manila days', () => {
        const stamps: StampRow[] = [
          // Day 1: 2 NFC stamps
          {
            id: 's1',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-01T02:00:00Z',
          },
          {
            id: 's2',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-01T06:00:00Z',
          },
          // Day 2: 2 NFC stamps
          {
            id: 's3',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-02T02:00:00Z',
          },
          {
            id: 's4',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-02T06:00:00Z',
          },
        ];

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs: [],
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('repeated-daily-cap');
        expect(anomalies[0]!.severity).toBe('warning');
        expect(anomalies[0]!.targetId).toBe(TEST_CUSTOMER_ID);
        expect(anomalies[0]!.description).toContain(
          'reached the 2-stamp daily cap on 2 recent day(s)',
        );
      });

      it('detects repeated-daily-cap with high severity when customer has cap day + >= 3 rejections', () => {
        const stamps: StampRow[] = [
          {
            id: 's1',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-01T02:00:00Z',
          },
          {
            id: 's2',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-01T06:00:00Z',
          },
        ];

        const auditLogs: AuditLogRow[] = [
          {
            id: 'a1',
            actor: TEST_CUSTOMER_ID,
            action: 'stamp_rejected_daily_limit',
            target: TEST_CUSTOMER_ID,
            detail: null,
            created_at: '2026-11-01T07:00:00Z',
          },
          {
            id: 'a2',
            actor: TEST_CUSTOMER_ID,
            action: 'stamp_rejected_cooldown',
            target: TEST_CUSTOMER_ID,
            detail: null,
            created_at: '2026-11-01T07:05:00Z',
          },
          {
            id: 'a3',
            actor: TEST_CUSTOMER_ID,
            action: 'stamp_rejected_daily_limit',
            target: TEST_CUSTOMER_ID,
            detail: null,
            created_at: '2026-11-01T07:10:00Z',
          },
        ];

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs,
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('repeated-daily-cap');
        expect(anomalies[0]!.severity).toBe('high');
        expect(anomalies[0]!.description).toContain('3 blocked tap attempt(s)');
      });

      it('detects repeated-daily-cap from >= 3 rejection audit logs alone even without cap days', () => {
        const auditLogs: AuditLogRow[] = [
          {
            id: 'a1',
            actor: TEST_CUSTOMER_ID,
            action: 'stamp_rejected_cooldown',
            target: TEST_CUSTOMER_ID,
            detail: null,
            created_at: '2026-11-01T07:00:00Z',
          },
          {
            id: 'a2',
            actor: TEST_CUSTOMER_ID,
            action: 'stamp_rejected_cooldown',
            target: TEST_CUSTOMER_ID,
            detail: null,
            created_at: '2026-11-01T07:05:00Z',
          },
          {
            id: 'a3',
            actor: TEST_CUSTOMER_ID,
            action: 'stamp_rejected_cooldown',
            target: TEST_CUSTOMER_ID,
            detail: null,
            created_at: '2026-11-01T07:10:00Z',
          },
        ];

        const anomalies = detectActivityAnomalies({
          stamps: [],
          redemptions: [],
          auditLogs,
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('repeated-daily-cap');
        expect(anomalies[0]!.severity).toBe('high');
        expect(anomalies[0]!.title).toBe('Repeated Blocked Tap Attempts');
      });

      it('detects high-tag-volume anomaly when tag records >= 10 stamps', () => {
        const stamps: StampRow[] = Array.from({ length: 12 }, (_, i) => ({
          id: `s-${i}`,
          customer_id: `cust-${i}`,
          tag_id: 'tag_front_counter',
          source: 'nfc',
          staff_id: null,
          reason: null,
          created_at: '2026-11-01T08:00:00Z',
        }));

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs: [],
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('high-tag-volume');
        expect(anomalies[0]!.severity).toBe('warning');
        expect(anomalies[0]!.targetId).toBe('tag_front_counter');
        expect(anomalies[0]!.description).toContain('12 recent stamp(s)');
      });

      it('detects high-tag-volume with high severity when tag records >= 20 stamps', () => {
        const stamps: StampRow[] = Array.from({ length: 22 }, (_, i) => ({
          id: `s-${i}`,
          customer_id: `cust-${i}`,
          tag_id: 'tag_busy',
          source: 'nfc',
          staff_id: null,
          reason: null,
          created_at: '2026-11-01T08:00:00Z',
        }));

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs: [],
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('high-tag-volume');
        expect(anomalies[0]!.severity).toBe('high');
      });

      it('detects high-tag-volume with high severity when tag triggers >= 3 tag_throttled events', () => {
        const auditLogs: AuditLogRow[] = [
          {
            id: 't1',
            actor: null,
            action: 'stamp_rejected_tag_throttled',
            target: 'tag_spammed',
            detail: null,
            created_at: '2026-11-01T08:00:01Z',
          },
          {
            id: 't2',
            actor: null,
            action: 'stamp_rejected_tag_throttled',
            target: 'tag_spammed',
            detail: null,
            created_at: '2026-11-01T08:00:02Z',
          },
          {
            id: 't3',
            actor: null,
            action: 'stamp_rejected_tag_throttled',
            target: 'tag_spammed',
            detail: null,
            created_at: '2026-11-01T08:00:03Z',
          },
        ];

        const anomalies = detectActivityAnomalies({
          stamps: [],
          redemptions: [],
          auditLogs,
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('high-tag-volume');
        expect(anomalies[0]!.severity).toBe('high');
        expect(anomalies[0]!.targetId).toBe('tag_spammed');
      });

      it('detects frequent-manual-stamps when customer receives >= 3 manual stamps', () => {
        const stamps: StampRow[] = [
          {
            id: 'm1',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: null,
            source: 'manual',
            staff_id: TEST_STAFF_ID,
            reason: 'NFC antenna damaged',
            created_at: '2026-11-01T08:00:00Z',
          },
          {
            id: 'm2',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: null,
            source: 'manual',
            staff_id: TEST_STAFF_ID,
            reason: 'iPhone 8 NFC issue',
            created_at: '2026-11-01T09:00:00Z',
          },
          {
            id: 'm3',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: null,
            source: 'manual',
            staff_id: TEST_STAFF_ID,
            reason: 'Customer receipt verified',
            created_at: '2026-11-01T10:00:00Z',
          },
        ];

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs: [],
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('frequent-manual-stamps');
        expect(anomalies[0]!.severity).toBe('warning');
        expect(anomalies[0]!.targetId).toBe(TEST_CUSTOMER_ID);
        expect(anomalies[0]!.description).toContain('received 3 manual staff stamps');
      });

      it('detects frequent-manual-stamps with high severity when customer receives >= 5 manual stamps', () => {
        const stamps: StampRow[] = Array.from({ length: 5 }, (_, i) => ({
          id: `m-${i}`,
          customer_id: TEST_CUSTOMER_ID,
          tag_id: null,
          source: 'manual',
          staff_id: TEST_STAFF_ID,
          reason: 'Manual override',
          created_at: '2026-11-01T08:00:00Z',
        }));

        const anomalies = detectActivityAnomalies({
          stamps,
          redemptions: [],
          auditLogs: [],
        }, TENANT_RULES);

        expect(anomalies).toHaveLength(1);
        expect(anomalies[0]!.category).toBe('frequent-manual-stamps');
        expect(anomalies[0]!.severity).toBe('high');
      });
    });

    describe('getStaffActivityDashboardData() & getStaffTagsList()', () => {
      it('fetches last 50 stamps, redemptions, audit logs, and computes anomalies', async () => {
        const sampleStamps = [
          {
            id: 's1',
            customer_id: TEST_CUSTOMER_ID,
            tag_id: 'tag1',
            source: 'nfc',
            staff_id: null,
            reason: null,
            created_at: '2026-11-01T10:00:00Z',
          },
        ];
        const sampleRedemptions = [
          {
            id: 'r1',
            customer_id: TEST_CUSTOMER_ID,
            stamps_used: 10,
            staff_id: TEST_STAFF_ID,
            created_at: '2026-11-01T11:00:00Z',
          },
        ];
        const sampleAudit = [
          {
            id: 'a1',
            actor: TEST_STAFF_ID,
            action: 'staff_redeem_token_used',
            target: 'nonce-1',
            detail: null,
            created_at: '2026-11-01T11:00:01Z',
          },
        ];

        tableQueryHandlers['stamps'] = () => createMockSupabaseQuery(sampleStamps, null);
        tableQueryHandlers['redemptions'] = () => createMockSupabaseQuery(sampleRedemptions, null);
        tableQueryHandlers['audit_log'] = () => createMockSupabaseQuery(sampleAudit, null);

        const data = await getStaffActivityDashboardData();
        expect(data.stamps).toEqual(sampleStamps);
        expect(data.redemptions).toEqual(sampleRedemptions);
        expect(data.auditLogs).toEqual(sampleAudit);
        expect(Array.isArray(data.anomalies)).toBe(true);
      });

      it('fetches tags list and returns decorated tags with NTAG215 tap URLs', async () => {
        const sampleTags: TagRow[] = [
          {
            id: 'tcp_tag_counter_1',
            label: 'Counter Tag',
            active: true,
            created_at: '2026-11-01T10:00:00Z',
            deactivated_at: null,
          },
        ];

        tableQueryHandlers['tags'] = () => createMockSupabaseQuery(sampleTags, null);

        const tagsWithUrls = await getStaffTagsList();
        expect(tagsWithUrls).toHaveLength(1);
        expect(tagsWithUrls[0]!.id).toBe('tcp_tag_counter_1');
        expect(tagsWithUrls[0]!.productionTapUrl).toBe('http://localhost:3000/t/tcp_tag_counter_1');
        expect(tagsWithUrls[0]!.localTapUrl).toBe('http://localhost:3000/t/tcp_tag_counter_1');
      });
    });
  });

  // ============================================================================
  // 2. POST /api/staff/redeem
  // ============================================================================
  describe('2. POST /api/staff/redeem: Staff Redemption Route Handler', () => {
    function makeRedeemRequest(body: any, rawText?: string) {
      if (rawText !== undefined) {
        return new Request('http://localhost:3000/api/staff/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawText,
        });
      }
      return new Request('http://localhost:3000/api/staff/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('rejects unauthenticated caller with 401', async () => {
      mockUnauthenticated();
      const res = await staffRedeemPost(makeRedeemRequest({ action: 'preview', token: 'dummy' }));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('unauthenticated');
    });

    it('rejects non-staff user with 403', async () => {
      mockNonStaffUser();
      const res = await staffRedeemPost(makeRedeemRequest({ action: 'preview', token: 'dummy' }));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('forbidden');
    });

    it('enforces rate limiting with 429 when rate limit exceeded', async () => {
      vi.mocked(checkPublicEndpointRateLimit).mockResolvedValueOnce({
        allowed: false,
        limit: 30,
        remaining: 0,
        resetMs: 60_000,
      });

      const res = await staffRedeemPost(makeRedeemRequest({ action: 'preview', token: 'dummy' }));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('rate_limited');
    });

    it('rejects malformed JSON body with 400', async () => {
      const res = await staffRedeemPost(makeRedeemRequest(null, '{ malformed json'));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
    });

    it('rejects invalid action or missing token with 400', async () => {
      const resInvalidAction = await staffRedeemPost(
        makeRedeemRequest({ action: 'destroy', token: 'dummy' }),
      );
      expect(resInvalidAction.status).toBe(400);

      const resMissingToken = await staffRedeemPost(makeRedeemRequest({ action: 'preview' }));
      expect(resMissingToken.status).toBe(400);
    });

    it('rejects tampered or malformed HMAC token (400 on preview, 200 invalid-token on confirm)', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);
      const tamperedToken = `${issued.token.slice(0, -6)}XXXXXX`;

      // Preview: 400
      const previewRes = await staffRedeemPost(
        makeRedeemRequest({ action: 'preview', token: tamperedToken }),
      );
      expect(previewRes.status).toBe(400);
      const previewJson = await previewRes.json();
      expect(previewJson.ok).toBe(false);
      expect(previewJson.message).toBe('Invalid redemption QR token.');

      // Confirm: 200 with result: 'invalid-token'
      const confirmRes = await staffRedeemPost(
        makeRedeemRequest({ action: 'confirm', token: tamperedToken }),
      );
      expect(confirmRes.status).toBe(200);
      const confirmJson = await confirmRes.json();
      expect(confirmJson.ok).toBe(true);
      expect(confirmJson.data.result).toBe('invalid-token');
      expect(confirmJson.data.message).toBe('Invalid redemption QR token.');
    });

    it('rejects expired HMAC token (400 on preview, 200 expired-token on confirm)', async () => {
      // Issue token with valid structure (exp > iat) but in the past (iat = now - 400s, exp = now - 100s)
      const expiredIssued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID, {
        nowMs: Date.now() - 400_000,
        ttlSeconds: 300,
      });

      // Preview: 400
      const previewRes = await staffRedeemPost(
        makeRedeemRequest({ action: 'preview', token: expiredIssued.token }),
      );
      expect(previewRes.status).toBe(400);
      const previewJson = await previewRes.json();
      expect(previewJson.ok).toBe(false);
      expect(previewJson.message).toBe('Redemption QR token has expired.');

      // Confirm: 200 with result: 'expired-token'
      const confirmRes = await staffRedeemPost(
        makeRedeemRequest({ action: 'confirm', token: expiredIssued.token }),
      );
      expect(confirmRes.status).toBe(200);
      const confirmJson = await confirmRes.json();
      expect(confirmJson.ok).toBe(true);
      expect(confirmJson.data.result).toBe('expired-token');
      expect(confirmJson.data.message).toBe('Redemption QR token has expired.');
    });

    it('enforces single-use token: rejects replayed token when audit_log contains staff_redeem_token_used for target=nonce', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

      // Mock audit_log containing existing row for nonce
      tableQueryHandlers['audit_log'] = () =>
        createMockSupabaseQuery({ id: 'used-audit-log-uuid' }, null);

      // Preview: 400
      const previewRes = await staffRedeemPost(
        makeRedeemRequest({ action: 'preview', token: issued.token }),
      );
      expect(previewRes.status).toBe(400);
      const previewJson = await previewRes.json();
      expect(previewJson.ok).toBe(false);
      expect(previewJson.message).toBe('This redemption QR token has already been used.');

      // Confirm: 200 with result: 'invalid-token'
      const confirmRes = await staffRedeemPost(
        makeRedeemRequest({ action: 'confirm', token: issued.token }),
      );
      expect(confirmRes.status).toBe(200);
      const confirmJson = await confirmRes.json();
      expect(confirmJson.ok).toBe(true);
      expect(confirmJson.data.result).toBe('invalid-token');
      expect(confirmJson.data.message).toBe('This redemption QR token has already been used.');
    });

    it('succeeds on preview: returns canRedeem true when customer has 10 stamps', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

      // audit_log: not used
      tableQueryHandlers['audit_log'] = () => createMockSupabaseQuery(null, null);

      // customer_balances: 10 stamps
      tableQueryHandlers['card_balances'] = () =>
        createMockSupabaseQuery(
          {
            customer_id: TEST_CUSTOMER_ID,
            available_stamps: 10,
            total_stamps: 15,
            stamps_redeemed: 5,
            last_stamped_at: '2026-11-01T10:00:00Z',
          },
          null,
        );

      const res = await staffRedeemPost(
        makeRedeemRequest({ action: 'preview', token: issued.token }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.mode).toBe('preview');
      expect(json.data.canRedeem).toBe(true);
      expect(json.data.availableStamps).toBe(10);
      expect(json.data.totalStamps).toBe(15);
      expect(json.data.stampsRedeemed).toBe(5);
      expect(json.data.displayCode).toBe(issued.displayCode);
    });

    it('succeeds on preview: returns canRedeem false when customer has 9 stamps', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

      tableQueryHandlers['audit_log'] = () => createMockSupabaseQuery(null, null);
      tableQueryHandlers['card_balances'] = () =>
        createMockSupabaseQuery(
          {
            customer_id: TEST_CUSTOMER_ID,
            available_stamps: 9,
            total_stamps: 9,
            stamps_redeemed: 0,
            last_stamped_at: '2026-11-01T10:00:00Z',
          },
          null,
        );

      const res = await staffRedeemPost(
        makeRedeemRequest({ action: 'preview', token: issued.token }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.mode).toBe('preview');
      expect(json.data.canRedeem).toBe(false);
      expect(json.data.availableStamps).toBe(9);
    });

    it('succeeds on confirm: calls redeem_card_reward RPC with the active shop, customer and staff, and returns result: redeemed', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

      tableQueryHandlers['audit_log'] = () => createMockSupabaseQuery(null, null);

      // Customer balance after deduction: 0 stamps
      tableQueryHandlers['card_balances'] = () =>
        createMockSupabaseQuery(
          {
            available_stamps: 0,
          },
          null,
        );

      mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
        if (rpcName === 'redeem_card_reward') {
          expect(args.p_customer).toBe(TEST_CUSTOMER_ID);
          expect(args.p_actor).toBe(TEST_STAFF_ID);
          expect(args.p_tenant).toBe(TENANT_ONE_ID);
          expect(args.p_nonce).toBe(issued.payload.nonce);
          return { data: 'redeemed', error: null };
        }
        return { data: null, error: null };
      });

      const res = await staffRedeemPost(
        makeRedeemRequest({ action: 'confirm', token: issued.token }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.mode).toBe('confirm');
      expect(json.data.result).toBe('redeemed');
      expect(json.data.availableStampsAfter).toBe(0);
      expect(json.data.message).toBe('FREE COFFEE redeemed successfully! 10 stamps deducted.');
      // The SQL function writes the redemption audit rows; the route makes no separate audit RPC
      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('log_audit_event', expect.anything());
    });

    it('handles confirm when redeem_card_reward returns insufficient-stamps', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

      tableQueryHandlers['audit_log'] = () => createMockSupabaseQuery(null, null);
      tableQueryHandlers['card_balances'] = () =>
        createMockSupabaseQuery({ available_stamps: 8 }, null);

      mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
        if (rpcName === 'redeem_card_reward') {
          return { data: 'insufficient-stamps', error: null };
        }
        return { data: null, error: null };
      });

      const res = await staffRedeemPost(
        makeRedeemRequest({ action: 'confirm', token: issued.token }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.result).toBe('insufficient-stamps');
      expect(json.data.message).toBe('Customer does not have enough stamps (10 required).');
    });

    it('returns 500 when redeem_card_reward RPC fails', async () => {
      const issued = await issueRedeemToken(TEST_CUSTOMER_ID, TENANT_ONE_ID);

      tableQueryHandlers['audit_log'] = () => createMockSupabaseQuery(null, null);

      mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
        if (rpcName === 'redeem_card_reward') {
          return { data: null, error: { message: 'Database transaction lock failed' } };
        }
        return { data: null, error: null };
      });

      const res = await staffRedeemPost(
        makeRedeemRequest({ action: 'confirm', token: issued.token }),
      );
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('internal_error');
    });
  });

  // ============================================================================
  // 3. POST /api/staff/stamp
  // ============================================================================
  describe('3. POST /api/staff/stamp: Staff Manual Stamp Route Handler', () => {
    function makeStampRequest(body: any, rawText?: string) {
      if (rawText !== undefined) {
        return new Request('http://localhost:3000/api/staff/stamp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawText,
        });
      }
      return new Request('http://localhost:3000/api/staff/stamp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('rejects unauthenticated caller with 401', async () => {
      mockUnauthenticated();
      const res = await staffStampPost(
        makeStampRequest({ customerId: TEST_CUSTOMER_ID, reason: 'NFC broken' }),
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('unauthenticated');
    });

    it('rejects non-staff user with 403', async () => {
      mockNonStaffUser();
      const res = await staffStampPost(
        makeStampRequest({ customerId: TEST_CUSTOMER_ID, reason: 'NFC broken' }),
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('forbidden');
    });

    it('enforces rate limiting with 429 when rate limit exceeded', async () => {
      vi.mocked(checkPublicEndpointRateLimit).mockResolvedValueOnce({
        allowed: false,
        limit: 30,
        remaining: 0,
        resetMs: 60_000,
      });

      const res = await staffStampPost(
        makeStampRequest({ customerId: TEST_CUSTOMER_ID, reason: 'NFC broken' }),
      );
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('rate_limited');
    });

    it('rejects malformed JSON body with 400', async () => {
      const res = await staffStampPost(makeStampRequest(null, '{ not-json'));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
    });

    it('rejects invalid customerId UUID with 400', async () => {
      const res = await staffStampPost(
        makeStampRequest({ customerId: 'not-a-uuid', reason: 'Verified espresso purchase' }),
      );
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('invalid_input');
    });

    it('rejects missing or too short reason (< 3 chars) with 400', async () => {
      const resShort = await staffStampPost(
        makeStampRequest({ customerId: TEST_CUSTOMER_ID, reason: 'ok' }),
      );
      expect(resShort.status).toBe(400);

      const resEmpty = await staffStampPost(
        makeStampRequest({ customerId: TEST_CUSTOMER_ID, reason: '   ' }),
      );
      expect(resEmpty.status).toBe(400);
    });

    it('returns 404 when the customer has no card at the active shop (no-card)', async () => {
      mockAdminClient.rpc.mockResolvedValueOnce({ data: 'no-card', error: null });

      const res = await staffStampPost(
        makeStampRequest({
          customerId: TEST_CUSTOMER_ID,
          reason: 'Verified customer phone antenna failed',
        }),
      );
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.message).toBe('This customer has no The Caffeine Plug card.');
    });

    it('succeeds for valid customer and reason: calls stamp_card_manual for the active shop and returns balance', async () => {
      tableQueryHandlers['card_balances'] = () =>
        createMockSupabaseQuery({ available_stamps: 7 }, null);

      mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
        if (rpcName === 'stamp_card_manual') {
          expect(args.p_customer).toBe(TEST_CUSTOMER_ID);
          expect(args.p_tenant).toBe(TENANT_ONE_ID);
          expect(args.p_actor).toBe(TEST_STAFF_ID);
          expect(args.p_reason).toBe('iPhone 8 NFC broken; receipt verified');
          return { data: 'stamped', error: null };
        }
        return { data: null, error: null };
      });

      const res = await staffStampPost(
        makeStampRequest({
          customerId: TEST_CUSTOMER_ID,
          reason: 'iPhone 8 NFC broken; receipt verified',
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.data.result).toBe('stamped');
      expect(json.data.customerId).toBe(TEST_CUSTOMER_ID);
      expect(json.data.availableStampsAfter).toBe(7);
      expect(json.data.reason).toBe('iPhone 8 NFC broken; receipt verified');
      // stamp_card_manual audits inside SQL, so the route makes no separate audit RPC
      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('log_audit_event', expect.anything());
    });

    it('returns 500 when stamp_card_manual RPC encounters an error', async () => {
      mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
        if (rpcName === 'stamp_card_manual') {
          return { data: null, error: { message: 'RPC execution failed' } };
        }
        return { data: null, error: null };
      });

      const res = await staffStampPost(
        makeStampRequest({
          customerId: TEST_CUSTOMER_ID,
          reason: 'Test reason for failure',
        }),
      );
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.ok).toBe(false);
      expect(json.error).toBe('internal_error');
    });
  });

  // ============================================================================
  // 4. GET & POST /api/staff/tags
  // ============================================================================
  describe('4. GET & POST /api/staff/tags: NFC Tag Management Route Handlers', () => {
    function makeTagRequest(body: any, rawText?: string) {
      if (rawText !== undefined) {
        return new Request('http://localhost:3000/api/staff/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawText,
        });
      }
      return new Request('http://localhost:3000/api/staff/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    describe('GET /api/staff/tags', () => {
      it('rejects unauthenticated caller with 401', async () => {
        mockUnauthenticated();
        const res = await staffTagsGet();
        expect(res.status).toBe(401);
      });

      it('rejects non-staff user with 403', async () => {
        mockNonStaffUser();
        const res = await staffTagsGet();
        expect(res.status).toBe(403);
      });

      it('returns decorated tags list with productionTapUrl and localTapUrl', async () => {
        const sampleTags: TagRow[] = [
          {
            id: 'tcp_tag_counter_1',
            label: 'Counter Barista 1',
            active: true,
            created_at: '2026-11-01T10:00:00Z',
            deactivated_at: null,
          },
          {
            id: 'tcp_tag_drive_thru',
            label: 'Drive Thru',
            active: false,
            created_at: '2026-10-15T08:00:00Z',
            deactivated_at: '2026-10-20T12:00:00Z',
          },
        ];

        tableQueryHandlers['tags'] = () => createMockSupabaseQuery(sampleTags, null);

        const res = await staffTagsGet();
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data).toHaveLength(2);
        expect(json.data[0].productionTapUrl).toBe('http://localhost:3000/t/tcp_tag_counter_1');
        expect(json.data[0].localTapUrl).toBe('http://localhost:3000/t/tcp_tag_counter_1');
        expect(json.data[1].productionTapUrl).toBe('http://localhost:3000/t/tcp_tag_drive_thru');
      });

      it('returns 500 when database query errors', async () => {
        tableQueryHandlers['tags'] = () =>
          createMockSupabaseQuery(null, { message: 'Database offline' });

        const res = await staffTagsGet();
        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.ok).toBe(false);
        expect(json.error).toBe('internal_error');
      });
    });

    describe('POST /api/staff/tags', () => {
      // Tag management is owner/manager only; the role gate itself is covered in phase12-staff-actions.
      beforeEach(() => {
        mockActiveStaff('owner');
      });

      it('rejects unauthenticated caller with 401', async () => {
        mockUnauthenticated();
        const res = await staffTagsPost(makeTagRequest({ action: 'create' }));
        expect(res.status).toBe(401);
      });

      it('rejects non-staff user with 403', async () => {
        mockNonStaffUser();
        const res = await staffTagsPost(makeTagRequest({ action: 'create' }));
        expect(res.status).toBe(403);
      });

      it('enforces rate limiting with 429', async () => {
        vi.mocked(checkPublicEndpointRateLimit).mockResolvedValueOnce({
          allowed: false,
          limit: 30,
          remaining: 0,
          resetMs: 60_000,
        });

        const res = await staffTagsPost(makeTagRequest({ action: 'create' }));
        expect(res.status).toBe(429);
      });

      it('rejects malformed JSON or invalid action with 400', async () => {
        const resMalformed = await staffTagsPost(makeTagRequest(null, '{ not-json'));
        expect(resMalformed.status).toBe(400);

        const resInvalidAction = await staffTagsPost(makeTagRequest({ action: 'burn-tag' }));
        expect(resInvalidAction.status).toBe(400);
      });

      describe('action: create', () => {
        it('creates a tag through create_tag for the active shop and returns the re-read, decorated tag', async () => {
          let createdId = '';
          mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
            if (rpcName === 'create_tag') {
              expect(args.p_actor).toBe(TEST_STAFF_ID);
              expect(args.p_tenant).toBe(TENANT_ONE_ID);
              expect(args.p_label).toBe('Front Counter Card #2');
              createdId = args.p_tag_id;
              return { data: 'created', error: null };
            }
            return { data: null, error: null };
          });

          tableQueryHandlers['tags'] = () => {
            const query: any = createMockSupabaseQuery();
            query.maybeSingle = vi.fn(async () => ({
              data: {
                id: createdId,
                label: 'Front Counter Card #2',
                active: true,
                created_at: '2026-11-01T12:00:00Z',
                deactivated_at: null,
              },
              error: null,
            }));
            return query;
          };

          const res = await staffTagsPost(
            makeTagRequest({ action: 'create', label: 'Front Counter Card #2' }),
          );
          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.action).toBe('create');
          expect(json.data.tag.id).toMatch(/^tcp_tag_[0-9a-z]{16}$/);
          expect(json.data.tag.id).toBe(createdId);
          expect(json.data.tag.label).toBe('Front Counter Card #2');
          expect(json.data.tag.productionTapUrl).toBe(
            `http://localhost:3000/t/${encodeURIComponent(json.data.tag.id)}`,
          );

          // The SQL function writes the tag_created audit row, so the route makes no audit RPC
          expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
            'log_audit_event',
            expect.anything(),
          );
        });

        it('returns 500 when creating the tag fails', async () => {
          mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
            if (rpcName === 'create_tag') {
              return { data: null, error: { message: 'Unique violation on tag id' } };
            }
            return { data: null, error: null };
          });

          const res = await staffTagsPost(makeTagRequest({ action: 'create' }));
          expect(res.status).toBe(500);
        });
      });

      describe('action: deactivate', () => {
        it('returns 404 when tag does not exist', async () => {
          mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
            if (rpcName === 'deactivate_tag') return { data: 'not-found', error: null };
            return { data: null, error: null };
          });

          const res = await staffTagsPost(
            makeTagRequest({ action: 'deactivate', tagId: 'tcp_tag_nonexistent' }),
          );
          expect(res.status).toBe(404);
          const json = await res.json();
          expect(json.ok).toBe(false);
          expect(json.message).toBe('NFC tag not found.');
        });

        it('deactivates tag through deactivate_tag and returns the updated tag', async () => {
          const updatedTag: TagRow = {
            id: 'tcp_tag_to_deactivate',
            label: 'Counter Tag',
            active: false,
            created_at: '2026-11-01T10:00:00Z',
            deactivated_at: new Date().toISOString(),
          };

          mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
            if (rpcName === 'deactivate_tag') {
              expect(args).toEqual({
                p_actor: TEST_STAFF_ID,
                p_tenant: TENANT_ONE_ID,
                p_tag_id: 'tcp_tag_to_deactivate',
              });
              return { data: 'deactivated', error: null };
            }
            return { data: null, error: null };
          });
          tableQueryHandlers['tags'] = () => createMockSupabaseQuery(updatedTag, null);

          const res = await staffTagsPost(
            makeTagRequest({ action: 'deactivate', tagId: 'tcp_tag_to_deactivate' }),
          );
          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.action).toBe('deactivate');
          expect(json.data.deactivatedTagId).toBe('tcp_tag_to_deactivate');
          expect(json.data.tag.active).toBe(false);
          expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
            'log_audit_event',
            expect.anything(),
          );
        });
      });

      describe('action: rotate', () => {
        it('returns 404 when target tag does not exist', async () => {
          mockAdminClient.rpc.mockImplementation(async (rpcName: string) => {
            if (rpcName === 'rotate_tag') return { data: 'not-found', error: null };
            return { data: null, error: null };
          });

          const res = await staffTagsPost(
            makeTagRequest({ action: 'rotate', tagId: 'tcp_tag_nonexistent' }),
          );
          expect(res.status).toBe(404);
        });

        it('rotates through rotate_tag with a fresh id and returns the new tag', async () => {
          let newId = '';
          mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
            if (rpcName === 'rotate_tag') {
              expect(args.p_actor).toBe(TEST_STAFF_ID);
              expect(args.p_tenant).toBe(TENANT_ONE_ID);
              expect(args.p_old_tag_id).toBe('tcp_tag_old_counter');
              expect(args.p_label).toBe('Register 1 New Card');
              newId = args.p_new_tag_id;
              return { data: 'rotated', error: null };
            }
            return { data: null, error: null };
          });

          tableQueryHandlers['tags'] = () => {
            const query: any = createMockSupabaseQuery();
            query.maybeSingle = vi.fn(async () => ({
              data: {
                id: newId,
                label: 'Register 1 New Card',
                active: true,
                created_at: '2026-11-01T14:00:00Z',
                deactivated_at: null,
              },
              error: null,
            }));
            return query;
          };

          const res = await staffTagsPost(
            makeTagRequest({
              action: 'rotate',
              tagId: 'tcp_tag_old_counter',
              newLabel: 'Register 1 New Card',
            }),
          );
          expect(res.status).toBe(200);
          const json = await res.json();
          expect(json.ok).toBe(true);
          expect(json.data.action).toBe('rotate');
          expect(json.data.deactivatedTagId).toBe('tcp_tag_old_counter');
          expect(json.data.tag.id).toMatch(/^tcp_tag_[0-9a-z]{16}$/);
          expect(json.data.tag.id).toBe(newId);
          expect(json.data.tag.label).toBe('Register 1 New Card');
          expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
            'log_audit_event',
            expect.anything(),
          );
        });

        it('leaves the label to rotate_tag (which keeps the old one) when newLabel is not provided', async () => {
          let rotateArgs: any = null;
          mockAdminClient.rpc.mockImplementation(async (rpcName: string, args: any) => {
            if (rpcName === 'rotate_tag') {
              rotateArgs = args;
              return { data: 'rotated', error: null };
            }
            return { data: null, error: null };
          });
          tableQueryHandlers['tags'] = () =>
            createMockSupabaseQuery(
              {
                id: 'tcp_tag_new',
                label: 'Barista Card Back Station',
                active: true,
                created_at: '2026-11-01T14:00:00Z',
                deactivated_at: null,
              },
              null,
            );

          const res = await staffTagsPost(
            makeTagRequest({ action: 'rotate', tagId: 'tcp_tag_preserve_lbl' }),
          );
          expect(res.status).toBe(200);
          expect(rotateArgs.p_label).toBeUndefined();
          const json = await res.json();
          expect(json.data.tag.label).toBe('Barista Card Back Station');
        });
      });
    });
  });

  // ============================================================================
  // 5. Staff UI Components & Accessibility
  // ============================================================================
  describe('5. Staff UI Components & Accessibility', () => {
    const testStaffSession: StaffSession = {
      userId: TEST_STAFF_ID,
      email: 'barista@thecaffeineplug.ph',
      displayName: 'Maria Santos',
      role: 'staff',
      active: true,
      tenantId: TENANT_ONE_ID,
      tenantSlug: TENANT_ONE_SLUG,
      tenantName: 'The Caffeine Plug',
      memberships: [
        {
          tenantId: TENANT_ONE_ID,
          tenantSlug: TENANT_ONE_SLUG,
          tenantName: 'The Caffeine Plug',
          role: 'staff',
        },
      ],
    };

    describe('StaffNav (components/staff/StaffNav.tsx)', () => {
      it('renders brand identity, staff name, role badge, and navigation landmarks', () => {
        const html = renderToStaticMarkup(
          React.createElement(StaffNav, {
            staff: testStaffSession,
            currentPath: ROUTES.staff.root,
          }),
        );

        expect(html).toContain(testStaffSession.tenantName);
        expect(html).toContain('Maria Santos');
        expect(html).toContain('Staff');
        expect(html).toContain('aria-label="Logged in as Maria Santos, staff"');
        expect(html).toContain('aria-label="Staff Portal Navigation"');
        expect(html).toContain('Sign Out');
      });

      it('highlights active navigation link with aria-current="page"', () => {
        const html = renderToStaticMarkup(
          React.createElement(StaffNav, {
            staff: testStaffSession,
            currentPath: ROUTES.staff.redeem,
          }),
        );

        expect(html).toContain('aria-current="page"');
        expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/staff\/redeem"/);
        expect(html).not.toMatch(/<a[^>]*aria-current="page"[^>]*href="\/staff\/stamp"/);
      });
    });

    describe('StaffLoginForm (components/staff/StaffLoginForm.tsx)', () => {
      it('renders accessible form with labels and mode toggles', () => {
        const html = renderToStaticMarkup(React.createElement(StaffLoginForm, {}));

        expect(html).toContain('Staff Access');
        expect(html).toContain('for="staff-login-email"');
        expect(html).toContain('Staff Email Address');
        expect(html).toContain('for="staff-login-password"');
        expect(html).toContain('Password');
        expect(html).toContain('Sign In with Password');
        expect(html).toContain('Magic Link');
      });

      it('renders role="alert" with exact error message and Switch Account button when initialError="forbidden"', () => {
        const html = renderToStaticMarkup(
          React.createElement(StaffLoginForm, { initialError: 'forbidden' }),
        );

        expect(html).toContain('role="alert"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain(
          'Access denied: This account does not have active staff permissions.',
        );
        expect(html).toContain('Sign Out &amp; Switch Account');
      });

      it('renders generic authentication error when initialError is provided', () => {
        const html = renderToStaticMarkup(
          React.createElement(StaffLoginForm, { initialError: 'invalid_credentials' }),
        );

        expect(html).toContain('role="alert"');
        expect(html).toContain('Authentication error: invalid_credentials');
      });
    });

    describe('RedeemRewardForm (components/staff/RedeemRewardForm.tsx)', () => {
      it('renders accessible textarea with label and verify button', () => {
        const html = renderToStaticMarkup(React.createElement(RedeemRewardForm));

        expect(html).toContain('Customer Reward Redemption');
        expect(html).toContain('for="redeem-token-input"');
        expect(html).toContain('Customer Redemption Token (Scan or Paste)');
        expect(html).toContain('Verify Token &amp; Check Balance');
      });
    });

    describe('ManualStampForm (components/staff/ManualStampForm.tsx)', () => {
      it('renders accessible inputs with labels and audit requirement', () => {
        const html = renderToStaticMarkup(React.createElement(ManualStampForm));

        expect(html).toContain('Issue Manual Stamp');
        expect(html).toContain('for="manual-customer-id"');
        expect(html).toContain('Customer UUID');
        expect(html).toContain('for="manual-stamp-reason"');
        expect(html).toContain('Reason for Manual Stamp (Required for Audit Log)');
        expect(html).toContain('Award Manual Stamp');
      });
    });

    describe('Server Component Pages Rendering', () => {
      it('StaffOverviewPage renders Home with the counter jobs first', async () => {
        mockActiveStaff('owner');
        const pageElement = await StaffOverviewPage();
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Hi, Maria');
        expect(html).toContain('Redeem Reward');
        expect(html).toContain('Add a stamp by hand');
        expect(html).toContain('Activity');
        expect(html).toContain('Running your shop');
        expect(html).toContain('Tap Cards');
      });

      it('StaffOverviewPage hides shop management from staff-role users', async () => {
        mockActiveStaff('staff');
        const html = renderToStaticMarkup(await StaffOverviewPage());
        expect(html).toContain('Redeem Reward');
        expect(html).not.toContain('Running your shop');
        expect(html).not.toContain('Tap Cards');
      });

      it('StaffRedeemPage renders Redeem Reward module and form', async () => {
        mockActiveStaff('staff');
        const pageElement = await StaffRedeemPage();
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('aria-label="Redeem Module Header"');
        expect(html).toContain('Redeem Reward');
        expect(html).toContain('Customer Reward Redemption');
      });

      it('StaffManualStampPage renders Manual Stamp module and form', async () => {
        mockActiveStaff('staff');
        const pageElement = await StaffManualStampPage();
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('aria-label="Manual Stamp Header"');
        expect(html).toContain('Manual Stamp');
        expect(html).toContain('Issue Manual Stamp');
      });

      it('StaffTagsPage sends managers to Tap Cards and staff Home', async () => {
        mockActiveStaff('owner');
        await expect(StaffTagsPage()).rejects.toThrow(
          `NEXT_REDIRECT: ${ROUTES.staff.tapCards(TENANT_ONE_SLUG)}`,
        );

        mockActiveStaff('staff');
        await expect(StaffTagsPage()).rejects.toThrow(`NEXT_REDIRECT: ${ROUTES.staff.root}`);
      });

      it('StaffActivityPage renders anomaly flags, recent stamps, redemptions, and audit logs', async () => {
        mockActiveStaff('owner');
        tableQueryHandlers['stamps'] = () =>
          createMockSupabaseQuery(
            [
              {
                id: 's1',
                customer_id: TEST_CUSTOMER_ID,
                tag_id: 'tag_1',
                source: 'nfc',
                staff_id: null,
                reason: null,
                created_at: '2026-11-01T10:00:00Z',
              },
            ],
            null,
          );
        tableQueryHandlers['redemptions'] = () =>
          createMockSupabaseQuery(
            [
              {
                id: 'r1',
                customer_id: TEST_CUSTOMER_ID,
                stamps_used: 10,
                staff_id: TEST_STAFF_ID,
                created_at: '2026-11-01T11:00:00Z',
              },
            ],
            null,
          );
        tableQueryHandlers['audit_log'] = () =>
          createMockSupabaseQuery(
            [
              {
                id: 'a1',
                actor: TEST_STAFF_ID,
                action: 'tag_created',
                target: 'tag_1',
                detail: { label: 'New Tag' },
                created_at: '2026-11-01T09:00:00Z',
              },
            ],
            null,
          );

        const pageElement = await StaffActivityPage();
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Anything unusual');
        expect(html).toContain('Full staff record');
        expect(html).toContain('Anomaly Flags');
        expect(html).toContain('Recent Stamps');
        expect(html).toContain('Recent Redemptions');
        expect(html).toContain('Audit Log Viewer');
        expect(html).toContain('tag_created');
      });

      it('StaffLoginPage redirects to nextPath if already authenticated as active staff', async () => {
        mockActiveStaff('staff');
        await expect(
          StaffLoginPage({
            searchParams: Promise.resolve({ next: '/staff/redeem' }),
          }),
        ).rejects.toThrow('NEXT_REDIRECT: /staff/redeem');
      });

      it('StaffLoginPage renders StaffLoginForm when caller is not authenticated', async () => {
        mockUnauthenticated();
        const pageElement = await StaffLoginPage({
          searchParams: Promise.resolve({ error: 'forbidden' }),
        });
        const html = renderToStaticMarkup(pageElement);

        expect(html).toContain('Staff Access');
        expect(html).toContain('role="alert"');
        expect(html).toContain(
          'Access denied: This account does not have active staff permissions.',
        );
      });
    });
  });
});
