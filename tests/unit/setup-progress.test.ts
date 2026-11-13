import { describe, expect, it } from 'vitest';
import {
  computeSetupProgress,
  describeMinutes,
  hasCustomLook,
  isSetupStepId,
  startOfTodayInZone,
} from '@/lib/console/setup-progress';
import { readableAccentFor } from '@/components/console/BrandSettingsForm';
import { getContrastRatio } from '@/lib/brand/contrast';

const blank = { brand: {}, rewardSaved: false, activeTapCards: 0, teamSize: 1, totalStamps: 0 };

describe('shop setup checklist', () => {
  it('starts with nothing done and points at the first step', () => {
    const p = computeSetupProgress('shop-a', blank);
    expect(p.doneCount).toBe(0);
    expect(p.isComplete).toBe(false);
    expect(p.nextStep?.id).toBe('look');
    expect(p.nextStep?.href).toBe('/staff/shop-a/setup?step=look');
  });

  it('is complete once required steps are done, even without inviting a team', () => {
    const p = computeSetupProgress('shop-a', {
      brand: { logoUrl: 'https://x/logo.png' },
      rewardSaved: true,
      activeTapCards: 1,
      teamSize: 1,
      totalStamps: 3,
    });
    expect(p.isComplete).toBe(true);
    expect(p.requiredDoneCount).toBe(p.requiredCount);
    // The optional team step is still offered as the next thing to do
    expect(p.nextStep?.id).toBe('team');
  });

  it('un-ticks the tap card step when no active card remains', () => {
    const p = computeSetupProgress('shop-a', { ...blank, activeTapCards: 0 });
    expect(p.steps.find((s) => s.id === 'tapCard')?.done).toBe(false);
  });

  it('treats default colours as not yet personalised', () => {
    expect(hasCustomLook({})).toBe(false);
    expect(hasCustomLook({ primaryColor: '#0a0a0a', accentColor: '#ffffff' })).toBe(false);
    expect(hasCustomLook({ primaryColor: '#3B2418' })).toBe(true);
  });

  it('validates step ids from the URL', () => {
    expect(isSetupStepId('reward')).toBe(true);
    expect(isSetupStepId('../admin')).toBe(false);
    expect(isSetupStepId(undefined)).toBe(false);
  });
});

describe('plain-language helpers', () => {
  it('describes minutes the way people say them', () => {
    expect(describeMinutes(0)).toBe('no wait');
    expect(describeMinutes(1)).toBe('1 minute');
    expect(describeMinutes(30)).toBe('30 minutes');
    expect(describeMinutes(60)).toBe('1 hour');
    expect(describeMinutes(90)).toBe('1 hour 30 min');
    expect(describeMinutes(120)).toBe('2 hours');
  });

  it('finds midnight in the shop timezone', () => {
    // 2026-11-13 01:30 in Manila (UTC+8) is 2026-11-12 17:30 UTC
    const now = new Date('2026-11-12T17:30:00Z');
    expect(startOfTodayInZone('Asia/Manila', now).toISOString()).toBe('2026-11-12T16:00:00.000Z');
  });

  it('"Fix it for me" always picks a readable text colour', () => {
    for (const bg of ['#FFFFFF', '#0A0A0A', '#FF6F07', '#F6EFE4', '#12324A', '#808080']) {
      expect(getContrastRatio(readableAccentFor(bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
