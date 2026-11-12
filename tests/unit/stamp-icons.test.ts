import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StampIcon, STAMP_ICON_LABELS } from '@/components/card/StampIcon';
import {
  STAMP_ICON_IDS,
  isStampIconId,
  DEFAULT_STAMP_ICON,
  type StampIconId,
} from '@/lib/contracts';
import { resolveCardTheme } from '@/lib/brand/contrast';

describe('Stamp Icons System', () => {
  it('includes pickleball, shoe, vape, dumbbell, and car in STAMP_ICON_IDS', () => {
    expect(STAMP_ICON_IDS).toContain('pickleball');
    expect(STAMP_ICON_IDS).toContain('shoe');
    expect(STAMP_ICON_IDS).toContain('vape');
    expect(STAMP_ICON_IDS).toContain('dumbbell');
    expect(STAMP_ICON_IDS).toContain('car');
  });

  it('provides a valid human label for every icon in STAMP_ICON_IDS', () => {
    for (const icon of STAMP_ICON_IDS) {
      expect(STAMP_ICON_LABELS[icon]).toBeDefined();
      expect(typeof STAMP_ICON_LABELS[icon]).toBe('string');
      expect(STAMP_ICON_LABELS[icon].length).toBeGreaterThan(0);
    }
    expect(STAMP_ICON_LABELS.pickleball).toBe('Pickleball');
    expect(STAMP_ICON_LABELS.shoe).toBe('Shoe');
    expect(STAMP_ICON_LABELS.vape).toBe('Vape');
    expect(STAMP_ICON_LABELS.dumbbell).toBe('Dumbbell');
    expect(STAMP_ICON_LABELS.car).toBe('Car wash');
  });

  it('correctly validates icon ids with isStampIconId', () => {
    expect(isStampIconId('cup')).toBe(true);
    expect(isStampIconId('pickleball')).toBe(true);
    expect(isStampIconId('shoe')).toBe(true);
    expect(isStampIconId('vape')).toBe(true);
    expect(isStampIconId('dumbbell')).toBe(true);
    expect(isStampIconId('car')).toBe(true);
    expect(isStampIconId('nonexistent')).toBe(false);
    expect(isStampIconId(null)).toBe(false);
    expect(isStampIconId(undefined)).toBe(false);
  });

  it('renders SVG markup for every supported stamp icon', () => {
    for (const icon of STAMP_ICON_IDS) {
      const html = renderToStaticMarkup(
        React.createElement(StampIcon, { icon, className: 'w-6 h-6' }),
      );
      expect(html).toContain('<svg');
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('class="w-6 h-6"');
      expect(html).toContain('</svg>');
    }
  });

  it('renders pickleball, shoe, and vape SVG glyphs with distinct paths', () => {
    const pickleballHtml = renderToStaticMarkup(
      React.createElement(StampIcon, { icon: 'pickleball' }),
    );
    const shoeHtml = renderToStaticMarkup(React.createElement(StampIcon, { icon: 'shoe' }));
    const vapeHtml = renderToStaticMarkup(React.createElement(StampIcon, { icon: 'vape' }));

    expect(pickleballHtml).toContain('circle');
    expect(shoeHtml).toContain('path');
    expect(vapeHtml).toContain('rect');
  });

  it('defaults to the cup icon when no icon prop is provided', () => {
    const html = renderToStaticMarkup(React.createElement(StampIcon));
    expect(html).toContain('<svg');
    expect(DEFAULT_STAMP_ICON).toBe('cup');
  });

  it('resolves theme with all new stamp icons', () => {
    const icons: StampIconId[] = ['pickleball', 'shoe', 'vape', 'dumbbell', 'car'];
    for (const icon of icons) {
      const theme = resolveCardTheme({ stampIcon: icon });
      expect(theme.stampIcon).toBe(icon);
    }
  });
});
