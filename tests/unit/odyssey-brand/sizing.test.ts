import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DESCRIPTOR_MIN_FONT_PX,
  ICONS,
  LAYOUTS,
  MIN_HEIGHT_PX,
} from '@/lib/brand/odyssey/brandTokens';
import {
  composeLogo,
  composePartnerLockup,
  descriptorPx,
  minHeightPx,
  resolveLogo,
} from '@/lib/brand/odyssey/composeLogo';
import { OdysseyLogo } from '@/components/brand/OdysseyLogo';
import { cornerDistanceShare, placeMonogram } from '../../../tools/odyssey-brand/scripts/icons';

describe('lockup minimums', () => {
  test.each([
    ['lockup-horizontal', MIN_HEIGHT_PX['lockup-horizontal']],
    ['lockup-compact', MIN_HEIGHT_PX['lockup-compact']],
  ] as const)('%s: stated minimum %ipx keeps the descriptor at >= 12px', (layout, stated) => {
    expect(minHeightPx(layout)).toBe(stated);
    expect(descriptorPx(composeLogo(layout, 'color'), stated)!).toBeGreaterThanOrEqual(
      DESCRIPTOR_MIN_FONT_PX,
    );
  });

  test('stacked lockup: the logo inside is never under the 56px stacked minimum', () => {
    const art = composeLogo('lockup-stacked', 'color');
    const min = minHeightPx('lockup-stacked');
    expect((min * LAYOUTS.stacked.height) / art.height).toBeGreaterThanOrEqual(
      MIN_HEIGHT_PX.stacked,
    );
    expect(descriptorPx(art, min)!).toBeGreaterThanOrEqual(DESCRIPTOR_MIN_FONT_PX);
  });

  test('stacked descriptor never outranks the 66u wordmark', () => {
    const art = composeLogo('lockup-stacked', 'color');
    const capHeight = (art.descriptorFontSize! * 697) / 1000;
    expect(capHeight).toBeLessThan(LAYOUTS.stacked.wordmarkCapHeight);
  });
});

describe('resolveLogo', () => {
  test('clamps up and reports, never scales below the minimum', () => {
    const r = resolveLogo('monogram', 'color', 20);
    expect(r.height).toBe(32);
    expect(r.width).toBeCloseTo((32 * 736) / 360, 1);
    expect(r.warning).toMatch(/clamped to 32px/);
  });

  test('drops the descriptor below 12px and shows the plain logo', () => {
    const r = resolveLogo('lockup-horizontal', 'color', 30);
    expect(r.artwork.layout).toBe('horizontal');
    expect(r.height).toBe(30);
    expect(r.warning).toMatch(/descriptor would render/);
  });

  test('no warning at or above the minimum', () => {
    expect(resolveLogo('lockup-compact', 'reverse', 48).warning).toBeNull();
    expect(resolveLogo('stacked', 'color', 56).warning).toBeNull();
  });
});

test('partner slot never exceeds the monogram height', () => {
  expect(composePartnerLockup('compact', 'color', 3, 999).slot.height).toBe(360);
});

describe('icon safe zones', () => {
  test('app icon: 70% width, corners inside the 40% maskable circle', () => {
    const p = placeMonogram(1024, ICONS.app.monogramWidth);
    expect(p.w / 1024).toBeCloseTo(0.7, 5);
    expect(cornerDistanceShare(p, 1024)).toBeLessThan(ICONS.maskableRadius);
  });
  test('android adaptive: monogram inside the 66/108 safe circle', () => {
    const p = placeMonogram(432, ICONS.adaptive.monogramWidth);
    expect(cornerDistanceShare(p, 432)).toBeLessThanOrEqual(
      ICONS.adaptive.safeDp / ICONS.adaptive.layerDp / 2,
    );
  });
});

describe('OdysseyLogo (web)', () => {
  test('renders accessible SVG from the shared artwork', () => {
    const html = renderToStaticMarkup(
      createElement(OdysseyLogo, {
        layout: 'stacked',
        colourway: 'color',
        height: 112,
        testID: 'logo',
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="ODYSSEY"');
    expect(html).toContain('viewBox="0 0 736 510"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain('fill-rule="evenodd"');
    expect(html).toContain('height="112"');
    expect(html).not.toMatch(/gradient|filter|stroke/i);
  });

  test('clamps below the minimum', () => {
    const html = renderToStaticMarkup(
      createElement(OdysseyLogo, { layout: 'stacked', colourway: 'color', height: 20 }),
    );
    expect(html).toContain('height="56"');
  });
});
