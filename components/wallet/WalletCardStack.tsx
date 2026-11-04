import Link from 'next/link';
import Image from 'next/image';
import { ROUTES, type WalletCardSummary } from '@/lib/contracts';
import { resolveCardTheme } from '@/lib/brand/contrast';

export interface WalletCardStackProps {
  cards: WalletCardSummary[];
}

/**
 * Collectible card stack component displaying all loyalty cards in a customer's wallet.
 * Each card renders with its shop's dynamic branding, accessible links,
 * tabular stamp counts, and completed card history badges.
 */
export function WalletCardStack({ cards }: WalletCardStackProps) {
  const totalCards = cards.length;
  const totalCompleted = cards.reduce((sum, c) => sum + (c.cardsCompleted ?? 0), 0);

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Wallet Counter Badges */}
      <div className="flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-plug-border bg-plug-elevated/80 px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-white">
          <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
          Cards collected: {totalCards}
        </span>
        {totalCompleted > 0 && (
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-neutral-400">
            {totalCompleted} completed
          </span>
        )}
      </div>

      {/* Collectible Cards Stack */}
      <ul className="flex flex-col gap-3.5" aria-label="Your loyalty cards">
        {cards.map((card) => {
          const theme = resolveCardTheme(card.brand);
          const progressPercent =
            card.rewardThreshold > 0
              ? Math.min(100, Math.round((card.availableStamps / card.rewardThreshold) * 100))
              : 0;

          return (
            <li key={card.tenantId}>
              <Link
                href={ROUTES.shop(card.tenantSlug)}
                className="group relative block w-full rounded-2xl p-4 sm:p-5 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{
                  backgroundColor: theme.primaryColor,
                  border: `1px solid ${theme.cardBorder}`,
                  color: theme.textColor,
                }}
              >
                {/* Top Row: Shop Logo / Monogram + Shop Name + Completed Badge */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {theme.logoUrl ? (
                      <div
                        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full p-0.5"
                        style={{
                          backgroundColor: theme.surfaceBg,
                          border: `1px solid ${theme.cardBorder}`,
                        }}
                      >
                        <Image
                          src={theme.logoUrl}
                          alt={`${card.tenantName} logo`}
                          width={36}
                          height={36}
                          className="h-full w-full rounded-full object-contain"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold uppercase"
                        style={{
                          backgroundColor: theme.surfaceBg,
                          border: `1px solid ${theme.cardBorder}`,
                          color: theme.textColor,
                        }}
                      >
                        {card.tenantName.slice(0, 2)}
                      </div>
                    )}

                    <div className="min-w-0">
                      <h2 className="truncate font-display text-base font-bold tracking-tight">
                        {card.tenantName}
                      </h2>
                      <p
                        className="truncate text-xs"
                        style={{ color: theme.subtextColor }}
                      >
                        {card.rewardLabel}
                      </p>
                    </div>
                  </div>

                  {/* Stamp Count & Completed Badge */}
                  <div className="flex flex-col items-end shrink-0">
                    <span
                      className="font-mono text-xl sm:text-2xl font-black tabular-nums tracking-tight leading-none"
                      style={{ color: theme.textColor }}
                    >
                      {`${card.availableStamps}/${card.rewardThreshold}`}
                    </span>
                    {card.cardsCompleted && card.cardsCompleted > 0 ? (
                      <span
                        className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          backgroundColor: theme.surfaceBg,
                          border: `1px solid ${theme.cardBorder}`,
                          color: theme.textColor,
                        }}
                      >
                        ★ {card.cardsCompleted} completed
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Progress Bar Track */}
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full"
                  style={{ backgroundColor: theme.surfaceBg }}
                  aria-hidden="true"
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${progressPercent}%`,
                      backgroundColor: theme.accentColor,
                    }}
                  />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
