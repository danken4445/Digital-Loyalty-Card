/**
 * ODYSSEY brand tokens for the Digital Loyalty Card logo system.
 * Source: ODYSSEY Brand Bible v1.0 (draft for approval, October 2026).
 *
 * Every value carries its bible status in a comment:
 *   APPROVED  supplied artwork / primary colours: never change
 *   PROPOSED  recommendation from the bible or this system: review before release
 *   CONFIRM   needs a decision from ODYSSEY
 *
 * No other file may hard-code a colour, size or geometry value: import it from here.
 */

/* ------------------------------------------------------------------ colour */

export const COLORS = {
  /** APPROVED. Structure, logo, text. */
  navy: '#152839',
  /** APPROVED. Accent, rim, sail. Never text on light backgrounds. */
  orange: '#FF6F07',
  /** APPROVED. Default background. */
  warmWhite: '#F9F8F3',
  /** PROPOSED. Orange text on light backgrounds only. */
  ember: '#B8470A',
  /** PROPOSED. Secondary text; descriptor on light. */
  slate: '#45546A',
  /** PROPOSED. Meta text; lockup divider on navy. */
  harborGrey: '#5F6A7C',
  /** PROPOSED. Dividers; lockup divider on light. */
  mist: '#DCE1E8',
  /** PROPOSED. Warm panels. */
  sand: '#ECE7DE',
  /** PROPOSED. Cards, documents; single-colour white logo. */
  white: '#FFFFFF',
  /** PROPOSED. Single-colour black logo (legal, engraving). */
  black: '#000000',
} as const;

export type ColorName = keyof typeof COLORS;
export type BrandHex = (typeof COLORS)[ColorName];

/** PROPOSED. Area balance per view. Orange includes the logo's own orange. */
export const COLOR_BALANCE = { light: 0.6, navy: 0.25, neutrals: 0.1, orangeMax: 0.05 } as const;

/** PROPOSED. WCAG 2.x thresholds used by the bible. */
export const CONTRAST = {
  /** Logo outer colour vs background (meaningful graphics). */
  logoMin: 3,
  /** Normal-size text (descriptor). */
  textMin: 4.5,
} as const;

/* -------------------------------------------------------------- colourways */

export const COLOURWAYS = ['color', 'reverse', 'navy', 'white', 'black'] as const;
export type Colourway = (typeof COLOURWAYS)[number];

export type Status = 'APPROVED' | 'PROPOSED' | 'REBUILD' | 'CONFIRM';

/** Fills per colourway. `null` rim = rim merges into the wall (single-colour). */
export const COLOURWAY_FILLS = {
  color: {
    status: 'APPROVED',
    letters: COLORS.navy,
    rim: COLORS.orange,
    sail: COLORS.orange,
    wordmark: COLORS.navy,
    descriptor: COLORS.slate,
    divider: COLORS.mist,
    /** Backgrounds this colourway is approved on. */
    backgrounds: [COLORS.warmWhite, COLORS.white, COLORS.mist],
  },
  reverse: {
    status: 'PROPOSED',
    letters: COLORS.warmWhite,
    rim: COLORS.orange,
    sail: COLORS.orange,
    wordmark: COLORS.warmWhite,
    descriptor: COLORS.warmWhite,
    divider: COLORS.harborGrey,
    backgrounds: [COLORS.navy],
  },
  navy: {
    status: 'PROPOSED',
    letters: COLORS.navy,
    rim: null,
    sail: COLORS.navy,
    wordmark: COLORS.navy,
    descriptor: COLORS.navy,
    divider: COLORS.navy,
    backgrounds: [COLORS.orange, COLORS.white, COLORS.warmWhite],
  },
  white: {
    status: 'PROPOSED',
    letters: COLORS.white,
    rim: null,
    sail: COLORS.white,
    wordmark: COLORS.white,
    descriptor: COLORS.white,
    divider: COLORS.white,
    /** Dark, calm photography. #3A4B5F is the bible's sample (page 11). */
    backgrounds: ['#3A4B5F'],
  },
  black: {
    status: 'PROPOSED',
    letters: COLORS.black,
    rim: null,
    sail: COLORS.black,
    wordmark: COLORS.black,
    descriptor: COLORS.black,
    divider: COLORS.black,
    backgrounds: [COLORS.white],
  },
} as const satisfies Record<
  Colourway,
  {
    status: Status;
    letters: string;
    rim: string | null;
    sail: string;
    wordmark: string;
    descriptor: string;
    divider: string;
    backgrounds: readonly string[];
  }
>;

/* ---------------------------------------------------------------- geometry */

/** APPROVED. Monogram geometry in master units (1u = 1/360 of monogram height). */
export const MONOGRAM = {
  height: 360,
  letterWidth: 272,
  pitch: 232,
  overlap: 40,
  width: 736, // 2 x pitch + letterWidth
  wall: 40, // = X
  rim: 18,
  radii: { outer: 128, wallInner: 88, counter: 70 },
  dStemRadii: { outer: 64, counter: 24 },
  cOpening: 104,
  mast: 14,
  mastSailGap: 9,
  /** Masters draw the monogram at (232, 335); every layout translates by this. */
  masterOrigin: { x: 232, y: 335 },
} as const;

/** APPROVED. Clear-space unit X = navy wall. */
export const X = MONOGRAM.wall;
/** APPROVED. Clear space on every side of every version. */
export const CLEAR_SPACE = 2 * X;

/** APPROVED (stacked) / PROPOSED (horizontal). Measured from the vector masters. */
export const LAYOUTS = {
  monogram: { status: 'PROPOSED', width: 736, height: 360 },
  stacked: {
    status: 'APPROVED',
    width: 736,
    height: 510,
    wordmarkCapHeight: 66,
    gap: 84,
    wordmarkWidth: 618,
  },
  horizontal: {
    status: 'PROPOSED',
    width: 1828.08,
    height: 360,
    wordmarkCapHeightRatio: 0.3,
    gap: 2 * X,
  },
} as const;

export type Layout = keyof typeof LAYOUTS;

/* ----------------------------------------------------------- loyalty lockups */

/** PROPOSED. Loyalty lockup geometry in master units. */
export const LOCKUP = {
  gap: 2 * X,
  dividerWidth: 4,
  /** Divider spans the monogram height. */
  dividerHeight: MONOGRAM.height,
  /**
   * Descriptor cap height as a share of monogram height.
   * Stacked: 0.18 (64.8u) keeps the descriptor just under the 66u wordmark so it never outranks the logo.
   */
  descriptorCapRatio: { horizontal: 0.22, compact: 0.3, stacked: 0.18 },
  /** Stacked: descriptor sits below the logo's 2X clear space plus another 2X. */
  stackedDescriptorGap: CLEAR_SPACE + 2 * X,
  /** Partner logo is never taller than the monogram. */
  partnerMaxHeight: MONOGRAM.height,
} as const;

export const LOCKUP_LAYOUTS = ['lockup-horizontal', 'lockup-compact', 'lockup-stacked'] as const;
export type LockupLayout = (typeof LOCKUP_LAYOUTS)[number];
export type AnyLayout = Layout | LockupLayout;

/** The plain logo a lockup falls back to when its descriptor would be under 12px. */
export const LOCKUP_FALLBACK = {
  'lockup-horizontal': 'horizontal',
  'lockup-compact': 'monogram',
  'lockup-stacked': 'stacked',
} as const satisfies Record<LockupLayout, Layout>;

/** CONFIRM. "Loyalty Card" is the default; "Odyssey Card" is outlined in case it is chosen. */
export const DESCRIPTORS = ['Loyalty Card', 'Odyssey Card'] as const;
export type DescriptorText = (typeof DESCRIPTORS)[number];
export const DEFAULT_DESCRIPTOR: DescriptorText = 'Loyalty Card';

/* ------------------------------------------------------------ minimum sizes */

/** PROPOSED (bible page 10) plus derived lockup minimums. Digital px, height. */
export const MIN_HEIGHT_PX = {
  stacked: 56,
  horizontal: 24,
  monogram: 32,
  favicon: 16,
  'lockup-horizontal': 40,
  'lockup-compact': 32,
  /** Derived in composeLogo from the 56px stacked minimum; see MIN_LOCKUP_STACKED. */
  'lockup-stacked': 0,
} as const;

/** PROPOSED. Print minimums, height in mm. Confirm with a printer proof. */
export const MIN_HEIGHT_MM = { stacked: 22, horizontal: 9, monogram: 12 } as const;

/** PROPOSED. Descriptor never renders below this font size. */
export const DESCRIPTOR_MIN_FONT_PX = 12;

/* -------------------------------------------------------------------- icons */

/** PROPOSED. App / PWA and Android adaptive icon geometry, as tile fractions. */
export const ICONS = {
  app: { monogramWidth: 0.7, sizes: [1024, 512, 192, 180] },
  maskableRadius: 0.4,
  /** Android adaptive: 108dp layer, 66dp safe circle. */
  adaptive: { layerDp: 108, safeDp: 66, exportPx: 432, monogramWidth: 0.545 },
  favicon: { sizes: [16, 32] },
} as const;

/* --------------------------------------------------------------- typography */

/** PROPOSED. Brand type. The wordmark is artwork and is never set in type. */
export const TYPE = {
  heading: { family: 'Poppins', weights: [500, 700] },
  body: { family: 'Inter', weights: [400, 500, 600] },
  fallback: 'system-ui, Arial, sans-serif',
  descriptor: { family: 'Poppins', weight: 500, tracking: 0 },
} as const;
