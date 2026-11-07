import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadOwnerAnalytics, normalizeOwnerAnalytics } from '@/lib/analytics/owner';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

describe('Owner Retention & Loyalty Card Analytics Loader', () => {
  const mockRpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      rpc: mockRpc,
    } as any);
  });

  it('returns_null_when_rpc_returns_unauthorized_or_error', async () => {
    // 1. Database error
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for function get_owner_analytics' },
    });
    const errResult = await loadOwnerAnalytics('user-1', 'tenant-1');
    expect(errResult).toBeNull();

    // 2. Unauthorized result code in payload
    mockRpc.mockResolvedValueOnce({
      data: { result: 'unauthorized' },
      error: null,
    });
    const unauthResult = await loadOwnerAnalytics('user-manager', 'tenant-1');
    expect(unauthResult).toBeNull();

    // 3. Not found result code
    mockRpc.mockResolvedValueOnce({
      data: { result: 'not-found' },
      error: null,
    });
    const notFoundResult = await loadOwnerAnalytics('user-owner', 'tenant-unknown');
    expect(notFoundResult).toBeNull();
  });

  it('normalizes_empty_and_null_analytics_payload', () => {
    // Zero-data empty shop payload (Review Focus 4)
    const rawEmpty = {
      result: 'ok',
      timezone: 'Asia/Manila',
      pulse: {
        totalCards: 0,
        activeMembers30d: 0,
        newCards30d: 0,
        repeatRate30dPct: 0,
        repeatRate14dPct: 0,
        medianDaysBetweenVisits: null,
        rewardsClaimed30d: 0,
        rewardsClaimedTotal: 0,
        rewardsReadyCount: 0,
      },
      retentionHealth: {
        activeRegulars: 0,
        newFirstVisit: 0,
        atRisk: 0,
        dormant: 0,
      },
      cardFunnel: {
        rewardThreshold: 10,
        rewardLabel: 'FREE COFFEE',
        zeroStampsCount: 0,
        earlyProgressCount: 0,
        halfwayPlusCount: 0,
        rewardReadyCount: 0,
        secondCardReturnPct: 0,
        medianDaysToReward: null,
        backedUpRatePct: 0,
      },
      cohorts: [],
      topCustomers: [],
    };

    const normalized = normalizeOwnerAnalytics(rawEmpty, 'UTC');
    expect(normalized).not.toBeNull();
    expect(normalized?.timezone).toBe('Asia/Manila');
    expect(normalized?.pulse.totalCards).toBe(0);
    expect(normalized?.pulse.medianDaysBetweenVisits).toBeNull();
    expect(normalized?.cardFunnel.medianDaysToReward).toBeNull();
    expect(normalized?.cohorts).toEqual([]);
    expect(normalized?.topCustomers).toEqual([]);

    // Fallback when missing arrays or optional fields
    const minimalRaw = {
      result: 'ok',
    };
    const minNormalized = normalizeOwnerAnalytics(minimalRaw, 'Asia/Manila');
    expect(minNormalized).not.toBeNull();
    expect(minNormalized?.timezone).toBe('Asia/Manila');
    expect(minNormalized?.cohorts).toEqual([]);
    expect(minNormalized?.topCustomers).toEqual([]);
    expect(minNormalized?.pulse.medianDaysBetweenVisits).toBeNull();
  });

  it('loads_and_maps_complete_owner_analytics_with_top_10_names', async () => {
    const rawComplete = {
      result: 'ok',
      timezone: 'Asia/Manila',
      pulse: {
        totalCards: 120,
        activeMembers30d: 48,
        newCards30d: 15,
        repeatRate30dPct: 32.5,
        repeatRate14dPct: 21.0,
        medianDaysBetweenVisits: 5.5,
        rewardsClaimed30d: 12,
        rewardsClaimedTotal: 84,
        rewardsReadyCount: 8,
      },
      retentionHealth: {
        activeRegulars: 35,
        newFirstVisit: 13,
        atRisk: 22,
        dormant: 50,
      },
      cardFunnel: {
        rewardThreshold: 10,
        rewardLabel: 'FREE COFFEE',
        zeroStampsCount: 25,
        earlyProgressCount: 42,
        halfwayPlusCount: 45,
        rewardReadyCount: 8,
        secondCardReturnPct: 65.4,
        medianDaysToReward: 24.0,
        backedUpRatePct: 40.0,
      },
      cohorts: [
        {
          cohortMonth: '2026-11',
          newCustomers: 15,
          returned14dPct: 20.0,
          returned30dPct: 33.3,
          returnedEverPct: 33.3,
        },
      ],
      topCustomers: [
        {
          rank: 1,
          customerId: '20000000-0000-4000-8000-0000000000c1',
          cardCode: '20000000',
          customerName: 'Marco Santos',
          isBackedUp: true,
          totalStamps: 35,
          availableStamps: 5,
          rewardsClaimed: 3,
          lastStampedAt: '2026-11-06T10:00:00+08:00',
        },
        {
          rank: 2,
          customerId: '20000000-0000-4000-8000-0000000000c4',
          cardCode: '20000000',
          customerName: 'Guest (Unbacked)',
          isBackedUp: false,
          totalStamps: 12,
          availableStamps: 2,
          rewardsClaimed: 1,
          lastStampedAt: '2026-11-04T12:00:00+08:00',
        },
      ],
    };

    mockRpc.mockResolvedValueOnce({
      data: rawComplete,
      error: null,
    });

    const result = await loadOwnerAnalytics('owner-uuid-1', 'tenant-uuid-1');

    expect(mockRpc).toHaveBeenCalledWith('get_owner_analytics', {
      p_actor: 'owner-uuid-1',
      p_tenant: 'tenant-uuid-1',
    });

    expect(result).not.toBeNull();
    expect(result?.timezone).toBe('Asia/Manila');
    expect(result?.pulse.activeMembers30d).toBe(48);
    expect(result?.retentionHealth.activeRegulars).toBe(35);
    expect(result?.cardFunnel.rewardReadyCount).toBe(8);
    expect(result?.cohorts).toHaveLength(1);
    expect(result?.topCustomers).toHaveLength(2);
    expect(result?.topCustomers[0]?.customerName).toBe('Marco Santos');
    expect(result?.topCustomers[1]?.customerName).toBe('Guest (Unbacked)');
    expect(result?.topCustomers[1]?.isBackedUp).toBe(false);
  });
});
