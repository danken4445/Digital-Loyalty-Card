import type { CSSProperties } from 'react';
import { StampIcon } from '@/components/card/StampIcon';
import { STAMP_RULES } from '@/lib/config';
import { DEFAULT_STAMP_ICON, type StampIconId } from '@/lib/contracts';
import { calculateStampProgress } from '@/lib/rules/display';

export interface StampGridProps {
  availableStamps: number;
  /**
   * Slot number (1-10) that was stamped on this page load, or null.
   * That slot plays the stamp-slam animation once; refreshes never replay it
   * because the `?r=stamped` param is stripped after the first render.
   */
  justStampedSlot?: number | null;
  /** Stamps needed for the reward (the shop's setting); defaults to the platform rule. */
  rewardThreshold?: number;
  /** Reward name printed on the last slot; defaults to the original shop's reward. */
  rewardLabel?: string;
  /** Slot printed "50% OFF"; null for shops without a milestone. Defaults to the platform rule. */
  milestoneStep?: number | null;
  /** Icon printed in each stamp slot; defaults to the coffee cup. */
  stampIcon?: StampIconId;
}

/**
 * Each stamp lands at a slightly different angle, like a rubber stamp pressed by hand.
 * Fixed per slot (not random) so server and client render the same markup.
 */
const SLOT_TILT_DEG = [-6, 4, -3, 7, -5, 3, -7, 5, -4, 6] as const;

/** Where each coffee bean flies to when the free coffee slot is stamped (x, y in px, spin). */
const BEAN_PATHS = [
  [-34, -30, -140],
  [0, -44, 90],
  [34, -30, 160],
  [44, 4, -60],
  [30, 34, 120],
  [-4, 44, -150],
  [-34, 30, 70],
  [-44, -2, -100],
] as const;

function getSlotAriaLabel(
  slot: number,
  isFilled: boolean,
  rewardThreshold: number,
  rewardLabel: string,
  milestoneStep: number | null,
): string {
  const status = isFilled ? 'filled' : 'empty';
  if (slot === milestoneStep && slot !== rewardThreshold) {
    return `Stamp ${slot} of ${rewardThreshold}, ${status} (50% off milestone)`;
  }
  if (slot === rewardThreshold) {
    return `Stamp ${slot} of ${rewardThreshold}, ${status} (${rewardLabel} reward)`;
  }
  return `Stamp ${slot} of ${rewardThreshold}, ${status}`;
}

/** Printed text for the two reward slots, as on the physical card. */
function rewardSlotText(
  slot: number,
  rewardThreshold: number,
  rewardLabel: string,
  milestoneStep: number | null,
): string | null {
  if (slot === milestoneStep && slot !== rewardThreshold) return '50% OFF';
  if (slot === rewardThreshold) return rewardLabel.toUpperCase();
  return null;
}

/**
 * Accessible 10-slot stamp card laid out like the printed Caffeine Plug card:
 * rows of icon slots, each row ending in a dashed reward circle.
 */
export function StampGrid({
  availableStamps,
  justStampedSlot = null,
  rewardThreshold = STAMP_RULES.rewardThreshold,
  rewardLabel = 'Free Coffee',
  milestoneStep = STAMP_RULES.milestoneStep,
  stampIcon = DEFAULT_STAMP_ICON,
}: StampGridProps) {
  const progress = calculateStampProgress(availableStamps, rewardThreshold);
  const slots = Array.from({ length: rewardThreshold }, (_, index) => index + 1);
  const hasJustStamped =
    justStampedSlot !== null && justStampedSlot >= 1 && justStampedSlot <= progress.clampedStamps;

  return (
    <div className="w-full">
      {/* Count + what's left. The progressbar wraps only the number: its children are not read aloud. */}
      <div className="flex items-end justify-between gap-4 mb-4">
        <div
          role="progressbar"
          aria-label="Stamp collection progress"
          aria-valuenow={progress.clampedStamps}
          aria-valuemin={0}
          aria-valuemax={progress.rewardThreshold}
          aria-valuetext={`${progress.clampedStamps} of ${progress.rewardThreshold} stamps`}
          className="font-display font-bold leading-none text-white flex items-baseline"
        >
          {/* overflow-hidden clips the rolling digit so it appears to tick up from below */}
          <span className="inline-block overflow-hidden text-5xl">
            <span className={`inline-block ${hasJustStamped ? 'count-roll' : ''}`}>
              {progress.clampedStamps}
            </span>
          </span>
          <span className="text-2xl text-plug-muted ml-1">/{progress.rewardThreshold}</span>
        </div>
        <p
          className={`text-sm text-right leading-snug max-w-[12rem] pb-1 ${
            progress.isRewardReady ? 'text-white font-semibold' : 'text-neutral-300'
          }`}
        >
          {progress.progressText}
        </p>
      </div>

      <ol aria-label={`Loyalty stamp grid, ${rewardThreshold} slots`} className="grid grid-cols-5 gap-2.5">
        {slots.map((slot) => {
          const isFilled = slot <= progress.clampedStamps;
          const isJustStamped = hasJustStamped && slot === justStampedSlot;
          const printedText = rewardSlotText(slot, rewardThreshold, rewardLabel, milestoneStep);
          const tilt = SLOT_TILT_DEG[(slot - 1) % SLOT_TILT_DEG.length] ?? 0;
          const stampStyle = {
            '--stamp-tilt': `${tilt}deg`,
            transform: `rotate(${tilt}deg)`,
          } as CSSProperties;

          return (
            <li
              key={slot}
              aria-label={getSlotAriaLabel(slot, isFilled, rewardThreshold, rewardLabel, milestoneStep)}
              className={`relative aspect-square ${isJustStamped ? 'z-10' : ''}`}
            >
              {/* Empty slot, always drawn underneath so a new stamp lands on top of it */}
              <span
                aria-hidden="true"
                className={`absolute inset-0 rounded-full flex items-center justify-center text-center ${
                  printedText
                    ? 'border-2 border-dashed border-white/60 text-white'
                    : 'border border-plug-border bg-plug-elevated/60 text-zinc-600'
                }`}
              >
                {printedText ? (
                  <span className="font-display font-bold text-[11px] leading-[1.05] px-1">
                    {printedText}
                  </span>
                ) : (
                  <StampIcon icon={stampIcon} className="w-[45%] h-[45%]" />
                )}
              </span>

              {isFilled && (
                <span
                  aria-hidden="true"
                  style={stampStyle}
                  className={`absolute inset-0 rounded-full bg-white text-plug-black flex items-center justify-center text-center ${
                    isJustStamped ? 'stamp-slam' : ''
                  }`}
                >
                  {printedText ? (
                    <span className="font-display font-bold text-[11px] leading-[1.05] px-1">
                      {printedText}
                    </span>
                  ) : (
                    <StampIcon icon={stampIcon} className="w-1/2 h-1/2" />
                  )}
                </span>
              )}

              {isJustStamped && (
                <span
                  aria-hidden="true"
                  className="stamp-ink-ring absolute inset-0 rounded-full border-2 border-white pointer-events-none"
                />
              )}

              {isJustStamped && slot === rewardThreshold && (
                <span
                  aria-hidden="true"
                  className="bean-burst absolute inset-0 pointer-events-none flex items-center justify-center"
                >
                  {BEAN_PATHS.map(([x, y, spin]) => (
                    <span
                      key={`${x}:${y}`}
                      style={
                        {
                          '--bean-x': `${x}px`,
                          '--bean-y': `${y}px`,
                          '--bean-spin': `${spin}deg`,
                        } as CSSProperties
                      }
                      className="absolute w-1.5 h-2.5 rounded-full bg-white"
                    />
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {progress.availableStamps === 0 && (
        <div
          role="note"
          aria-label="First visit tip"
          className="mt-4 rounded-xl border border-dashed border-plug-border px-4 py-3"
        >
          <p className="text-sm text-neutral-300 leading-relaxed">
            0 stamps collected yet. When you order, ask the staff to tap their card on your phone.
          </p>
        </div>
      )}
    </div>
  );
}

export default StampGrid;
