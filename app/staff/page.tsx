import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SetupChecklist } from '@/components/console/SetupChecklist';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { loadShopHomeData, type ShopHomeData } from '@/lib/console/setup-data';
import { SETUP_SKIPPED_COOKIE } from '@/lib/console/setup-progress';
import { ROUTES } from '@/lib/contracts';
import { getTenantById } from '@/lib/tenants/context';

function Chevron({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0 transition-transform group-hover:translate-x-0.5`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 4 6 6-6 6" />
    </svg>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-plug-border bg-plug-surface p-4 sm:p-5">
      <p className="text-3xl font-bold tabular-nums text-white">{value}</p>
      <p className="mt-1 text-sm text-plug-muted">{label}</p>
    </div>
  );
}

export default async function StaffHomePage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.root);
  const tenant = await getTenantById(staff.tenantId).catch(() => null);
  const rewardLabel = tenant?.settings.rewardLabel || 'reward';
  const isOwner = staff.role === 'owner';
  const canManage = isOwner || staff.role === 'manager';
  const slug = staff.tenantSlug;

  let home: ShopHomeData | null = null;
  if (tenant) {
    home = await loadShopHomeData(tenant).catch(() => null);
  }

  // A brand-new owner goes straight into the guided setup, unless they chose "later".
  if (isOwner && home && home.progress.doneCount === 0) {
    const jar = await cookies();
    if (!jar.get(SETUP_SKIPPED_COOKIE)) {
      redirect(ROUTES.staff.setup(slug));
    }
  }

  const firstName = staff.displayName.split(' ')[0] || staff.displayName;
  const showChecklist = isOwner && home && !home.progress.isComplete;

  const manageLinks = [
    { title: 'My Card', description: 'Your reward and how the card looks', href: ROUTES.staff.settings(slug) },
    { title: 'Tap Cards', description: 'The cards customers tap at the counter', href: ROUTES.staff.tapCards(slug) },
    { title: 'Team', description: 'Invite staff and choose what they can do', href: ROUTES.staff.team(slug) },
    isOwner
      ? { title: 'Insights', description: 'How many customers come back', href: ROUTES.staff.analytics(slug) }
      : { title: 'Reports', description: 'Download your customer and stamp lists', href: ROUTES.staff.exportData(slug) },
  ];

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.root}
      title={`Hi, ${firstName}`}
      headerLabel="Home Header"
      description={
        canManage
          ? "Here's how your shop is doing today."
          : 'Ready for the counter. Tap Redeem when a customer wants their reward.'
      }
    >
      <div className="space-y-8">
        {showChecklist && home && <SetupChecklist progress={home.progress} />}

        {home && (
          <section aria-label="Today" className="grid grid-cols-2 gap-3 sm:gap-4">
            <StatTile value={home.today.stampsToday} label="Stamps given today" />
            <StatTile value={home.today.rewardsToday} label="Rewards given today" />
          </section>
        )}

        <section aria-label="At the counter" className="space-y-3">
          <h2 className="text-sm font-semibold text-plug-muted">At the counter</h2>

          {/* The one task baristas do many times a day gets the biggest target */}
          <Link
            href={ROUTES.staff.redeem}
            className="group flex items-center justify-between gap-4 rounded-3xl bg-white p-6 text-plug-black transition-colors hover:bg-neutral-200 sm:p-8"
          >
            <div>
              <h2 className="text-3xl font-bold leading-none sm:text-4xl">Redeem Reward</h2>
              <p className="mt-2 max-w-md text-base text-neutral-700">
                Scan the customer&apos;s QR code and give them their {rewardLabel.toLowerCase()}.
              </p>
            </div>
            <Chevron className="h-8 w-8" />
          </Link>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href={ROUTES.staff.manualStamp}
              className="group flex min-h-20 items-center justify-between gap-4 rounded-2xl border border-plug-border bg-plug-surface px-5 py-4 transition-colors hover:bg-plug-elevated"
            >
              <div>
                <h3 className="text-lg font-semibold text-white">Add a stamp by hand</h3>
                <p className="text-sm text-plug-muted">When a phone won&apos;t read the tap card</p>
              </div>
              <Chevron />
            </Link>
            <Link
              href={ROUTES.staff.activity}
              className="group flex min-h-20 items-center justify-between gap-4 rounded-2xl border border-plug-border bg-plug-surface px-5 py-4 transition-colors hover:bg-plug-elevated"
            >
              <div>
                <h3 className="text-lg font-semibold text-white">Activity</h3>
                <p className="text-sm text-plug-muted">Today&apos;s stamps, rewards and anything odd</p>
              </div>
              <Chevron />
            </Link>
          </div>
        </section>

        {canManage && (
          <section aria-label="Running your shop" className="space-y-3">
            <h2 className="text-sm font-semibold text-plug-muted">Running your shop</h2>
            <ul className="divide-y divide-plug-border overflow-hidden rounded-2xl border border-plug-border bg-plug-surface">
              {manageLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group flex min-h-16 items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-plug-elevated"
                  >
                    <div>
                      <h3 className="text-base font-semibold text-white">{link.title}</h3>
                      <p className="text-sm text-plug-muted">{link.description}</p>
                    </div>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </StaffPageShell>
  );
}
