'use client';

/**
 * ODYSSEY logo for the web. Draws the approved artwork from lib/brand (path data copied verbatim
 * from the supplied masters). Pick the colourway with colourwayForBackground(surfaceHex).
 * STATUS: PROPOSED (component); the logo artwork it draws is APPROVED and unaltered.
 * A React Native twin lives in tools/odyssey-brand/native and shares the same lib/brand code.
 */
import { memo, useEffect, useMemo } from 'react';
import {
  DEFAULT_DESCRIPTOR,
  type AnyLayout,
  type Colourway,
  type DescriptorText,
} from '@/lib/brand/odyssey/brandTokens';
import { resolveLogo } from '@/lib/brand/odyssey/composeLogo';

export interface OdysseyLogoProps {
  /** monogram | horizontal | stacked, or a loyalty lockup. */
  layout: AnyLayout;
  /** Choose by background with colourwayForBackground; never by taste. */
  colourway: Colourway;
  /** Rendered height in px. Width follows the layout's aspect ratio. Clamped up to the minimum. */
  height: number;
  /** Lockups only. */
  descriptor?: DescriptorText;
  testID?: string;
  accessibilityLabel?: string;
  className?: string;
}

const PRESERVE = 'xMidYMid meet';
const IS_DEV = process.env.NODE_ENV !== 'production';

function OdysseyLogoDom({
  layout,
  colourway,
  height,
  descriptor = DEFAULT_DESCRIPTOR,
  testID,
  accessibilityLabel = 'ODYSSEY',
  className,
}: OdysseyLogoProps) {
  const resolved = useMemo(
    () => resolveLogo(layout, colourway, height, descriptor),
    [layout, colourway, height, descriptor],
  );

  useEffect(() => {
    if (IS_DEV && resolved.warning) console.warn(resolved.warning);
  }, [resolved.warning]);

  const { artwork } = resolved;
  const paths = useMemo(
    () =>
      artwork.shapes.map((s) => (
        <path
          key={s.key}
          d={s.d}
          fill={s.fill}
          fillRule={s.fillRule}
          transform={s.transform || undefined}
        />
      )),
    [artwork],
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={resolved.width}
      height={resolved.height}
      viewBox={artwork.viewBox}
      preserveAspectRatio={PRESERVE}
      role="img"
      aria-label={accessibilityLabel}
      data-testid={testID}
      focusable="false"
      className={className}
    >
      <title>{accessibilityLabel}</title>
      {paths}
    </svg>
  );
}

export const OdysseyLogo = memo(OdysseyLogoDom);
OdysseyLogo.displayName = 'OdysseyLogo';
