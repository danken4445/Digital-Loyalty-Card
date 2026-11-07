import 'server-only';

import {
  type OwnerAnalyticsCardFunnel,
  type OwnerAnalyticsCohortRow,
  type OwnerAnalyticsData,
  type OwnerAnalyticsPulse,
  type OwnerAnalyticsRetentionHealth,
  type OwnerAnalyticsTopCustomer,
} from '@/lib/contracts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function toNumber(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function toNullableNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Normalizes and validates the raw JSON payload returned by get_owner_analytics RPC.
 * Returns null if the payload result is not 'ok' or the shape is malformed.
 */
export function normalizeOwnerAnalytics(
  raw: unknown,
  fallbackTimezone = 'Asia/Manila',
): OwnerAnalyticsData | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (record.result !== 'ok') {
    return null;
  }

  const timezone = typeof record.timezone === 'string' && record.timezone.trim()
    ? record.timezone.trim()
    : fallbackTimezone;

  const rawPulse = (record.pulse ?? {}) as Record<string, unknown>;
  const pulse: OwnerAnalyticsPulse = {
    totalCards: toNumber(rawPulse.totalCards, 0),
    activeMembers30d: toNumber(rawPulse.activeMembers30d, 0),
    newCards30d: toNumber(rawPulse.newCards30d, 0),
    repeatRate30dPct: toNumber(rawPulse.repeatRate30dPct, 0),
    repeatRate14dPct: toNumber(rawPulse.repeatRate14dPct, 0),
    medianDaysBetweenVisits: toNullableNumber(rawPulse.medianDaysBetweenVisits),
    rewardsClaimed30d: toNumber(rawPulse.rewardsClaimed30d, 0),
    rewardsClaimedTotal: toNumber(rawPulse.rewardsClaimedTotal, 0),
    rewardsReadyCount: toNumber(rawPulse.rewardsReadyCount, 0),
  };

  const rawHealth = (record.retentionHealth ?? {}) as Record<string, unknown>;
  const retentionHealth: OwnerAnalyticsRetentionHealth = {
    activeRegulars: toNumber(rawHealth.activeRegulars, 0),
    newFirstVisit: toNumber(rawHealth.newFirstVisit, 0),
    atRisk: toNumber(rawHealth.atRisk, 0),
    dormant: toNumber(rawHealth.dormant, 0),
  };

  const rawFunnel = (record.cardFunnel ?? {}) as Record<string, unknown>;
  const cardFunnel: OwnerAnalyticsCardFunnel = {
    rewardThreshold: toNumber(rawFunnel.rewardThreshold, 10),
    rewardLabel: typeof rawFunnel.rewardLabel === 'string' && rawFunnel.rewardLabel.trim()
      ? rawFunnel.rewardLabel.trim()
      : 'FREE COFFEE',
    zeroStampsCount: toNumber(rawFunnel.zeroStampsCount, 0),
    earlyProgressCount: toNumber(rawFunnel.earlyProgressCount, 0),
    halfwayPlusCount: toNumber(rawFunnel.halfwayPlusCount, 0),
    rewardReadyCount: toNumber(rawFunnel.rewardReadyCount, 0),
    secondCardReturnPct: toNumber(rawFunnel.secondCardReturnPct, 0),
    medianDaysToReward: toNullableNumber(rawFunnel.medianDaysToReward),
    backedUpRatePct: toNumber(rawFunnel.backedUpRatePct, 0),
  };

  const rawCohorts = Array.isArray(record.cohorts) ? record.cohorts : [];
  const cohorts: OwnerAnalyticsCohortRow[] = rawCohorts.map((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      cohortMonth: typeof r.cohortMonth === 'string' ? r.cohortMonth : '',
      newCustomers: toNumber(r.newCustomers, 0),
      returned14dPct: toNumber(r.returned14dPct, 0),
      returned30dPct: toNumber(r.returned30dPct, 0),
      returnedEverPct: toNumber(r.returnedEverPct, 0),
    };
  });

  const rawTop = Array.isArray(record.topCustomers) ? record.topCustomers : [];
  const topCustomers: OwnerAnalyticsTopCustomer[] = rawTop.map((row, idx) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const customerId = typeof r.customerId === 'string' ? r.customerId : '';
    const fallbackCode = customerId ? customerId.replace(/-/g, '').slice(0, 8).toUpperCase() : 'UNKNOWN';

    return {
      rank: toNumber(r.rank, idx + 1),
      customerId,
      cardCode: typeof r.cardCode === 'string' && r.cardCode ? r.cardCode : fallbackCode,
      customerName: typeof r.customerName === 'string' && r.customerName.trim()
        ? r.customerName.trim()
        : 'Guest (Unbacked)',
      isBackedUp: Boolean(r.isBackedUp),
      totalStamps: toNumber(r.totalStamps, 0),
      availableStamps: toNumber(r.availableStamps, 0),
      rewardsClaimed: toNumber(r.rewardsClaimed, 0),
      lastStampedAt: typeof r.lastStampedAt === 'string' ? r.lastStampedAt : null,
    };
  });

  return {
    timezone,
    pulse,
    retentionHealth,
    cardFunnel,
    cohorts,
    topCustomers,
  };
}

/**
 * Loads retention, card funnel, cohort, and top customer analytics for the shop owner.
 * Strictly calls the get_owner_analytics RPC using the admin service client.
 */
export async function loadOwnerAnalytics(
  actorId: string,
  tenantId: string,
  fallbackTimezone = 'Asia/Manila',
): Promise<OwnerAnalyticsData | null> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.rpc('get_owner_analytics', {
    p_actor: actorId,
    p_tenant: tenantId,
  });

  if (error) {
    console.error('[loadOwnerAnalytics] get_owner_analytics RPC error:', error);
    return null;
  }
  if (!data) {
    return null;
  }

  return normalizeOwnerAnalytics(data, fallbackTimezone);
}
