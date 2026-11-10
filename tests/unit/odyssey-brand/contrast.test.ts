import { describe, expect, test, vi } from 'vitest';
import { COLORS, COLOURWAYS, COLOURWAY_FILLS, CONTRAST } from '@/lib/brand/odyssey/brandTokens';
import { colourwayForBackground, contrastRatio } from '@/lib/brand/odyssey/contrast';

test('ratios match the bible (page 14)', () => {
  expect(contrastRatio(COLORS.navy, COLORS.warmWhite)).toBeCloseTo(14.16, 1);
  expect(contrastRatio(COLORS.navy, COLORS.white)).toBeCloseTo(15.06, 1);
  expect(contrastRatio(COLORS.navy, COLORS.orange)).toBeCloseTo(5.4, 1);
  expect(contrastRatio(COLORS.ember, COLORS.warmWhite)).toBeCloseTo(5.01, 1);
  expect(contrastRatio(COLORS.orange, COLORS.warmWhite)).toBeCloseTo(2.62, 1);
  expect(contrastRatio(COLORS.white, COLORS.orange)).toBeCloseTo(2.79, 1);
});

describe.each(COLOURWAYS)('%s colourway on its approved backgrounds', (cw) => {
  const f = COLOURWAY_FILLS[cw];
  test.each(f.backgrounds.map((b) => [b]))(
    'logo outer colour >= 3:1 and descriptor >= 4.5:1 on %s',
    (bg) => {
      expect(contrastRatio(f.letters, bg)).toBeGreaterThanOrEqual(CONTRAST.logoMin);
      expect(contrastRatio(f.descriptor, bg)).toBeGreaterThanOrEqual(CONTRAST.textMin);
    },
  );
});

test('colourwayForBackground chooses by background', () => {
  const quiet = vi.fn();
  const pick = (hex: string) => colourwayForBackground(hex, quiet).colourway;
  expect(pick(COLORS.warmWhite)).toBe('color');
  expect(pick(COLORS.white)).toBe('color');
  expect(pick(COLORS.mist)).toBe('color');
  expect(pick(COLORS.sand)).toBe('color');
  expect(pick(COLORS.navy)).toBe('reverse');
  expect(pick(COLORS.orange)).toBe('navy');
  expect(pick('#3A4B5F')).toBe('white');
  expect(pick('#000000')).toBe('white');
  expect(quiet).not.toHaveBeenCalled();
});

test('never returns anything outside the five colourways, and always reaches 3:1 for opaque colours', () => {
  const warn = vi.fn();
  for (let v = 0; v <= 255; v += 5) {
    for (const hex of [
      `#${v.toString(16).padStart(2, '0').repeat(3)}`,
      `#FF${v.toString(16).padStart(2, '0')}07`,
    ]) {
      const choice = colourwayForBackground(hex, warn);
      expect(COLOURWAYS).toContain(choice.colourway);
      expect(choice.meetsMinimum).toBe(true);
    }
  }
  expect(warn).not.toHaveBeenCalled();
});

test('rejects malformed input', () => {
  expect(() => colourwayForBackground('navy')).toThrow();
});
