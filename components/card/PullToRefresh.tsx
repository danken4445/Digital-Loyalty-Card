'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PullToRefreshProps {
  /** Optional custom refresh handler; defaults to router.refresh() */
  onRefresh?: () => Promise<void> | void;
  /** Distance in px to trigger refresh; default 60 */
  threshold?: number;
  /** Maximum visual pull distance in px; default 80 */
  maxPull?: number;
  /** Force enable regardless of standalone mode; default true */
  enabled?: boolean;
}

/**
 * Checks whether the application is running as an installed PWA / standalone display mode.
 */
export function isPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = (window.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined)) as
    | { standalone?: boolean }
    | undefined;
  const doc = window.document ?? (typeof document !== 'undefined' ? document : undefined);
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    nav?.standalone === true ||
    doc?.referrer?.includes('android-app://')
  );
}

/**
 * Pull-to-refresh and scroll-up refresh component designed for mobile PWAs.
 * In standalone PWA mode (where browser reload buttons and native pull-to-refresh
 * are disabled or hidden), this provides a smooth, accessible gesture-driven refresh
 * returning the latest card stamps and reward status.
 */
export function PullToRefresh({
  onRefresh,
  threshold = 60,
  maxPull = 80,
  enabled = true,
}: PullToRefreshProps) {
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPwaMode, setIsPwaMode] = useState(false);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isPullingRef = useRef(false);
  const wheelDeltaRef = useRef(0);
  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect PWA standalone mode on client mount
  useEffect(() => {
    setIsPwaMode(isPwa());
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setPullDistance(threshold);

    // Provide subtle haptic feedback on supported mobile devices
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(15);
      } catch {
        // Ignore haptics errors if permission denied
      }
    }

    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        router.refresh();
        // Keep indicator visible briefly for tactile confirmation
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    } catch (err) {
      console.error('[PullToRefresh] Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('pwa:refreshed'));
      }
    }
  }, [isRefreshing, onRefresh, router, threshold]);

  useEffect(() => {
    if (!enabled) return;

    function handleTouchStart(e: TouchEvent) {
      if (isRefreshing) return;
      const isAtTop = window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
      if (!isAtTop) return;

      const touch = e.touches[0];
      if (!touch) return;

      startYRef.current = touch.clientY;
      startXRef.current = touch.clientX;
      isPullingRef.current = true;
    }

    function handleTouchMove(e: TouchEvent) {
      if (!isPullingRef.current || isRefreshing) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaY = touch.clientY - startYRef.current;
      const deltaX = touch.clientX - startXRef.current;

      // Allow horizontal swipes (e.g. tabs or sliders) without hijacking
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        return;
      }

      const isAtTop = window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
      if (!isAtTop) {
        isPullingRef.current = false;
        setPullDistance(0);
        return;
      }

      if (deltaY > 0) {
        // Apply rubber-band damping curve
        const damped = Math.min(maxPull, deltaY * 0.45);
        setPullDistance(damped);

        if (e.cancelable && damped > 10) {
          e.preventDefault();
        }
      } else {
        setPullDistance(0);
      }
    }

    function handleTouchEnd() {
      if (!isPullingRef.current) return;
      isPullingRef.current = false;

      setPullDistance((current) => {
        if (current >= threshold) {
          void handleRefresh();
          return threshold;
        }
        return 0;
      });
    }

    // Scroll up (wheel deltaY < 0) when already at top of page (for laptop/desktop PWAs)
    function handleWheel(e: WheelEvent) {
      if (isRefreshing) return;
      const isAtTop = window.scrollY <= 0 && document.documentElement.scrollTop <= 0;

      if (isAtTop && e.deltaY < 0) {
        wheelDeltaRef.current += Math.abs(e.deltaY);

        if (wheelTimeoutRef.current) {
          clearTimeout(wheelTimeoutRef.current);
        }

        if (wheelDeltaRef.current >= threshold * 1.4) {
          wheelDeltaRef.current = 0;
          void handleRefresh();
        } else {
          wheelTimeoutRef.current = setTimeout(() => {
            wheelDeltaRef.current = 0;
          }, 350);
        }
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
    window.addEventListener('wheel', handleWheel, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('wheel', handleWheel);
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, [enabled, handleRefresh, isRefreshing, maxPull, threshold]);

  const isVisible = pullDistance > 0 || isRefreshing;
  const isPastThreshold = pullDistance >= threshold;

  return (
    <div
      data-testid="pull-to-refresh"
      data-pwa={isPwaMode ? 'true' : 'false'}
      data-refreshing={isRefreshing ? 'true' : 'false'}
      className="w-full max-w-[390px] flex flex-col items-center select-none"
    >
      {/* Screen reader / keyboard refresh trigger */}
      <button
        type="button"
        data-testid="pull-to-refresh-trigger"
        onClick={() => void handleRefresh()}
        className="sr-only focus:not-sr-only focus:mb-2 focus:px-3 focus:py-1 focus:rounded-lg focus:bg-plug-elevated focus:text-white focus:text-xs"
      >
        {isRefreshing ? 'Refreshing card...' : 'Refresh card'}
      </button>

      {/* Visual pull-to-refresh indicator strip */}
      <div
        role="status"
        aria-live="polite"
        aria-label={
          isRefreshing
            ? 'Refreshing loyalty card'
            : isPastThreshold
              ? 'Release to refresh'
              : 'Pull down to refresh'
        }
        data-testid="pull-to-refresh-indicator"
        className="w-full flex items-center justify-center overflow-hidden transition-[height,opacity] duration-200 pointer-events-none"
        style={{
          height: isVisible ? `${isRefreshing ? threshold : pullDistance}px` : '0px',
          opacity: isVisible ? Math.min(1, Math.max(0.2, pullDistance / threshold)) : 0,
        }}
      >
        <div className="flex items-center gap-2 py-1.5 px-3.5 rounded-full bg-plug-surface/90 border border-plug-border/80 shadow-md text-xs font-mono font-semibold tracking-wider text-neutral-200">
          {isRefreshing ? (
            <>
              <svg
                data-testid="pull-refreshing-spinner"
                className="animate-spin h-3.5 w-3.5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>REFRESHING...</span>
            </>
          ) : isPastThreshold ? (
            <>
              <svg
                className="h-3.5 w-3.5 text-emerald-400 rotate-180 transition-transform duration-200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="M19 12l-7 7-7-7" />
              </svg>
              <span className="text-emerald-400">RELEASE TO REFRESH</span>
            </>
          ) : (
            <>
              <svg
                className="h-3.5 w-3.5 text-neutral-400 transition-transform duration-200"
                style={{
                  transform: `rotate(${Math.min(180, (pullDistance / threshold) * 180)}deg)`,
                }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="M19 12l-7 7-7-7" />
              </svg>
              <span>PULL TO REFRESH</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
