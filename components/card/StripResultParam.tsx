'use client';

import { useEffect, useState } from 'react';
import type { StampResultCode } from '@/lib/contracts';

export interface StripResultParamProps {
  result?: StampResultCode | null;
}

interface ResultMeta {
  title: string;
  message: string;
  badge: string;
  isSuccess: boolean;
}

const RESULT_META_MAP: Record<StampResultCode, ResultMeta> = {
  stamped: {
    title: 'STAMP COLLECTED',
    message: 'Stamp added! Thanks for visiting The Caffeine Plug.',
    badge: '+1 STAMP',
    isSuccess: true,
  },
  cooldown: {
    title: 'COOLDOWN ACTIVE',
    message: 'Hang tight — stamps have a 30-minute cooldown between visits.',
    badge: 'COOLDOWN',
    isSuccess: false,
  },
  'daily-limit': {
    title: 'DAILY CAP REACHED',
    message: 'Daily limit reached (max 2 stamps per day). See you tomorrow!',
    badge: 'DAILY CAP',
    isSuccess: false,
  },
  'tag-throttled': {
    title: 'TAP THROTTLED',
    message: 'Card was just tapped a moment ago. Please wait 5 seconds and tap again.',
    badge: 'WAIT 5 SEC',
    isSuccess: false,
  },
  'invalid-tag': {
    title: 'INACTIVE NFC TAG',
    message: 'This NFC tag is no longer active. Please ask our barista for help.',
    badge: 'TAG INACTIVE',
    isSuccess: false,
  },
};

/** Delay before the "thunk" vibration, so it lands with the stamp-slam impact (see globals.css). */
const STAMP_IMPACT_MS = 420;

/**
 * Displays a high-contrast accessible status banner for stamp tap results,
 * and strips both `?r=` and `?result=` from the URL on mount so refreshing the page
 * never replays a stale status while keeping the message visible during the current render.
 */
export function StripResultParam({ result }: StripResultParamProps) {
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Strip both ?r= and ?result= query parameters using replaceState
    if (window.location.search) {
      const url = new URL(window.location.href);
      let changed = false;

      if (url.searchParams.has('r')) {
        url.searchParams.delete('r');
        changed = true;
      }
      if (url.searchParams.has('result')) {
        url.searchParams.delete('result');
        changed = true;
      }

      if (changed) {
        const remainingSearch = url.searchParams.toString();
        const targetPath = remainingSearch ? `${url.pathname}?${remainingSearch}` : url.pathname;
        window.history.replaceState(null, '', targetPath);
      }
    }
  }, []);

  // A short buzz as the stamp lands. Android only: iOS Safari has no Vibration API.
  useEffect(() => {
    if (result !== 'stamped' || typeof navigator === 'undefined' || !('vibrate' in navigator)) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const timer = window.setTimeout(() => navigator.vibrate([14, 50, 26]), STAMP_IMPACT_MS);
    return () => window.clearTimeout(timer);
  }, [result]);

  if (!result || isDismissed) {
    return null;
  }

  const meta = RESULT_META_MAP[result];
  if (!meta) {
    return null;
  }

  // Success is printed in ink-on-paper (inverted), like the stamp itself; everything else stays dark.
  const tone = meta.isSuccess
    ? 'bg-white text-plug-black border-white'
    : 'bg-plug-elevated text-white border-plug-border';

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`w-full max-w-[390px] mb-4 rounded-2xl border pl-4 pr-1 py-1 ${tone} ${
        meta.isSuccess ? 'banner-enter-late' : 'banner-enter'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display font-bold text-base ${
            meta.isSuccess ? 'bg-plug-black text-white' : 'border border-white/40 text-white'
          }`}
        >
          {meta.isSuccess ? '+1' : '!'}
        </span>

        <div className="min-w-0 flex-1 py-2">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-base font-bold tracking-wide">{meta.title}</span>
            <span
              className={`text-[11px] font-semibold ${
                meta.isSuccess ? 'text-neutral-600' : 'text-plug-muted'
              }`}
            >
              {meta.badge}
            </span>
          </p>
          <p
            className={`mt-0.5 text-sm leading-snug ${
              meta.isSuccess ? 'text-neutral-700' : 'text-neutral-300'
            }`}
          >
            {meta.message}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          aria-label="Dismiss notification"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors cursor-pointer ${
            meta.isSuccess
              ? 'text-neutral-500 hover:text-plug-black hover:bg-black/5 focus-visible:outline-plug-black'
              : 'text-plug-muted hover:text-white hover:bg-white/5'
          }`}
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

export default StripResultParam;
