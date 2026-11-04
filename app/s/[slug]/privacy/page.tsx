import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRAND_THEME, SECURITY_CONFIG } from '@/lib/config';
import { ROUTES } from '@/lib/contracts';
import { resolveCardTheme } from '@/lib/brand/contrast';
import { getVerifiedUser } from '@/lib/supabase/server';
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

  let cardState: { customerId: string; isAnonymous: boolean } | null = null;
  try {
    const user = await getVerifiedUser();
    cardState = user ? { customerId: user.id, isAnonymous: Boolean(user.is_anonymous) } : null;
  } catch {
    cardState = null;
  }

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
        aria-label={`${tenant.name} Privacy Notice & Data Subject Rights`}
        className="w-full max-w-[580px] bg-plug-surface/95 border border-plug-border rounded-2xl p-5 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md relative overflow-hidden space-y-8"
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

        {/* Header & Brand Identity */}
        <header className="flex flex-col items-center text-center">
          <div
            className="relative w-16 h-16 rounded-full p-1 bg-plug-elevated border border-plug-border shadow-inner flex items-center justify-center overflow-hidden"
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
              <strong className="text-white">{tenant.name}</strong> operates as the independent{' '}
              <strong className="text-white">Data Controller</strong> for this loyalty card, its stamp ledger, reward redemptions, and shop visit records.
            </p>
            <p>
              The DigitalLoyalty platform operator provides cloud infrastructure and acts as a secure{' '}
              <strong className="text-white">Data Processor</strong> on behalf of {tenant.name}.
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
              In strict adherence to the storage limitation principle of RA 10173, anonymous cards
              with <strong className="text-white">0 stamps</strong> that remain inactive for more
              than <strong className="text-white">30 days</strong> (
              {SECURITY_CONFIG.staleAnonRetentionDays} days) are automatically purged from the {tenant.name} ledger.
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
            <div className="space-y-2">
              <div>
                <strong className="text-white block font-mono text-xs uppercase tracking-wider">
                  Right to Be Informed &amp; Right to Access:
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
                  Right to Withdraw Consent &amp; Right to Erasure / Blocking:
                </strong>
                <p className="mt-0.5">
                  You can permanently remove this card from your wallet at any time using the action below.
                  Removing this card deletes your stamp progress at {tenant.name} while leaving all other cards in your wallet untouched.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 6: Scoped Card Removal Panel */}
        <section
          aria-labelledby="section-scoped-erasure"
          className="rounded-2xl border-2 border-neutral-700 bg-plug-elevated/70 p-5 space-y-4 shadow-inner"
        >
          <div className="text-center sm:text-left">
            <h2
              id="section-scoped-erasure"
              className="font-display text-base sm:text-lg font-black uppercase tracking-wider text-white"
            >
              6. Remove Card from Wallet
            </h2>
            <p className="text-xs text-neutral-300 leading-relaxed mt-1">
              Want to remove your {tenant.name} card? Exercise your Right to Erasure for this shop. This permanently
              removes your card and stamps at {tenant.name}. Any other shop cards in your wallet remain completely safe and untouched.
            </p>
          </div>

          <div className="w-full pt-1">
            <DeleteCardButton
              customerId={cardState?.customerId ?? null}
              variant="full"
              scope="card"
              tenantSlug={tenant.slug}
              tenantName={tenant.name}
            />
          </div>
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
