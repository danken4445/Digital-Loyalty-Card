import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRAND_THEME, SECURITY_CONFIG } from '@/lib/config';
import { type CustomerCardState, ROUTES } from '@/lib/contracts';
import { resolveCardTheme } from '@/lib/brand/contrast';
import { getCustomerCardState } from '@/lib/auth/customer';
import { getTenantBySlug } from '@/lib/tenants/context';
import { DeleteCardButton } from '@/components/card/DeleteCardButton';

interface ShopPrivacyPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ShopPrivacyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant || tenant.status === 'closed') {
    return {
      title: 'Privacy Notice Not Found',
    };
  }

  return {
    title: `${tenant.name} Privacy Notice & Data Rights (RA 10173)`,
    description: `Customer Privacy Notice and Data Subject Rights under Philippines Republic Act No. 10173 (Data Privacy Act of 2012) for ${tenant.name}.`,
  };
}

export default async function ShopPrivacyPage({ params }: ShopPrivacyPageProps) {
  const { slug } = await params;
  const tenant = await getTenantBySlug(slug);
  if (!tenant || tenant.status === 'closed') {
    notFound();
  }

  const theme = resolveCardTheme(tenant.settings.brand);

  let cardState: CustomerCardState | null = null;
  try {
    const state = await getCustomerCardState(tenant);
    cardState = state && state !== 'no-card' ? state : null;
  } catch {
    cardState = null;
  }
  const hasCard = Boolean(cardState);

  const logoSrc = theme.logoUrl || BRAND_THEME.assets.logoCircleDark;

  return (
    <main
      aria-label={`${tenant.name} Privacy Notice and Data Subject Rights`}
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Top Navigation Bar */}
      <div className="w-full max-w-[580px] flex items-center justify-between text-[10px] font-mono tracking-widest text-plug-muted uppercase px-1 pb-3">
        <Link
          href={ROUTES.shop(tenant.slug)}
          className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded inline-flex items-center gap-1.5"
        >
          &larr; Back to {tenant.name}
        </Link>
        <span>RA 10173 COMPLIANCE</span>
      </div>

      {/* Main Privacy Notice Shell */}
      <article
        aria-label={`${tenant.name} Privacy Notice &amp; Data Subject Rights`}
        className="w-full max-w-[580px] bg-plug-surface border border-plug-border rounded-2xl p-5 sm:p-8 relative overflow-hidden space-y-8"
        style={{
          borderColor: theme.cardBorder,
        }}
      >
        {/* Subtle decorative corner tick */}
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none"
        >
          <div
            className="text-black font-mono font-bold text-[8px] py-1 text-center transform rotate-45 translate-x-3 -translate-y-1 w-16"
            style={{
              backgroundColor: theme.accentColor || '#FFFFFF',
              color: '#000000',
            }}
          >
            PRIV
          </div>
        </div>

        {/* Counsel Review Draft Notice Banner */}
        <div
          role="note"
          aria-label="Legal counsel review pending"
          className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-center text-xs font-mono text-amber-200"
        >
          DRAFT &mdash; this notice is pending review by Philippine legal counsel and is not final.
        </div>

        {/* Header & Brand Identity */}
        <header className="flex flex-col items-center text-center">
          <div
            className="relative w-16 h-16 rounded-full p-1 bg-plug-elevated border border-plug-border flex items-center justify-center overflow-hidden"
            style={{ borderColor: theme.cardBorder }}
          >
            <Image
              src={logoSrc}
              alt={`${tenant.name} circular logo`}
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
            {tenant.name} {theme.tagline ? `\u2022 ${theme.tagline}` : ''}
          </p>

          {/* Active Card Status Badge */}
          <div className="mt-4">
            {hasCard && cardState ? (
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
                <span>NO ACTIVE CARD FOR THIS SHOP ON THIS DEVICE</span>
              </div>
            )}
          </div>
        </header>

        {/* Section 1: Data Controller Identification */}
        <section aria-labelledby="section-controller" className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: theme.accentColor || '#FFFFFF' }}
              aria-hidden="true"
            />
            <h2
              id="section-controller"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              1. Data Controller Identification
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              Under Philippines Republic Act No. 10173 (Data Privacy Act of 2012),{' '}
              <strong className="text-white">{tenant.name}</strong> is intended to act as the independent{' '}
              <strong className="text-white">Data Controller</strong> for this loyalty card, its stamp ledger, reward redemptions, and shop visit records, subject to counsel review.
            </p>
            <p>
              The DigitalLoyalty platform operator provides cloud infrastructure and is intended to act as a secure{' '}
              <strong className="text-white">Data Processor</strong> on behalf of {tenant.name}, subject to counsel review.
            </p>
          </div>
        </section>

        {/* Section 2: What We Collect (Data Minimization) */}
        <section aria-labelledby="section-what-we-collect" className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: theme.accentColor || '#FFFFFF' }}
              aria-hidden="true"
            />
            <h2
              id="section-what-we-collect"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              2. What We Collect (Data Minimization)
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              Your digital card at {tenant.name} is designed with privacy-by-default. We generate a random identifier stored in an{' '}
              <code className="bg-neutral-800 text-neutral-200 px-1 py-0.5 rounded text-xs font-mono">
                HttpOnly
              </code>{' '}
              browser cookie and record only the timestamps of your taps and rewards.
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-neutral-300">
              <li>
                <strong className="text-white">No background location tracking</strong>: We only verify tag taps when you physically interact with the shop counter tag.
              </li>
              <li>
                <strong className="text-white">No contact-list access</strong> or intrusive device permissions.
              </li>
              <li>
                <strong className="text-white">No third-party ad trackers</strong> or data brokers.
              </li>
              <li>
                <strong className="text-white">No unsolicited marketing emails</strong> or spam.
              </li>
            </ul>
          </div>
        </section>

        {/* Section 3: Shop Loyalty Rules & Policies */}
        <section aria-labelledby="section-shop-rules" className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: theme.accentColor || '#FFFFFF' }}
              aria-hidden="true"
            />
            <h2
              id="section-shop-rules"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              3. Loyalty Rules &amp; Stamping Limits
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              To ensure fairness and prevent fraud, {tenant.name} enforces the following rules authorized in tenant configuration:
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs sm:text-sm">
              <dt className="text-plug-muted font-mono uppercase">Stamp Cooldown</dt>
              <dd className="text-right text-white font-mono font-bold">
                {tenant.settings.cooldownMinutes} minutes between valid counter taps
              </dd>
              <dt className="text-plug-muted font-mono uppercase">Daily Stamp Limit</dt>
              <dd className="text-right text-white font-mono font-bold">
                {tenant.settings.dailyCap} stamps per day
              </dd>
              <dt className="text-plug-muted font-mono uppercase">Reward Goal</dt>
              <dd className="text-right text-white font-mono font-bold">
                {tenant.settings.rewardThreshold} stamps for {tenant.settings.rewardLabel}
              </dd>
            </dl>
          </div>
        </section>

        {/* Section 4: Data Retention & Automatic Cleanup */}
        <section aria-labelledby="section-data-retention" className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: theme.accentColor || '#FFFFFF' }}
              aria-hidden="true"
            />
            <h2
              id="section-data-retention"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              4. Data Retention &amp; Automatic Cleanup
            </h2>
          </div>

          <div className="space-y-2.5 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              In strict adherence to the storage limitation principle of RA 10173, anonymous accounts across the platform
              with <strong className="text-white">0 stamps</strong> that remain inactive for more
              than <strong className="text-white">{SECURITY_CONFIG.staleAnonRetentionDays} days</strong> are automatically purged platform-wide.
            </p>
            <p>
              Cards with active stamps or linked backup accounts remain active so you can redeem your rewards anytime you visit {tenant.name}.
            </p>
          </div>
        </section>

        {/* Section 5: Your Rights Under Republic Act No. 10173 */}
        <section aria-labelledby="section-your-rights" className="space-y-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: theme.accentColor || '#FFFFFF' }}
              aria-hidden="true"
            />
            <h2
              id="section-your-rights"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              5. Your Rights Under Republic Act No. 10173 (Data Privacy Act of 2012)
            </h2>
          </div>

          <div className="space-y-3 text-xs sm:text-sm text-neutral-300 leading-relaxed pl-4 border-l border-plug-border">
            <p>
              Under Philippine law, you maintain comprehensive data subject rights over your personal data:
            </p>
            <div className="space-y-2.5">
              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Be Informed:
                </strong>
                <p className="mt-0.5">
                  You have the right to know whether personal data pertaining to you is being processed, including data sources and collection purposes.
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Access:
                </strong>
                <p className="mt-0.5">
                  View your current stamps, redemptions, and member details anytime on{' '}
                  <Link
                    href={ROUTES.shop(tenant.slug)}
                    className="underline text-white hover:text-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded"
                  >
                    /s/{tenant.slug}
                  </Link>
                  .
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Object:
                </strong>
                <p className="mt-0.5">
                  You have the right to withhold or withdraw consent to card processing at any time.
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Rectification / Correction:
                </strong>
                <p className="mt-0.5">
                  You have the right to dispute and request correction of any inaccurate or outdated records in your loyalty balance.
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Erasure / Blocking:
                </strong>
                <p className="mt-0.5">
                  You can permanently remove this card from your wallet at any time. Removing this card deletes your stamp progress at {tenant.name} while leaving all other cards in your wallet untouched.
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Data Portability:
                </strong>
                <p className="mt-0.5">
                  You have the right to request a copy of your personal data processed in an electronic or structured format.
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Damages:
                </strong>
                <p className="mt-0.5">
                  You have the right to be indemnified for damages sustained due to inaccurate, false, unlawfully obtained, or unauthorized use of personal data.
                </p>
              </div>

              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to File a Complaint with the National Privacy Commission (NPC):
                </strong>
                <p className="mt-0.5">
                  If you believe your rights under RA 10173 have been violated, you may lodge a complaint with the National Privacy Commission of the Philippines (https://privacy.gov.ph).
                </p>
              </div>

              <div className="pt-2 border-t border-plug-border">
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Data Protection Officer (DPO) Contact:
                </strong>
                <p className="mt-0.5 text-neutral-400">
                  Data Controller: {tenant.name} &bull; Contact: [DPO contact for {tenant.name} to be confirmed by counsel]
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 6: Scoped Card Removal Panel */}
        <section
          aria-labelledby="section-scoped-erasure"
          className="rounded-xl border border-neutral-700 bg-plug-elevated p-5 space-y-4"
        >
          <div className="text-center sm:text-left">
            <h2
              id="section-scoped-erasure"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              6. Remove Card from Wallet
            </h2>
            {hasCard && cardState ? (
              <p className="text-xs text-neutral-300 leading-relaxed mt-1">
                Want to remove your {tenant.name} card? Exercise your Right to Erasure for this shop. This permanently
                removes your card and stamps at {tenant.name}. Any other shop cards in your wallet remain completely safe and untouched.
              </p>
            ) : (
              <p className="text-xs text-neutral-300 leading-relaxed mt-1">
                No active {tenant.name} card was found in this wallet session. If you add this shop&apos;s card in the future, you will be able to remove it here at any time.
              </p>
            )}
          </div>

          {hasCard && cardState && (
            <div className="w-full pt-1">
              <DeleteCardButton
                customerId={cardState.customerId}
                variant="full"
                scope="card"
                tenantSlug={tenant.slug}
                tenantName={tenant.name}
              />
            </div>
          )}
        </section>

        {/* Navigation Back to Shop */}
        <div className="pt-4 border-t border-plug-border flex justify-center">
          <Link
            href={ROUTES.shop(tenant.slug)}
            className="text-xs font-mono font-bold tracking-widest text-neutral-300 hover:text-white uppercase transition-colors underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded py-1 px-2 inline-flex items-center gap-1.5"
          >
            &larr; Back to {tenant.name}
          </Link>
        </div>
      </article>

      {/* Streetwear Footer */}
      <footer className="w-full max-w-[580px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>{tenant.name} &copy; 2026</span>
      </footer>
    </main>
  );
}
