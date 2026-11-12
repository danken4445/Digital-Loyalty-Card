'use client';

import { useEffect, useState } from 'react';
import { FacebookGlyph, InstagramGlyph, TikTokGlyph } from '@/components/card/SocialGlyphs';
import { formatSocialDisplayHandle, formatSocialUrl, type SocialLinkItem } from '@/lib/brand/social';
import { INSTAGRAM_PERK } from '@/lib/config';
import {
  ROUTES,
  type ApiResponse,
  type IssuedRedeemToken,
  type RedeemTokenRequest,
} from '@/lib/contracts';

export interface InstagramUpsizePanelProps {
  claimed: boolean;
  /** The shop offering the perk; sent when requesting the claim QR code. */
  tenantSlug: string;
  /** Legacy Instagram handle (e.g. "@thecaffeineplug8400") */
  handle?: string;
  /** What the follower gets; defaults to the platform wording (e.g. "Free upsize" or custom). */
  perkLabel?: string;
  /** Multi-platform social media links configured by the shop owner. */
  socialLinks?: readonly SocialLinkItem[];
}

function storageKey(tenantSlug: string): string {
  return `${INSTAGRAM_PERK.followOpenedStorageKey}:${tenantSlug}`;
}

function readFollowOpened(tenantSlug: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(tenantSlug)) === '1';
  } catch {
    return false;
  }
}

function rememberFollowOpened(tenantSlug: string): void {
  try {
    window.localStorage.setItem(storageKey(tenantSlug), '1');
  } catch {
    // Storage blocked (private mode); the claim button still works without it
  }
}

/**
 * One-time social media follower perk (e.g. "follow us on IG/FB/TikTok, get a free reward").
 * Opening a profile and pressing claim shows a signed QR code; staff checks the follow
 * on the customer's phone before confirming from /staff/redeem.
 */
export function InstagramUpsizePanel({
  claimed,
  tenantSlug,
  handle,
  perkLabel = INSTAGRAM_PERK.rewardLabel,
  socialLinks,
}: InstagramUpsizePanelProps) {
  const [followOpened, setFollowOpened] = useState<boolean>(false);
  const [tokenData, setTokenData] = useState<IssuedRedeemToken | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Resolve active links to display in this panel
  const activeFollowLinks: SocialLinkItem[] =
    socialLinks && socialLinks.length > 0
      ? [...socialLinks]
      : handle
        ? [
            {
              platform: 'instagram',
              url: formatSocialUrl('instagram', handle),
              displayLabel: formatSocialDisplayHandle('instagram', handle),
            },
          ]
        : [];

  useEffect(() => {
    setFollowOpened(readFollowOpened(tenantSlug));
  }, [tenantSlug]);

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
    rememberFollowOpened(tenantSlug);
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
        body: JSON.stringify({ tenantSlug } satisfies RedeemTokenRequest),
      });
      const json = (await response.json()) as ApiResponse<IssuedRedeemToken>;

      if (!response.ok || !json.ok) {
        setErrorMessage(!json.ok ? json.message : 'Unable to load your perk QR code.');
        return;
      }

      setTokenData(json.data);
    } catch {
      setErrorMessage('Network connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isOnlyInstagram =
    activeFollowLinks.length === 1 && activeFollowLinks[0]?.platform === 'instagram';

  if (claimed) {
    return (
      <section
        aria-label="Social Follow Perk"
        className="mt-6 pt-4 border-t border-plug-border flex flex-col items-center text-center"
      >
        <span className="bg-white text-black font-mono text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
          {isOnlyInstagram ? 'INSTAGRAM UPSIZE • CLAIMED' : 'SOCIAL PERK • CLAIMED'}
        </span>
        <p className="text-[10px] font-mono uppercase tracking-wider text-plug-muted mt-2 max-w-[280px]">
          {handle
            ? `Thanks for following ${handle}. Watch our feed for drops.`
            : 'Thanks for following us. Watch our feeds for drops and announcements.'}
        </p>
      </section>
    );
  }

  const isExpired = tokenData !== null && secondsLeft <= 0;

  return (
    <section
      aria-label="Social Follow Perk"
      className="mt-6 pt-5 border-t border-plug-border flex flex-col items-center text-center"
    >
      <span className="bg-white text-black font-mono text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
        {perkLabel.toUpperCase()} • ONE TIME
      </span>
      <h2 className="font-display text-2xl font-bold uppercase leading-none tracking-wide text-white mt-3">
        {perkLabel.toLowerCase().includes('upsize')
          ? 'Follow us, size up'
          : `Follow us, get ${perkLabel.toLowerCase()}`}
      </h2>
      <p className="text-sm text-neutral-300 mt-2 max-w-[320px]">
        Follow{' '}
        {isOnlyInstagram && handle ? (
          <span className="font-semibold text-white">{handle}</span>
        ) : (
          'our social channels'
        )}{' '}
        and get a {perkLabel.toLowerCase()}.
      </p>

      {tokenData ? (
        <div className="w-full flex flex-col items-center mt-4">
          <p className="text-xs font-mono uppercase tracking-wider text-plug-muted">
            Show this QR and your social follow to the staff
          </p>

          <div
            role="img"
            aria-label={`Perk QR code ${tokenData.displayCode} for staff to scan`}
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
          {activeFollowLinks.map((item) => (
            <a
              key={item.platform}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleFollowClick}
              className={`w-full min-h-12 py-3 px-4 font-display font-black text-xs tracking-widest uppercase rounded-xl flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                followOpened
                  ? 'bg-plug-surface text-white border border-plug-border hover:border-zinc-500'
                  : 'bg-white text-black hover:bg-neutral-200'
              }`}
            >
              {item.platform === 'instagram' && <InstagramGlyph />}
              {item.platform === 'facebook' && <FacebookGlyph />}
              {item.platform === 'tiktok' && <TikTokGlyph />}
              <span>
                {followOpened
                  ? `OPEN ${item.platform.toUpperCase()} AGAIN`
                  : isOnlyInstagram && handle
                    ? `FOLLOW ${handle}`
                    : `FOLLOW ON ${item.platform.toUpperCase()}`}
              </span>
            </a>
          ))}

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
                ? `I FOLLOWED — CLAIM ${perkLabel.toUpperCase()}`
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

export { InstagramUpsizePanel as SocialFollowPerkPanel };
export default InstagramUpsizePanel;
