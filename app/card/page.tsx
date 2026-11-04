import Image from 'next/image';
import Link from 'next/link';
import { BRAND_THEME, SHOP_CONFIG } from '@/lib/config';
import {
  isStampResultCode,
  ROUTES,
  TENANT_ONE_ID,
  type IssuedRedeemToken,
} from '@/lib/contracts';
import { getAuthenticatedCustomerCardState } from '@/lib/auth/customer';
import {
  calculateCardsCompleted,
  calculateStampProgress,
  formatManilaDateTime,
  formatMemberSince,
} from '@/lib/rules/display';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { GetCardButton } from '@/components/card/GetCardButton';
import { OnboardingCard } from '@/components/card/OnboardingCard';
import { StripResultParam } from '@/components/card/StripResultParam';
import { StampGrid } from '@/components/card/StampGrid';
import { RedeemRewardPanel } from '@/components/card/RedeemRewardPanel';
import { BackupCardPanel } from '@/components/card/BackupCardPanel';
import { InstagramUpsizePanel } from '@/components/card/InstagramUpsizePanel';
import { DeleteCardButton } from '@/components/card/DeleteCardButton';

interface CardPageProps {
  searchParams: Promise<{
    r?: string | string[] | undefined;
    result?: string | string[] | undefined;
    deleted?: string | string[] | undefined;
  }>;
}

export default async function CardPage({ searchParams }: CardPageProps) {
  const resolvedParams = await searchParams;
  const rawResult = resolvedParams?.r ?? resolvedParams?.result;
  const rValue = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const validResult = typeof rValue === 'string' && isStampResultCode(rValue) ? rValue : null;

  const isDeletedParam = resolvedParams?.deleted === '1';

  const cardState = await getAuthenticatedCustomerCardState();

  // 1. NO-SESSION ONBOARDING VIEW
  if (cardState === null) {
    return (
      <OnboardingCard
        pageLabel={`${SHOP_CONFIG.name} Digital Loyalty Card`}
        title="Get your loyalty card"
        lines={[
          'No app download. No form. Instant digital stamp card.',
          'Collect 10 stamps for a free coffee, with 50% off at stamp 5.',
        ]}
        notice={
          isDeletedParam ? (
            <div
              role="status"
              aria-live="polite"
              className="banner-enter w-full max-w-[390px] mb-4 rounded-2xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-neutral-200"
            >
              Your card and all associated data have been permanently erased.
            </div>
          ) : undefined
        }
      >
        <GetCardButton mode="card" />
      </OnboardingCard>
    );
  }

  // 2. ACTIVE LOYALTY CARD VIEW
  const progress = calculateStampProgress(cardState.availableStamps);
  const lastVisitedText = cardState.lastStampedAt
    ? formatManilaDateTime(cardState.lastStampedAt)
    : null;
  const memberSinceText = formatMemberSince(cardState.createdAt);
  const cardsCompleted =
    cardState.cardsCompleted ?? calculateCardsCompleted(cardState.totalStamps);

  // The newest stamp sits in slot N when the customer holds N stamps. Past 10 (stacked rewards)
  // the new stamp isn't on the visible grid, so nothing animates.
  const justStampedSlot =
    validResult === 'stamped' &&
      cardState.availableStamps >= 1 &&
      cardState.availableStamps <= progress.rewardThreshold
      ? cardState.availableStamps
      : null;

  let initialRedeemToken: IssuedRedeemToken | null = null;
  if (progress.isRewardReady) {
    try {
      initialRedeemToken = await issueRedeemToken(cardState.customerId, TENANT_ONE_ID);
    } catch {
      initialRedeemToken = null;
    }
  }

  return (
    <main
      aria-label={`${SHOP_CONFIG.name} Loyalty Card`}
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Status message from the last tap (?r=), stripped from the URL after display */}
      <div className="w-full max-w-[390px] flex flex-col items-center">
        {validResult && <StripResultParam result={validResult} />}
      </div>

      {/* The card itself. On a fresh stamp it nudges down as the stamp lands (card-impact). */}
      <section
        aria-label="Active Loyalty Card Container"
        className={`w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-3xl p-5 sm:p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-md relative ${justStampedSlot !== null ? 'card-impact' : ''
          }`}
      >
        {/* Header mirrors the printed card: mascot logo on the left, headline on the right */}
        <header className="flex items-center gap-4">
          <div className="relative w-16 h-16 shrink-0 rounded-full p-0.5 bg-plug-elevated border border-plug-border">
            <Image
              src={BRAND_THEME.assets.logoCircleDark}
              alt={`${SHOP_CONFIG.name} logo`}
              width={60}
              height={60}
              priority
              className="rounded-full object-contain"
            />
          </div>

          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white">
              <span className="sr-only">{SHOP_CONFIG.name} </span>Loyalty card
            </h1>
            <p className="text-sm text-neutral-300 mt-1.5 lowercase first-letter:uppercase">
              {SHOP_CONFIG.tagline}
            </p>
            <p className="text-xs text-neutral-400 mt-1 font-medium">
              Member Since {memberSinceText}
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white text-plug-black">
            ACTIVE WALLET
          </span>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-plug-border text-neutral-300">
            {cardState.isAnonymous ? 'ANONYMOUS PASS' : 'BACKED UP PASS'}
          </span>
          <span
            data-testid="card-completion-badge"
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-plug-border bg-plug-elevated text-white flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span>
              {cardsCompleted} {cardsCompleted === 1 ? 'CARD COMPLETED' : 'CARDS COMPLETED'}
            </span>
          </span>
        </div>

        {/* Card Completion Counter Strip */}
        <div
          data-testid="card-completion-counter"
          aria-label={`Card Completion Counter: ${cardsCompleted} completed`}
          className="mt-4 flex items-center justify-between rounded-2xl border border-plug-border bg-plug-elevated/70 px-4 py-2.5 text-xs text-neutral-300"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white">
              <svg
                className="h-3.5 w-3.5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <span className="font-medium text-neutral-200">Card Completion Counter</span>
          </div>
          <span className="font-mono font-bold text-white text-sm tabular-nums">
            {cardsCompleted} {cardsCompleted === 1 ? 'Card' : 'Cards'}
          </span>
        </div>

        <div className="mt-5 pt-5 border-t border-plug-border">
          <StampGrid
            availableStamps={cardState.availableStamps}
            justStampedSlot={justStampedSlot}
          />
        </div>

        {/* Reward Redemption Panel (when reward is ready and token issued) */}
        {initialRedeemToken && (
          <RedeemRewardPanel
            initialToken={initialRedeemToken}
            availableStamps={cardState.availableStamps}
          />
        )}

        {/* One-time Instagram follow perk (free upsize) */}
        {cardState.instagramUpsizeClaimed !== undefined && (
          <InstagramUpsizePanel claimed={cardState.instagramUpsizeClaimed} />
        )}

        {/* Customer Backup, Consent & Recovery Section */}
        <BackupCardPanel
          customerId={cardState.customerId}
          isAnonymous={cardState.isAnonymous}
          email={cardState.email}
          availableStamps={cardState.availableStamps}
        />

        {/* Card Metadata & Lifetime Stats Section */}
        <div className="mt-6 pt-4 border-t border-plug-border">
          {/* Card facts as a definition list: label on the left, value on the right */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-plug-muted">Card</dt>
            <dd className="text-right font-semibold text-white tabular-nums">
              Card #{cardState.customerId.slice(0, 8).toUpperCase()}
            </dd>
            <dt className="text-plug-muted">Member Since</dt>
            <dd className="text-right text-neutral-300 tabular-nums">
              {memberSinceText}
            </dd>
            <dt className="text-plug-muted">Cards Completed</dt>
            <dd className="text-right font-semibold text-white tabular-nums">
              {cardsCompleted} {cardsCompleted === 1 ? 'card' : 'cards'}
            </dd>
            <dt className="text-plug-muted">History</dt>
            <dd className="text-right text-neutral-300 tabular-nums">
              Total Earned: {cardState.totalStamps} &bull; Redeemed: {cardState.stampsRedeemed}
            </dd>
            <dt className="text-plug-muted">Last stamp</dt>
            <dd className="text-right text-neutral-300">
              {lastVisitedText ? `${lastVisitedText} PHT` : 'First visit pending'}
            </dd>
          </dl>

          <a
            href={`https://instagram.com/${SHOP_CONFIG.instagramHandle.replace('@', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Visit our Instagram profile ${SHOP_CONFIG.instagramHandle}`}
            className="mt-5 flex min-h-11 items-center justify-center font-display text-lg font-bold tracking-wide text-white hover:underline underline-offset-4 rounded-xl"
          >
            {SHOP_CONFIG.instagramHandle}
          </a>

          {/* Privacy & Self-Service Data Deletion Controls */}
          <div className="mt-3 pt-3 border-t border-plug-border/60 w-full flex flex-col items-center gap-2">
            <Link
              href={ROUTES.privacy}
              className="min-h-11 inline-flex items-center text-sm text-neutral-400 hover:text-white transition-colors underline-offset-4 hover:underline rounded px-2"
            >
              Privacy &amp; Data Rights (RA 10173)
            </Link>

            <DeleteCardButton customerId={cardState.customerId} variant="compact" />
          </div>
        </div>
      </section>

      {/* Streetwear Footer Note */}
      <footer className="w-full max-w-[390px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>THE CAFFEINE PLUG &copy; 2026</span>
      </footer>
    </main>
  );
}
