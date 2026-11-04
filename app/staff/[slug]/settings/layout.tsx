import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConsoleTabNav } from '@/components/console/ConsoleTabNav';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { ROUTES } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

interface SettingsLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function SettingsLayout({
  children,
  params,
}: SettingsLayoutProps) {
  const { slug } = await params;
  const { staff } = await enforceConsolePageAccess(slug, 'staff');

  return (
    <div className="min-h-dvh bg-plug-black text-white">
      {/* Top flat console header */}
      <header className="border-b border-plug-border bg-plug-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href={ROUTES.staff.root}
              className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-400 transition-colors hover:text-white"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10 3 5 8l5 5" />
              </svg>
              Overview
            </Link>
            <span className="text-neutral-600">/</span>
            <div>
              <span className="font-display text-lg font-bold uppercase tracking-wider text-white">
                {staff.tenantName}
              </span>
              <span className="ml-2 rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs font-medium uppercase text-neutral-300">
                {staff.role}
              </span>
            </div>
          </div>

          <div className="text-xs text-neutral-400">
            Console Shell: <span className="font-mono text-white">{slug}</span>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <ConsoleTabNav slug={slug} />
        </div>
      </header>

      {/* Main settings body */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
