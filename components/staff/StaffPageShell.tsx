import type { ReactNode } from 'react';
import { StaffNav } from '@/components/staff/StaffNav';
import type { StaffSession } from '@/lib/contracts';

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
 * Shared frame for every signed-in staff screen: nav bar and a plain page title.
 * Home is always one tap away in the nav, so pages don't need their own back link.
 */
export function StaffPageShell({
  staff,
  currentPath,
  title,
  description,
  headerLabel,
  children,
}: StaffPageShellProps) {
  return (
    <div className="min-h-dvh bg-plug-black text-white">
      <StaffNav staff={staff} currentPath={currentPath} />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        <section aria-label={headerLabel} className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1.5 max-w-prose text-base leading-relaxed text-neutral-300">
            {description}
          </p>
        </section>

        {children}
      </main>
    </div>
  );
}
