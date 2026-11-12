import { describe, expect, it } from 'vitest';
import { calculateMilestoneRewardState } from '@/lib/rules/display';

describe('calculateMilestoneRewardState', () => {
  it('returns null if milestone is not configured or disabled', () => {
    expect(calculateMilestoneRewardState(5, 10, null, null, false)).toBeNull();
    expect(calculateMilestoneRewardState(5, 10, undefined, undefined, false)).toBeNull();
    expect(calculateMilestoneRewardState(5, 10, 0, '50% OFF', false)).toBeNull();
    expect(calculateMilestoneRewardState(5, 10, 10, '50% OFF', false)).toBeNull(); // step >= threshold
  });

  it('marks milestone as not eligible when current stamps are below milestone step', () => {
    // 4 stamps out of 10, milestone at 5
    const state = calculateMilestoneRewardState(4, 10, 5, '50% OFF', false);
    expect(state).not.toBeNull();
    expect(state?.isEligible).toBe(false);
    expect(state?.isClaimed).toBe(false);
    expect(state?.cycleIndex).toBe(0);
    expect(state?.step).toBe(5);
    expect(state?.label).toBe('50% OFF');
  });

  it('marks milestone as eligible when customer reaches milestone step in cycle 0', () => {
    // Exactly 5 stamps out of 10
    const state = calculateMilestoneRewardState(5, 10, 5, '50% OFF', false);
    expect(state?.isEligible).toBe(true);
    expect(state?.isClaimed).toBe(false);
    expect(state?.cycleIndex).toBe(0);

    // 7 stamps out of 10 (still in cycle 0, before 10th stamp)
    const state7 = calculateMilestoneRewardState(7, 10, 5, '50% OFF', false);
    expect(state7?.isEligible).toBe(true);
    expect(state7?.isClaimed).toBe(false);
  });

  it('marks milestone as claimed when already claimed in this cycle', () => {
    const state = calculateMilestoneRewardState(6, 10, 5, '50% OFF', true);
    expect(state?.isEligible).toBe(false);
    expect(state?.isClaimed).toBe(true);
    expect(state?.cycleIndex).toBe(0);
  });

  it('expires milestone when card completes 10 stamps, rolling into cycle 1', () => {
    // 10 stamps: completed cycle 0, cycleIndex = 1, currentCycleStamps = 0 (< 5)
    const state = calculateMilestoneRewardState(10, 10, 5, '50% OFF', false);
    expect(state?.cycleIndex).toBe(1);
    expect(state?.isEligible).toBe(false);
    expect(state?.isClaimed).toBe(false);
  });

  it('unlocks milestone again in cycle 1 when reaching 15 stamps (5 stamps into card 2)', () => {
    // 15 stamps: cycleIndex = 1, currentCycleStamps = 5 (>= 5)
    const state = calculateMilestoneRewardState(15, 10, 5, '50% OFF', false);
    expect(state?.cycleIndex).toBe(1);
    expect(state?.isEligible).toBe(true);
    expect(state?.isClaimed).toBe(false);
  });
});
