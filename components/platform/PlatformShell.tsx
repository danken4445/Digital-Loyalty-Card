import Link from 'next/link';
import type { ReactNode } from 'react';
import { ROUTES, type PlatformAdminSession } from '@/lib/contracts';

export interface PlatformShellProps {
  admin: PlatformAdminSession;
  currentPath: string;
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}

export function PlatformShell({
  admin,
  currentPath,
  title,
  description,
  backHref,
  backLabel = 'Back',
  children,
}: PlatformShellProps) {
  const isRoot = currentPath === ROUTES.platform.root;

  return (
    <div className="min-h-dvh bg-plug-black text-white">
      {/* Top flat navigation bar */}
      <header className="border-b border-plug-border bg-plug-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link
              href={ROUTES.platform.root}
              className="font-display text-xl font-bold uppercase tracking-wider text-white transition-colors hover:text-neutral-300"
            >
              Platform Ops
            </Link>
            <nav className="hidden items-center gap-4 sm:flex" aria-label="Platform navigation">
              <Link
                href={ROUTES.platform.root}
                className={`text-sm font-medium transition-colors ${
                  isRoot ? 'text-white' : 'text-plug-muted hover:text-white'
                }`}
              >
                Tenants
              </Link>
              <Link
                href={ROUTES.platform.newTenant}
                className={`text-sm font-medium transition-colors ${
                  currentPath === ROUTES.platform.newTenant
                    ? 'text-white'
                    : 'text-plug-muted hover:text-white'
                }`}
              >
                + New Tenant
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center rounded border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-xs font-medium text-emerald-400"
              aria-label="Security status AAL2 MFA verified"
            >
              MFA AAL2 Active
            </span>
            <span className="hidden text-xs text-plug-muted sm:inline-block">
              {admin.email ?? admin.userId}
            </span>
          </div>
        </div>
      </header>

      {/* Main page content */}
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <div className="mb-8">
          {backHref && (
            <Link
              href={backHref}
              className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-plug-muted transition-colors hover:text-white"
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
              {backLabel}
            </Link>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white sm:text-4xl">
                {title}
              </h1>
              {description && <p className="mt-1 text-sm text-plug-muted">{description}</p>}
            </div>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
