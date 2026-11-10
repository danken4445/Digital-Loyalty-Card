// One-off: copies path data verbatim from the supplied vector masters into src/brand/logoPaths.ts.
import { readFileSync, writeFileSync } from 'node:fs';
const read = (f) => readFileSync(`reference/masters/${f}`, 'utf8');
const ds = (svg, groupId) => {
  const start = svg.indexOf(`<g id="${groupId}"`);
  const g = svg.slice(start, svg.indexOf('</g>', start));
  return [...g.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
};
const one = (svg, id) => svg.match(new RegExp(`<path id="${id}"[^>]* d="([^"]+)"`))[1];
const color = read('odyssey-logo-monogram-color.svg');
const navy = read('odyssey-logo-monogram-navy.svg');
const stacked = read('odyssey-logo-stacked-color.svg');
const horiz = read('odyssey-logo-horizontal-color.svg');
const fav = read('odyssey-favicon-proposed.svg');
const favPaths = [...fav.matchAll(/<path [^>]*d="([^"]+)"/g)].map((m) => m[1]);
const favT = fav.match(/<g transform="([^"]+)"/)[1];
const favRx = fav.match(/rx="([^"]+)"/)[1];
const q = (s) => JSON.stringify(s);
const arr = (a) => `[\n    ${a.map(q).join(',\n    ')},\n  ]`;
const out = `/**
 * ODYSSEY logo path data: the single source of truth for native, web and the asset generator.
 *
 * Copied verbatim from the supplied vector masters (odyssey-brand-assets/svg, v1.0) by
 * scripts/extract-master-paths.mjs. Do not redraw, trace, simplify or reformat.
 * tests/approvedArtwork.test.ts hashes this data, so any edit fails CI.
 *
 * Coordinate spaces (as in the masters):
 *  - Monogram pieces (letters, rim, sail) are drawn at origin (232, 335); layouts translate them by
 *    (-232, -335) so the monogram occupies 0..736 x 0..360.
 *  - Wordmark paths are already in their layout's final space.
 */

/** APPROVED. Navy walls with r88 counters (colour and reverse colourways). */
export const LETTERS_WITH_RIM = ${arr(ds(color, 'letters'))} as const;

/** APPROVED (single-colour cut). Walls with the rim merged in: r70 counters. navy, white, black. */
export const LETTERS_SOLID = ${arr(ds(navy, 'letters'))} as const;

/** APPROVED. 18u orange inner rim, one ring per letter. */
export const RIM = ${arr(ds(color, 'rim'))} as const;

/** APPROVED. Mast (14u) and sail, 9u apart, standing on the D's base. */
export const SAIL = ${q(one(color, 'sail'))} as const;

/** APPROVED. Wordmark for the stacked logo (cap height 66u, width 618u, 84u below the monogram). */
export const WORDMARK_STACKED = ${q(one(stacked, 'wordmark'))} as const;

/** PROPOSED layout, APPROVED letterforms. Wordmark for the horizontal logo (cap height 0.30 x 360u). */
export const WORDMARK_HORIZONTAL = ${q(one(horiz, 'wordmark'))} as const;

/** PROPOSED, requires approval. Simplified D-and-sail favicon (bible page 22). */
export const FAVICON = {
  viewBox: 512,
  tileRadius: ${favRx},
  transform: ${q(favT)},
  d: ${q(favPaths[0])},
  sail: ${q(favPaths[1])},
} as const;
`;
writeFileSync('../../lib/brand/odyssey/logoPaths.ts', out);
console.log('written', out.length);
