import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRAND_THEME, SHOP_CONFIG } from '@/lib/config';
import {
  isStampResultCode,
  ROUTES,
  TENANT_ONE_ID,
  type IssuedRedeemToken,
} from '@/lib/contracts';
import { getCustomerCardState } from '@/lib/auth/customer';
import {
  calculateCardsCompleted,
  calculateStampProgress,
  formatDateTimeInZone,
  formatMemberSince,
  formatTimeZoneAbbreviation,
} from '@/lib/rules/display';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getTenantSuspendedAt, isSuspendedRedeemExpired } from '@/lib/security/reward-token-helpers';
import { getTenantBySlug } from '@/lib/tenants/context';
import { AddCardPanel } from '@/components/card/AddCardPanel';
import { AddCardCelebrationBanner } from '@/components/card/AddCardCelebrationBanner';
import { resolveCardTheme } from '@/lib/brand/contrast';
import { GetCardButton } from '@/components/card/GetCardButton';
import { OnboardingCard } from '@/components/card/OnboardingCard';
import { StripResultParam } from '@/components/card/StripResultParam';
import { StampGrid } from '@/components/card/StampGrid';
import { RedeemRewardPanel } from '@/components/card/RedeemRewardPanel';
import { BackupCardPanel } from '@/components/card/BackupCardPanel';
import { InstagramUpsizePanel } from '@/components/card/InstagramUpsizePanel';
import { DeleteCardButton } from '@/components/card/DeleteCardButton';

interface ShopPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    r?: string | string[] | undefined;
    result?: string | string[] | undefined;
    deleted?: string | string[] | undefined;
    t?: string | string[] | undefined;
    c?: string | string[] | undefined;
    m?: string | string[] | undefined;
    added?: string | string[] | undefined;
  }>;
}

export default async function ShopPage({ params, searchParams }: ShopPageProps) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant || tenant.status === 'closed') {
    notFound();
  }

  const { settings } = tenant;
  const rewardThreshold = settings.rewardThreshold;
  const instagramPerk = settings.perks.instagram_follow_upsize;
  const instagramHandle = instagramPerk?.handle;
  // The 50% off milestone is printed on the original shop's card only
  const milestoneStep = tenant.id === TENANT_ONE_ID ? undefined : null;
  const theme = resolveCardTheme(settings.brand);
  const tagline =
    settings.brand.tagline ?? (tenant.id === TENANT_ONE_ID ? SHOP_CONFIG.tagline : undefined);

  const resolvedParams = await searchParams;
  const rawResult = resolvedParams?.r ?? resolvedParams?.result;
  const rValue = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const validResult = typeof rValue === 'string' && isStampResultCode(rValue) ? rValue : null;

  const isDeletedParam = resolvedParams?.deleted === '1';
  const isAddedParam =
    resolvedParams?.added === '1' ||
    (Array.isArray(resolvedParams?.added) && resolvedParams.added[0] === '1');
  const rawTag = Array.isArray(resolvedParams?.t) ? resolvedParams.t[0] : resolvedParams?.t;
  const tagId = typeof rawTag === 'string' && rawTag.trim().length > 0 ? rawTag.trim() : null;
  const rawC = Array.isArray(resolvedParams?.c) ? resolvedParams.c[0] : resolvedParams?.c;
  const cParam = typeof rawC === 'string' && rawC.trim().length > 0 ? rawC.trim() : undefined;
  const rawM = Array.isArray(resolvedParams?.m) ? resolvedParams.m[0] : resolvedParams?.m;
  const mParam = typeof rawM === 'string' && rawM.trim().length > 0 ? rawM.trim() : undefined;

  const cardState = await getCustomerCardState(tenant);

  const isSuspended = tenant.status === 'suspended';
  const suspendedAt =
    (tenant as { suspendedAt?: string | null }).suspendedAt ??
    (isSuspended ? await getTenantSuspendedAt(tenant.id) : null);
  const isExpired = isSuspended && isSuspendedRedeemExpired({ status: tenant.status, suspendedAt });

  // 1. NO-SESSION ONBOARDING VIEW
  if (cardState === null) {
    if (isSuspended) {
      return (
        <OnboardingCard
          pageLabel={`${tenant.name} Digital Loyalty Card (Paused)`}
          title={`${tenant.name} is temporarily paused`}
          shopName={tenant.name}
          originalShop={tenant.id === TENANT_ONE_ID}
          instagramHandle={instagramHandle ?? null}
          theme={theme}
          lines={
            isExpired
              ? ['This shop is temporarily paused and reward redemption has closed.']
              : [
                  'This shop is temporarily paused and is not currently issuing new stamp cards.',
                  'Existing cardholders can still redeem earned rewards.',
                ]
          }
          notice={
            <div
              role="status"
              aria-live="polite"
              className="banner-enter w-full max-w-[390px] mb-4 rounded-2xl border border-yellow-500/50 bg-yellow-950/20 px-4 py-3 text-sm text-yellow-200 text-center"
            >
              Shop is temporarily paused. Stamping and new cards are unavailable.
            </div>
          }
        >
          <div className="w-full text-center">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="w-full py-4 px-6 bg-neutral-800 text-neutral-400 font-display font-black text-sm tracking-widest uppercase border-2 border-neutral-700 opacity-50 cursor-not-allowed rounded-xl"
            >
              Shop Paused
            </button>
          </div>
        </OnboardingCard>
      );
    }

    return (
      <OnboardingCard
        pageLabel={`${tenant.name} Digital Loyalty Card`}
        title={`Get a loyalty card at ${tenant.name}`}
        shopName={tenant.name}
        originalShop={tenant.id === TENANT_ONE_ID}
        instagramHandle={instagramHandle ?? null}
        theme={theme}
        lines={[
          'No app download. No form. Instant digital stamp card.',
          `Collect ${rewardThreshold} stamps, get ${settings.rewardLabel}.`,
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
        <GetCardButton
          mode={tagId ? 'start' : 'card'}
          tagId={tagId}
          mirrorC={cParam}
          mirrorM={mParam}
          returnTo={ROUTES.shop(tenant.slug)}
        />
      </OnboardingCard>
    );
  }

  // 1b. SIGNED IN, NO CARD AT THIS SHOP YET
  if (cardState === 'no-card') {
    return (
      <OnboardingCard
        pageLabel={`${tenant.name} Digital Loyalty Card${isSuspended ? ' (Paused)' : ''}`}
        title={`${tenant.name} loyalty card`}
        shopName={tenant.name}
        originalShop={tenant.id === TENANT_ONE_ID}
        instagramHandle={instagramHandle ?? null}
        theme={theme}
        lines={
          isSuspended
            ? ['This shop is temporarily paused and is not currently issuing new stamp cards.']
            : [`Collect ${rewardThreshold} stamps, get ${settings.rewardLabel}.`]
        }
      >
        <AddCardPanel
          tenantSlug={tenant.slug}
          tenantName={tenant.name}
          rewardLabel={settings.rewardLabel}
          tagId={tagId}
          mirrorC={cParam}
          mirrorM={mParam}
          isSuspended={isSuspended}
        />
      </OnboardingCard>
    );
  }

  // 2. ACTIVE LOYALTY CARD VIEW
  const progress = calculateStampProgress(cardState.availableStamps, rewardThreshold);
  const lastVisitedText = cardState.lastStampedAt
    ? `${formatDateTimeInZone(cardState.lastStampedAt, settings.timezone)} ${formatTimeZoneAbbreviation(settings.timezone, cardState.lastStampedAt)}`
    : null;
  const memberSinceText = formatMemberSince(cardState.createdAt, settings.timezone);
  const cardsCompleted =
    cardState.cardsCompleted ?? calculateCardsCompleted(cardState.totalStamps, rewardThreshold);

  // The newest stamp sits in slot N when the customer holds N stamps. Past the threshold (stacked
  // rewards) the new stamp isn't on the visible grid, so nothing animates.
  const justStampedSlot =
    validResult === 'stamped' &&
    cardState.availableStamps >= 1 &&
    cardState.availableStamps <= progress.rewardThreshold
      ? cardState.availableStamps
      : null;

  let initialRedeemToken: IssuedRedeemToken | null = null;
  if (progress.isRewardReady && !isExpired) {
    try {
      initialRedeemToken = await issueRedeemToken(cardState.customerId, tenant.id);
    } catch {
      initialRedeemToken = null;
    }
  }

  return (
    <main
      aria-label={`${tenant.name} Loyalty Card`}
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Celebratory moment when card was just added (?added=1) */}
      {isAddedParam && <AddCardCelebrationBanner />}

      {/* Suspended Shop Banner */}
      {isSuspended && (
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-[390px] mb-4 rounded-2xl border border-yellow-500/50 bg-yellow-950/30 px-4 py-3 text-xs text-yellow-200 text-center"
        >
          <span className="font-semibold uppercase tracking-wider block mb-0.5">Paused Shop</span>
          Stamping is temporarily paused for this shop.
          {!isExpired && ' Rewards may still be redeemed within the 30-day grace period.'}
        </div>
      )}

      {/* Status message from the last tap (?r=), stripped from the URL after display */}
      <div className="w-full max-w-[390px] flex flex-col items-center">
        {validResult && <StripResultParam result={validResult} />}
      </div>

      {/* The card itself. On a fresh stamp it nudges down as the stamp lands (card-impact). */}
      <section
        aria-label="Active Loyalty Card Container"
        className={`w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-3xl p-5 sm:p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-md relative ${
          justStampedSlot !== null ? 'card-impact' : ''
        }`}
        style={{
          backgroundColor: theme.primaryColor,
          borderColor: theme.cardBorder,
          borderWidth: 1,
          borderStyle: 'solid',
        }}
      >
        {/* Header mirrors the printed card: mascot logo on the left, headline on the right */}
        <header className="flex items-center gap-4">
          <div
            className="relative w-16 h-16 shrink-0 rounded-full p-0.5 border"
            style={{
              backgroundColor: theme.surfaceBg,
              borderColor: theme.cardBorder,
            }}
          >
            <Image
              src={theme.logoUrl ?? BRAND_THEME.assets.logoCircleDark}
              alt={`${tenant.name} logo`}
              width={60}
              height={60}
              priority
              unoptimized
              className="rounded-full object-contain"
            />
          </div>

          <div className="min-w-0">
            <h1
              className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white"
              style={{ color: theme.textColor }}
            >
              <span className="sr-only">{tenant.name} </span>Loyalty card
            </h1>
            {tagline && (
              <p
                className="text-sm text-neutral-300 mt-1.5 lowercase first-letter:uppercase"
                style={{ color: theme.subtextColor }}
              >
                {tagline}
              </p>
            )}
            <p
              className="text-xs text-neutral-400 mt-1 font-medium"
              style={{ color: theme.subtextColor }}
            >
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

        <div className="mt-5 pt-5 border-t border-plug-border" style={{ borderColor: theme.cardBorder }}>
          <StampGrid
            availableStamps={cardState.availableStamps}
            justStampedSlot={justStampedSlot}
            rewardThreshold={rewardThreshold}
            rewardLabel={settings.rewardLabel}
            milestoneStep={milestoneStep}
            stampIcon={theme.stampIcon}
          />
        </div>

        {/* Reward Redemption Panel (when reward is ready and token issued) */}
        {initialRedeemToken && (
          <RedeemRewardPanel
            initialToken={initialRedeemToken}
            availableStamps={cardState.availableStamps}
            tenantSlug={tenant.slug}
            rewardLabel={settings.rewardLabel}
          />
        )}

        {/* Expired Redemption Notice for Suspended Shop */}
        {progress.isRewardReady && isExpired && (
          <div
            data-testid="redemption-closed-notice"
            role="status"
            aria-live="polite"
            className="mt-4 rounded-2xl border border-red-500/50 bg-red-950/30 p-4 text-xs text-red-200 text-center"
          >
            <span className="font-semibold block mb-1">Redemption period closed</span>
            Reward redemption for this shop has closed. The 30-day redemption window has expired.
          </div>
        )}

        {/* One-time Instagram follow perk (free upsize), only for shops that offer it */}
        {instagramPerk && cardState.instagramUpsizeClaimed !== undefined && (
          <InstagramUpsizePanel
            claimed={cardState.instagramUpsizeClaimed}
            tenantSlug={tenant.slug}
            handle={instagramHandle}
            perkLabel={instagramPerk.label}
          />
        )}

        {/* Customer Backup, Consent & Recovery Section */}
        <BackupCardPanel
          customerId={cardState.customerId}
          isAnonymous={cardState.isAnonymous}
          email={cardState.email}
          availableStamps={cardState.availableStamps}
        />

        {/* Card Metadata & Lifetime Stats Section */}
        <div className="mt-6 pt-4 border-t border-plug-border" style={{ borderColor: theme.cardBorder }}>
          {/* Card facts as a definition list: label on the left, value on the right */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-plug-muted">Card</dt>
            <dd className="text-right font-semibold text-white tabular-nums">
              Card #{cardState.customerId.slice(0, 8).toUpperCase()}
            </dd>
            <dt className="text-plug-muted">Member Since</dt>
            <dd className="text-right text-neutral-300 tabular-nums">{memberSinceText}</dd>
            <dt className="text-plug-muted">Cards Completed</dt>
            <dd className="text-right font-semibold text-white tabular-nums">
              {cardsCompleted} {cardsCompleted === 1 ? 'card' : 'cards'}
            </dd>
            <dt className="text-plug-muted">History</dt>
            <dd className="text-right text-neutral-300 tabular-nums">
              Total Earned: {cardState.totalStamps} &bull; Redeemed: {cardState.stampsRedeemed}
            </dd>
            <dt className="text-plug-muted">Last stamp</dt>
            <dd className="text-right text-neutral-300">{lastVisitedText ?? 'First visit pending'}</dd>
          </dl>

          {instagramHandle && (
            <a
              href={`https://instagram.com/${instagramHandle.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Visit our Instagram profile ${instagramHandle}`}
              className="mt-5 flex min-h-11 items-center justify-center font-display text-lg font-bold tracking-wide text-white hover:underline underline-offset-4 rounded-xl"
            >
              {instagramHandle}
            </a>
          )}

          {/* Privacy & Self-Service Data Deletion Controls */}
          <div className="mt-3 pt-3 border-t border-plug-border/60 w-full flex flex-col items-center gap-2">
            <Link
              href={ROUTES.privacy}
              className="min-h-11 inline-flex items-center text-sm text-neutral-400 hover:text-white transition-colors underline-offset-4 hover:underline rounded px-2"
            >
              Privacy &amp; Data Rights (RA 10173)
            </Link>

            <DeleteCardButton
              customerId={cardState.customerId}
              variant="compact"
              scope="card"
              tenantSlug={tenant.slug}
              tenantName={tenant.name}
            />
          </div>
        </div>
      </section>

      {/* Streetwear Footer Note */}
      <footer className="w-full max-w-[390px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>{tenant.name} &copy; 2026</span>
      </footer>
    </main>
  );
}
