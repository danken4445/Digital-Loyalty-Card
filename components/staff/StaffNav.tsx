'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PLATFORM_CONFIG } from '@/lib/config';
import { BILLING_VIEWER_ROLES, ROUTES, type StaffRole, type StaffSession } from '@/lib/contracts';
import { StaffTenantSwitcher } from '@/components/staff/StaffTenantSwitcher';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface StaffNavProps {
  staff: StaffSession;
  currentPath?: string;
}

interface NavItem {
  name: string;
  href: string;
  /** Roles that see this tab; omitted = everyone */
  roles?: readonly StaffRole[];
}

export function StaffNav({ staff, currentPath }: StaffNavProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const navItems: readonly NavItem[] = [
    { name: 'Overview', href: ROUTES.staff.root },
    { name: 'Redeem Reward', href: ROUTES.staff.redeem },
    { name: 'Manual Stamp', href: ROUTES.staff.manualStamp },
    { name: 'NFC Tags', href: ROUTES.staff.tags },
    { name: 'Activity & Audit', href: ROUTES.staff.activity },
    {
      name: 'Shop Settings',
      href: ROUTES.staff.settings(staff.tenantSlug),
      roles: ['owner', 'manager'],
    },
    { name: 'Plan & Billing', href: ROUTES.staff.billing, roles: BILLING_VIEWER_ROLES },
  ];

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push(ROUTES.staff.login);
      router.refresh();
    } catch {
      router.push(ROUTES.staff.login);
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    // Sticky so the module tabs stay in reach while scrolling long tables at the counter
    <header className="sticky top-0 z-20 w-full border-b border-plug-border bg-plug-black/90 text-white backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Link
          href={ROUTES.staff.root}
          className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg"
        >
          <Image
            src={PLATFORM_CONFIG.assets.monogramReverse}
            alt=""
            width={52}
            height={25}
            className="h-auto w-[52px] shrink-0"
          />
          <span className="truncate font-display text-lg font-bold uppercase leading-none tracking-wide">
            {staff.tenantName} <span className="hidden text-plug-muted sm:inline">STAFF OPS</span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          {staff.memberships.length > 1 ? (
            <StaffTenantSwitcher memberships={staff.memberships} activeTenantId={staff.tenantId} />
          ) : null}
          <div
            className="hidden items-center gap-2 text-sm sm:flex"
            aria-label={`Logged in as ${staff.displayName}, ${staff.role}`}
          >
            <span className="font-medium text-white">{staff.displayName}</span>
            <span className="rounded-full border border-plug-border px-2 py-0.5 text-xs font-semibold text-plug-muted">
              {staff.role.toUpperCase()}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            aria-busy={isSigningOut}
            className="inline-flex min-h-11 items-center rounded-xl border border-plug-border px-3 text-sm font-medium text-neutral-300 transition-colors hover:border-white hover:text-white disabled:opacity-50"
          >
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
      </div>

      <nav aria-label="Staff Portal Navigation" className="mx-auto max-w-5xl px-2 sm:px-4">
        {/* Scrolls sideways on narrow phones instead of wrapping to a second row */}
        <ul className="flex items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.filter((item) => !item.roles || item.roles.includes(staff.role)).map(
            (item) => {
              const isSettingsTab = item.href.includes('/settings');
              const isActive = isSettingsTab
                ? Boolean(currentPath?.startsWith(`/staff/${staff.tenantSlug}/settings`))
                : currentPath === item.href;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors ${isActive
                        ? 'bg-white text-plug-black'
                        : 'text-plug-muted hover:bg-plug-elevated hover:text-white'
                      }`}
                  >
                    {item.name}
                  </Link>
                </li>
              );
            },
          )}
        </ul>
      </nav>
    </header>
  );
}
