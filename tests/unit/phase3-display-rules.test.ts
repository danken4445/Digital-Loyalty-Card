import { describe, expect, it, vi } from 'vitest';
import {
  calculateStampProgress,
  formatManilaDate,
  formatManilaDateTime,
  getRemainingCooldownMinutes,
} from '@/lib/rules/display';
import { STAMP_RULES } from '@/lib/config';

describe('lib/rules/display', () => {
  describe('calculateStampProgress', () => {
    it('handles 0 stamps correctly (empty card)', () => {
      const progress = calculateStampProgress(0);
      expect(progress).toEqual({
        availableStamps: 0,
        rewardThreshold: 10,
        clampedStamps: 0,
        stampsRemaining: 10,
        progressPercent: 0,
        isMilestoneReached: false,
        isRewardReady: false,
        progressText: '10 more stamps to go',
      });
    });

    it('handles 1 stamp correctly', () => {
      const progress = calculateStampProgress(1);
      expect(progress).toEqual({
        availableStamps: 1,
        rewardThreshold: 10,
        clampedStamps: 1,
        stampsRemaining: 9,
        progressPercent: 10,
        isMilestoneReached: false,
        isRewardReady: false,
        progressText: '9 more stamps to go',
      });
    });

    it('handles 4 stamps correctly (just below milestone)', () => {
      const progress = calculateStampProgress(4);
      expect(progress).toEqual({
        availableStamps: 4,
        rewardThreshold: 10,
        clampedStamps: 4,
        stampsRemaining: 6,
        progressPercent: 40,
        isMilestoneReached: false,
        isRewardReady: false,
        progressText: '6 more stamps to go',
      });
    });

    it('handles 5 stamps correctly (reaches milestoneStep)', () => {
      const progress = calculateStampProgress(5);
      expect(progress).toEqual({
        availableStamps: 5,
        rewardThreshold: 10,
        clampedStamps: 5,
        stampsRemaining: 5,
        progressPercent: 50,
        isMilestoneReached: true,
        isRewardReady: false,
        progressText: '5 more stamps to go',
      });
    });

    it('handles 9 stamps correctly ("1 more stamp to go!" with exclamation)', () => {
      const progress = calculateStampProgress(9);
      expect(progress).toEqual({
        availableStamps: 9,
        rewardThreshold: 10,
        clampedStamps: 9,
        stampsRemaining: 1,
        progressPercent: 90,
        isMilestoneReached: true,
        isRewardReady: false,
        progressText: '1 more stamp to go!',
      });
    });

    it('handles 10 stamps correctly (reward ready threshold)', () => {
      const progress = calculateStampProgress(10);
      expect(progress).toEqual({
        availableStamps: 10,
        rewardThreshold: 10,
        clampedStamps: 10,
        stampsRemaining: 0,
        progressPercent: 100,
        isMilestoneReached: true,
        isRewardReady: true,
        progressText: 'Reward ready! Show your QR code to staff.',
      });
    });

    it('handles 12 stamps correctly (over threshold clamped to 10 for bar)', () => {
      const progress = calculateStampProgress(12);
      expect(progress).toEqual({
        availableStamps: 12,
        rewardThreshold: 10,
        clampedStamps: 10,
        stampsRemaining: 0,
        progressPercent: 100,
        isMilestoneReached: true,
        isRewardReady: true,
        progressText: 'Reward ready! Show your QR code to staff.',
      });
    });

    it('normalizes negative numbers to 0', () => {
      const progress = calculateStampProgress(-3);
      expect(progress).toEqual({
        availableStamps: 0,
        rewardThreshold: 10,
        clampedStamps: 0,
        stampsRemaining: 10,
        progressPercent: 0,
        isMilestoneReached: false,
        isRewardReady: false,
        progressText: '10 more stamps to go',
      });
    });

    it('normalizes NaN and non-finite numbers to 0', () => {
      const nanProgress = calculateStampProgress(Number.NaN);
      expect(nanProgress.availableStamps).toBe(0);
      expect(nanProgress.progressPercent).toBe(0);

      const infinityProgress = calculateStampProgress(Number.POSITIVE_INFINITY);
      expect(infinityProgress.availableStamps).toBe(0);
    });

    it('floors fractional stamps to integer', () => {
      const progress = calculateStampProgress(4.9);
      expect(progress.availableStamps).toBe(4);
      expect(progress.clampedStamps).toBe(4);
      expect(progress.stampsRemaining).toBe(6);
      expect(progress.progressPercent).toBe(40);
    });

    it('respects custom rewardThreshold parameter', () => {
      const progress = calculateStampProgress(3, 5);
      expect(progress).toEqual({
        availableStamps: 3,
        rewardThreshold: 5,
        clampedStamps: 3,
        stampsRemaining: 2,
        progressPercent: 60,
        isMilestoneReached: false,
        isRewardReady: false,
        progressText: '2 more stamps to go',
      });

      const readyProgress = calculateStampProgress(5, 5);
      expect(readyProgress.isRewardReady).toBe(true);
      expect(readyProgress.progressText).toBe('Reward ready! Show your QR code to staff.');
    });
  });

  describe('formatManilaDate & formatManilaDateTime', () => {
    // 2026-11-01T15:59:59Z is 23:59:59 on Nov 1 in Asia/Manila (UTC+8)
    const beforeMidnightUtc = '2026-11-01T15:59:59Z';
    // 2026-11-01T16:00:00Z is 00:00:00 on Nov 2 in Asia/Manila (UTC+8)
    const afterMidnightUtc = '2026-11-01T16:00:00Z';

    it('formats date across UTC midnight boundary into Asia/Manila calendar date', () => {
      expect(formatManilaDate(beforeMidnightUtc)).toBe('2026-11-01');
      expect(formatManilaDate(afterMidnightUtc)).toBe('2026-11-02');
    });

    it('formats date/time across UTC midnight boundary into Asia/Manila localized string', () => {
      expect(formatManilaDateTime(beforeMidnightUtc)).toBe('Nov 1, 2026, 11:59 PM');
      expect(formatManilaDateTime(afterMidnightUtc)).toBe('Nov 2, 2026, 12:00 AM');
    });

    it('formats an afternoon timestamp in Asia/Manila correctly', () => {
      // 07:30 UTC + 8h = 15:30 (3:30 PM)
      const afternoonUtc = '2026-11-02T07:30:00Z';
      expect(formatManilaDate(afternoonUtc)).toBe('2026-11-02');
      expect(formatManilaDateTime(afternoonUtc)).toBe('Nov 2, 2026, 3:30 PM');
    });

    it('accepts Date objects, ISO strings, and epoch timestamps', () => {
      const dateObj = new Date('2026-11-02T07:30:00Z');
      const isoStr = '2026-11-02T07:30:00Z';
      const epochMs = dateObj.getTime();

      expect(formatManilaDate(dateObj)).toBe('2026-11-02');
      expect(formatManilaDate(isoStr)).toBe('2026-11-02');
      expect(formatManilaDate(epochMs)).toBe('2026-11-02');

      expect(formatManilaDateTime(dateObj)).toBe('Nov 2, 2026, 3:30 PM');
      expect(formatManilaDateTime(isoStr)).toBe('Nov 2, 2026, 3:30 PM');
      expect(formatManilaDateTime(epochMs)).toBe('Nov 2, 2026, 3:30 PM');
    });
  });

  describe('getRemainingCooldownMinutes', () => {
    const baseTime = '2026-11-01T10:00:00.000Z';

    it('returns 0 when lastStampedAt is null', () => {
      expect(getRemainingCooldownMinutes(null, baseTime)).toBe(0);
    });

    it('returns full cooldown (30m) when 0m have elapsed', () => {
      const now = baseTime;
      expect(getRemainingCooldownMinutes(baseTime, now)).toBe(30);
    });

    it('returns 15m remaining when 15m have elapsed', () => {
      const now = '2026-11-01T10:15:00.000Z';
      expect(getRemainingCooldownMinutes(baseTime, now)).toBe(15);
    });

    it('returns 1m remaining when 29m01s have elapsed (Math.ceil round-up)', () => {
      // 29 minutes and 1 second elapsed -> 59 seconds remaining -> ceil to 1 minute
      const now = '2026-11-01T10:29:01.000Z';
      expect(getRemainingCooldownMinutes(baseTime, now)).toBe(1);
    });

    it('returns 0 when exactly 30m00s have elapsed', () => {
      const now = '2026-11-01T10:30:00.000Z';
      expect(getRemainingCooldownMinutes(baseTime, now)).toBe(0);
    });

    it('returns 0 when 45m have elapsed (cooldown long expired)', () => {
      const now = '2026-11-01T10:45:00.000Z';
      expect(getRemainingCooldownMinutes(baseTime, now)).toBe(0);
    });

    it('supports Date instances and numeric epoch timestamps', () => {
      const last = new Date(baseTime);
      const now = new Date('2026-11-01T10:10:00.000Z');
      expect(getRemainingCooldownMinutes(last, now)).toBe(20);
      expect(getRemainingCooldownMinutes(last.getTime(), now.getTime())).toBe(20);
    });

    it('supports custom cooldownMinutes parameter', () => {
      const now = '2026-11-01T10:04:00.000Z';
      // 4 minutes elapsed with 10 minute cooldown -> 6 minutes remaining
      expect(getRemainingCooldownMinutes(baseTime, now, 10)).toBe(6);
    });

    it('caps return value at cooldownMinutes even if clock skew causes now < lastStampedAt', () => {
      const clockSkewNow = '2026-11-01T09:55:00.000Z';
      expect(getRemainingCooldownMinutes(baseTime, clockSkewNow)).toBe(STAMP_RULES.cooldownMinutes);
    });

    it('returns 0 for invalid date inputs', () => {
      expect(getRemainingCooldownMinutes('invalid-date', baseTime)).toBe(0);
      expect(getRemainingCooldownMinutes(baseTime, 'invalid-date')).toBe(0);
    });
  });

  describe('purity and clock isolation', () => {
    it('never calls Date.now() during execution', () => {
      const dateNowSpy = vi.spyOn(Date, 'now');

      calculateStampProgress(5);
      formatManilaDate('2026-11-01T10:00:00Z');
      formatManilaDateTime('2026-11-01T10:00:00Z');
      getRemainingCooldownMinutes('2026-11-01T10:00:00Z', '2026-11-01T10:15:00Z');

      expect(dateNowSpy).not.toHaveBeenCalled();
      dateNowSpy.mockRestore();
    });
  });
});
