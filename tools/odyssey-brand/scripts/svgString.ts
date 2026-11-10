/** Serialises an Artwork to a standalone SVG file. Used by the asset generator and tests. */
import type { Status } from '../../../lib/brand/odyssey/brandTokens';
import type { Artwork, Shape } from '../../../lib/brand/odyssey/composeLogo';

export function statusComment(status: Status, note: string): string {
  return `<!-- STATUS: ${status} | ODYSSEY Brand Bible v1.0 | ${note} -->`;
}

export function shapeToSvg(s: Shape): string {
  const t = s.transform ? ` transform="${s.transform}"` : '';
  const rule = s.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  return `<path data-role="${s.role}" fill="${s.fill}"${rule}${t} d="${s.d}"/>`;
}

/** Inner markup only (no <svg> wrapper), for embedding in sheets and icons. */
export function artworkBody(art: Artwork): string {
  return art.shapes.map(shapeToSvg).join('\n');
}

export function artworkToSvg(art: Artwork, opts: { title: string; note: string; status?: Status }): string {
  const status = opts.status ?? art.status;
  return [
    statusComment(status, opts.note),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${art.width}" height="${art.height}" viewBox="${art.viewBox}" role="img" aria-label="${opts.title}">`,
    `<title>${opts.title}</title>`,
    artworkBody(art),
    `</svg>`,
    '',
  ].join('\n');
}
