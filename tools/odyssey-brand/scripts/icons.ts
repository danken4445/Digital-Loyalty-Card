/** Icon geometry and SVG builders. STATUS: PROPOSED (favicon also requires approval before use). */
import { COLORS, ICONS, LAYOUTS } from '../../../lib/brand/odyssey/brandTokens';
import { composeLogo } from '../../../lib/brand/odyssey/composeLogo';
import { FAVICON } from '../../../lib/brand/odyssey/logoPaths';
import { artworkBody, statusComment } from './svgString';

export interface Placement {
  /** Scale from master units to tile px. */
  s: number;
  tx: number;
  ty: number;
  /** Monogram bounding box in tile px. */
  w: number;
  h: number;
}

/** Monogram centred in a square tile, `widthShare` of the tile wide. */
export function placeMonogram(tile: number, widthShare: number): Placement {
  const m = LAYOUTS.monogram;
  const s = (tile * widthShare) / m.width;
  const w = m.width * s;
  const h = m.height * s;
  return { s, tx: (tile - w) / 2, ty: (tile - h) / 2, w, h };
}

/** Distance from tile centre to the monogram's bounding-box corner, as a share of tile size. */
export function cornerDistanceShare(p: Placement, tile: number): number {
  return Math.hypot(p.w / 2, p.h / 2) / tile;
}

const r = (n: number) => Math.round(n * 100) / 100;
const rScale = (n: number) => Math.round(n * 10000) / 10000;

function placedMonogram(p: Placement): string {
  const art = composeLogo('monogram', 'reverse');
  return `<g transform="translate(${r(p.tx)} ${r(p.ty)}) scale(${rScale(p.s)})">\n${artworkBody(art)}\n</g>`;
}

/** App / PWA icon: reversed monogram, 70% of tile width, full-bleed navy, no pre-rounded corners. */
export function appIconSvg(tile = 1024): string {
  const p = placeMonogram(tile, ICONS.app.monogramWidth);
  return [
    statusComment('PROPOSED', 'App / PWA icon. Full-bleed square; the platform applies its own mask.'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}" role="img" aria-label="ODYSSEY">`,
    `<title>ODYSSEY</title>`,
    `<rect width="${tile}" height="${tile}" fill="${COLORS.navy}"/>`,
    placedMonogram(p),
    `</svg>`,
    '',
  ].join('\n');
}

/** Android adaptive icon foreground: transparent layer, monogram inside the 66/108 safe circle. */
export function adaptiveForegroundSvg(tile: number = ICONS.adaptive.exportPx): string {
  const p = placeMonogram(tile, ICONS.adaptive.monogramWidth);
  return [
    statusComment('PROPOSED', 'Android adaptive icon foreground (108dp layer). Background layer: solid Odyssey Navy.'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">`,
    placedMonogram(p),
    `</svg>`,
    '',
  ].join('\n');
}

export function adaptiveBackgroundSvg(tile: number = ICONS.adaptive.exportPx): string {
  return [
    statusComment('PROPOSED', 'Android adaptive icon background layer.'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">`,
    `<rect width="${tile}" height="${tile}" fill="${COLORS.navy}"/>`,
    `</svg>`,
    '',
  ].join('\n');
}

/** Favicon: the bible's proposed D-and-sail tile, path data verbatim. Requires approval before use. */
export function faviconSvg(): string {
  const v = FAVICON.viewBox;
  return [
    statusComment('PROPOSED', 'Favicon: simplified D-and-sail tile (bible page 22). Requires approval before use.'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${v} ${v}" role="img" aria-label="ODYSSEY">`,
    `<title>ODYSSEY</title>`,
    `<rect width="${v}" height="${v}" rx="${FAVICON.tileRadius}" fill="${COLORS.navy}"/>`,
    `<g transform="${FAVICON.transform}">`,
    `<path fill="${COLORS.warmWhite}" fill-rule="evenodd" d="${FAVICON.d}"/>`,
    `<path fill="${COLORS.orange}" d="${FAVICON.sail}"/>`,
    `</g>`,
    `</svg>`,
    '',
  ].join('\n');
}
