import Link from 'next/link';
import { StaffNav } from '@/components/staff/StaffNav';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffOverviewPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.root);

  const actionCards = [
    {
      index: '01',
      title: 'Redeem Reward',
      href: ROUTES.staff.redeem,
      description:
        "Verify a customer's 5-minute signed QR token and deduct 10 stamps for a free coffee.",
      badge: 'Redemption Engine',
    },
    {
      index: '02',
      title: 'Manual Stamp',
      href: ROUTES.staff.manualStamp,
      description:
        "Award a manual stamp with a mandatory audit reason when a customer's phone cannot tap NFC.",
      badge: 'Customer Support',
    },
    {
      index: '03',
      title: 'NFC Tag Manager',
      href: ROUTES.staff.tags,
      description:
        'Provision new random NTAG215 tag IDs, copy URLs for NFC Tools, or rotate/deactivate compromised tags.',
      badge: 'Hardware & Tags',
    },
    {
      index: '04',
      title: 'Activity & Audit Log',
      href: ROUTES.staff.activity,
      description:
        'Inspect the last 50 stamps, redemptions, anomaly flags, and immutable audit trail.',
      badge: 'Security & Audit',
    },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <StaffNav staff={staff} currentPath={ROUTES.staff.root} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Header */}
        <section
          className="mb-8 border-b border-[#27272A] pb-6"
          aria-label="Portal Overview Header"
        >
          <p className="font-mono text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
            THE CAFFEINE PLUG // DISPATCH
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight uppercase sm:text-4xl">
            Operations Console
          </h1>
          <p className="mt-2 text-sm text-[#A1A1AA]">
            Select an operational module below to verify customer rewards, award manual loyalty
            stamps, manage counter NFC tags, or inspect security audit logs.
          </p>
        </section>

        {/* Action Grid */}
        <section aria-label="Staff Operations Modules">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {actionCards.map((card) => (
              <Link
                key={card.index}
                href={card.href}
                className="group flex flex-col justify-between rounded-lg border border-[#27272A] bg-[#121214] p-6 transition-all duration-150 hover:border-white hover:bg-[#1C1C1F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold tracking-wider text-[#A1A1AA]">
                      [ {card.index} ]
                    </span>
                    <span className="rounded bg-[#0A0A0A] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#A1A1AA] uppercase border border-[#27272A]">
                      {card.badge}
                    </span>
                  </div>
                  <h2 className="mt-4 text-xl font-black tracking-tight text-white uppercase group-hover:text-white">
                    {card.title}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-[#A1A1AA]">{card.description}</p>
                </div>

                <div className="mt-6 flex items-center gap-1 font-mono text-xs font-bold tracking-wider text-white uppercase">
                  <span>Enter Module</span>
                  <span className="transition-transform duration-150 group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
