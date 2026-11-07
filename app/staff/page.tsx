import Link from 'next/link';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';
import { getTenantById } from '@/lib/tenants/context';

const SECONDARY_TOOLS = [
  {
    title: 'Manual Stamp',
    href: ROUTES.staff.manualStamp,
    description: "Add a stamp by hand when a customer's phone can't tap. Needs a reason.",
  },
  {
    title: 'NFC Tag Manager',
    href: ROUTES.staff.tags,
    description: 'Create, rotate or switch off the NFC cards you tap on phones.',
  },
  {
    title: 'Activity & Audit Log',
    href: ROUTES.staff.activity,
    description: 'Recent stamps and rewards, plus anything that looks unusual.',
  },
] as const;

function ChevronRight() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-plug-muted transition-transform group-hover:translate-x-0.5 group-hover:text-white"
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

export default async function StaffOverviewPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.root);
  const tenant = await getTenantById(staff.tenantId).catch(() => null);
  const rewardLabel = tenant?.settings.rewardLabel || 'reward';
  const canManage = staff.role === 'owner' || staff.role === 'manager';

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.root}
      title="Operations Console"
      headerLabel="Portal Overview Header"
      description={`Signed in as ${staff.displayName}. Redeeming rewards is the everyday job; the other tools are for when something needs fixing.`}
    >
      <div className="space-y-8">
        {/* Counter Operations Section */}
        <section aria-label="Staff Operations Modules" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-plug-muted">
              Counter Operations
            </h2>
          </div>

          {/* The one task baristas do many times a day gets the biggest target */}
          <Link
            href={ROUTES.staff.redeem}
            className="group flex items-center justify-between gap-4 rounded-3xl bg-white p-6 text-plug-black transition-colors hover:bg-neutral-200 sm:p-8"
          >
            <div>
              <h2 className="font-display text-3xl font-bold uppercase leading-none tracking-wide sm:text-4xl">
                Redeem Reward
              </h2>
              <p className="mt-2 max-w-md text-base text-neutral-700">
                Scan the customer&apos;s reward QR code and give them their {rewardLabel.toLowerCase()}.
              </p>
            </div>
            <svg
              className="h-8 w-8 shrink-0 transition-transform group-hover:translate-x-1"
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
          </Link>

          <ul className="overflow-hidden divide-y divide-plug-border rounded-3xl border border-plug-border bg-plug-surface">
            {SECONDARY_TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link
                  href={tool.href}
                  className="group flex min-h-20 items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-plug-elevated/60"
                >
                  <div>
                    <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
                      {tool.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-plug-muted">{tool.description}</p>
                  </div>
                  <ChevronRight />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Owner & Manager Shop Administration Console */}
        {canManage && (
          <section aria-label="Shop Administration Console" className="space-y-4 pt-4 border-t border-plug-border">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
                  Shop Management &amp; Branding
                </h2>
                <p className="mt-0.5 text-xs text-plug-muted">
                  Customize card appearance, configure stamping rules, invite team members, and manage branches.
                </p>
              </div>
              <Link
                href={ROUTES.staff.settings(staff.tenantSlug)}
                className="inline-flex items-center gap-1.5 rounded-full border border-plug-border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:border-white hover:text-white transition-colors"
              >
                All Settings &rarr;
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {staff.role === 'owner' && (
                <Link
                  href={ROUTES.staff.analytics(staff.tenantSlug)}
                  className="group flex flex-col justify-between rounded-3xl border border-plug-border bg-plug-surface p-5 transition-colors hover:border-emerald-500/60 hover:bg-plug-elevated/70"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 3v18h18" />
                          <path d="m19 9-5 5-4-4-3 3" />
                        </svg>
                      </span>
                      <div>
                        <h3 className="font-display text-lg font-bold uppercase tracking-wide text-white group-hover:text-emerald-300">
                          Owner Analytics
                        </h3>
                        <span className="mt-0.5 inline-block rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-emerald-400">
                          Retention &amp; Top 10
                        </span>
                      </div>
                    </div>
                    <ChevronRight />
                  </div>
                  <p className="mt-3 text-sm text-plug-muted">
                    Customer retention rates, loyalty card funnel, visit cadence, and top loyal customer leaderboard.
                  </p>
                </Link>
              )}

              <Link
                href={`/staff/${encodeURIComponent(staff.tenantSlug)}/settings/brand`}
                className="group flex flex-col justify-between rounded-3xl border border-plug-border bg-plug-surface p-5 transition-colors hover:border-amber-500/60 hover:bg-plug-elevated/70"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold uppercase tracking-wide text-white group-hover:text-amber-300">
                        Brand &amp; Card Look
                      </h3>
                      <span className="mt-0.5 inline-block rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase text-amber-400">
                        Live Preview
                      </span>
                    </div>
                  </div>
                  <ChevronRight />
                </div>
                <p className="mt-3 text-sm text-plug-muted">
                  Configure primary and accent colors, shop logo, card artwork, and preview your live loyalty card.
                </p>
              </Link>

              <Link
                href={ROUTES.staff.settings(staff.tenantSlug)}
                className="group flex flex-col justify-between rounded-3xl border border-plug-border bg-plug-surface p-5 transition-colors hover:border-neutral-500 hover:bg-plug-elevated/70"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-800 text-neutral-300">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold uppercase tracking-wide text-white group-hover:text-neutral-200">
                        Loyalty &amp; Rules
                      </h3>
                      <span className="mt-0.5 inline-block text-xs text-plug-muted">
                        Thresholds &amp; Limits
                      </span>
                    </div>
                  </div>
                  <ChevronRight />
                </div>
                <p className="mt-3 text-sm text-plug-muted">
                  Cooldown minutes, daily stamp caps, reward thresholds, and customer reward descriptions.
                </p>
              </Link>

              <Link
                href={`/staff/${encodeURIComponent(staff.tenantSlug)}/settings/staff`}
                className="group flex flex-col justify-between rounded-3xl border border-plug-border bg-plug-surface p-5 transition-colors hover:border-neutral-500 hover:bg-plug-elevated/70"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-800 text-neutral-300">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold uppercase tracking-wide text-white group-hover:text-neutral-200">
                        Staff &amp; Team
                      </h3>
                      <span className="mt-0.5 inline-block text-xs text-plug-muted">
                        Roles &amp; Invites
                      </span>
                    </div>
                  </div>
                  <ChevronRight />
                </div>
                <p className="mt-3 text-sm text-plug-muted">
                  Invite managers and baristas, assign permissions, and manage team access.
                </p>
              </Link>

              <Link
                href={`/staff/${encodeURIComponent(staff.tenantSlug)}/settings/locations`}
                className="group flex flex-col justify-between rounded-3xl border border-plug-border bg-plug-surface p-5 transition-colors hover:border-neutral-500 hover:bg-plug-elevated/70"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-700 bg-neutral-800 text-neutral-300">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold uppercase tracking-wide text-white group-hover:text-neutral-200">
                        Branches &amp; Locations
                      </h3>
                      <span className="mt-0.5 inline-block text-xs text-plug-muted">
                        Multi-Store Setup
                      </span>
                    </div>
                  </div>
                  <ChevronRight />
                </div>
                <p className="mt-3 text-sm text-plug-muted">
                  Manage store branches, physical addresses, and multi-location card-sharing policies.
                </p>
              </Link>
            </div>
          </section>
        )}
      </div>
    </StaffPageShell>
  );
}
