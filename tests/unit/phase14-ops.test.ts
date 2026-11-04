import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { logSecurityEvent } from '@/lib/security/logger';
import { checkPublicEndpointRateLimit, resetMemoryRateLimitStore } from '@/lib/security/ratelimit';
import { GET } from '@/app/api/health/route';
import { evaluateTagLeakSignals } from '@/lib/ops/tag-leak';
import { generateRandomTagId } from '@/lib/auth/staff';
import type { ApiResponse, TagLeakSignal } from '@/lib/contracts';

// Mock Supabase admin client for health route test
const mockRpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

describe('Phase 14 Ops (Task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryRateLimitStore();
  });

  describe('1. log_events_carry_tenant_id_and_stay_redacted', () => {
    it('preserves tenantId as a shop UUID while redacting sensitive fields and PII', () => {
      const tenantId = '7c1f0000-0000-4000-8000-000000000001';
      const log = logSecurityEvent('info', 'test_event', {
        tenantId,
        userEmail: 'sensitive@customer.ph',
        userPassword: 'plaintext-password-123',
        authToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.sig',
        tagId: 'tcp_tag_abc12345',
        count: 42,
      });

      expect(log.context.tenantId).toBe(tenantId);
      expect(log.context.userEmail).toBe('[REDACTED]');
      expect(log.context.userPassword).toBe('[REDACTED]');
      expect(log.context.authToken).toBe('[REDACTED]');
      expect(log.context.tagId).toBe('tcp_tag_abc12345');
      expect(log.context.count).toBe(42);
    });
  });

  describe('2. ratelimit_tenant_bucket_blocks_one_tenant_only', () => {
    it('enforces per-tenant rate limit and isolates tenants from each other', async () => {
      const tenantA = '7c1f0000-0000-4000-8000-00000000000a';
      const tenantB = '7c1f0000-0000-4000-8000-00000000000b';

      // Exhaust tenant A's quota for the cards endpoint (perTenant: 60)
      for (let i = 0; i < 60; i++) {
        const res = await checkPublicEndpointRateLimit({
          endpoint: 'cards',
          ip: `192.168.1.${(i % 10) + 1}`, // spread IPs so perIp doesn't trigger
          tenantId: tenantA,
        });
        expect(res.allowed).toBe(true);
      }

      // 61st request for tenant A should be blocked
      const blockedResA = await checkPublicEndpointRateLimit({
        endpoint: 'cards',
        ip: '192.168.1.15',
        tenantId: tenantA,
      });
      expect(blockedResA.allowed).toBe(false);

      // Meanwhile, tenant B should still be allowed
      const allowedResB = await checkPublicEndpointRateLimit({
        endpoint: 'cards',
        ip: '192.168.1.16',
        tenantId: tenantB,
      });
      expect(allowedResB.allowed).toBe(true);
    });
  });

  describe('3. health_reports_degraded_when_cleanup_stale', () => {
    it('returns degraded status with HTTP 200 when cleanup job is stale', async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          lastRunAt: '2026-10-01T03:00:00.000Z',
          stale: true,
        },
        error: null,
      });

      const response = await GET();
      expect(response.status).toBe(200);

      const body = (await response.json()) as ApiResponse<{
        status: string;
        service: string;
        cleanup: { lastRunAt: string | null; stale: boolean };
      }>;

      expect(body.ok).toBe(true);
      if (!body.ok) {
        throw new Error('Expected ok: true');
      }
      expect(body.data.status).toBe('degraded');
      expect(body.data.cleanup).toEqual({
        lastRunAt: '2026-10-01T03:00:00.000Z',
        stale: true,
      });
    });

    it('returns ok status when cleanup job is fresh', async () => {
      const freshTime = new Date().toISOString();
      mockRpc.mockResolvedValueOnce({
        data: {
          lastRunAt: freshTime,
          stale: false,
        },
        error: null,
      });

      const response = await GET();
      expect(response.status).toBe(200);

      const body = (await response.json()) as ApiResponse<{
        status: string;
        service: string;
        cleanup: { lastRunAt: string | null; stale: boolean };
      }>;

      expect(body.ok).toBe(true);
      if (!body.ok) {
        throw new Error('Expected ok: true');
      }
      expect(body.data.status).toBe('ok');
      expect(body.data.cleanup).toEqual({
        lastRunAt: freshTime,
        stale: false,
      });
    });
  });

  describe('4. leak_banner_rotates_with_generated_tag_id', () => {
    it('evaluateTagLeakSignals safely extracts and validates signal payloads', () => {
      expect(evaluateTagLeakSignals(null)).toEqual([]);
      expect(evaluateTagLeakSignals(undefined)).toEqual([]);
      expect(evaluateTagLeakSignals({ result: 'unauthorized' })).toEqual([]);
      expect(evaluateTagLeakSignals('invalid string')).toEqual([]);

      const raw = [
        {
          tagId: 'tcp_tag_leaked_01',
          distinctCustomers: 12,
          throttleRejections: 4,
        },
        {
          tagId: 'tcp_tag_throttled_02',
          distinctCustomers: 2,
          throttleRejections: 30,
        },
        {
          tagId: '', // invalid, should be filtered out
          distinctCustomers: 10,
          throttleRejections: 0,
        },
      ];

      const signals = evaluateTagLeakSignals(raw);
      expect(signals).toHaveLength(2);
      expect(signals[0]).toEqual({
        tagId: 'tcp_tag_leaked_01',
        distinctCustomers: 12,
        throttleRejections: 4,
      });
      expect(signals[1]).toEqual({
        tagId: 'tcp_tag_throttled_02',
        distinctCustomers: 2,
        throttleRejections: 30,
      });
    });

    it('generates a valid random tag id for rotation and emits security warn log', () => {
      const tenantId = '7c1f0000-0000-4000-8000-000000000001';
      const flaggedTagId = 'tcp_tag_leaked_01';

      // Emulate the banner rotation flow:
      const newTagId = generateRandomTagId();
      expect(newTagId).toMatch(/^tcp_tag_[A-Za-z0-9_-]{8,128}$/);
      expect(newTagId).not.toBe(flaggedTagId);

      const warnLog = logSecurityEvent('warn', 'tag_leak_rotated', {
        tenantId,
        oldTagId: flaggedTagId,
        newTagId,
        reason: 'operator_rotated_leak_signal',
      });

      expect(warnLog.level).toBe('warn');
      expect(warnLog.event).toBe('tag_leak_rotated');
      expect(warnLog.context.tenantId).toBe(tenantId);
      expect(warnLog.context.oldTagId).toBe(flaggedTagId);
      expect(warnLog.context.newTagId).toBe(newTagId);
    });
  });
});
