import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { User } from '@supabase/supabase-js';

// Stub 'server-only' for Node/Vitest test environment
vi.mock('server-only', () => ({}));

import { ensureCustomerRecord, getCustomerCardState } from '@/lib/auth/customer';
import type { TenantContext } from '@/lib/contracts';
import { POST } from '@/app/api/customers/route';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const TEST_TENANT: TenantContext = {
  id: '7c1f0000-0000-4000-8000-000000000001',
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
    rewardLabel: 'FREE COFFEE',
    brand: {},
    perks: {},
  },
};

describe('Phase 2 Customer Identity & Card Provisioning Test Suite', () => {
  const mockAdminRpc = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockEq = vi.fn();
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();

  const mockAdminClient = {
    rpc: mockAdminRpc,
  };

  const mockServerClient = {
    from: mockFrom,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default admin mock setup
    mockAdminRpc.mockResolvedValue({
      data: '11111111-1111-1111-1111-111111111111',
      error: null,
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(mockAdminClient as any);

    // Default server mock setup
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    });
    mockEq.mockImplementation(() => ({
      eq: mockEq,
      maybeSingle: mockMaybeSingle,
    }));
    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockFrom.mockReturnValue({
      select: mockSelect,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockServerClient as any);
  });

  describe('Customer Identity Helpers (lib/auth/customer.ts)', () => {
    it('ensureCustomerRecord invokes ensure_customer RPC with verified userId', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      mockAdminRpc.mockResolvedValueOnce({
        data: userId,
        error: null,
      });

      const customerId = await ensureCustomerRecord(userId);

      expect(customerId).toBe(userId);
      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: userId,
      });
    });

    it('ensureCustomerRecord throws descriptive error if RPC fails', async () => {
      mockAdminRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' },
      });

      await expect(ensureCustomerRecord('user_failed')).rejects.toThrow(
        'Failed to ensure customer record for user "user_failed": Database connection failed',
      );
    });

    it('getCustomerCardState returns null when unauthenticated', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const state = await getCustomerCardState(TEST_TENANT);

      expect(state).toBeNull();
      expect(mockAdminRpc).not.toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('getCustomerCardState returns hydrated card state for existing customer', async () => {
      const mockUser: User = {
        id: '11111111-1111-1111-1111-111111111111',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        is_anonymous: true,
      };

      vi.mocked(getVerifiedUser).mockResolvedValueOnce(mockUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: mockUser.id,
        error: null,
      });

      mockMaybeSingle
        .mockResolvedValueOnce({ data: { added_at: '2026-10-15T08:00:00.000Z' }, error: null })
        .mockResolvedValueOnce({
          data: {
            tenant_id: TEST_TENANT.id,
            customer_id: mockUser.id,
            total_stamps: 4,
            stamps_redeemed: 0,
            available_stamps: 4,
            last_stamped_at: '2026-11-02T03:00:00.000Z',
          },
          error: null,
        });

      const state = await getCustomerCardState(TEST_TENANT);

      expect(state).toEqual({
        customerId: mockUser.id,
        tenant: TEST_TENANT,
        isAnonymous: true,
        email: null,
        displayName: null,
        totalStamps: 4,
        stampsRedeemed: 0,
        availableStamps: 4,
        lastStampedAt: '2026-11-02T03:00:00.000Z',
        createdAt: '2026-10-15T08:00:00.000Z',
        cardsCompleted: 0,
        instagramUpsizeClaimed: false,
        milestoneReward: null,
      });

      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: mockUser.id,
      });
      expect(mockFrom).toHaveBeenCalledWith('customer_cards');
      expect(mockFrom).toHaveBeenCalledWith('card_balances');
      expect(mockEq).toHaveBeenCalledWith('tenant_id', TEST_TENANT.id);
      expect(mockEq).toHaveBeenCalledWith('customer_id', mockUser.id);
    });

    it('getCustomerCardState returns 0 defaults when the card_balances row is not yet found', async () => {
      const mockUser: User = {
        id: '22222222-2222-2222-2222-222222222222',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        is_anonymous: false,
      };

      vi.mocked(getVerifiedUser).mockResolvedValueOnce(mockUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: mockUser.id,
        error: null,
      });

      mockMaybeSingle
        .mockResolvedValueOnce({ data: { added_at: '2026-10-15T08:00:00.000Z' }, error: null })
        .mockResolvedValueOnce({ data: null, error: null });

      const state = await getCustomerCardState(TEST_TENANT);

      expect(state).toEqual({
        customerId: mockUser.id,
        tenant: TEST_TENANT,
        isAnonymous: false,
        email: null,
        displayName: null,
        totalStamps: 0,
        stampsRedeemed: 0,
        availableStamps: 0,
        lastStampedAt: null,
        createdAt: '2026-10-15T08:00:00.000Z',
        cardsCompleted: 0,
        instagramUpsizeClaimed: false,
        milestoneReward: null,
      });
    });

    it('getCustomerCardState reports instagramUpsizeClaimed when a perk_claims row exists', async () => {
      const mockUser: User = {
        id: '33333333-3333-3333-3333-333333333333',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        is_anonymous: true,
      };

      vi.mocked(getVerifiedUser).mockResolvedValueOnce(mockUser);
      mockAdminRpc.mockResolvedValueOnce({ data: mockUser.id, error: null });

      mockMaybeSingle
        .mockResolvedValueOnce({ data: { added_at: '2026-10-15T08:00:00.000Z' }, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: { id: 'perk-claim-1' }, error: null });

      const state = await getCustomerCardState(TEST_TENANT);

      expect(state).not.toBeNull();
      expect(state).not.toBe('no-card');
      expect((state as { instagramUpsizeClaimed?: boolean }).instagramUpsizeClaimed).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('perk_claims');
      expect(mockEq).toHaveBeenCalledWith('tenant_id', TEST_TENANT.id);
      expect(mockEq).toHaveBeenCalledWith('perk', 'instagram_follow_upsize');
    });

    it('getCustomerCardState throws when query encounters database error', async () => {
      const mockUser: User = {
        id: '33333333-3333-3333-3333-333333333333',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        is_anonymous: true,
      };

      vi.mocked(getVerifiedUser).mockResolvedValueOnce(mockUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: mockUser.id,
        error: null,
      });

      mockMaybeSingle
        .mockResolvedValueOnce({ data: { added_at: '2026-10-15T08:00:00.000Z' }, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'relation card_balances does not exist' },
        });

      await expect(getCustomerCardState(TEST_TENANT)).rejects.toThrow(
        'Failed to query customer balance for user "33333333-3333-3333-3333-333333333333": relation card_balances does not exist',
      );
    });
  });

  describe('POST /api/customers Route Handler', () => {
    const anonymousUser: User = {
      id: '11111111-1111-1111-1111-111111111111',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      is_anonymous: true,
    };

    it('Test 1: Unauthenticated request returns HTTP 401 and rejects without calling ensure_customer', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json).toEqual({
        ok: false,
        error: 'unauthenticated',
        message: 'Active session required to create or access a loyalty card.',
      });
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('Test 2: Authenticated anonymous user returns HTTP 200 and provisions customer record', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: anonymousUser.id,
        error: null,
      });

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({
        ok: true,
        data: {
          customerId: anonymousUser.id,
          isAnonymous: true,
        },
      });

      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: anonymousUser.id,
      });
    });

    it('Test 3: Repeat POST /api/customers calls with same session reuse same customerId idempotently', async () => {
      for (let i = 0; i < 3; i++) {
        vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
        mockAdminRpc.mockResolvedValueOnce({
          data: anonymousUser.id,
          error: null,
        });

        const request = new Request('http://localhost:3000/api/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        const response = await POST(request);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json).toEqual({
          ok: true,
          data: {
            customerId: anonymousUser.id,
            isAnonymous: true,
          },
        });
      }

      expect(mockAdminRpc).toHaveBeenCalledTimes(3);
      for (let i = 1; i <= 3; i++) {
        expect(mockAdminRpc).toHaveBeenNthCalledWith(i, 'ensure_customer', {
          p_customer: anonymousUser.id,
        });
      }
    });

    it('Test 4: Attempted IDOR — request body specifying arbitrary userId/customerId is ignored; verified user.id is strictly enforced', async () => {
      const attackerAttemptBody = {
        userId: '99999999-9999-9999-9999-999999999999',
        customerId: '99999999-9999-9999-9999-999999999999',
        p_customer: '99999999-9999-9999-9999-999999999999',
      };

      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: anonymousUser.id,
        error: null,
      });

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attackerAttemptBody),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.data.customerId).toBe(anonymousUser.id);
      expect(json.data.customerId).not.toBe('99999999-9999-9999-9999-999999999999');

      // Crucial security invariant: ensure_customer is NEVER called with attacker's supplied ID
      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: anonymousUser.id,
      });
      expect(mockAdminRpc).not.toHaveBeenCalledWith('ensure_customer', {
        p_customer: '99999999-9999-9999-9999-999999999999',
      });
    });

    it('Test 5: A failing captchaToken in the body is ignored (Supabase Auth is the only Turnstile verifier)', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({ data: anonymousUser.id, error: null });

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken: 'FAIL_TOKEN' }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.customerId).toBe(anonymousUser.id);
      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: anonymousUser.id,
      });
    });

    it('Accepts valid Turnstile token and provisions successfully', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: anonymousUser.id,
        error: null,
      });

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.195',
        },
        body: JSON.stringify({ captchaToken: 'VALID_TURNSTILE_TOKEN' }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.customerId).toBe(anonymousUser.id);
      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: anonymousUser.id,
      });
    });

    it('Test 6: Malformed JSON body is ignored; the verified session alone provisions the card', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({ data: anonymousUser.id, error: null });
      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed_json: true, ',
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.customerId).toBe(anonymousUser.id);
      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: anonymousUser.id,
      });
    });

    it('Non-string captchaToken is ignored', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({ data: anonymousUser.id, error: null });
      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captchaToken: 12345 }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.customerId).toBe(anonymousUser.id);
      expect(mockAdminRpc).toHaveBeenCalledWith('ensure_customer', {
        p_customer: anonymousUser.id,
      });
    });

    it('Empty body with Content-Length: 0 succeeds for authenticated user', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: anonymousUser.id,
        error: null,
      });

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Length': '0' },
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.customerId).toBe(anonymousUser.id);
    });

    it('Returns HTTP 500 internal_error when ensureCustomerRecord fails', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(anonymousUser);
      mockAdminRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database failure during ensure_customer RPC' },
      });

      const request = new Request('http://localhost:3000/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json).toEqual({
        ok: false,
        error: 'internal_error',
        message: 'Unable to provision loyalty card right now.',
      });
    });
  });

  describe('Source Code Static Invariant Check', () => {
    const sensitiveFiles = [
      'lib/supabase/server.ts',
      'lib/supabase/middleware.ts',
      'lib/auth/customer.ts',
      'app/api/customers/route.ts',
    ];

    it('ensures none of the sensitive files invoke .getSession(', () => {
      for (const relativePath of sensitiveFiles) {
        const fullPath = path.resolve(process.cwd(), relativePath);
        expect(fs.existsSync(fullPath), `Expected file ${relativePath} to exist`).toBe(true);

        const content = fs.readFileSync(fullPath, 'utf8');

        // Must NEVER call .getSession(
        expect(
          content.includes('.getSession('),
          `Security Invariant Violation: "${relativePath}" calls .getSession(. Always use .getUser() or getVerifiedUser() for server-side authorization.`,
        ).toBe(false);
      }
    });

    it('verifies server.ts, middleware.ts, customer.ts, and route.ts strictly rely on getUser() or getVerifiedUser()', () => {
      const serverContent = fs.readFileSync(
        path.resolve(process.cwd(), 'lib/supabase/server.ts'),
        'utf8',
      );
      expect(serverContent).toContain('.getUser()');

      const middlewareContent = fs.readFileSync(
        path.resolve(process.cwd(), 'lib/supabase/middleware.ts'),
        'utf8',
      );
      expect(middlewareContent).toContain('.getUser()');

      const customerContent = fs.readFileSync(
        path.resolve(process.cwd(), 'lib/auth/customer.ts'),
        'utf8',
      );
      expect(customerContent).toContain('getVerifiedUser()');

      const routeContent = fs.readFileSync(
        path.resolve(process.cwd(), 'app/api/customers/route.ts'),
        'utf8',
      );
      expect(routeContent).toContain('getVerifiedUser()');
    });
  });
});
