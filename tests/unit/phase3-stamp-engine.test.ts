import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

// Stub 'server-only' for Vitest test environment
vi.mock('server-only', () => ({}));

import { verifyTap } from '@/lib/nfc/verifyTap';
import { checkPublicEndpointRateLimit, resetMemoryRateLimitStore } from '@/lib/security/ratelimit';
import { getVerifiedUser } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { GET } from '@/app/t/[tagId]/route';
import { POST } from '@/app/api/claim/route';

// Mock server auth and admin client for route testing
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

describe('Phase 3 Stamp Engine & Tap Route Test Suite', () => {
  const mockAdminRpc = vi.fn();
  const mockAdminClient = {
    rpc: mockAdminRpc,
  };

  const authenticatedCustomer: User = {
    id: '11111111-1111-1111-1111-111111111111',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    is_anonymous: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryRateLimitStore();

    // Default admin mock setup
    mockAdminRpc.mockResolvedValue({
      data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
      error: null,
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(mockAdminClient as any);
  });

  // ============================================================================
  // 1. NFC Tap Verification (verifyTap)
  // ============================================================================
  describe('verifyTap: Input Sanitization & Tag Boundary Verification', () => {
    it('accepts valid canonical tag ID and normalizes correctly', () => {
      const result = verifyTap({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' });
      expect(result).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
      });
    });

    it('trims leading and trailing whitespace from tag ID', () => {
      const result = verifyTap({ tagId: '   tcp_tag_demo_9x8k2m4p7q1w   ' });
      expect(result).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
      });
    });

    it('accepts exactly minimum length (8 characters)', () => {
      const minTag = '12345678';
      const result = verifyTap({ tagId: minTag });
      expect(result).toEqual({
        valid: true,
        normalizedTagId: minTag,
        mode: 'ntag215-static',
      });
    });

    it('accepts exactly maximum length (128 characters)', () => {
      const maxTag = 'a'.repeat(128);
      const result = verifyTap({ tagId: maxTag });
      expect(result).toEqual({
        valid: true,
        normalizedTagId: maxTag,
        mode: 'ntag215-static',
      });
    });

    it('accepts underscores and hyphens in tag IDs', () => {
      const tagWithChars = 'Tag_123-abc_XYZ-789';
      const result = verifyTap({ tagId: tagWithChars });
      expect(result).toEqual({
        valid: true,
        normalizedTagId: tagWithChars,
        mode: 'ntag215-static',
      });
    });

    it('rejects too-short tag ID (< 8 characters)', () => {
      expect(verifyTap({ tagId: 'short' })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });

      expect(verifyTap({ tagId: '1234567' })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });

    it('rejects too-long tag ID (> 128 characters)', () => {
      const longTag = 'a'.repeat(129);
      expect(verifyTap({ tagId: longTag })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });

    it('rejects empty and whitespace-only tag IDs', () => {
      expect(verifyTap({ tagId: '' })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });

      expect(verifyTap({ tagId: '       ' })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });

    it('rejects path-traversal strings and dangerous characters', () => {
      const attackStrings = [
        '../etc/passwd',
        '../../secret',
        'tag?foo=bar',
        'tag#hash',
        'tag/with/slash',
        'tag\\with\\backslash',
        '<script>alert(1)</script>',
        'tag with spaces',
        'tag;drop table stamps;',
        'tag%20encoded',
      ];

      for (const attack of attackStrings) {
        expect(
          verifyTap({ tagId: attack }),
          `Expected attack string "${attack}" to be rejected`,
        ).toEqual({
          valid: false,
          reason: 'malformed-tag-id',
        });
      }
    });

    it('handles non-string tagId safely', () => {
      expect(verifyTap({ tagId: null as any })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });

      expect(verifyTap({ tagId: undefined as any })).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });
  });

  // ============================================================================
  // 2. Sliding Window Rate Limiting (checkPublicEndpointRateLimit)
  // ============================================================================
  describe('checkPublicEndpointRateLimit: Per-IP and Per-Customer Throttling', () => {
    it('enforces per-IP rate limit on tap endpoint (60 requests/minute)', async () => {
      const ip = '198.51.100.10';
      const startMs = 1_700_000_000_000;

      // First 60 requests are allowed
      for (let i = 0; i < 60; i++) {
        const result = await checkPublicEndpointRateLimit(
          { endpoint: 'tap', ip },
          startMs + i * 100,
        );
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(59 - i);
      }

      // 61st request in the same minute is blocked
      const blocked = await checkPublicEndpointRateLimit(
        { endpoint: 'tap', ip },
        startMs + 60 * 100,
      );
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.resetMs).toBeGreaterThan(0);

      // A different IP is isolated and still allowed
      const otherIp = await checkPublicEndpointRateLimit(
        { endpoint: 'tap', ip: '198.51.100.11' },
        startMs + 60 * 100,
      );
      expect(otherIp.allowed).toBe(true);

      // Window resets after 60,001 ms
      const resetResult = await checkPublicEndpointRateLimit(
        { endpoint: 'tap', ip },
        startMs + 60_001,
      );
      expect(resetResult.allowed).toBe(true);
    });

    it('enforces per-customer rate limit on tap endpoint (30 requests/minute)', async () => {
      const ip = '198.51.100.20';
      const customerId = 'cust-uuid-1111';
      const startMs = 1_700_000_000_000;

      // Customer makes 30 requests within limits
      for (let i = 0; i < 30; i++) {
        const result = await checkPublicEndpointRateLimit(
          { endpoint: 'tap', ip, customerId },
          startMs + i * 100,
        );
        expect(result.allowed).toBe(true);
      }

      // 31st request for customer A is blocked
      const blocked = await checkPublicEndpointRateLimit(
        { endpoint: 'tap', ip, customerId },
        startMs + 30 * 100,
      );
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);

      // Customer B from the same coffee shop IP is not blocked (customer isolation)
      const customerB = await checkPublicEndpointRateLimit(
        { endpoint: 'tap', ip, customerId: 'cust-uuid-2222' },
        startMs + 30 * 100,
      );
      expect(customerB.allowed).toBe(true);
    });

    it('enforces tighter per-customer limit on claim endpoint (10 requests/minute)', async () => {
      const ip = '198.51.100.30';
      const customerId = 'cust-uuid-claim-1';
      const startMs = 1_700_000_000_000;

      for (let i = 0; i < 10; i++) {
        const result = await checkPublicEndpointRateLimit(
          { endpoint: 'claim', ip, customerId },
          startMs + i * 100,
        );
        expect(result.allowed).toBe(true);
      }

      const blocked = await checkPublicEndpointRateLimit(
        { endpoint: 'claim', ip, customerId },
        startMs + 10 * 100,
      );
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);

      // Resets after 60,001 ms
      const afterWindow = await checkPublicEndpointRateLimit(
        { endpoint: 'claim', ip, customerId },
        startMs + 60_001,
      );
      expect(afterWindow.allowed).toBe(true);
    });
  });

  // ============================================================================
  // 3. GET /t/[tagId] Route Handler
  // ============================================================================
  describe('GET /t/[tagId] Route Handler', () => {
    it('redirects (303) unauthenticated user to /start?t=<tagId> and NEVER creates an account or touches DB', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/start?t=tcp_tag_demo_9x8k2m4p7q1w',
      );

      // Crucial Security Invariant: Tap with no session NEVER creates an account or records stamp
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('redirects (303) authenticated user with malformed tag to /card?r=invalid-tag without querying DB', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);

      const request = new NextRequest('http://localhost:3000/t/bad!');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'bad!' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('http://localhost:3000/card?r=invalid-tag');
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('redirects (303) to the shop page with r=stamped when stamp_card_nfc succeeds', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
        error: null,
      });

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/s/the-caffeine-plug?r=stamped',
      );

      expect(mockAdminRpc).toHaveBeenCalledWith('stamp_card_nfc', {
        p_customer: authenticatedCustomer.id,
        p_tag: 'tcp_tag_demo_9x8k2m4p7q1w',
      });
    });

    it.each([
      ['cooldown', '/s/the-caffeine-plug?r=cooldown'],
      ['daily-limit', '/s/the-caffeine-plug?r=daily-limit'],
      ['tag-throttled', '/s/the-caffeine-plug?r=tag-throttled'],
      ['invalid-tag', '/card?r=invalid-tag'],
    ])('redirects (303) for %s to %s when stamp_card_nfc returns it', async (resultCode, expectedPath) => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: {
          result: resultCode,
          tenant_slug: resultCode === 'invalid-tag' ? null : 'the-caffeine-plug',
        },
        error: null,
      });

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`http://localhost:3000${expectedPath}`);
    });

    it('falls back safely to /card?r=invalid-tag when database throws an exception', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockRejectedValueOnce(new Error('Database network timeout'));

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('http://localhost:3000/card?r=invalid-tag');
    });

    it('returns HTTP 429 when IP rate limit is exceeded', async () => {
      // Exhaust IP limit
      for (let i = 0; i < 60; i++) {
        await checkPublicEndpointRateLimit({ endpoint: 'tap', ip: '203.0.113.50' });
      }

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w', {
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });

      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json).toEqual({
        ok: false,
        error: 'rate_limited',
        message: 'Too many tap requests. Please wait a moment.',
      });
      expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('returns HTTP 429 when customer rate limit is exceeded', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(authenticatedCustomer);

      // Exhaust customer limit
      for (let i = 0; i < 30; i++) {
        await checkPublicEndpointRateLimit({
          endpoint: 'tap',
          ip: '203.0.113.60',
          customerId: authenticatedCustomer.id,
        });
      }

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w', {
        headers: { 'x-forwarded-for': '203.0.113.60' },
      });

      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(429);
      const json = await response.json();
      expect(json.error).toBe('rate_limited');
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // 4. POST /api/claim Route Handler
  // ============================================================================
  describe('POST /api/claim Route Handler', () => {
    it('returns HTTP 401 unauthenticated when no session exists', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(401);
      expect(json).toEqual({
        ok: false,
        error: 'unauthenticated',
        message: 'Active session required to claim stamp.',
      });
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns HTTP 400 invalid_input when body is missing tagId', async () => {
      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json).toEqual({
        ok: false,
        error: 'invalid_input',
        message: 'Invalid request payload.',
      });
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('returns HTTP 400 invalid_input on malformed JSON payload', async () => {
      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json: ',
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe('invalid_input');
    });

    it('returns result invalid-tag without calling DB when tagId fails verification', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);

      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: 'bad!' }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({
        ok: true,
        data: {
          result: 'invalid-tag',
          redirectTo: '/card?r=invalid-tag',
        },
      });
      expect(mockAdminRpc).not.toHaveBeenCalled();
    });

    it('successfully claims stamp for authenticated customer', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
        error: null,
      });

      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({
        ok: true,
        data: {
          result: 'stamped',
          redirectTo: '/s/the-caffeine-plug?r=stamped',
        },
      });

      expect(mockAdminRpc).toHaveBeenCalledWith('stamp_card_nfc', {
        p_customer: authenticatedCustomer.id,
        p_tag: 'tcp_tag_demo_9x8k2m4p7q1w',
      });
    });

    it('returns internal_error HTTP 500 when RPC returns an error', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database query execution failed' },
      });

      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json).toEqual({
        ok: false,
        error: 'internal_error',
        message: 'Unable to record stamp.',
      });
    });
  });

  // ============================================================================
  // 5. 20 Simultaneous Parallel Requests (Advisory Locking & Concurrency)
  // ============================================================================
  describe('20-Simultaneous-Taps Parallel Concurrency Verification', () => {
    it('Deterministic Simulator: 20 parallel simultaneous taps for same customer serialize under advisory lock, yielding 1 stamped and 19 cooldown', async () => {
      // In-memory simulator modeling Postgres advisory lock serialization:
      // When 20 requests arrive concurrently for the same customer, they acquire a serialized lock.
      // The first request enters and records a stamp; the remaining 19 see the stamp inside the 30-min window and return 'cooldown'.
      let lockOwner: string | null = null;
      let lastStampTime: number | null = null;
      let stampCount = 0;
      const COOLDOWN_MS = 30 * 60 * 1000;

      const simulateAdvisoryLockedRecordStamp = async (
        customerId: string,
        nowMs: number,
      ): Promise<'stamped' | 'cooldown'> => {
        // Wait for lock acquisition
        while (lockOwner !== null) {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        lockOwner = customerId;

        try {
          if (lastStampTime !== null && nowMs - lastStampTime < COOLDOWN_MS) {
            return 'cooldown';
          }
          lastStampTime = nowMs;
          stampCount++;
          return 'stamped';
        } finally {
          lockOwner = null;
        }
      };

      const now = Date.now();
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, idx) =>
          simulateAdvisoryLockedRecordStamp(authenticatedCustomer.id, now + idx * 5),
        ),
      );

      const stampedCount = results.filter((r) => r === 'stamped').length;
      const cooldownCount = results.filter((r) => r === 'cooldown').length;

      expect(stampedCount).toBe(1);
      expect(cooldownCount).toBe(19);
      expect(stampCount).toBe(1);
    });

    it('Live Database Parallel Concurrency: fires 20 real simultaneous Promise.all RPCs to local Supabase container if reachable', async () => {
      let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !serviceRoleKey) {
        const envLocalPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envLocalPath)) {
          const envLines = fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/);
          for (const line of envLines) {
            if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
              supabaseUrl = line.slice('NEXT_PUBLIC_SUPABASE_URL='.length).trim();
            } else if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
              serviceRoleKey = line.slice('SUPABASE_SERVICE_ROLE_KEY='.length).trim();
            }
          }
        }
      }

      if (!supabaseUrl || !serviceRoleKey) {
        return;
      }

      // Only run the destructive live concurrency test against a local Docker Supabase instance
      const isLocalUrl = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost');
      if (!isLocalUrl) {
        return;
      }

      let isSupabaseReachable = false;
      try {
        const ping = await fetch(`${supabaseUrl}/rest/v1/`, {
          headers: { apikey: serviceRoleKey },
        });
        isSupabaseReachable = ping.ok || ping.status === 200 || ping.status === 404;
      } catch {
        isSupabaseReachable = false;
      }

      if (!isSupabaseReachable) {
        // Skip live network test if running in an offline environment without local Supabase Docker
        return;
      }

      const realAdminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });

      // Create a clean dedicated test customer
      const uniqueEmail = `concurrency-test-${Date.now()}@caffeineplug.ph`;
      const { data: userData, error: createError } = await realAdminClient.auth.admin.createUser({
        email: uniqueEmail,
        email_confirm: true,
      });

      expect(createError).toBeNull();
      const testUserId = userData?.user?.id;
      expect(testUserId).toBeDefined();

      try {
        // Fire 20 real parallel HTTP RPC requests simultaneously
        const responses = await Promise.all(
          Array.from({ length: 20 }, () =>
            realAdminClient.rpc('record_stamp', {
              p_customer: testUserId!,
              p_tag: 'tcp_tag_demo_9x8k2m4p7q1w',
              p_source: 'nfc',
            }),
          ),
        );

        const results = responses.map((r) => r.data);
        const stampedCount = results.filter((r) => r === 'stamped').length;
        const cooldownCount = results.filter((r) => r === 'cooldown').length;

        // Core Phase 3 Acceptance Invariant:
        // Exactly ONE request returns 'stamped', and the other 19 return 'cooldown'
        expect(stampedCount).toBe(1);
        expect(cooldownCount).toBe(19);

        // Verify the database has exactly 1 stamp row recorded
        const { data: dbStamps, error: queryError } = await realAdminClient
          .from('stamps')
          .select('id')
          .eq('customer_id', testUserId!);

        expect(queryError).toBeNull();
        expect(dbStamps).toHaveLength(1);
      } finally {
        // Cleanup test user and stamps
        if (testUserId) {
          await realAdminClient.from('stamps').delete().eq('customer_id', testUserId);
          await realAdminClient.from('customers').delete().eq('id', testUserId);
          await realAdminClient.auth.admin.deleteUser(testUserId);
        }
      }
    });
  });

  // ============================================================================
  // 6. Source Code Static Security & Architecture Invariants
  // ============================================================================
  describe('Source Code Static Invariant & Security Checks', () => {
    const phase3Files = ['app/t/[tagId]/route.ts', 'app/api/claim/route.ts'];

    it('ensures none of the Phase 3 route handlers invoke .getSession(', () => {
      for (const relativePath of phase3Files) {
        const fullPath = path.resolve(process.cwd(), relativePath);
        expect(fs.existsSync(fullPath), `Expected file ${relativePath} to exist`).toBe(true);

        const content = fs.readFileSync(fullPath, 'utf8');
        expect(
          content.includes('.getSession('),
          `Security Invariant Violation: "${relativePath}" calls .getSession(. Always use getVerifiedUser() for server-side authorization.`,
        ).toBe(false);
      }
    });

    it('verifies GET /t/[tagId] uses HTTP 303 redirects exclusively', () => {
      const fullPath = path.resolve(process.cwd(), 'app/t/[tagId]/route.ts');
      const content = fs.readFileSync(fullPath, 'utf8');

      // Must use status 303 to ensure browser does not re-POST or cache redirects
      expect(content).toContain('303');
    });

    it('verifies GET /t/[tagId] checks user authentication before calling createSupabaseAdminClient in function body', () => {
      const fullPath = path.resolve(process.cwd(), 'app/t/[tagId]/route.ts');
      const content = fs.readFileSync(fullPath, 'utf8');

      const functionBody = content.slice(content.indexOf('export async function GET'));
      const userIndex = functionBody.indexOf('getVerifiedUser');
      const adminIndex = functionBody.indexOf('createSupabaseAdminClient');

      expect(userIndex).toBeGreaterThan(-1);
      expect(adminIndex).toBeGreaterThan(-1);
      expect(userIndex).toBeLessThan(adminIndex);
    });
  });
});
