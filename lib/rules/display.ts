import { SHOP_CONFIG, STAMP_RULES } from '@/lib/config';
import type { StampProgressDisplay } from '@/lib/contracts';

/**
 * Pure display calculation for customer stamp card progress.
 * Note: Authoritative business logic and stamp issuance live in Postgres SQL functions.
 * This helper calculates UI display state (progress bar, milestone, human copy).
 */
export function calculateStampProgress(
  availableStamps: number,
  rewardThreshold: number = STAMP_RULES.rewardThreshold,
): StampProgressDisplay {
  const normalized = Number.isFinite(availableStamps)
    ? Math.max(0, Math.floor(availableStamps))
    : 0;
  const clampedStamps = Math.min(normalized, rewardThreshold);
  const stampsRemaining = Math.max(0, rewardThreshold - normalized);
  const progressPercent =
    rewardThreshold > 0 ? Math.min(100, Math.round((clampedStamps / rewardThreshold) * 100)) : 100;
  const isMilestoneReached = normalized >= STAMP_RULES.milestoneStep;
  const isRewardReady = normalized >= rewardThreshold;

  let progressText: string;
  if (isRewardReady) {
    progressText = 'Reward ready! Show your QR code to staff.';
  } else if (stampsRemaining === 1) {
    progressText = '1 more stamp to go!';
  } else {
    progressText = `${stampsRemaining} more stamps to go`;
  }

  return {
    availableStamps: normalized,
    rewardThreshold,
    clampedStamps,
    stampsRemaining,
    progressPercent,
    isMilestoneReached,
    isRewardReady,
    progressText,
  };
}

const manilaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_CONFIG.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Formats a timestamp into an ISO calendar date (YYYY-MM-DD) in Asia/Manila timezone.
 * Pure function: timestamp is passed explicitly.
 */
export function formatManilaDate(timestamp: Date | string | number): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return manilaDateFormatter.format(date);
}

const MAX_FORMATTER_CACHE_SIZE = 100;

export const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats a timestamp into a medium date and short time string (e.g. 'Nov 2, 2026, 3:30 PM')
 * in the given IANA timezone.
 * Pure function: timestamp is passed explicitly.
 * Memoizes Intl.DateTimeFormat instances by timezone up to MAX_FORMATTER_CACHE_SIZE to prevent leaks.
 */
export function formatDateTimeInZone(timestamp: Date | string | number, timeZone: string): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    if (formatterCache.size >= MAX_FORMATTER_CACHE_SIZE) {
      const oldestKey = formatterCache.keys().next().value;
      if (oldestKey) {
        formatterCache.delete(oldestKey);
      }
    }
    formatter = new Intl.DateTimeFormat('en-PH', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter.format(date);
}

/**
 * Formats a timestamp into a medium date and short time string in Asia/Manila timezone.
 * Pure function: timestamp is passed explicitly.
 */
export function formatManilaDateTime(timestamp: Date | string | number): string {
  return formatDateTimeInZone(timestamp, SHOP_CONFIG.timezone);
}

/**
 * Pure display calculation of how many whole minutes remain in a customer's cooldown window.
 * Returns 0 if lastStampedAt is null or cooldown has already elapsed.
 * Ceiling is applied so that 29m01s elapsed of a 30m window displays as 1 minute remaining.
 * Never accesses system clock; explicit `now` parameter must be provided.
 */
export function getRemainingCooldownMinutes(
  lastStampedAt: Date | string | number | null,
  now: Date | string | number,
  cooldownMinutes: number = STAMP_RULES.cooldownMinutes,
): number {
  if (lastStampedAt === null || lastStampedAt === undefined) {
    return 0;
  }

  const lastMs =
    lastStampedAt instanceof Date ? lastStampedAt.getTime() : new Date(lastStampedAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) {
    return 0;
  }

  const cooldownMs = cooldownMinutes * 60 * 1000;
  const elapsedMs = nowMs - lastMs;
  const remainingMs = cooldownMs - elapsedMs;

  if (remainingMs <= 0) {
    return 0;
  }

  return Math.min(cooldownMinutes, Math.ceil(remainingMs / (60 * 1000)));
}

/**
 * Pure display calculation of how many full loyalty cards the customer has completed.
 * Based on lifetime total stamps earned divided by the reward threshold (10 stamps per card).
 */
export function calculateCardsCompleted(
  totalStamps: number,
  rewardThreshold: number = STAMP_RULES.rewardThreshold,
): number {
  const normalized = Number.isFinite(totalStamps) ? Math.max(0, Math.floor(totalStamps)) : 0;
  return rewardThreshold > 0 ? Math.floor(normalized / rewardThreshold) : 0;
}

const manilaMemberDateFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: SHOP_CONFIG.timezone,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Formats a join timestamp into a human-friendly date string for member display
 * (e.g. 'Nov 2, 2026') in Asia/Manila timezone.
 * Pure function: timestamp is passed explicitly.
 */
export function formatMemberSince(timestamp: Date | string | number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return 'Recently';
  }
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return 'Recently';
    }
    return manilaMemberDateFormatter.format(date);
  } catch {
    return 'Recently';
  }
}


/** Abbreviations Intl's locale data renders as "GMT+n" but that customers recognise. */
const TIME_ZONE_ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
  'Asia/Manila': 'PHT',
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Singapore': 'SGT',
  'Asia/Hong_Kong': 'HKT',
});

/**
 * Short label for an IANA timezone, shown after a local time (e.g. "PHT", "JST", "EST").
 * Falls back to Intl's short name (such as "GMT+7") for zones without a well-known abbreviation.
 */
export function formatTimeZoneAbbreviation(timeZone: string, at: Date | string | number = Date.now()): string {
  const known = TIME_ZONE_ABBREVIATIONS[timeZone];
  if (known) {
    return known;
  }
  try {
    const date = at instanceof Date ? at : new Date(at);
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
