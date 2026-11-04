import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getLuminance,
  getContrastRatio,
  resolveCardTheme,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_SURFACE_DARK,
  DEFAULT_BORDER_DARK,
  DEFAULT_LOGO_URL,
} from '@/lib/brand/contrast';
import { formatDateTimeInZone, formatterCache } from '@/lib/rules/display';
import type { TenantBrand } from '@/lib/contracts';

describe('lib/brand/contrast', () => {
  describe('getLuminance', () => {
    it('calculates correct relative luminance for black and white', () => {
      expect(getLuminance('#000000')).toBe(0);
      expect(getLuminance('#FFFFFF')).toBe(1);
      expect(getLuminance('#000')).toBe(0);
      expect(getLuminance('#fff')).toBe(1);
    });

    it('calculates correct sRGB luminance for primary channels', () => {
      // Red: 0.2126, Green: 0.7152, Blue: 0.0722
      expect(getLuminance('#FF0000')).toBeCloseTo(0.2126, 4);
      expect(getLuminance('#00FF00')).toBeCloseTo(0.7152, 4);
      expect(getLuminance('#0000FF')).toBeCloseTo(0.0722, 4);
    });

    it('handles hex values with or without hash, case-insensitively', () => {
      expect(getLuminance('ffffff')).toBe(1);
      expect(getLuminance('000000')).toBe(0);
      expect(getLuminance('#FfFfFf')).toBe(1);
    });

    it('gracefully handles invalid hex input', () => {
      expect(getLuminance('')).toBe(0);
      expect(getLuminance('not-a-color')).toBe(0);
    });
  });

  describe('getContrastRatio', () => {
    it('contrast_ratio_calculates_black_and_white_as_21_to_1', () => {
      const ratio = getContrastRatio('#000000', '#FFFFFF');
      expect(ratio).toBe(21);

      // Order should not matter: (L1 + 0.05) / (L2 + 0.05) where L1 is lighter
      const reverseRatio = getContrastRatio('#FFFFFF', '#000000');
      expect(reverseRatio).toBe(21);
    });

    it('calculates identical colors as 1 to 1', () => {
      expect(getContrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
      expect(getContrastRatio('#0A0A0A', '#0A0A0A')).toBe(1);
    });

    it('calculates expected contrast ratio for Tenant 1 default colors', () => {
      // White on #0A0A0A is > 19:1
      const ratio = getContrastRatio('#FFFFFF', '#0A0A0A');
      expect(ratio).toBeGreaterThanOrEqual(19);
    });
  });

  describe('resolveCardTheme', () => {
    it('resolve_card_theme_preserves_tenant1_defaults', () => {
      const theme = resolveCardTheme({});

      expect(theme).toEqual({
        primaryColor: '#0A0A0A',
        accentColor: '#FFFFFF',
        textColor: '#FFFFFF',
        subtextColor: '#A1A1AA',
        surfaceBg: '#141414',
        cardBorder: '#262626',
        logoUrl: DEFAULT_LOGO_URL,
        cardArtUrl: null,
        tagline: null,
        passesAA: true,
      });
    });

    it('preserves tenant 1 defaults when brand is null or undefined', () => {
      const fromNull = resolveCardTheme(null as unknown as TenantBrand);
      expect(fromNull.primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
      expect(fromNull.accentColor).toBe(DEFAULT_ACCENT_COLOR);
      expect(fromNull.surfaceBg).toBe(DEFAULT_SURFACE_DARK);
      expect(fromNull.cardBorder).toBe(DEFAULT_BORDER_DARK);
      expect(fromNull.logoUrl).toBe(DEFAULT_LOGO_URL);
      expect(fromNull.passesAA).toBe(true);

      const fromUndefined = resolveCardTheme(undefined as unknown as TenantBrand);
      expect(fromUndefined.primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
    });

    it('contrast_engine_falls_back_when_contrast_fails_aa', () => {
      // Yellow (#FFFF00) accent/text on white (#FFFFFF) background fails AA (< 4.5:1)
      const brand: TenantBrand = {
        primaryColor: '#FFFFFF',
        accentColor: '#FFFF00',
      };

      const theme = resolveCardTheme(brand);

      // Must fall back to dark text (#0A0A0A)
      expect(theme.textColor).toBe('#0A0A0A');
      expect(theme.primaryColor).toBe('#FFFFFF');
      expect(theme.accentColor).toBe('#FFFF00');

      // The fallback text color against the primary background must have contrast >= 4.5:1
      const contrast = getContrastRatio(theme.textColor, theme.primaryColor);
      expect(contrast).toBeGreaterThanOrEqual(4.5);

      // passesAA flag indicates the original brand combination failed AA
      expect(theme.passesAA).toBe(false);
    });

    it('falls back to white text when dark text on dark background fails AA', () => {
      // Dark grey on near-black
      const brand: TenantBrand = {
        primaryColor: '#0A0A0A',
        accentColor: '#1A1A1A',
      };

      const theme = resolveCardTheme(brand);

      expect(theme.textColor).toBe('#FFFFFF');
      const contrast = getContrastRatio(theme.textColor, theme.primaryColor);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(theme.passesAA).toBe(false);
    });

    it('keeps brand accent as text color when it passes AA contrast', () => {
      // Bright gold/amber on very dark navy
      const brand: TenantBrand = {
        primaryColor: '#0F172A',
        accentColor: '#FBBF24',
        tagline: 'Specialty Roasters',
        logoUrl: '/custom-logo.png',
        cardArtUrl: '/custom-art.png',
      };

      const theme = resolveCardTheme(brand);

      expect(theme.primaryColor).toBe('#0F172A');
      expect(theme.accentColor).toBe('#FBBF24');
      expect(theme.textColor).toBe('#FBBF24');
      expect(theme.tagline).toBe('Specialty Roasters');
      expect(theme.logoUrl).toBe('/custom-logo.png');
      expect(theme.cardArtUrl).toBe('/custom-art.png');
      expect(theme.passesAA).toBe(true);
    });
  });
});

describe('lib/rules/display - formatDateTimeInZone memoization', () => {
  beforeEach(() => {
    formatterCache.clear();
  });

  it('formatDateTimeInZone_reuses_cached_formatter_instances', () => {
    const timestamp1 = new Date('2026-11-04T12:00:00Z');
    const timestamp2 = new Date('2026-11-05T15:30:00Z');

    expect(formatterCache.has('Asia/Tokyo')).toBe(false);

    const formatted1 = formatDateTimeInZone(timestamp1, 'Asia/Tokyo');
    expect(formatterCache.has('Asia/Tokyo')).toBe(true);
    const cachedInstance = formatterCache.get('Asia/Tokyo');
    expect(cachedInstance).toBeDefined();

    const formatted2 = formatDateTimeInZone(timestamp2, 'Asia/Tokyo');
    // Cached instance must be the exact same reference
    expect(formatterCache.get('Asia/Tokyo')).toBe(cachedInstance);

    // Formatted outputs must be accurate
    expect(formatted1).toContain('2026');
    expect(formatted2).toContain('2026');
  });

  it('maintains distinct cached formatters for different timezones', () => {
    const timestamp = new Date('2026-11-04T12:00:00Z');

    const manila = formatDateTimeInZone(timestamp, 'Asia/Manila');
    const newYork = formatDateTimeInZone(timestamp, 'America/New_York');

    expect(formatterCache.size).toBe(2);
    expect(formatterCache.has('Asia/Manila')).toBe(true);
    expect(formatterCache.has('America/New_York')).toBe(true);
    expect(manila).not.toBe(newYork);
  });

  it('caps cache size to prevent unbounded memory growth', () => {
    formatterCache.clear();
    const timestamp = new Date('2026-11-04T12:00:00Z');
    const timezones = Intl.supportedValuesOf('timeZone').slice(0, 105);

    for (const tz of timezones) {
      formatDateTimeInZone(timestamp, tz);
    }

    expect(formatterCache.size).toBe(100);
    expect(formatterCache.has(timezones[0]!)).toBe(false);
    expect(formatterCache.has(timezones[104]!)).toBe(true);
  });
});

