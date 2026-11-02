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

const manilaDateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: SHOP_CONFIG.timezone,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Formats a timestamp into a medium date and short time string (e.g. 'Nov 2, 2026, 3:30 PM')
 * in Asia/Manila timezone.
 * Pure function: timestamp is passed explicitly.
 */
export function formatManilaDateTime(timestamp: Date | string | number): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return manilaDateTimeFormatter.format(date);
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
