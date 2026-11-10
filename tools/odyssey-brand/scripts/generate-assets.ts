/**
 * Generates every deliverable from composeLogo (layout x colourway). Never hand-edit the outputs.
 * Run: npm run generate
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import {
  CLEAR_SPACE,
  COLORS,
  COLOURWAYS,
  COLOURWAY_FILLS,
  ICONS,
  LAYOUTS,
  type AnyLayout,
  type Colourway,
  type Layout,
  type LockupLayout,
  type Status,
} from '../../../lib/brand/odyssey/brandTokens';
import {
  clearSpaceBox,
  composeLogo,
  composePartnerLockup,
  descriptorPx,
  minHeightPx,
  type Artwork,
  type Rect,
} from '../../../lib/brand/odyssey/composeLogo';
import { contrastRatio } from '../../../lib/brand/odyssey/contrast';
import {
  adaptiveBackgroundSvg,
  adaptiveForegroundSvg,
  appIconSvg,
  cornerDistanceShare,
  faviconSvg,
  placeMonogram,
} from './icons';
import { artworkBody, artworkToSvg, statusComment } from './svgString';

const OUT = '../../public/brand/odyssey';
const manifest: { file: string; status: Status; note: string }[] = [];

function write(rel: string, content: string | Buffer, status: Status, note: string) {
  const path = join(OUT, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  manifest.push({ file: rel.replace(/\\/g, '/'), status, note });
}

function renderPng(svg: string, width: number, opaque = false): Buffer {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  })
    .render()
    .asPng();
  if (!opaque) return png;
  // iOS App Store icon: no alpha channel. Re-encode RGBA -> RGB (the tile is already fully opaque).
  const decoded = PNG.sync.read(png);
  return PNG.sync.write(decoded, { colorType: 2, inputColorType: 6, inputHasAlpha: true });
}

const LAYOUT_NOTE: Record<Layout, string> = {
  stacked: 'Primary logo. Path data copied verbatim from the vector master.',
  horizontal: 'Horizontal logo (bible: proposed). Path data copied verbatim from the horizontal master.',
  monogram: 'Monogram (bible: approved element, proposed for standalone use). Path data verbatim.',
};

/* --------------------------------------------------------- 1. SVG masters */
rmSync(OUT, { recursive: true, force: true });
for (const layout of Object.keys(LAYOUTS) as Layout[]) {
  for (const cw of COLOURWAYS) {
    const art = composeLogo(layout, cw);
    const note = `${LAYOUT_NOTE[layout]} Colourway ${cw}: ${COLOURWAY_FILLS[cw].status.toLowerCase()}.`;
    write(`svg/odyssey-logo-${layout}-${cw}.svg`, artworkToSvg(art, { title: 'ODYSSEY', note }), art.status, note);
  }
}

/* ------------------------------------------------------- 2. Loyalty lockups */
const LOCKUP_NAME: Record<LockupLayout, string> = {
  'lockup-horizontal': 'horizontal',
  'lockup-compact': 'compact',
  'lockup-stacked': 'stacked',
};
for (const layout of Object.keys(LOCKUP_NAME) as LockupLayout[]) {
  for (const cw of COLOURWAYS) {
    const art = composeLogo(layout, cw);
    const note = `Loyalty lockup (${LOCKUP_NAME[layout]}), descriptor "Loyalty Card" outlined from Poppins Medium. Logo artwork unaltered.`;
    write(
      `svg/odyssey-loyalty-lockup-${LOCKUP_NAME[layout]}-${cw}.svg`,
      artworkToSvg(art, { title: 'ODYSSEY Loyalty Card', note, status: 'PROPOSED' }),
      'PROPOSED',
      note,
    );
  }
}

/* Partner variant templates: dashed box marks the partner slot (max monogram height). */
function partnerTemplate(base: 'horizontal' | 'compact', cw: Colourway): string {
  const { artwork, slot } = composePartnerLockup(base, cw, 2.5);
  const guide = COLOURWAY_FILLS[cw].divider;
  return [
    statusComment('PROPOSED', `Partner lockup template (${base}). Replace the dashed slot with the partner logo, at most monogram height.`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${artwork.width}" height="${artwork.height}" viewBox="${artwork.viewBox}" role="img" aria-label="ODYSSEY with partner">`,
    artworkBody(artwork),
    `<rect data-role="partner-slot" x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" fill="none" stroke="${guide}" stroke-width="4" stroke-dasharray="16 12"/>`,
    `</svg>`,
    '',
  ].join('\n');
}
for (const base of ['horizontal', 'compact'] as const) {
  for (const cw of ['color', 'reverse'] as const) {
    write(
      `svg/odyssey-loyalty-lockup-${base}-partner-${cw}.svg`,
      partnerTemplate(base, cw),
      'PROPOSED',
      'Partner variant template. Dashed rectangle = partner slot, not artwork.',
    );
  }
}

/* --------------------------------------------------------------- 3. Icons */
const appSvg = appIconSvg(1024);
write('icons/odyssey-app-icon.svg', appSvg, 'PROPOSED', 'App / PWA icon master, full bleed, no rounded corners.');
for (const size of ICONS.app.sizes) {
  write(
    `icons/odyssey-app-icon-${size}.png`,
    renderPng(appSvg, size, true),
    'PROPOSED',
    `App / PWA icon ${size}px, RGB, no alpha.`,
  );
}
const fg = adaptiveForegroundSvg();
const bg = adaptiveBackgroundSvg();
write('icons/odyssey-android-adaptive-foreground.svg', fg, 'PROPOSED', 'Android adaptive foreground, transparent.');
write('icons/odyssey-android-adaptive-foreground-432.png', renderPng(fg, ICONS.adaptive.exportPx), 'PROPOSED', 'Android adaptive foreground, 432px (108dp @4x).');
write('icons/odyssey-android-adaptive-background.svg', bg, 'PROPOSED', 'Android adaptive background, solid navy.');
write('icons/odyssey-android-adaptive-background-432.png', renderPng(bg, ICONS.adaptive.exportPx, true), 'PROPOSED', 'Android adaptive background, 432px.');
const fav = faviconSvg();
write('icons/odyssey-favicon.svg', fav, 'PROPOSED', 'Favicon, simplified D-and-sail. Requires approval before use.');
for (const size of ICONS.favicon.sizes) {
  write(`icons/odyssey-favicon-${size}.png`, renderPng(fav, size), 'PROPOSED', `Favicon ${size}px. Requires approval before use.`);
}

/* -------------------------------------------------------- 4. Preview sheet */
interface Bg {
  name: string;
  hex: string;
  cw: Colourway;
}
const BACKGROUNDS: Bg[] = [
  { name: 'Warm White', hex: COLORS.warmWhite, cw: 'color' },
  { name: 'White', hex: COLORS.white, cw: 'color' },
  { name: 'Mist', hex: COLORS.mist, cw: 'color' },
  { name: 'Odyssey Navy', hex: COLORS.navy, cw: 'reverse' },
  { name: 'Voyage Orange', hex: COLORS.orange, cw: 'navy' },
  { name: 'Dark calm photo area', hex: COLOURWAY_FILLS.white.backgrounds[0], cw: 'white' },
  { name: 'White (legal, engraving)', hex: COLORS.white, cw: 'black' },
];

const SHEET_W = 2400;
const MARGIN = 60;
const GUTTER = 36;
const PAD = 28;
const LABEL_H = 92;
const fmt = (n: number) => n.toFixed(2);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

function guideColour(bgHex: string): string {
  if (bgHex === COLORS.orange) return COLORS.navy;
  return contrastRatio(COLORS.ember, bgHex) >= 3 ? COLORS.ember : COLORS.warmWhite;
}

function card(art: Artwork, b: Bg, x: number, y: number, w: number, h: number, extra = ''): string {
  const lockupBox: Rect = { x: -CLEAR_SPACE, y: -CLEAR_SPACE, width: art.width + 2 * CLEAR_SPACE, height: art.height + 2 * CLEAR_SPACE };
  const logoBox = clearSpaceBox(art);
  const content = union(lockupBox, logoBox);
  const sc = Math.min((w - 2 * PAD) / content.width, (h - 2 * PAD) / content.height);
  const ox = x + (w - content.width * sc) / 2 - content.x * sc;
  const oy = y + (h - content.height * sc) / 2 - content.y * sc;
  const g = guideColour(b.hex);
  const sw = 2 / sc;
  const dash = `${10 / sc} ${7 / sc}`;
  const dot = `${3 / sc} ${6 / sc}`;
  const border = b.hex === COLORS.white || b.hex === COLORS.warmWhite ? ` stroke="${COLORS.mist}" stroke-width="2"` : '';
  const logoGuide =
    art.layout === 'lockup-stacked'
      ? `<rect x="${logoBox.x}" y="${logoBox.y}" width="${logoBox.width}" height="${logoBox.height}" fill="none" stroke="${g}" stroke-width="${sw}" stroke-dasharray="${dot}" opacity="0.9"/>`
      : '';
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${b.hex}"${border}/>`,
    `<g transform="translate(${ox} ${oy}) scale(${sc})">`,
    `<rect x="${lockupBox.x}" y="${lockupBox.y}" width="${lockupBox.width}" height="${lockupBox.height}" fill="none" stroke="${g}" stroke-width="${sw}" stroke-dasharray="${dash}"/>`,
    logoGuide,
    artworkBody(art),
    extra,
    `</g>`,
  ].join('\n');
}

function label(art: Artwork, b: Bg, x: number, y: number): string {
  const f = COLOURWAY_FILLS[art.colourway];
  const logoRatio = contrastRatio(f.letters, b.hex);
  const parts = [`logo ${fmt(logoRatio)} : 1`];
  if (art.descriptor) parts.push(`descriptor ${fmt(contrastRatio(f.descriptor, b.hex))} : 1`);
  const min = minHeightPx(art.layout);
  const px = descriptorPx(art, min);
  const sizeLine = `min ${min}px tall` + (px ? ` (descriptor ${px.toFixed(1)}px)` : '');
  const line = (text: string, dy: number, weight = 400, size = 20, fill: string = COLORS.slate) =>
    `<text x="${x}" y="${y + dy}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
  return [
    line(`${art.colourway} on ${b.name} ${b.hex}  ·  PROPOSED`, 26, 600, 21, COLORS.navy),
    line(parts.join('  ·  '), 52),
    line(sizeLine, 76),
  ].join('\n');
}

const body: string[] = [];
let cursorY = MARGIN;
body.push(
  `<text x="${MARGIN}" y="${cursorY + 40}" font-family="Poppins, Arial, sans-serif" font-size="44" font-weight="700" fill="${COLORS.navy}">ODYSSEY Digital Loyalty Card · lockup preview</text>`,
  `<text x="${MARGIN}" y="${cursorY + 84}" font-family="Inter, Arial, sans-serif" font-size="22" fill="${COLORS.slate}">STATUS: PROPOSED. Dashed line = 2X clear space around the lockup. Dotted line (stacked) = 2X clear space around the approved logo. Ratios: WCAG 2.x. Logo needs 3 : 1, descriptor 4.5 : 1.</text>`,
);
cursorY += 130;

function section(title: string, layout: AnyLayout, cols: number, maxCardH: number, backgrounds: Bg[]) {
  body.push(
    `<text x="${MARGIN}" y="${cursorY + 34}" font-family="Poppins, Arial, sans-serif" font-size="30" font-weight="500" fill="${COLORS.navy}">${esc(title)}</text>`,
  );
  cursorY += 56;
  const cardW = (SHEET_W - 2 * MARGIN - (cols - 1) * GUTTER) / cols;
  const sample = composeLogo(layout, 'color');
  const contentAspect = (sample.width + 4 * CLEAR_SPACE) / (sample.height + 4 * CLEAR_SPACE);
  const cardH = Math.min(maxCardH, (cardW - 2 * PAD) / contentAspect + 2 * PAD);
  backgrounds.forEach((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + GUTTER);
    const y = cursorY + row * (cardH + LABEL_H + GUTTER);
    const art = composeLogo(layout, b.cw);
    body.push(card(art, b, x, y, cardW, cardH), label(art, b, x, y + cardH + 4));
  });
  cursorY += Math.ceil(backgrounds.length / cols) * (cardH + LABEL_H + GUTTER) + 20;
}

section('Horizontal lockup  ·  web headers, email', 'lockup-horizontal', 2, 300, BACKGROUNDS);
section('Compact lockup  ·  in-app card header (< 360px wide or < 48px tall)', 'lockup-compact', 3, 300, BACKGROUNDS);
section('Stacked lockup  ·  splash, onboarding', 'lockup-stacked', 4, 640, BACKGROUNDS);

// Partner variant (optional)
body.push(
  `<text x="${MARGIN}" y="${cursorY + 34}" font-family="Poppins, Arial, sans-serif" font-size="30" font-weight="500" fill="${COLORS.navy}">Partner variant (optional)  ·  dashed box = partner logo slot, max monogram height</text>`,
);
cursorY += 56;
{
  const cardW = (SHEET_W - 2 * MARGIN - GUTTER) / 2;
  const cardH = 300;
  const items: [('horizontal' | 'compact'), Bg][] = [
    ['horizontal', BACKGROUNDS[0]],
    ['compact', BACKGROUNDS[3]],
  ];
  items.forEach(([base, b], i) => {
    const { artwork, slot } = composePartnerLockup(base, b.cw, 2.5);
    const g = guideColour(b.hex);
    const extra = `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" fill="none" stroke="${g}" stroke-width="5" stroke-dasharray="18 12"/>`;
    const x = MARGIN + i * (cardW + GUTTER);
    body.push(card(artwork, b, x, cursorY, cardW, cardH, extra), label(artwork, b, x, cursorY + cardH + 4));
  });
  cursorY += cardH + LABEL_H + GUTTER;
}

const sheetH = Math.ceil(cursorY + MARGIN);
const sheet = [
  statusComment('PROPOSED', 'Preview sheet: every lockup on its approved background, 2X clear-space guides, WCAG contrast.'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${sheetH}" viewBox="0 0 ${SHEET_W} ${sheetH}">`,
  `<rect width="${SHEET_W}" height="${sheetH}" fill="${COLORS.white}"/>`,
  ...body,
  `</svg>`,
  '',
].join('\n');
write('preview/odyssey-loyalty-preview-sheet.svg', sheet, 'PROPOSED', 'Preview sheet (labels are live text; artwork is outlined).');
write('preview/odyssey-loyalty-preview-sheet.png', renderPng(sheet, SHEET_W), 'PROPOSED', 'PNG render of the preview sheet, for review only.');

/* ------------------------------------------- 5. Measurements for the report */
function orangeShare(art: Artwork, bgHex: string): number {
  // Share of the lockup-plus-2X area covered by Voyage Orange (the bible's <= 5% budget is per view).
  const box = { x: -CLEAR_SPACE, y: -CLEAR_SPACE, w: art.width + 2 * CLEAR_SPACE, h: art.height + 2 * CLEAR_SPACE };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${box.w}" height="${box.h}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${bgHex}"/>${artworkBody(art)}</svg>`;
  const img = PNG.sync.read(renderPng(svg, 1200));
  let orange = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i] - 255) < 8 && Math.abs(img.data[i + 1] - 111) < 8 && img.data[i + 2] < 20) orange++;
  }
  return orange / (img.width * img.height);
}

const measurements: string[] = [];
for (const layout of ['stacked', 'horizontal', 'monogram', 'lockup-horizontal', 'lockup-compact', 'lockup-stacked'] as AnyLayout[]) {
  const art = composeLogo(layout, 'color');
  const min = minHeightPx(layout);
  const px = descriptorPx(art, min);
  measurements.push(
    `| ${layout} | ${art.width} x ${art.height} u | ${min}px | ${px ? px.toFixed(1) + 'px' : 'n/a'} | ${(orangeShare(art, COLORS.warmWhite) * 100).toFixed(1)}% |`,
  );
}
const app = placeMonogram(1024, ICONS.app.monogramWidth);
const adaptive = placeMonogram(ICONS.adaptive.exportPx, ICONS.adaptive.monogramWidth);
const iconLines = [
  `- App icon: monogram ${(ICONS.app.monogramWidth * 100).toFixed(0)}% of tile; bounding-box corner at ${cornerDistanceShare(app, 1024).toFixed(4)} of tile from centre (maskable limit ${ICONS.maskableRadius}).`,
  `- Android adaptive: monogram ${(ICONS.adaptive.monogramWidth * 100).toFixed(1)}% of tile; corner at ${cornerDistanceShare(adaptive, ICONS.adaptive.exportPx).toFixed(4)} (safe circle radius ${(ICONS.adaptive.safeDp / ICONS.adaptive.layerDp / 2).toFixed(4)}).`,
];

/* ------------------------------------------------------------ 6. Manifest */
const md = [
  '# ODYSSEY Digital Loyalty Card: asset status',
  '',
  'Generated by `npm run generate` from `src/brand/composeLogo.ts`. Do not edit these files by hand.',
  'Labels follow the ODYSSEY Brand Bible v1.0: APPROVED (supplied artwork), PROPOSED (review before release), CONFIRM (needs a decision). No file is a REBUILD: all logo path data is copied verbatim from the supplied vector masters.',
  '',
  '| File | Status | Note |',
  '|---|---|---|',
  ...manifest.map((m) => `| \`${m.file}\` | ${m.status} | ${m.note} |`),
  '| `STATUS.md` | PROPOSED | This manifest. |',
  '',
  '## Measurements',
  '',
  '| Layout | Artwork | Min height | Descriptor at min | Orange share of lockup + 2X box |',
  '|---|---|---|---|---|',
  ...measurements,
  '',
  ...iconLines,
  '',
].join('\n');
writeFileSync(join(OUT, 'STATUS.md'), md);
console.log(`${manifest.length} files written to ${OUT}/`);
console.log(measurements.join('\n'));
console.log(iconLines.join('\n'));
