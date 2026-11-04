import Link from 'next/link';
import type { ReactNode } from 'react';
import { StaffNav } from '@/components/staff/StaffNav';
import { ROUTES, type StaffSession } from '@/lib/contracts';

export interface StaffPageShellProps {
  staff: StaffSession;
  currentPath: string;
  title: string;
  description: string;
  /** Accessible name for the page header region */
  headerLabel: string;
  children: ReactNode;
}

/**
 * Shared frame for every signed-in staff screen: nav bar, page title, and a way back to Overview.
 * Keeps headings, spacing and width identical across the staff area.
 */
export function StaffPageShell({
  staff,
  currentPath,
  title,
  description,
  headerLabel,
  children,
}: StaffPageShellProps) {
  const isOverview = currentPath === ROUTES.staff.root;

  return (
    <div className="min-h-dvh bg-plug-black text-white">
      <StaffNav staff={staff} currentPath={currentPath} />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <section aria-label={headerLabel} className="mb-8">
          {!isOverview && (
            <Link
              href={ROUTES.staff.root}
              className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-plug-muted transition-colors hover:text-white"
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
          )}
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-plug-muted">
            {staff.tenantName}
          </p>
          <h1 className="font-display text-4xl font-bold uppercase leading-none tracking-wide sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-neutral-300">
            {description}
          </p>
        </section>

        {children}
      </main>
    </div>
  );
}
