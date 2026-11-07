import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).React = React;

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
});
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/staff/shop-a/settings/analytics',
  redirect: (url: string) => mockRedirect(url),
  notFound: () => mockNotFound(),
}));

vi.mock('@/lib/console/guard', () => ({
  enforceConsolePageAccess: vi.fn(),
}));

import { loadOwnerAnalytics, normalizeOwnerAnalytics } from '@/lib/analytics/owner';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ConsoleTabNav } from '@/components/console/ConsoleTabNav';
import { OwnerAnalyticsDashboard } from '@/components/console/OwnerAnalyticsDashboard';
import OwnerAnalyticsPage from '@/app/staff/[slug]/settings/analytics/page';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import type { OwnerAnalyticsData } from '@/lib/contracts';

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

  describe('UI, Guard & Navigation Integration', () => {
    const mockAnalyticsData: OwnerAnalyticsData = {
      timezone: 'Asia/Manila',
      pulse: {
        totalCards: 100,
        activeMembers30d: 45,
        newCards30d: 12,
        repeatRate30dPct: 35.5,
        repeatRate14dPct: 22.0,
        medianDaysBetweenVisits: 6.0,
        rewardsClaimed30d: 10,
        rewardsClaimedTotal: 50,
        rewardsReadyCount: 7,
      },
      retentionHealth: {
        activeRegulars: 30,
        newFirstVisit: 15,
        atRisk: 20,
        dormant: 35,
      },
      cardFunnel: {
        rewardThreshold: 10,
        rewardLabel: 'FREE COFFEE',
        zeroStampsCount: 20,
        earlyProgressCount: 35,
        halfwayPlusCount: 38,
        rewardReadyCount: 7,
        secondCardReturnPct: 60.0,
        medianDaysToReward: 21.5,
        backedUpRatePct: 42.0,
      },
      cohorts: [
        {
          cohortMonth: '2026-11',
          newCustomers: 12,
          returned14dPct: 25.0,
          returned30dPct: 41.7,
          returnedEverPct: 41.7,
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
          customerId: '20000000-0000-4000-8000-0000000000c2',
          cardCode: '20000000',
          customerName: 'Guest (Unbacked)',
          isBackedUp: false,
          totalStamps: 14,
          availableStamps: 4,
          rewardsClaimed: 1,
          lastStampedAt: '2026-11-04T12:00:00+08:00',
        },
      ],
    };

    it('analytics_page_blocks_manager_and_staff', async () => {
      // 1. When non-owner visits, guard redirects
      vi.mocked(enforceConsolePageAccess).mockImplementationOnce(async () => {
        mockRedirect('/staff/login?error=forbidden');
        throw new Error('NEXT_REDIRECT: /staff/login?error=forbidden');
      });

      await expect(
        OwnerAnalyticsPage({ params: Promise.resolve({ slug: 'shop-b' }) }),
      ).rejects.toThrow('NEXT_REDIRECT: /staff/login?error=forbidden');

      expect(enforceConsolePageAccess).toHaveBeenCalledWith(
        'shop-b',
        'owner',
        '/staff/shop-b/settings/analytics',
      );

      // 2. When owner visits and analytics load succeeds, page renders
      vi.mocked(enforceConsolePageAccess).mockResolvedValueOnce({
        staff: {
          userId: 'owner-id',
          email: 'owner@test.local',
          displayName: 'Owner User',
          tenantId: 'tenant-123',
          tenantSlug: 'shop-a',
          tenantName: 'Cafe Shop A',
          role: 'owner',
          active: true,
          memberships: [],
        },
        tenantId: 'tenant-123',
      });

      mockRpc.mockResolvedValueOnce({
        data: {
          result: 'ok',
          ...mockAnalyticsData,
        },
        error: null,
      });

      const pageElement = await OwnerAnalyticsPage({
        params: Promise.resolve({ slug: 'shop-a' }),
      });
      const html = renderToStaticMarkup(pageElement);

      expect(html).toContain('Owner Analytics');
      expect(html).toContain('Marco Santos');
      expect(html).toContain('35.5%');
    });

    it('dashboard_renders_retention_funnel_and_top_10_customer_names', () => {
      const html = renderToStaticMarkup(
        React.createElement(OwnerAnalyticsDashboard, {
          data: mockAnalyticsData,
          shopName: 'Cafe Shop A',
        }),
      );

      // 2x2 Headline Pulse
      expect(html).toContain('35.5%');
      expect(html).toContain('45');
      expect(html).toContain('6.0 days');
      expect(html).toContain('50');

      // Retention Health
      expect(html).toContain('Active Regulars');
      expect(html).toContain('New (1st Visit)');
      expect(html).toContain('At-Risk');
      expect(html).toContain('Dormant');

      // Card Funnel
      expect(html).toContain('0 Stamps');
      expect(html).toContain('Early Progress');
      expect(html).toContain('Halfway+');
      expect(html).toContain('Ready to Redeem');
      expect(html).toContain('60.0%');
      expect(html).toContain('21.5 days');
      expect(html).toContain('42.0%');

      // Cohorts
      expect(html).toContain('2026-11');

      // Top 10 Customers with name resolution
      expect(html).toContain('Marco Santos');
      expect(html).toContain('#20000000');
      expect(html).toContain('Guest (Unbacked)');
      expect(html).toContain('Backed Up');
    });

    it('console_tab_nav_shows_analytics_tab_for_owner_only', () => {
      // 1. Owner sees Analytics tab first
      const ownerHtml = renderToStaticMarkup(
        React.createElement(ConsoleTabNav, {
          slug: 'shop-a',
          role: 'owner',
        }),
      );
      expect(ownerHtml).toContain('/staff/shop-a/settings/analytics');
      expect(ownerHtml).toContain('Analytics');

      // 2. Manager does not see Analytics tab
      const managerHtml = renderToStaticMarkup(
        React.createElement(ConsoleTabNav, {
          slug: 'shop-a',
          role: 'manager',
        }),
      );
      expect(managerHtml).not.toContain('/staff/shop-a/settings/analytics');

      // 3. Staff does not see Analytics tab
      const staffHtml = renderToStaticMarkup(
        React.createElement(ConsoleTabNav, {
          slug: 'shop-a',
          role: 'staff',
        }),
      );
      expect(staffHtml).not.toContain('/staff/shop-a/settings/analytics');

      // 4. Default without role does not see Analytics tab
      const defaultHtml = renderToStaticMarkup(
        React.createElement(ConsoleTabNav, {
          slug: 'shop-a',
        }),
      );
      expect(defaultHtml).not.toContain('/staff/shop-a/settings/analytics');
    });
  });
});
