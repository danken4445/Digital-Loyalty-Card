/**
 * The one parametric function behind every logo, lockup and icon: (layout x colourway) -> artwork.
 * Native, web and the SVG generator all render the `Artwork` this returns, so they cannot drift.
 *
 * The approved logo is always placed at scale 1 in master units. Lockups only add a divider and
 * an outlined descriptor (or a partner slot) beside or below it; they never touch the logo itself.
 */
import {
  CLEAR_SPACE,
  COLOURWAY_FILLS,
  DEFAULT_DESCRIPTOR,
  DESCRIPTOR_MIN_FONT_PX,
  LAYOUTS,
  LOCKUP,
  LOCKUP_FALLBACK,
  LOCKUP_LAYOUTS,
  MIN_HEIGHT_PX,
  MONOGRAM,
  type AnyLayout,
  type Colourway,
  type DescriptorText,
  type Layout,
  type LockupLayout,
  type Status,
} from './brandTokens';
import {
  LETTERS_SOLID,
  LETTERS_WITH_RIM,
  RIM,
  SAIL,
  WORDMARK_HORIZONTAL,
  WORDMARK_STACKED,
} from './logoPaths';
import { DESCRIPTOR_FONT, DESCRIPTOR_OUTLINES } from './descriptorPaths.generated';

export type ShapeRole = 'letters' | 'rim' | 'sail' | 'wordmark' | 'divider' | 'descriptor';

export interface Shape {
  readonly key: string;
  readonly role: ShapeRole;
  readonly d: string;
  readonly fill: string;
  /** Counters are cut with even-odd, never painted. */
  readonly fillRule: 'evenodd' | 'nonzero';
  /** Pre-built SVG transform string (stable identity, no allocation at render). */
  readonly transform: string;
  /** Numeric form of `transform`: translate(tx ty) scale(s). */
  readonly tx: number;
  readonly ty: number;
  readonly s: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Artwork {
  readonly layout: AnyLayout;
  readonly colourway: Colourway;
  readonly status: Status;
  readonly width: number;
  readonly height: number;
  /** width / height */
  readonly aspect: number;
  readonly viewBox: string;
  readonly shapes: readonly Shape[];
  /** Box the approved logo occupies inside this artwork (for clear-space guides). */
  readonly logoBox: Rect;
  readonly descriptor: DescriptorText | null;
  /** Descriptor font size in artwork units, or null when there is no descriptor. */
  readonly descriptorFontSize: number | null;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
/** Positions: 2 decimals is far below a device pixel at any size. Scales keep 4 decimals. */
const round2 = (n: number) => Math.round(n * 100) / 100;

function transformString(tx: number, ty: number, s: number): string {
  const t = tx === 0 && ty === 0 ? '' : `translate(${round2(tx)} ${round2(ty)})`;
  const sc = s === 1 ? '' : `scale(${round(s)})`;
  return [t, sc].filter(Boolean).join(' ');
}

function shape(
  key: string,
  role: ShapeRole,
  d: string,
  fill: string,
  fillRule: Shape['fillRule'],
  tx: number,
  ty: number,
  s = 1,
): Shape {
  return {
    key,
    role,
    d,
    fill,
    fillRule,
    tx: round2(tx),
    ty: round2(ty),
    s: round(s),
    transform: transformString(tx, ty, s),
  };
}

/** Monogram pieces, unaltered, placed with the monogram's top-left at (x, y). */
function monogramShapes(colourway: Colourway, x: number, y: number): Shape[] {
  const f = COLOURWAY_FILLS[colourway];
  const ox = x - MONOGRAM.masterOrigin.x;
  const oy = y - MONOGRAM.masterOrigin.y;
  const letters = f.rim === null ? LETTERS_SOLID : LETTERS_WITH_RIM;
  const out: Shape[] = letters.map((d, i) =>
    shape(`letters-${i}`, 'letters', d, f.letters, 'evenodd', ox, oy),
  );
  if (f.rim !== null) {
    const rim = f.rim;
    RIM.forEach((d, i) => out.push(shape(`rim-${i}`, 'rim', d, rim, 'evenodd', ox, oy)));
  }
  out.push(shape('sail', 'sail', SAIL, f.sail, 'nonzero', ox, oy));
  return out;
}

/** Approved layout shapes with the layout's top-left at (x, y). */
function logoShapes(layout: Layout, colourway: Colourway, x = 0, y = 0): Shape[] {
  const out = monogramShapes(colourway, x, y);
  const fill = COLOURWAY_FILLS[colourway].wordmark;
  if (layout === 'stacked')
    out.push(shape('wordmark', 'wordmark', WORDMARK_STACKED, fill, 'nonzero', x, y));
  if (layout === 'horizontal')
    out.push(shape('wordmark', 'wordmark', WORDMARK_HORIZONTAL, fill, 'nonzero', x, y));
  return out;
}

function statusFor(layout: AnyLayout, colourway: Colourway): Status {
  if (layout === 'stacked' && colourway === 'color') return 'APPROVED';
  return 'PROPOSED';
}

function finish(
  layout: AnyLayout,
  colourway: Colourway,
  width: number,
  height: number,
  shapes: Shape[],
  logoBox: Rect,
  descriptor: DescriptorText | null,
  descriptorFontSize: number | null,
): Artwork {
  // Approved layouts keep the masters' exact canvas (e.g. 1828.08); lockups use whole units,
  // rounded up so the outlined descriptor is never clipped.
  const lockup = isLockup(layout);
  const w = lockup ? Math.ceil(width - 1e-6) : round(width);
  const h = lockup ? Math.ceil(height - 1e-6) : round(height);
  return {
    layout,
    colourway,
    status: statusFor(layout, colourway),
    width: w,
    height: h,
    aspect: w / h,
    viewBox: `0 0 ${w} ${h}`,
    shapes,
    logoBox,
    descriptor,
    descriptorFontSize: descriptorFontSize === null ? null : round(descriptorFontSize),
  };
}

/** Font size (artwork units) that gives the descriptor the requested cap height. */
export function descriptorFontSizeFor(capHeight: number): number {
  return (capHeight * DESCRIPTOR_FONT.unitsPerEm) / DESCRIPTOR_FONT.capHeight;
}

interface _Slot {
  kind: 'descriptor' | 'partner';
}

/** Horizontal or compact lockup: logo | gap | divider | gap | slot. Slot is vertically centred. */
function sideLockup(
  base: 'horizontal' | 'monogram',
  colourway: Colourway,
  layout: AnyLayout,
  slotWidth: (fontSize: number) => number,
  addSlot: (shapes: Shape[], x: number, centreY: number, fontSize: number) => void,
  capRatio: number,
  descriptor: DescriptorText | null,
): Artwork {
  const logo = LAYOUTS[base];
  const f = COLOURWAY_FILLS[colourway];
  const shapes = logoShapes(base, colourway);
  const dividerX = logo.width + LOCKUP.gap;
  const dividerY = (logo.height - LOCKUP.dividerHeight) / 2;
  shapes.push(
    shape(
      'divider',
      'divider',
      `M0 0 H${LOCKUP.dividerWidth} V${LOCKUP.dividerHeight} H0 Z`,
      f.divider,
      'nonzero',
      dividerX,
      dividerY,
    ),
  );
  const slotX = dividerX + LOCKUP.dividerWidth + LOCKUP.gap;
  const fontSize = descriptorFontSizeFor(capRatio * MONOGRAM.height);
  addSlot(shapes, slotX, logo.height / 2, fontSize);
  const width = slotX + slotWidth(fontSize);
  return finish(
    layout,
    colourway,
    width,
    logo.height,
    shapes,
    { x: 0, y: 0, width: logo.width, height: logo.height },
    descriptor,
    descriptor ? fontSize : null,
  );
}

function descriptorSlot(colourway: Colourway, text: DescriptorText) {
  const o = DESCRIPTOR_OUTLINES[text];
  const fill = COLOURWAY_FILLS[colourway].descriptor;
  const capH = DESCRIPTOR_FONT.capHeight;
  return {
    width: (fontSize: number) => ((o.bbox.x2 - o.bbox.x1) * fontSize) / DESCRIPTOR_FONT.unitsPerEm,
    /** Places the descriptor with its ink starting at x and its cap height centred on centreY. */
    add: (shapes: Shape[], x: number, centreY: number, fontSize: number) => {
      const s = fontSize / DESCRIPTOR_FONT.unitsPerEm;
      const baseline = centreY + (capH * s) / 2;
      shapes.push(
        shape('descriptor', 'descriptor', o.d, fill, 'nonzero', x - o.bbox.x1 * s, baseline, s),
      );
    },
  };
}

function stackedLockup(colourway: Colourway, text: DescriptorText): Artwork {
  const logo = LAYOUTS.stacked;
  const o = DESCRIPTOR_OUTLINES[text];
  const fontSize = descriptorFontSizeFor(LOCKUP.descriptorCapRatio.stacked * MONOGRAM.height);
  const s = fontSize / DESCRIPTOR_FONT.unitsPerEm;
  const inkW = (o.bbox.x2 - o.bbox.x1) * s;
  const width = Math.max(logo.width, inkW);
  const logoX = (width - logo.width) / 2;
  const shapes = logoShapes('stacked', colourway, logoX, 0);
  const capTop = logo.height + LOCKUP.stackedDescriptorGap;
  const baseline = capTop + DESCRIPTOR_FONT.capHeight * s;
  const fill = COLOURWAY_FILLS[colourway].descriptor;
  shapes.push(
    shape(
      'descriptor',
      'descriptor',
      o.d,
      fill,
      'nonzero',
      (width - inkW) / 2 - o.bbox.x1 * s,
      baseline,
      s,
    ),
  );
  const height = baseline + Math.max(0, o.bbox.y2) * s;
  return finish(
    'lockup-stacked',
    colourway,
    width,
    height,
    shapes,
    { x: logoX, y: 0, width: logo.width, height: logo.height },
    text,
    fontSize,
  );
}

function build(layout: AnyLayout, colourway: Colourway, text: DescriptorText): Artwork {
  switch (layout) {
    case 'monogram':
    case 'stacked':
    case 'horizontal': {
      const l = LAYOUTS[layout];
      return finish(
        layout,
        colourway,
        l.width,
        l.height,
        logoShapes(layout, colourway),
        { x: 0, y: 0, width: l.width, height: l.height },
        null,
        null,
      );
    }
    case 'lockup-horizontal': {
      const slot = descriptorSlot(colourway, text);
      return sideLockup(
        'horizontal',
        colourway,
        layout,
        slot.width,
        slot.add,
        LOCKUP.descriptorCapRatio.horizontal,
        text,
      );
    }
    case 'lockup-compact': {
      const slot = descriptorSlot(colourway, text);
      return sideLockup(
        'monogram',
        colourway,
        layout,
        slot.width,
        slot.add,
        LOCKUP.descriptorCapRatio.compact,
        text,
      );
    }
    case 'lockup-stacked':
      return stackedLockup(colourway, text);
  }
}

const cache = new Map<string, Artwork>();

/** Memoised: the same arguments always return the same object, so components can rely on identity. */
export function composeLogo(
  layout: AnyLayout,
  colourway: Colourway,
  descriptor: DescriptorText = DEFAULT_DESCRIPTOR,
): Artwork {
  const key = `${layout}|${colourway}|${isLockup(layout) ? descriptor : ''}`;
  let art = cache.get(key);
  if (!art) {
    art = build(layout, colourway, descriptor);
    cache.set(key, art);
  }
  return art;
}

export function isLockup(layout: AnyLayout): layout is LockupLayout {
  return (LOCKUP_LAYOUTS as readonly string[]).includes(layout);
}

/* ------------------------------------------------------------ partner variant */

export interface PartnerLockup {
  readonly artwork: Artwork;
  /** Where the partner's logo goes, in artwork units. Fit the partner artwork inside it. */
  readonly slot: Rect;
}

/**
 * PROPOSED (optional). The descriptor slot holds a partner's logo, at most the monogram's height,
 * with the same divider and gaps. `partnerAspect` = partner logo width / height.
 */
export function composePartnerLockup(
  base: 'horizontal' | 'compact',
  colourway: Colourway,
  partnerAspect: number,
  partnerHeight: number = LOCKUP.partnerMaxHeight,
): PartnerLockup {
  if (!(partnerAspect > 0)) throw new Error('partnerAspect must be > 0');
  const h = Math.min(partnerHeight, LOCKUP.partnerMaxHeight);
  let slot: Rect = { x: 0, y: 0, width: 0, height: 0 };
  const artwork = sideLockup(
    base === 'compact' ? 'monogram' : 'horizontal',
    colourway,
    base === 'compact' ? 'lockup-compact' : 'lockup-horizontal',
    () => h * partnerAspect,
    (_shapes, x, centreY) => {
      slot = {
        x: round(x),
        y: round(centreY - h / 2),
        width: round(h * partnerAspect),
        height: round(h),
      };
    },
    0,
    null,
  );
  return { artwork, slot };
}

/* ------------------------------------------------------------------- sizing */

/** Minimum on-screen height (px) for a layout, including the derived lockup minimums. */
export function minHeightPx(
  layout: AnyLayout,
  descriptor: DescriptorText = DEFAULT_DESCRIPTOR,
): number {
  if (!isLockup(layout)) return MIN_HEIGHT_PX[layout];
  const art = composeLogo(layout, 'color', descriptor);
  const fontSize = art.descriptorFontSize ?? 1;
  const forDescriptor = (DESCRIPTOR_MIN_FONT_PX * art.height) / fontSize;
  const stated =
    layout === 'lockup-stacked'
      ? (MIN_HEIGHT_PX.stacked * art.height) / LAYOUTS.stacked.height
      : MIN_HEIGHT_PX[layout];
  return Math.ceil(Math.max(stated, forDescriptor));
}

/** Descriptor font size in px when the artwork is drawn `heightPx` tall. */
export function descriptorPx(art: Artwork, heightPx: number): number | null {
  return art.descriptorFontSize === null ? null : (art.descriptorFontSize * heightPx) / art.height;
}

export interface ResolvedLogo {
  readonly artwork: Artwork;
  readonly height: number;
  readonly width: number;
  /** Set when the request was changed (descriptor dropped or size clamped). Report under __DEV__. */
  readonly warning: string | null;
}

/**
 * Applies the size rules. Order:
 * 1. A lockup whose descriptor would render under 12px drops the descriptor and becomes the plain logo.
 * 2. Anything under its minimum height is clamped up, never scaled down silently.
 */
export function resolveLogo(
  layout: AnyLayout,
  colourway: Colourway,
  height: number,
  descriptor: DescriptorText = DEFAULT_DESCRIPTOR,
): ResolvedLogo {
  const notes: string[] = [];
  let finalLayout: AnyLayout = layout;
  if (isLockup(layout)) {
    const px = descriptorPx(composeLogo(layout, colourway, descriptor), height) ?? 0;
    if (px < DESCRIPTOR_MIN_FONT_PX) {
      finalLayout = LOCKUP_FALLBACK[layout];
      notes.push(
        `descriptor would render at ${px.toFixed(1)}px (< ${DESCRIPTOR_MIN_FONT_PX}px), so the plain ${finalLayout} logo is shown`,
      );
    }
  }
  const min = minHeightPx(finalLayout, descriptor);
  let h = height;
  if (!(h >= min)) {
    notes.push(
      `height ${height}px is below the ${finalLayout} minimum of ${min}px; clamped to ${min}px`,
    );
    h = min;
  }
  const artwork = composeLogo(finalLayout, colourway, descriptor);
  return {
    artwork,
    height: h,
    width: Math.round(h * artwork.aspect * 100) / 100,
    warning: notes.length ? `[OdysseyLogo] ${layout}: ${notes.join('; ')}.` : null,
  };
}

/** Clear-space box (2X on every side) around an artwork's approved logo, in artwork units. */
export function clearSpaceBox(art: Artwork): Rect {
  return {
    x: art.logoBox.x - CLEAR_SPACE,
    y: art.logoBox.y - CLEAR_SPACE,
    width: art.logoBox.width + 2 * CLEAR_SPACE,
    height: art.logoBox.height + 2 * CLEAR_SPACE,
  };
}
