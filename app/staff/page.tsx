import Link from 'next/link';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

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

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.root}
      title="Operations Console"
      headerLabel="Portal Overview Header"
      description={`Signed in as ${staff.displayName}. Redeeming rewards is the everyday job; the other tools are for when something needs fixing.`}
    >
      <section aria-label="Staff Operations Modules" className="space-y-4">
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
              Scan the customer&apos;s reward QR code and give them their free coffee.
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
    </StaffPageShell>
  );
}
