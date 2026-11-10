/**
 * OdysseyLogo for React Native (react-native-svg).
 * Renders artwork from composeLogo; the path data is shared with the web variant and the exporter.
 * STATUS: PROPOSED (component); the logo artwork it draws is APPROVED and unaltered.
 */
import React, { memo, useEffect, useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { DEFAULT_DESCRIPTOR, type AnyLayout, type Colourway, type DescriptorText } from '../../../lib/brand/odyssey/brandTokens';
import { resolveLogo } from '../../../lib/brand/odyssey/composeLogo';

export interface OdysseyLogoProps {
  /** monogram | horizontal | stacked, or a loyalty lockup. */
  layout: AnyLayout;
  /** Pick with colourwayForBackground(surfaceHex); never by taste. */
  colourway: Colourway;
  /** Rendered height in px. Width follows from the layout's aspect ratio. Clamped up to the minimum. */
  height: number;
  /** Lockups only. Outlined text from DESCRIPTORS. */
  descriptor?: DescriptorText;
  testID?: string;
  accessibilityLabel?: string;
}

const PRESERVE = 'xMidYMid meet';

function OdysseyLogoNative({
  layout,
  colourway,
  height,
  descriptor = DEFAULT_DESCRIPTOR,
  testID,
  accessibilityLabel = 'ODYSSEY',
}: OdysseyLogoProps) {
  const resolved = useMemo(() => resolveLogo(layout, colourway, height, descriptor), [layout, colourway, height, descriptor]);

  useEffect(() => {
    if (__DEV__ && resolved.warning) console.warn(resolved.warning);
  }, [resolved.warning]);

  const { artwork } = resolved;
  const paths = useMemo(
    () =>
      artwork.shapes.map((s) => (
        <Path key={s.key} d={s.d} fill={s.fill} fillRule={s.fillRule} transform={s.transform || undefined} />
      )),
    [artwork],
  );

  return (
    <Svg
      width={resolved.width}
      height={resolved.height}
      viewBox={artwork.viewBox}
      preserveAspectRatio={PRESERVE}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {paths}
    </Svg>
  );
}

export const OdysseyLogo = memo(OdysseyLogoNative);
OdysseyLogo.displayName = 'OdysseyLogo';
export default OdysseyLogo;
