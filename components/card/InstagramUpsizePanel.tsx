'use client';

import { useEffect, useState } from 'react';
import { INSTAGRAM_PERK, SHOP_CONFIG } from '@/lib/config';
import { ROUTES, type ApiResponse, type IssuedRedeemToken } from '@/lib/contracts';

export interface InstagramUpsizePanelProps {
  claimed: boolean;
}

function InstagramGlyph() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function readFollowOpened(): boolean {
  try {
    return window.localStorage.getItem(INSTAGRAM_PERK.followOpenedStorageKey) === '1';
  } catch {
    return false;
  }
}

function rememberFollowOpened(): void {
  try {
    window.localStorage.setItem(INSTAGRAM_PERK.followOpenedStorageKey, '1');
  } catch {
    // Storage blocked (private mode); the claim button still works without it
  }
}

/**
 * One-time "follow us on Instagram, get a free upsize" perk. Opening the profile and pressing
 * claim only shows a signed QR; the barista checks the follow on the customer's phone and grants
 * the upsize from /staff/redeem.
 */
export function InstagramUpsizePanel({ claimed }: InstagramUpsizePanelProps) {
  const [followOpened, setFollowOpened] = useState<boolean>(false);
  const [tokenData, setTokenData] = useState<IssuedRedeemToken | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setFollowOpened(readFollowOpened());
  }, []);

  useEffect(() => {
    if (!tokenData) {
      return;
    }
    const calculateSeconds = () =>
      Math.max(0, Math.floor((tokenData.payload.exp * 1000 - Date.now()) / 1000));

    setSecondsLeft(calculateSeconds());
    const intervalId = window.setInterval(() => setSecondsLeft(calculateSeconds()), 1000);
    return () => window.clearInterval(intervalId);
  }, [tokenData]);

  const handleFollowClick = () => {
    rememberFollowOpened();
    setFollowOpened(true);
  };

  const handleClaim = async () => {
    if (isLoading) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(ROUTES.api.instagramUpsizeToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = (await response.json()) as ApiResponse<IssuedRedeemToken>;

      if (!response.ok || !json.ok) {
        setErrorMessage(!json.ok ? json.message : 'Unable to load your upsize QR code.');
        return;
      }

      setTokenData(json.data);
    } catch {
      setErrorMessage('Network connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (claimed) {
    return (
      <section
        aria-label="Instagram Upsize Perk"
        className="mt-6 pt-4 border-t border-plug-border flex flex-col items-center text-center"
      >
        <span className="bg-white text-black font-mono text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
          INSTAGRAM UPSIZE • CLAIMED
        </span>
        <p className="text-[10px] font-mono uppercase tracking-wider text-plug-muted mt-2 max-w-[280px]">
          Thanks for following {SHOP_CONFIG.instagramHandle}. Watch our feed for drops.
        </p>
      </section>
    );
  }

  const isExpired = tokenData !== null && secondsLeft <= 0;

  return (
    <section
      aria-label="Instagram Upsize Perk"
      className="mt-6 pt-5 border-t border-plug-border flex flex-col items-center text-center"
    >
      <span className="bg-white text-black font-mono text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
        FREE UPSIZE • ONE TIME
      </span>
      <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-wide text-white mt-3">
        Follow us, size up
      </h2>
      <p className="text-sm text-neutral-300 mt-2 max-w-[300px]">
        Follow <span className="font-semibold text-white">{SHOP_CONFIG.instagramHandle}</span> on
        Instagram and get a {INSTAGRAM_PERK.rewardLabel.toLowerCase()}.
      </p>

      {tokenData ? (
        <div className="w-full flex flex-col items-center mt-4">
          <p className="text-xs font-mono uppercase tracking-wider text-plug-muted">
            Show this QR and your Instagram follow to the barista
          </p>

          <div
            role="img"
            aria-label={`Upsize QR code ${tokenData.displayCode} for staff to scan`}
            className="relative bg-white p-3 rounded-xl mt-3 flex items-center justify-center w-48 h-48 max-w-full overflow-hidden"
          >
            <div
              dangerouslySetInnerHTML={{ __html: tokenData.qrSvg }}
              className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
            />
            {isExpired && (
              <div className="absolute inset-0 bg-black/90 flex items-center justify-center">
                <span className="font-display font-black text-xl text-white tracking-widest uppercase">
                  EXPIRED
                </span>
              </div>
            )}
          </div>

          <div
            aria-label={`Verification code ${tokenData.displayCode}`}
            className="font-mono text-xl font-black tracking-widest text-white px-4 py-1 mt-3 rounded-lg bg-black/80 border border-plug-border"
          >
            {tokenData.displayCode}
          </div>
          <p className="text-[11px] font-mono text-plug-muted mt-1.5">
            {isExpired
              ? 'Code expired'
              : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
          </p>

          {isExpired && (
            <button
              type="button"
              onClick={handleClaim}
              disabled={isLoading}
              aria-busy={isLoading}
              className="w-full mt-4 py-3 px-4 bg-white text-black font-display font-black text-xs tracking-widest uppercase rounded-xl hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {isLoading ? 'LOADING...' : 'NEW QR CODE'}
            </button>
          )}
        </div>
      ) : (
        <div className="w-full flex flex-col gap-2.5 mt-4">
          <a
            href={SHOP_CONFIG.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleFollowClick}
            className={`w-full min-h-12 py-3 px-4 font-display font-black text-xs tracking-widest uppercase rounded-xl flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              followOpened
                ? 'bg-plug-surface text-white border border-plug-border hover:border-zinc-500'
                : 'bg-white text-black hover:bg-neutral-200'
            }`}
          >
            <InstagramGlyph />
            <span>
              {followOpened ? 'OPEN INSTAGRAM AGAIN' : `FOLLOW ${SHOP_CONFIG.instagramHandle}`}
            </span>
          </a>

          <button
            type="button"
            onClick={handleClaim}
            disabled={isLoading}
            aria-busy={isLoading}
            className={`w-full min-h-12 py-3 px-4 font-display font-black text-xs tracking-widest uppercase rounded-xl transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              followOpened
                ? 'bg-white text-black hover:bg-neutral-200'
                : 'bg-plug-surface text-white border border-plug-border hover:border-zinc-500'
            }`}
          >
            {isLoading
              ? 'LOADING...'
              : followOpened
                ? 'I FOLLOWED — CLAIM UPSIZE'
                : 'ALREADY FOLLOWING? CLAIM'}
          </button>
        </div>
      )}

      {errorMessage && (
        <p role="alert" className="w-full mt-3 text-xs text-red-300">
          {errorMessage}
        </p>
      )}
    </section>
  );
}

export default InstagramUpsizePanel;
