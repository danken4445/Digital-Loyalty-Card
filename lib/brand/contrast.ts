import { DEFAULT_STAMP_ICON, isStampIconId, type StampIconId, type TenantBrand } from '@/lib/contracts';

/**
 * WCAG AA Contrast and Dynamic Card Branding Engine.
 * Computes sRGB relative luminance and contrast ratios per W3C WCAG 2.1 specifications.
 * Enforces legibility for customer wallet cards across custom café palettes.
 */

export const DEFAULT_PRIMARY_COLOR = '#0A0A0A';
export const DEFAULT_ACCENT_COLOR = '#FFFFFF';
export const DEFAULT_TEXT_COLOR = '#FFFFFF';
export const DEFAULT_SUBTEXT_COLOR_DARK = '#A1A1AA';
export const DEFAULT_SUBTEXT_COLOR_LIGHT = '#71717A';
export const DEFAULT_SURFACE_DARK = '#141414';
export const DEFAULT_SURFACE_LIGHT = '#F4F4F5';
export const DEFAULT_BORDER_DARK = '#262626';
export const DEFAULT_BORDER_LIGHT = '#E4E4E7';
export const DEFAULT_LOGO_URL = '/brand/logo-circle-dark.png';

export const FALLBACK_DARK_TEXT = '#0A0A0A';
export const FALLBACK_LIGHT_TEXT = '#FFFFFF';

export const WCAG_AA_NORMAL_TEXT_RATIO = 4.5;
export const WCAG_AA_LARGE_TEXT_RATIO = 3.0;

export interface ResolvedCardTheme {
  primaryColor: string;
  accentColor: string;
  textColor: string;
  subtextColor: string;
  surfaceBg: string;
  cardBorder: string;
  logoUrl: string | null;
  cardArtUrl: string | null;
  tagline: string | null;
  stampIcon: StampIconId;
  passesAA: boolean;
}

/**
 * Parses a 3- or 6-digit hex color string (with or without '#') into [R, G, B] channels (0..255).
 * Returns null if the string is not a valid hex color representation.
 */
export function parseHexColor(hex: string): [number, number, number] | null {
  if (!hex || typeof hex !== 'string') return null;
  let clean = hex.trim();
  if (clean.startsWith('#')) {
    clean = clean.slice(1);
  }
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(clean)) {
    return null;
  }
  if (clean.length === 3) {
    const c0 = clean.charAt(0);
    const c1 = clean.charAt(1);
    const c2 = clean.charAt(2);
    const r = parseInt(c0 + c0, 16);
    const g = parseInt(c1 + c1, 16);
    const b = parseInt(c2 + c2, 16);
    return [r, g, b];
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Normalizes a hex color string into standard #RRGGBB uppercase format.
 * Returns null if the input is not a valid hex color.
 */
export function normalizeHexColor(hex: string): string | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Calculates sRGB relative luminance per WCAG 2.1.
 * Linearizes RGB channels with threshold 0.04045, formula L = 0.2126*R + 0.7152*G + 0.0722*B.
 * Returns a value in [0, 1] where 0 is darkest black and 1 is lightest white.
 */
export function getLuminance(hexColor: string): number {
  const rgb = parseHexColor(hexColor);
  if (!rgb) {
    return 0;
  }

  const [r, g, b] = rgb;
  const toLinear = (val: number) => {
    const c = val / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates WCAG contrast ratio between two colors: (L1 + 0.05) / (L2 + 0.05)
 * where L1 is the lighter luminance. Returns a value between 1.0 and 21.0.
 */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

/**
 * Accepts only https URLs and root-relative paths for tenant-supplied images, matching the
 * CSP `img-src` (http, data: and script schemes are blocked or unsafe). Returns null otherwise.
 */
function sanitizeImageUrl(url: string | undefined | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') || trimmed.startsWith('/\\') ? null : trimmed;
  }
  return /^https:\/\/[^\s/]/i.test(trimmed) ? trimmed : null;
}

/**
 * Resolves full card theme colors and metadata from a TenantBrand configuration.
 * Enforces WCAG AA contrast for text elements, falling back to #FFFFFF or #0A0A0A when needed.
 * Preserves Tenant #1 (The Caffeine Plug) defaults when properties are not specified.
 */
export function resolveCardTheme(brand?: TenantBrand | null): ResolvedCardTheme {
  const safeBrand = brand ?? {};

  const primaryColor =
    normalizeHexColor(safeBrand.primaryColor ?? '') ?? DEFAULT_PRIMARY_COLOR;
  const accentColor =
    normalizeHexColor(safeBrand.accentColor ?? '') ?? DEFAULT_ACCENT_COLOR;

  // Candidate text color defaults to accentColor unless explicitly specified
  const candidateTextColor =
    normalizeHexColor((safeBrand as { textColor?: string }).textColor ?? '') ?? accentColor;

  const initialRatio = getContrastRatio(candidateTextColor, primaryColor);
  const passesAA = initialRatio >= WCAG_AA_NORMAL_TEXT_RATIO;

  let textColor = candidateTextColor;
  if (!passesAA) {
    // Override with #FFFFFF or #0A0A0A (whichever provides higher contrast against primaryColor)
    const whiteRatio = getContrastRatio(FALLBACK_LIGHT_TEXT, primaryColor);
    const darkRatio = getContrastRatio(FALLBACK_DARK_TEXT, primaryColor);
    textColor = whiteRatio >= darkRatio ? FALLBACK_LIGHT_TEXT : FALLBACK_DARK_TEXT;
  }

  const isDarkPrimary = getLuminance(primaryColor) <= 0.5;

  const defaultSurfaceBg = isDarkPrimary ? DEFAULT_SURFACE_DARK : DEFAULT_SURFACE_LIGHT;
  const defaultCardBorder = isDarkPrimary ? DEFAULT_BORDER_DARK : DEFAULT_BORDER_LIGHT;
  const defaultSubtextColor = isDarkPrimary ? DEFAULT_SUBTEXT_COLOR_DARK : DEFAULT_SUBTEXT_COLOR_LIGHT;

  const surfaceBg =
    normalizeHexColor((safeBrand as { surfaceBg?: string }).surfaceBg ?? '') ?? defaultSurfaceBg;
  const cardBorder =
    normalizeHexColor((safeBrand as { cardBorder?: string }).cardBorder ?? '') ?? defaultCardBorder;
  let subtextColor =
    normalizeHexColor((safeBrand as { subtextColor?: string }).subtextColor ?? '') ?? defaultSubtextColor;

  // Ensure subtextColor has at least large-text contrast (>= 3.0:1) against primaryColor or clamp to textColor
  if (getContrastRatio(subtextColor, primaryColor) < WCAG_AA_LARGE_TEXT_RATIO) {
    subtextColor = textColor;
  }

  const logoUrl = sanitizeImageUrl(safeBrand.logoUrl) ?? DEFAULT_LOGO_URL;
  const cardArtUrl = sanitizeImageUrl(safeBrand.cardArtUrl);

  const tagline =
    safeBrand.tagline && safeBrand.tagline.trim().length > 0
      ? safeBrand.tagline.trim()
      : null;

  return {
    primaryColor,
    accentColor,
    textColor,
    subtextColor,
    surfaceBg,
    cardBorder,
    logoUrl,
    cardArtUrl,
    tagline,
    stampIcon: isStampIconId(safeBrand.stampIcon) ? safeBrand.stampIcon : DEFAULT_STAMP_ICON,
    passesAA,
  };
}
