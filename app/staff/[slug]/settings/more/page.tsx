import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageIntro } from '@/components/console/ui';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { BILLING_VIEWER_ROLES, ROUTES } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

interface MorePageProps {
  params: Promise<{ slug: string }>;
}

/** Things owners need now and then, kept off the main menu so it stays short. */
export default async function MoreSettingsPage({ params }: MorePageProps) {
  const { slug } = await params;
  const { staff } = await enforceConsolePageAccess(slug, 'staff', ROUTES.staff.more(slug));
  if (staff.role === 'staff') {
    redirect(ROUTES.staff.root);
  }
  const isOwner = staff.role === 'owner';

  const items = [
    ...(isOwner
      ? [
          {
            title: 'Shop setup checklist',
            description: 'Go back through the guided setup any time.',
            href: ROUTES.staff.setup(slug),
          },
          {
            title: 'Branches',
            description: 'Have more than one shop? Add each location here.',
            href: ROUTES.staff.branches(slug),
          },
          {
            title: 'Download your data',
            description: 'Customer and stamp lists as spreadsheet files.',
            href: ROUTES.staff.exportData(slug),
          },
        ]
      : []),
    ...((BILLING_VIEWER_ROLES as readonly string[]).includes(staff.role)
      ? [
          {
            title: 'Plan & Billing',
            description: 'Your plan and what you will pay this month.',
            href: ROUTES.staff.billing,
          },
        ]
      : []),
    {
      title: 'Stamp limits',
      description: 'How often customers can collect stamps (in My Card → Reward → Advanced).',
      href: ROUTES.staff.settings(slug),
    },
  ];

  return (
    <div className="space-y-8">
      <PageIntro title="More" description="Everything else, in one place." />
      <ul className="divide-y divide-plug-border overflow-hidden rounded-2xl border border-plug-border bg-plug-surface">
        {items.map((item) => (
          <li key={item.title}>
            <Link
              href={item.href}
              className="group flex min-h-16 items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-plug-elevated"
            >
              <div>
                <h2 className="text-base font-semibold text-white">{item.title}</h2>
                <p className="text-sm text-plug-muted">{item.description}</p>
              </div>
              <span className="text-plug-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
