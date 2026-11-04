'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type IssuedRedeemToken,
  type RedeemTokenRequest,
} from '@/lib/contracts';

export interface RedeemRewardPanelProps {
  initialToken: IssuedRedeemToken;
  availableStamps: number;
  /** The shop the reward belongs to; sent when refreshing the QR code. */
  tenantSlug: string;
  /** Reward name shown on the panel; defaults to the original shop's reward. */
  rewardLabel?: string;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Two-tone high-contrast reward redemption panel displaying a short-lived
 * signed QR code, visual verification code, live countdown, and refresh actions.
 */
export function RedeemRewardPanel({
  initialToken,
  availableStamps: _availableStamps,
  tenantSlug,
  rewardLabel = 'Free Coffee',
}: RedeemRewardPanelProps) {
  const [tokenData, setTokenData] = useState<IssuedRedeemToken>(initialToken);
  const [secondsLeft, setSecondsLeft] = useState<number>(() =>
    Math.max(0, Math.floor((initialToken.payload.exp * 1000 - Date.now()) / 1000)),
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const calculateSeconds = () =>
      Math.max(0, Math.floor((tokenData.payload.exp * 1000 - Date.now()) / 1000));

    setSecondsLeft(calculateSeconds());

    const intervalId = window.setInterval(() => {
      setSecondsLeft(calculateSeconds());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [tokenData]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleRefresh = async () => {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const response = await fetch(ROUTES.api.redeemToken, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantSlug } satisfies RedeemTokenRequest),
      });

      const json = (await response.json()) as ApiResponse<IssuedRedeemToken>;

      if (!response.ok || !json.ok) {
        const msg = !json.ok ? json.message : 'Unable to refresh redemption QR code.';
        setRefreshError(msg || 'Unable to refresh redemption QR code.');
        setIsRefreshing(false);
        return;
      }

      setTokenData(json.data);
      const remaining = Math.max(0, Math.floor((json.data.payload.exp * 1000 - Date.now()) / 1000));
      setSecondsLeft(remaining);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Network connection error. Please try again.';
      setRefreshError(message);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(tokenData.token);
        setCopied(true);
        if (copyTimeoutRef.current !== null) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopied(false);
        }, 2000);
      }
    } catch {
      // Fallback if clipboard API is blocked
    }
  };

  return (
    <section
      aria-label={`${rewardLabel} Reward Redemption`}
      className="w-full mt-6 bg-plug-elevated/90 border-2 border-white rounded-2xl p-5 sm:p-6 shadow-[0_10px_35px_rgba(255,255,255,0.15)] flex flex-col items-center text-center relative overflow-hidden"
    >
      {/* Header Badge */}
      <div className="flex flex-col items-center text-center mb-4">
        <span className="text-[10px] font-mono font-black tracking-widest uppercase px-3 py-1 rounded-full bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)] mb-1.5 animate-pulse">
          {`REWARD UNLOCKED • ${rewardLabel.toUpperCase()}`}
        </span>
        <p className="text-xs font-mono uppercase tracking-wider text-plug-muted">
          Show this QR code to the barista
        </p>
      </div>

      {/* Inline SVG QR Container */}
      <div
        role="img"
        aria-label={`Redemption QR code ${tokenData.displayCode} for staff to scan`}
        className="relative bg-white p-3 rounded-xl border-2 border-white shadow-[0_0_25px_rgba(255,255,255,0.25)] flex items-center justify-center w-56 h-56 max-w-full overflow-hidden"
      >
        <div
          dangerouslySetInnerHTML={{ __html: tokenData.qrSvg }}
          className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
        />

        {secondsLeft <= 0 && (
          <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center">
            <span className="font-display font-black text-xl text-white tracking-widest uppercase">
              EXPIRED
            </span>
            <p className="text-[10px] font-mono text-neutral-300 mt-1 uppercase tracking-wider">
              Press &ldquo;Refresh QR Code&rdquo; below
            </p>
          </div>
        )}
      </div>

      {/* Human-Readable Verification Code & Countdown Badge */}
      <div className="flex flex-col items-center gap-1.5 mt-4">
        <span className="text-[10px] font-mono uppercase tracking-widest text-plug-muted">
          Verification Code
        </span>
        <div
          aria-label={`Verification code ${tokenData.displayCode}`}
          className="font-mono text-2xl font-black tracking-widest text-white px-4 py-1 rounded-lg bg-black/80 border border-plug-border"
        >
          {tokenData.displayCode}
        </div>
        <div
          className={`text-[11px] font-mono font-bold tracking-wider px-2.5 py-0.5 rounded-full ${
            secondsLeft > 0
              ? 'bg-plug-surface text-neutral-200 border border-plug-border'
              : 'bg-red-950/80 text-red-300 border border-red-800'
          }`}
        >
          {secondsLeft > 0 ? `Expires in ${formatCountdown(secondsLeft)}` : 'Token expired'}
        </div>
      </div>

      {/* Accessible Error Alert Banner */}
      {refreshError && (
        <div
          role="alert"
          aria-live="assertive"
          className="w-full mt-4 p-3 bg-red-950/70 border border-red-500/60 rounded-xl text-red-200 text-xs font-mono text-center flex flex-col items-center gap-1 shadow-lg"
        >
          <span className="font-bold text-red-400 uppercase tracking-wide">Notice</span>
          <p className="text-[11px] leading-relaxed text-neutral-200">{refreshError}</p>
        </div>
      )}

      {/* Two Keyboard-Accessible Action Buttons */}
      <div className="w-full flex flex-col gap-2.5 mt-5">
        {/* Button 1: Refresh QR Code */}
        <button
          type="button"
          disabled={isRefreshing}
          aria-disabled={isRefreshing}
          aria-busy={isRefreshing}
          onClick={handleRefresh}
          className="w-full py-3.5 px-4 bg-white text-black font-display font-black text-xs tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_15px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {isRefreshing && (
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4 text-black"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
          <span>{isRefreshing ? 'REFRESHING...' : 'REFRESH QR CODE'}</span>
        </button>

        {/* Button 2: Copy Redemption Code */}
        <button
          type="button"
          onClick={handleCopy}
          className="w-full py-3 px-4 bg-plug-surface text-white font-mono font-bold text-xs tracking-wider uppercase border border-plug-border hover:bg-zinc-800 hover:border-zinc-500 transition-all select-none flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          {copied ? (
            <span className="text-white font-black">COPIED!</span>
          ) : (
            <span>COPY REDEMPTION CODE</span>
          )}
        </button>
      </div>
    </section>
  );
}

export default RedeemRewardPanel;
