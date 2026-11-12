'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type IssuedRedeemToken,
  type RedeemTokenRequest,
} from '@/lib/contracts';

export interface MilestoneRewardPanelProps {
  tenantSlug: string;
  step: number;
  label: string;
  isEligible: boolean;
  isClaimed: boolean;
  initialToken?: IssuedRedeemToken | null;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function MilestoneRewardPanel({
  tenantSlug,
  step,
  label,
  isEligible,
  isClaimed,
  initialToken = null,
}: MilestoneRewardPanelProps) {
  const [isOpen, setIsOpen] = useState<boolean>(Boolean(initialToken));
  const [tokenData, setTokenData] = useState<IssuedRedeemToken | null>(initialToken);
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!initialToken) return 0;
    return Math.max(0, Math.floor((initialToken.payload.exp * 1000 - Date.now()) / 1000));
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!tokenData) return;

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

  const fetchMilestoneToken = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(ROUTES.api.redeemToken, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantSlug,
          kind: 'milestone-reward',
        } satisfies RedeemTokenRequest),
      });

      const json = (await response.json()) as ApiResponse<IssuedRedeemToken>;

      if (!response.ok || !json.ok) {
        setErrorMessage(json.ok ? 'Unable to generate milestone token.' : json.message);
        setIsLoading(false);
        return;
      }

      setTokenData(json.data);
      setIsOpen(true);
      setIsLoading(false);
    } catch {
      setErrorMessage('Network error while requesting milestone token.');
      setIsLoading(false);
    }
  };

  const handleToggle = async () => {
    if (!isOpen && !tokenData) {
      await fetchMilestoneToken();
    } else {
      setIsOpen(!isOpen);
    }
  };

  const handleCopyCode = async () => {
    if (!tokenData?.displayCode) return;
    try {
      await navigator.clipboard.writeText(tokenData.displayCode);
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard denied
    }
  };

  if (isClaimed) {
    return (
      <aside
        aria-label="Milestone perk status"
        className="w-full max-w-[390px] mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-2.5 text-xs text-emerald-300 flex items-center justify-between"
      >
        <span className="font-medium">
          ✓ Milestone Reward ({label}) claimed for this card
        </span>
        <span className="text-[11px] text-emerald-400/80 uppercase tracking-wider font-mono">
          Slot {step}
        </span>
      </aside>
    );
  }

  if (!isEligible) {
    return null;
  }

  const isExpired = secondsLeft <= 0;

  return (
    <aside
      aria-label="Milestone Reward Panel"
      className="w-full max-w-[390px] mt-4 rounded-2xl border border-violet-500/40 bg-gradient-to-b from-violet-950/40 to-neutral-900/60 p-4 text-white shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-500/30 text-violet-300 border border-violet-500/40">
              Milestone Reward
            </span>
            <span className="text-xs text-neutral-400">Stamp {step}</span>
          </div>
          <h3 className="font-display font-bold text-base mt-1 text-white">
            {label}
          </h3>
          <p className="text-xs text-neutral-300 mt-0.5">
            Free halfway perk • Keeps your stamps
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          disabled={isLoading}
          aria-expanded={isOpen}
          className="px-3 py-2 rounded-xl text-xs font-semibold bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white transition-transform shadow-md disabled:opacity-50"
        >
          {isLoading
            ? 'Loading...'
            : isOpen
              ? 'Hide QR'
              : 'Claim Perk'}
        </button>
      </div>

      {errorMessage && (
        <p className="mt-3 text-xs text-red-400 bg-red-950/30 p-2 rounded-lg border border-red-500/30">
          {errorMessage}
        </p>
      )}

      {isOpen && tokenData && (
        <div className="mt-4 pt-4 border-t border-violet-500/20 flex flex-col items-center animate-fade-in">
          <div className="p-3 bg-white rounded-2xl shadow-md border border-neutral-200">
            <div
              className="w-48 h-48 flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: tokenData.qrSvg }}
            />
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            aria-label="Copy verification code"
            className="mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-700/80 border border-neutral-700 text-xs font-mono font-bold tracking-widest text-neutral-200"
          >
            <span>{tokenData.displayCode}</span>
            <span className="text-[10px] text-neutral-400 font-sans">
              {copied ? 'Copied!' : 'Copy'}
            </span>
          </button>

          <div className="mt-2 text-center">
            {isExpired ? (
              <p className="text-xs text-yellow-400 font-medium">
                QR expired.{' '}
                <button
                  type="button"
                  onClick={fetchMilestoneToken}
                  className="underline hover:text-white"
                >
                  Refresh
                </button>
              </p>
            ) : (
              <p className="text-xs text-neutral-300">
                Expires in{' '}
                <span className="font-mono font-bold text-violet-300">
                  {formatCountdown(secondsLeft)}
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
