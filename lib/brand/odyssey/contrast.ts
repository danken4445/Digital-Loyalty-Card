import { COLORS, CONTRAST, COLOURWAY_FILLS, type Colourway } from './brandTokens';

/** Parses #RGB or #RRGGBB. Throws on anything else so bad input never picks a colourway silently. */
export function parseHex(hex: string): readonly [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const raw = m?.[1];
  if (!raw) throw new Error(`Not a hex colour: ${hex}`);
  const h = raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The colour that meets the background at the logo's edge: the walls / letters. */
export function outerColour(colourway: Colourway): string {
  return COLOURWAY_FILLS[colourway].letters;
}

/**
 * Below this orange-vs-background ratio the orange rim and sail would disappear into the
 * background (e.g. an orange surface), so the single-colour navy version is used instead.
 * Mist (2.1 : 1 against orange) stays above it and keeps the full-colour logo, as the bible approves.
 */
const ORANGE_SEPARATION_MIN = 1.5;

const sameHex = (a: string, b: string) => parseHex(a).join() === parseHex(b).join();

export interface ColourwayChoice {
  colourway: Colourway;
  /** Contrast of the chosen colourway's outer colour against the background. */
  ratio: number;
  meetsMinimum: boolean;
}

/**
 * Chooses the colourway by background, never by taste (bible page 09).
 * Returns one of the five colourways. Warns when none reaches 3 : 1.
 * Dark mode: pass the actual surface colour; the logo itself never recolours.
 * `black` is never chosen automatically: it is for legal documents and engraving only.
 */
export function colourwayForBackground(
  bgHex: string,
  warn: (msg: string) => void = console.warn,
): ColourwayChoice {
  const result = (colourway: Colourway): ColourwayChoice => {
    const ratio = contrastRatio(outerColour(colourway), bgHex);
    return { colourway, ratio, meetsMinimum: ratio >= CONTRAST.logoMin };
  };

  if (sameHex(bgHex, COLORS.navy)) return result('reverse');

  if (contrastRatio(COLORS.navy, bgHex) >= CONTRAST.logoMin) {
    return contrastRatio(COLORS.orange, bgHex) < ORANGE_SEPARATION_MIN
      ? result('navy')
      : result('color');
  }

  if (contrastRatio(COLORS.white, bgHex) >= CONTRAST.logoMin) return result('white');

  // Mid-tone: nothing passes. Return the best available and say so.
  const onLight = result('color');
  const onDark = result('white');
  const best = onLight.ratio >= onDark.ratio ? onLight : onDark;
  warn(
    `[OdysseyLogo] No colourway reaches ${CONTRAST.logoMin}:1 on ${bgHex} (best: ${best.colourway} at ` +
      `${best.ratio.toFixed(2)}:1). Place the logo on a solid Warm White or Navy panel instead.`,
  );
  return best;
}
