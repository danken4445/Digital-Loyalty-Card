import Link from 'next/link';
import { listWalletCards } from '@/lib/auth/customer';
import { isStampResultCode, ROUTES } from '@/lib/contracts';
import { OnboardingCard } from '@/components/card/OnboardingCard';
import { StripResultParam } from '@/components/card/StripResultParam';

interface WalletPageProps {
  searchParams: Promise<{
    r?: string | string[] | undefined;
    result?: string | string[] | undefined;
    deleted?: string | string[] | undefined;
  }>;
}

/** Simple list of the customer's shop cards. Phase 13 restyles this page. */
export default async function WalletPage({ searchParams }: WalletPageProps) {
  const resolvedParams = await searchParams;
  const rawResult = resolvedParams?.r ?? resolvedParams?.result;
  const rValue = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const validResult = typeof rValue === 'string' && isStampResultCode(rValue) ? rValue : null;
  const isDeletedParam = resolvedParams?.deleted === '1';

  const cards = await listWalletCards();

  if (cards === null) {
    return (
      <OnboardingCard
        pageLabel="Your loyalty wallet"
        title="Your loyalty wallet"
        instagramHandle={null}
        lines={[
          'Loyalty cards are added at each shop.',
          "Tap the shop's NFC card or scan its QR code to add it here.",
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
        <p className="text-sm text-neutral-400">Nothing to show yet.</p>
      </OnboardingCard>
    );
  }

  return (
    <main
      aria-label="Your loyalty wallet"
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center px-4 py-6 sm:py-10"
    >
      <div className="w-full max-w-[390px] flex flex-col items-center">
        {validResult && <StripResultParam result={validResult} />}
      </div>

      <section
        aria-label="Wallet cards"
        className="w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-3xl p-5 sm:p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-md"
      >
        <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white">
          Your loyalty wallet
        </h1>

        {cards.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-300">
            No cards yet. Tap a shop&apos;s NFC card or scan its QR code to add it here.
          </p>
        ) : (
          <ul className="mt-5 flex flex-col gap-3">
            {cards.map((card) => (
              <li key={card.tenantId}>
                <Link
                  href={ROUTES.shop(card.tenantSlug)}
                  className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-plug-border bg-plug-elevated/70 px-4 py-3 text-white hover:border-zinc-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{card.tenantName}</span>
                    <span className="block truncate text-xs text-neutral-400">
                      {card.rewardLabel}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-lg font-bold tabular-nums">
                    {`${card.availableStamps}/${card.rewardThreshold}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link
          href={ROUTES.privacy}
          className="mt-5 inline-flex min-h-11 items-center text-sm text-neutral-400 hover:text-white transition-colors underline-offset-4 hover:underline rounded px-2"
        >
          Privacy &amp; Data Rights (RA 10173)
        </Link>
      </section>
    </main>
  );
}
