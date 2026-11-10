import { describe, expect, test } from 'vitest';
import { CLEAR_SPACE, LAYOUTS, MONOGRAM, X } from '@/lib/brand/odyssey/brandTokens';
import { composeLogo } from '@/lib/brand/odyssey/composeLogo';
import {
  LETTERS_WITH_RIM,
  RIM,
  SAIL,
  WORDMARK_HORIZONTAL,
  WORDMARK_STACKED,
} from '@/lib/brand/odyssey/logoPaths';
import { allPoints, bbox, nth, onCurvePoints } from './helpers';

const { x: OX, y: OY } = MONOGRAM.masterOrigin;

describe('monogram geometry (measured from the approved path data)', () => {
  const box = bbox(allPoints(...LETTERS_WITH_RIM));

  test('monogram is 736u wide and 360u tall', () => {
    expect(box.x1 - OX).toBe(0);
    expect(box.y1 - OY).toBe(0);
    expect(box.width).toBe(736);
    expect(box.height).toBe(360);
    expect(MONOGRAM.width).toBe(2 * MONOGRAM.pitch + MONOGRAM.letterWidth);
  });

  test('X = navy wall = 40u, rim = 18u', () => {
    const letterO = onCurvePoints(LETTERS_WITH_RIM[0]);
    expect(bbox(nth(letterO, 1)).x1 - bbox(nth(letterO, 0)).x1).toBe(40);
    expect(X).toBe(40);
    const rimO = onCurvePoints(RIM[0]);
    expect(bbox(nth(rimO, 1)).x1 - bbox(nth(rimO, 0)).x1).toBe(MONOGRAM.rim);
  });

  test('each letter 272u wide, pitch 232u, overlap 40u', () => {
    const lefts = LETTERS_WITH_RIM.map((d) => bbox(onCurvePoints(d).flat()));
    lefts.forEach((b) => expect(b.width).toBe(272));
    expect(nth(lefts, 1).x1 - nth(lefts, 0).x1).toBe(232);
    expect(nth(lefts, 0).x2 - nth(lefts, 1).x1).toBe(40);
  });

  test('C opening is 104u between horizontal terminals', () => {
    const ys = onCurvePoints(LETTERS_WITH_RIM[2])
      .flat()
      .filter((p) => p.x === 968)
      .map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(104);
  });

  test('mast 14u, mast-to-sail gap 9u', () => {
    const sailParts = onCurvePoints(SAIL);
    const m = bbox(nth(sailParts, 0));
    expect(m.width).toBe(14);
    expect(bbox(nth(sailParts, 1)).x1 - m.x2).toBe(9);
  });
});

describe('stacked logo (approved)', () => {
  const wm = bbox(allPoints(WORDMARK_STACKED));
  // Flat-topped glyphs (D, Y, E) give the cap height without the O's overshoot.
  const capTop = 444.28;

  test('wordmark is about 618u wide = 84% of the monogram, centred', () => {
    // Master measures 618.5u (on-curve points); the bible rounds to 618u.
    expect(Math.abs(wm.width - LAYOUTS.stacked.wordmarkWidth)).toBeLessThanOrEqual(1);
    expect(wm.width / MONOGRAM.width).toBeCloseTo(0.84, 2);
    expect((wm.x1 + wm.x2) / 2).toBeCloseTo(MONOGRAM.width / 2, 0);
  });

  test('cap height 66u, gap 84u, total 736 x 510u', () => {
    expect(510 - capTop).toBeCloseTo(LAYOUTS.stacked.wordmarkCapHeight, 0);
    expect(capTop - MONOGRAM.height).toBeCloseTo(LAYOUTS.stacked.gap, 0);
    const art = composeLogo('stacked', 'color');
    expect([art.width, art.height]).toEqual([736, 510]);
  });

  test('with 2X clear space: 896 x 670u', () => {
    expect(CLEAR_SPACE).toBe(80);
    expect([
      LAYOUTS.stacked.width + 2 * CLEAR_SPACE,
      LAYOUTS.stacked.height + 2 * CLEAR_SPACE,
    ]).toEqual([896, 670]);
  });
});

describe('horizontal logo (proposed, measured from its master)', () => {
  const wm = bbox(allPoints(WORDMARK_HORIZONTAL));
  test('gap 2X, cap height 0.30 x monogram, vertically centred', () => {
    expect(wm.x1 - MONOGRAM.width).toBe(2 * X);
    const cap = 234 - 126.46;
    expect(cap / MONOGRAM.height).toBeCloseTo(0.3, 2);
    expect((126.46 + 234) / 2).toBeCloseTo(MONOGRAM.height / 2, 0);
    expect(wm.x2).toBe(LAYOUTS.horizontal.width);
  });
});
