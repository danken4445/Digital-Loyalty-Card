import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BRAND_THEME, SHOP_CONFIG } from '@/lib/config';
import { ROUTES } from '@/lib/contracts';
import type { ResolvedCardTheme } from '@/lib/brand/contrast';

export interface OnboardingCardProps {
  /** Accessible name for the page */
  pageLabel: string;
  title: string;
  /** Short lines under the headline, one paragraph each */
  lines: readonly string[];
  /** Optional message shown above the card (e.g. after deleting data) */
  notice?: ReactNode;
  /** Shop name for the mascot alt text; defaults to the platform's original shop. */
  shopName?: string;
  /**
   * True only for the original shop (tenant #1): shows its mascot and the 50% OFF milestone
   * preview. Other shops (and shop-neutral pages) get neither until they have their own branding.
   */
  originalShop?: boolean;
  /** Instagram handle shown under the card; null hides it, undefined uses the original shop's. */
  instagramHandle?: string | null;
  /** Dynamic card theme resolved from tenant brand settings */
  theme?: ResolvedCardTheme;
  /** The call to action, usually <GetCardButton /> */
  children: ReactNode;
}

/** The first row of the printed card: four cups, then the dashed 50% off circle. Decorative. */
function StampRowPreview() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-2">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-plug-border bg-plug-elevated/60 text-zinc-500"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8.5 4 9.3 2.5h5.4l.8 1.5" />
            <rect x="5" y="4" width="14" height="3" rx="1" />
            <path d="M6.5 7 8 21h8l1.5-14" />
          </svg>
        </span>
      ))}
      <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-white/60 font-display text-[9px] font-bold leading-none text-white">
        50%
        <br />
        OFF
      </span>
    </div>
  );
}

/**
 * Shared first-visit screen for /card (QR scan, no card yet) and /start (NFC tap, no card yet).
 * Same mascot, type and stamp-circle language as the active card so the hand-off feels continuous.
 */
export function OnboardingCard({
  pageLabel,
  title,
  lines,
  notice,
  shopName = SHOP_CONFIG.name,
  originalShop = false,
  instagramHandle = SHOP_CONFIG.instagramHandle,
  theme,
  children,
}: OnboardingCardProps) {
  return (
    <main
      aria-label={pageLabel}
      className="min-h-dvh w-full bg-topo-pattern flex flex-col items-center justify-center px-4 py-8"
    >
      {notice}

      <section
        className="w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-3xl px-5 pb-6 pt-8 shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-md flex flex-col items-center text-center"
        style={
          theme
            ? {
                backgroundColor: theme.primaryColor,
                borderColor: theme.cardBorder,
                borderWidth: 1,
                borderStyle: 'solid',
              }
            : undefined
        }
      >
        {originalShop && (
          <Image
            src={BRAND_THEME.assets.mascotFull}
            alt={`${shopName} mascot`}
            width={144}
            height={144}
            priority
            className="h-36 w-36 object-contain mix-blend-lighten"
          />
        )}

        {!originalShop && theme?.logoUrl && (
          <div
            className="relative w-20 h-20 shrink-0 rounded-full p-1 mb-2"
            style={{
              backgroundColor: theme.surfaceBg,
              borderColor: theme.cardBorder,
              borderWidth: 1,
            }}
          >
            <Image
              src={theme.logoUrl}
              alt={`${shopName} logo`}
              width={72}
              height={72}
              priority
              unoptimized
              className="rounded-full object-contain"
            />
          </div>
        )}

        <h1
          className="mt-4 font-display text-4xl font-bold uppercase leading-[0.95] tracking-wide text-white"
          style={theme ? { color: theme.textColor } : undefined}
        >
          {title}
        </h1>

        <div className="mt-3 space-y-1.5">
          {lines.map((line) => (
            <p
              key={line}
              className="text-base leading-snug text-neutral-300"
              style={theme ? { color: theme.subtextColor } : undefined}
            >
              {line}
            </p>
          ))}
        </div>

        {originalShop && (
          <div className="mt-6">
            <StampRowPreview />
          </div>
        )}

        <div className="w-full mt-6">{children}</div>

        <Link
          href={ROUTES.privacy}
          className="mt-4 inline-flex min-h-11 items-center rounded px-2 text-sm text-neutral-400 underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          Privacy &amp; Data Rights (RA 10173)
        </Link>
      </section>

      {instagramHandle && (
        <p className="mt-5 font-display text-base font-bold tracking-wide text-plug-muted">
          {instagramHandle}
        </p>
      )}
    </main>
  );
}
