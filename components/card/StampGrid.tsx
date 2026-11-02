import type { CSSProperties } from 'react';
import { STAMP_RULES } from '@/lib/config';
import { calculateStampProgress } from '@/lib/rules/display';

export interface StampGridProps {
  availableStamps: number;
  /**
   * Slot number (1-10) that was stamped on this page load, or null.
   * That slot plays the stamp-slam animation once; refreshes never replay it
   * because the `?r=stamped` param is stripped after the first render.
   */
  justStampedSlot?: number | null;
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

function getSlotAriaLabel(slot: number, isFilled: boolean): string {
  const status = isFilled ? 'filled' : 'empty';
  if (slot === STAMP_RULES.milestoneStep) {
    return `Stamp 5 of 10, ${status} (50% off milestone)`;
  }
  if (slot === STAMP_RULES.rewardThreshold) {
    return `Stamp 10 of 10, ${status} (Free Coffee reward)`;
  }
  return `Stamp ${slot} of 10, ${status}`;
}

/** Takeaway cup with a coffee bean on the sleeve, matching the printed loyalty card. */
function CupIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 4 9.3 2.5h5.4l.8 1.5" />
      <rect x="5" y="4" width="14" height="3" rx="1" />
      <path d="M6.5 7 8 21h8l1.5-14" />
      <ellipse cx="12" cy="14" rx="2.2" ry="2.8" transform="rotate(30 12 14)" />
      <path d="M10.9 15.9c.9-.7 1.3-2.5 2.2-3.8" />
    </svg>
  );
}

/** Printed text for the two reward slots, as on the physical card. */
function rewardSlotText(slot: number): string | null {
  if (slot === STAMP_RULES.milestoneStep) return '50% OFF';
  if (slot === STAMP_RULES.rewardThreshold) return 'FREE COFFEE';
  return null;
}

/**
 * Accessible 10-slot stamp card laid out like the printed Caffeine Plug card:
 * two rows of four cups, each row ending in a dashed reward circle.
 */
export function StampGrid({ availableStamps, justStampedSlot = null }: StampGridProps) {
  const progress = calculateStampProgress(availableStamps);
  const slots = Array.from({ length: STAMP_RULES.rewardThreshold }, (_, index) => index + 1);
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

      <ol aria-label="Loyalty stamp grid, 10 slots" className="grid grid-cols-5 gap-2.5">
        {slots.map((slot) => {
          const isFilled = slot <= progress.clampedStamps;
          const isJustStamped = hasJustStamped && slot === justStampedSlot;
          const printedText = rewardSlotText(slot);
          const tilt = SLOT_TILT_DEG[slot - 1] ?? 0;
          const stampStyle = {
            '--stamp-tilt': `${tilt}deg`,
            transform: `rotate(${tilt}deg)`,
          } as CSSProperties;

          return (
            <li
              key={slot}
              aria-label={getSlotAriaLabel(slot, isFilled)}
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
                  <CupIcon className="w-[45%] h-[45%]" />
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
                    <CupIcon className="w-1/2 h-1/2" />
                  )}
                </span>
              )}

              {isJustStamped && (
                <span
                  aria-hidden="true"
                  className="stamp-ink-ring absolute inset-0 rounded-full border-2 border-white pointer-events-none"
                />
              )}

              {isJustStamped && slot === STAMP_RULES.rewardThreshold && (
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
            0 stamps collected yet. When you order, ask the barista to tap their card on your phone.
          </p>
        </div>
      )}
    </div>
  );
}

export default StampGrid;
