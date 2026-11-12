'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { OdysseyLogo } from '@/components/brand/OdysseyLogo';
import { COLORS, MIN_HEIGHT_PX } from '@/lib/brand/odyssey/brandTokens';
import { colourwayForBackground } from '@/lib/brand/odyssey/contrast';
import { PLATFORM_CONFIG } from '@/lib/config';
import { ROUTES, type PlatformAdminSession } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const HEADER_LOGO = colourwayForBackground(COLORS.navy).colourway;

export interface PlatformShellProps {
  admin: PlatformAdminSession;
  currentPath: string;
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}

export function PlatformShell({
  admin,
  currentPath,
  title,
  description,
  backHref,
  backLabel = 'Back',
  headerActions,
  children,
}: PlatformShellProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push(ROUTES.staff.login);
      router.refresh();
    } catch {
      router.push(ROUTES.staff.login);
    } finally {
      setSigningOut(false);
    }
  }

  const navItems = [
    {
      name: 'Dashboard',
      href: ROUTES.platform.root,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
      active: currentPath === ROUTES.platform.root,
    },
    {
      name: 'Invoices & Billing',
      href: ROUTES.platform.invoices,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
      active: currentPath.startsWith(ROUTES.platform.invoices),
    },
    {
      name: 'Onboard Client',
      href: ROUTES.platform.newTenant,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      ),
      active: currentPath === ROUTES.platform.newTenant,
    },
    {
      name: 'Security & MFA',
      href: ROUTES.platform.mfa,
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      active: currentPath === ROUTES.platform.mfa,
    },
  ];

  return (
    <div className="flex min-h-dvh bg-plug-black font-sans text-white">
      {/* Mobile drawer backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-plug-border bg-[#0E0E10] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Lockup */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-plug-border/80 px-5">
          <Link
            href={ROUTES.platform.root}
            className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-odyssey-navy p-1">
              <OdysseyLogo
                layout="monogram"
                colourway={HEADER_LOGO}
                height={MIN_HEIGHT_PX.monogram}
                accessibilityLabel={`${PLATFORM_CONFIG.shortName} logo`}
              />
            </div>
            <div>
              <span className="block font-display text-sm font-bold uppercase tracking-wider text-white">
                ODC Platform
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-odyssey-orange">
                Super Admin
              </span>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1 text-plug-muted hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Section */}
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-plug-muted/70">
            Navigation
          </p>
          <nav className="space-y-1" aria-label="Super admin navigation">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs font-semibold tracking-wide transition-all ${
                  item.active
                    ? 'border border-white/20 bg-plug-elevated text-white shadow-sm'
                    : 'text-plug-muted hover:bg-plug-surface hover:text-white'
                }`}
              >
                <span className={item.active ? 'text-odyssey-orange' : 'text-plug-muted'}>
                  {item.icon}
                </span>
                <span>{item.name}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* User Identity & Logout at bottom */}
        <div className="shrink-0 border-t border-plug-border/80 p-3.5">
          <div className="mb-3 rounded-xl border border-plug-border bg-plug-surface p-3">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-xs font-medium text-neutral-200" title={admin.email ?? admin.userId}>
                {admin.email ?? admin.userId}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                MFA AAL2 Active
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex w-full min-h-10 items-center justify-center gap-2 rounded-xl border border-plug-border/80 bg-plug-elevated/80 px-3 py-2 text-xs font-bold uppercase tracking-wider text-rose-300 transition-colors hover:border-rose-900/60 hover:bg-rose-950/40 hover:text-rose-200 disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>{signingOut ? 'Signing Out...' : 'Logout'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Pane */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        {/* Mobile Header Bar */}
        <header className="flex h-16 items-center justify-between border-b border-plug-border bg-[#0E0E10] px-4 lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-plug-border p-2 text-plug-muted hover:text-white"
              aria-label="Open sidebar"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="3" y1="12" x2="21" y2="12" strokeWidth="2" strokeLinecap="round" />
                <line x1="3" y1="6" x2="21" y2="6" strokeWidth="2" strokeLinecap="round" />
                <line x1="3" y1="18" x2="21" y2="18" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <span className="font-display text-sm font-bold uppercase tracking-wider text-white">
              ODC Platform
            </span>
          </div>

          <span className="inline-flex items-center rounded border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            AAL2
          </span>
        </header>

        {/* Page Inner Container */}
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-7xl">
            {backHref && (
              <Link
                href={backHref}
                className="-ml-2 mb-4 inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold uppercase tracking-wider text-plug-muted transition-colors hover:text-white"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 3 5 8l5 5" />
                </svg>
                {backLabel}
              </Link>
            )}

            {/* Header / Actions section */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-plug-muted">
                  Platform Overview
                </p>
                <h1 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {title}
                </h1>
                {description && <p className="mt-1 text-xs text-plug-muted sm:text-sm">{description}</p>}
              </div>

              {headerActions && <div className="flex flex-wrap items-center gap-3">{headerActions}</div>}
            </div>

            {/* Children content */}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
