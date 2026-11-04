import Image from 'next/image';
import Link from 'next/link';
import { listWalletCards } from '@/lib/auth/customer';
import { isStampResultCode, ROUTES } from '@/lib/contracts';
import { getVerifiedUser } from '@/lib/supabase/server';
import { StripResultParam } from '@/components/card/StripResultParam';
import { DeleteCardButton } from '@/components/card/DeleteCardButton';
import { WalletCardStack } from '@/components/wallet/WalletCardStack';
import { WalletBackupModal } from '@/components/wallet/WalletBackupModal';

interface WalletPageProps {
  searchParams: Promise<{
    r?: string | string[] | undefined;
    result?: string | string[] | undefined;
    deleted?: string | string[] | undefined;
  }>;
}

/**
 * Customer wallet page displaying all collectible loyalty cards across shops.
 * Restores mascot empty state and integrates wallet-level backup.
 */
export default async function WalletPage({ searchParams }: WalletPageProps) {
  const resolvedParams = await searchParams;
  const rawResult = resolvedParams?.r ?? resolvedParams?.result;
  const rValue = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const validResult = typeof rValue === 'string' && isStampResultCode(rValue) ? rValue : null;
  const isDeletedParam = resolvedParams?.deleted === '1';

  const user = await getVerifiedUser();
  const cards = await listWalletCards();

  if (cards === null) {
    return (
      <main
        aria-label="Your loyalty wallet"
        className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-center px-4 py-8 sm:py-12"
      >
        <section
          aria-label="Your loyalty wallet"
          className="w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-3xl p-6 sm:p-7 shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-md flex flex-col items-center text-center"
        >
          {isDeletedParam && (
            <div
              role="status"
              aria-live="polite"
              className="banner-enter w-full mb-4 rounded-2xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-neutral-200"
            >
              Your card and all associated data have been permanently erased.
            </div>
          )}

          <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white mb-4">
            Your loyalty wallet
          </h1>

          <Image
            src="/images/brand/kaws-standing-clean.png"
            alt="Loyalty wallet mascot"
            width={144}
            height={144}
            priority
            unoptimized
            className="h-36 w-36 object-contain mix-blend-lighten mb-4"
          />

          <p className="text-base font-semibold text-white mb-1">
            Loyalty cards are added at each shop
          </p>
          <p className="text-sm text-neutral-300 max-w-[280px] mb-6">
            Tap the shop&apos;s NFC card or scan its QR code to add it here.
          </p>

          <Link
            href={ROUTES.privacy}
            className="inline-flex min-h-11 items-center text-sm text-neutral-400 hover:text-white transition-colors underline-offset-4 hover:underline rounded px-2"
          >
            Privacy &amp; Data Rights (RA 10173)
          </Link>
        </section>
      </main>
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
        className="w-full max-w-[390px] bg-plug-surface/95 border border-plug-border rounded-3xl p-5 sm:p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-md flex flex-col items-center text-center"
      >
        <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-white self-start text-left mb-4">
          Your loyalty wallet
        </h1>

        {cards.length === 0 ? (
          <div className="flex flex-col items-center text-center my-4 w-full">
            <Image
              src="/images/brand/kaws-standing-clean.png"
              alt="Loyalty wallet mascot"
              width={144}
              height={144}
              priority
              unoptimized
              className="h-36 w-36 object-contain mix-blend-lighten mb-4"
            />
            <p className="text-base font-semibold text-white mb-1">
              No cards in your wallet yet
            </p>
            <p className="text-sm text-neutral-300 max-w-[280px] mb-2">
              Tap a shop&apos;s NFC card or scan its QR code to add it here.
            </p>
          </div>
        ) : (
          <WalletCardStack cards={cards} />
        )}

        {/* Wallet-level backup prompt for anonymous users */}
        {user && user.is_anonymous && (
          <WalletBackupModal
            customerId={user.id}
            isAnonymous={true}
            email={user.email}
            totalCards={cards.length}
          />
        )}

        <Link
          href={ROUTES.privacy}
          className="mt-6 inline-flex min-h-11 items-center text-sm text-neutral-400 hover:text-white transition-colors underline-offset-4 hover:underline rounded px-2"
        >
          Privacy &amp; Data Rights (RA 10173)
        </Link>

        <div className="mt-3 pt-3 border-t border-plug-border/60 w-full flex flex-col items-center">
          <DeleteCardButton variant="compact" scope="wallet" />
        </div>
      </section>
    </main>
  );
}
