import { PageIntro, Panel } from '@/components/console/ui';
import { enforceConsolePageAccess } from '@/lib/console/guard';

export const dynamic = 'force-dynamic';

interface ExportSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ExportSettingsPage({ params }: ExportSettingsPageProps) {
  const { slug } = await params;
  await enforceConsolePageAccess(slug, 'manager');
  const base = `/api/staff/${encodeURIComponent(slug)}/export`;

  return (
    <div className="max-w-3xl space-y-8">
      <PageIntro
        title="Download your data"
        description="Spreadsheet files (CSV) you can open in Excel or Google Sheets."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel title="Customer list" description="Every loyalty card: when it was made, which branch, and how many stamps it has.">
          <a
            href={`${base}?kind=cards`}
            download
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-plug-black hover:bg-neutral-200"
          >
            Download customer list
          </a>
        </Panel>
        <Panel title="Stamp history" description="Every stamp given: when, at which tap card and branch, and why (for hand-added stamps).">
          <a
            href={`${base}?kind=stamps`}
            download
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-neutral-600 px-5 text-sm font-semibold text-white hover:border-white"
          >
            Download stamp history
          </a>
        </Panel>
      </div>

      <p className="text-sm leading-relaxed text-plug-muted">
        To protect your customers&apos; privacy (Data Privacy Act, RA 10173), files never include names, emails or phone
        numbers. Each customer is shown by a card code instead.
      </p>
    </div>
  );
}
