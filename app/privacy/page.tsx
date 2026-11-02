import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BRAND_THEME, SECURITY_CONFIG, SHOP_CONFIG } from '@/lib/config';
import { ROUTES } from '@/lib/contracts';
import { getAuthenticatedCustomerCardState } from '@/lib/auth/customer';
import { DeleteCardButton } from '@/components/card/DeleteCardButton';

export const metadata: Metadata = {
  title: 'Privacy Notice & Data Rights (RA 10173)',
  description: `Customer Privacy Notice and Data Subject Rights under Philippines Republic Act No. 10173 (Data Privacy Act of 2012) for ${SHOP_CONFIG.name}.`,
};

export default async function PrivacyPage() {
  let cardState = null;
  try {
    cardState = await getAuthenticatedCustomerCardState();
  } catch {
    cardState = null;
  }

  return (
    <main
      aria-label={`${SHOP_CONFIG.name} Privacy Notice and Data Subject Rights`}
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Top Navigation Bar */}
      <div className="w-full max-w-[580px] flex items-center justify-between text-[10px] font-mono tracking-widest text-plug-muted uppercase px-1 pb-3">
        <Link
          href={ROUTES.card}
          className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded inline-flex items-center gap-1.5"
        >
          &larr; BACK TO MY LOYALTY CARD
        </Link>
        <span>RA 10173 COMPLIANCE</span>
      </div>

      {/* Main Privacy Notice Shell */}
      <article
        aria-label="Privacy Notice & Data Subject Rights"
        className="w-full max-w-[580px] bg-plug-surface/95 border border-plug-border rounded-2xl p-5 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md relative overflow-hidden space-y-8"
      >
        {/* Subtle decorative corner tick */}
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none"
        >
          <div className="bg-white text-black font-mono font-bold text-[8px] py-1 text-center transform rotate-45 translate-x-3 -translate-y-1 w-16">
            TCP
          </div>
        </div>

        {/* Header & Brand Identity */}
        <header className="flex flex-col items-center text-center">
          <div className="relative w-16 h-16 rounded-full p-1 bg-plug-elevated border border-plug-border shadow-inner">
            <Image
              src={BRAND_THEME.assets.logoCircleDark}
              alt={`${SHOP_CONFIG.name} circular logo`}
              width={60}
              height={60}
              priority
              className="rounded-full object-contain"
            />
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-wider text-white mt-3">
            PRIVACY &amp; DATA RIGHTS
          </h1>

          <p className="text-[11px] font-mono uppercase tracking-widest text-plug-muted font-bold mt-1 max-w-[420px]">
            PHILIPPINES REPUBLIC ACT NO. 10173 &bull; DATA PRIVACY ACT OF 2012
          </p>

          <p className="text-[10px] uppercase tracking-widest text-neutral-400 mt-0.5">
            {SHOP_CONFIG.name} &bull; {SHOP_CONFIG.tagline}
          </p>

          {/* Active Card Status Badge */}
          <div className="mt-4">
            {cardState ? (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-plug-elevated border border-plug-border text-xs font-mono text-neutral-200">
                <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" />
                <span>
                  CONNECTED CARD #{cardState.customerId.slice(0, 8).toUpperCase()} &bull;{' '}
                  {cardState.isAnonymous ? 'ANONYMOUS PASS' : 'BACKED UP PASS'}
                </span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-plug-elevated border border-plug-border text-xs font-mono text-plug-muted">
                <span className="w-2 h-2 rounded-full bg-neutral-500" aria-hidden="true" />
                <span>NO ACTIVE CARD SESSION ON THIS DEVICE</span>
              </div>
            )}
          </div>
        </header>

        {/* Section 1: What We Collect (Data Minimization) */}
        <section aria-labelledby="section-what-we-collect" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full" aria-hidden="true" />
            <h2
              id="section-what-we-collect"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              1. What We Collect (Data Minimization)
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              By default, your digital stamp card is{' '}
              <strong className="text-white">100% anonymous</strong>. We generate a random UUID
              stored in an{' '}
              <code className="bg-neutral-800 text-neutral-200 px-1 py-0.5 rounded text-xs font-mono">
                HttpOnly
              </code>{' '}
              browser cookie and record only the timestamps of your stamps, reward redemptions, and
              whether your card has used its Instagram upsize. We never see or store your Instagram
              account. We never ask for your name, phone number, or personal details to start
              earning coffee stamps.
            </p>
            <p>
              <strong className="text-white">Optional Card Backup</strong>: Only if you explicitly
              check the consent box and choose to back up your card do we link your Google account
              or email address via Supabase Auth so you can recover your stamps on a new phone.
            </p>
          </div>
        </section>

        {/* Section 2: What We Never Do */}
        <section aria-labelledby="section-what-we-never-do" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full" aria-hidden="true" />
            <h2
              id="section-what-we-never-do"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              2. What We Never Do
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              We treat your digital privacy with the same uncompromising standards we roast our
              coffee:
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-neutral-300">
              <li>
                <strong className="text-white">No background location tracking</strong>: We only
                verify tag taps when you physically interact with the NFC counter tag.
              </li>
              <li>
                <strong className="text-white">No contact-list access</strong> or device sensor
                permissions.
              </li>
              <li>
                <strong className="text-white">No third-party advertising trackers</strong> or data
                brokers.
              </li>
              <li>
                <strong className="text-white">No unsolicited marketing emails</strong> or
                promotional spam.
              </li>
            </ul>
          </div>
        </section>

        {/* Section 3: Data Retention & Automatic Cleanup */}
        <section aria-labelledby="section-data-retention" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full" aria-hidden="true" />
            <h2
              id="section-data-retention"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              3. Data Retention &amp; Automatic Cleanup
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              In strict adherence to the storage limitation principle of RA 10173, anonymous cards
              with <strong className="text-white">0 stamps</strong> that remain inactive for more
              than <strong className="text-white">30 days</strong> (
              {SECURITY_CONFIG.staleAnonRetentionDays} days) are automatically purged from our
              database.
            </p>
            <p>
              Cards with active stamps or linked backup accounts remain active so you can redeem
              your rewards anytime.
            </p>
          </div>
        </section>

        {/* Section 4: Your Rights Under Republic Act No. 10173 */}
        <section aria-labelledby="section-your-rights" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-white rounded-full" aria-hidden="true" />
            <h2
              id="section-your-rights"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              4. Your Rights Under Republic Act No. 10173 (Data Privacy Act of 2012)
            </h2>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              Under Philippine law, you maintain comprehensive data subject rights over your
              personal data:
            </p>
            <div className="space-y-2">
              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Be Informed &amp; Right to Access:
                </strong>
                <p className="mt-0.5">
                  View your exact stamp count, redemption total, and backup status anytime on{' '}
                  <Link
                    href={ROUTES.card}
                    className="underline text-white hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
                  >
                    /card
                  </Link>
                  .
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Withdraw Consent &amp; Right to Erasure / Blocking:
                </strong>
                <p className="mt-0.5">
                  You can permanently delete your loyalty card, all stamps, redemptions, and linked
                  account data at any time with zero staff intervention using the button below.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 5: Self-Service Data Erasure Panel */}
        <section
          aria-labelledby="section-self-service-erasure"
          className="rounded-2xl border-2 border-neutral-700 bg-plug-elevated/70 p-5 space-y-4 shadow-inner"
        >
          <div className="text-center sm:text-left">
            <h2
              id="section-self-service-erasure"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              5. Self-Service Data Erasure Panel
            </h2>
            <p className="text-xs text-neutral-300 leading-relaxed mt-1">
              Need your record removed? Exercise your Right to Erasure immediately. This permanently
              purges your loyalty card, stamp transactions, redemption history, and linked
              authentication credentials.
            </p>
          </div>

          <div className="w-full pt-1">
            <DeleteCardButton customerId={cardState?.customerId ?? null} variant="full" />
          </div>
        </section>

        {/* Section 6: Navigation Back to Card */}
        <div className="pt-4 border-t border-plug-border flex justify-center">
          <Link
            href={ROUTES.card}
            className="text-xs font-mono font-bold tracking-widest text-neutral-300 hover:text-white uppercase transition-colors underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded py-1 px-2 inline-flex items-center gap-1.5"
          >
            &larr; BACK TO MY LOYALTY CARD
          </Link>
        </div>
      </article>

      {/* Streetwear Footer */}
      <footer className="w-full max-w-[580px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>THE CAFFEINE PLUG &copy; 2026 // STREETWEAR LOYALTY</span>
      </footer>
    </main>
  );
}
