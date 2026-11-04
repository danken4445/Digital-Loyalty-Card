import { enforceConsolePageAccess } from '@/lib/console/guard';

export const dynamic = 'force-dynamic';

interface ExportSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ExportSettingsPage({ params }: ExportSettingsPageProps) {
  const { slug } = await params;
  await enforceConsolePageAccess(slug, 'manager');

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h2 className="font-display text-xl font-bold uppercase tracking-wider text-white">
          Data Export (CSV)
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          Download shop customer cards and stamping records in RFC 4180 compliant CSV format.
        </p>
      </div>

      <div className="border border-neutral-800 bg-neutral-900/60 p-5 space-y-4">
        <div className="flex items-start gap-3 border-b border-neutral-800 pb-4">
          <div className="rounded border border-amber-800/80 bg-amber-950/40 p-2 text-amber-400">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div className="text-xs">
            <h3 className="font-bold uppercase tracking-wider text-neutral-200">
              Privacy & Compliance (RA 10173)
            </h3>
            <p className="mt-1 text-neutral-400 leading-relaxed">
              In accordance with Philippines Data Privacy laws, all exports contain pseudonymous IDs and activity counts only. Customer emails and phone numbers are strictly omitted. Formula injection characters are neutralized.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
          {/* Export Cards */}
          <div className="border border-neutral-800 bg-black p-4 flex flex-col justify-between">
            <div className="space-y-1">
              <span className="font-display text-sm font-bold uppercase tracking-wider text-white">
                Customer Cards Export
              </span>
              <p className="text-xs text-neutral-400">
                Includes pseudonymous card IDs, join timestamps, branch, total stamps earned, and available stamps.
              </p>
            </div>
            <div className="pt-4">
              <a
                href={`/api/staff/${encodeURIComponent(slug)}/export?kind=cards`}
                download
                className="inline-flex w-full items-center justify-center border border-amber-500 bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-amber-400"
              >
                Download Cards CSV
              </a>
            </div>
          </div>

          {/* Export Stamps */}
          <div className="border border-neutral-800 bg-black p-4 flex flex-col justify-between">
            <div className="space-y-1">
              <span className="font-display text-sm font-bold uppercase tracking-wider text-white">
                Stamps History Export
              </span>
              <p className="text-xs text-neutral-400">
                Full chronological ledger of stamps, tap timestamps, NFC tag IDs, branch locations, and reasons.
              </p>
            </div>
            <div className="pt-4">
              <a
                href={`/api/staff/${encodeURIComponent(slug)}/export?kind=stamps`}
                download
                className="inline-flex w-full items-center justify-center border border-neutral-700 bg-neutral-800 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-neutral-700"
              >
                Download Stamps CSV
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
