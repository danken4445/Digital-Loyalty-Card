import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { COLOURWAYS, LAYOUTS, type Layout } from '@/lib/brand/odyssey/brandTokens';
import { composeLogo, isLockup } from '@/lib/brand/odyssey/composeLogo';
import * as P from '@/lib/brand/odyssey/logoPaths';
import { readMaster } from './helpers';

/**
 * Pinned hash of the APPROVED path data. If this fails, someone edited logoPaths.ts.
 * Do not update the hash unless ODYSSEY has supplied a new approved master.
 */
const APPROVED_SHA256 = '049f69531aa0ca8cc8101da5fdcd21c6e05a50cad5ff407f4c1639d0b923f597';

test('approved path data is unchanged', () => {
  const data = JSON.stringify([
    P.LETTERS_WITH_RIM,
    P.LETTERS_SOLID,
    P.RIM,
    P.SAIL,
    P.WORDMARK_STACKED,
    P.WORDMARK_HORIZONTAL,
  ]);
  expect(createHash('sha256').update(data).digest('hex')).toBe(APPROVED_SHA256);
});

describe.each(Object.keys(LAYOUTS) as Layout[])(
  '%s layout matches the supplied master',
  (layout) => {
    test.each(COLOURWAYS)('%s', (cw) => {
      const master = readMaster(`odyssey-logo-${layout}-${cw}.svg`);
      const art = composeLogo(layout, cw);
      expect([art.width, art.height]).toEqual([master.width, master.height]);
      expect(
        art.shapes.map((s) => ({
          d: s.d,
          fill: s.fill,
          fillRule: s.fillRule,
          tx: s.tx,
          ty: s.ty,
          s: s.s,
        })),
      ).toEqual(master.paths.map((p) => ({ ...p, s: 1 })));
    });
  },
);

test('counters are cut (even-odd), never painted; no gradients, filters, strokes or extra shapes', () => {
  for (const layout of [
    'monogram',
    'stacked',
    'horizontal',
    'lockup-horizontal',
    'lockup-compact',
    'lockup-stacked',
  ] as const) {
    for (const cw of COLOURWAYS) {
      const art = composeLogo(layout, cw);
      const roles = new Set(art.shapes.map((s) => s.role));
      expect(
        [...roles].every((r) =>
          ['letters', 'rim', 'sail', 'wordmark', 'divider', 'descriptor'].includes(r),
        ),
      ).toBe(true);
      art.shapes
        .filter((s) => s.role === 'letters' || s.role === 'rim')
        .forEach((s) => expect(s.fillRule).toBe('evenodd'));
      art.shapes.forEach((s) => expect(s.fill).toMatch(/^#[0-9A-F]{6}$/));
      // The approved logo is never scaled, moved relative to itself or recoloured inside a lockup.
      const logoShapes = art.shapes.filter((s) => s.role !== 'divider' && s.role !== 'descriptor');
      logoShapes.forEach((s) => expect(s.s).toBe(1));
      if (isLockup(layout))
        expect(art.shapes.filter((s) => s.role === 'descriptor')).toHaveLength(1);
    }
  }
});
