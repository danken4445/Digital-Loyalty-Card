'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { OdysseyLogo } from '@/components/brand/OdysseyLogo';
import { MIN_HEIGHT_PX } from '@/lib/brand/odyssey/brandTokens';
import { colourwayForBackground } from '@/lib/brand/odyssey/contrast';
import { ROUTES, type StaffRole, type StaffSession } from '@/lib/contracts';
import { StaffTenantSwitcher } from '@/components/staff/StaffTenantSwitcher';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * The nav keeps the shop-side plug styling (plug-black #0A0A0A). On that surface the bible's rules
 * select the single-colour white logo; the reversed (orange) version is approved on Odyssey Navy only.
 */
const NAV_LOGO = colourwayForBackground('#0A0A0A').colourway;

export interface StaffNavProps {
  staff: StaffSession;
  /** Defaults to the browser path; pass explicitly when rendering outside the router (tests). */
  currentPath?: string;
}

export interface NavItem {
  name: string;
  href: string;
  /** Extra paths that also light this item up (sub-pages). */
  alsoActiveOn?: readonly string[];
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

/**
 * One navigation for the whole staff area. Everyone gets the counter jobs; owners and managers get
 * a second, separated group for running the shop. Nothing an employee cannot use is ever shown.
 */
export function buildNavGroups(staff: StaffSession): { counter: NavItem[]; manage: NavItem[] } {
  const slug = staff.tenantSlug;
  const counter: NavItem[] = [
    { name: 'Home', href: ROUTES.staff.root },
    { name: 'Redeem', href: ROUTES.staff.redeem },
    { name: 'Add stamp', href: ROUTES.staff.manualStamp },
    { name: 'Activity', href: ROUTES.staff.activity },
  ];

  if (staff.role === 'staff') {
    return { counter, manage: [] };
  }

  const manage: NavItem[] = [
    {
      name: 'My Card',
      href: ROUTES.staff.settings(slug),
      alsoActiveOn: [ROUTES.staff.cardLook(slug), ROUTES.staff.setup(slug)],
    },
    { name: 'Tap Cards', href: ROUTES.staff.tapCards(slug), alsoActiveOn: [ROUTES.staff.tags] },
    { name: 'Team', href: ROUTES.staff.team(slug) },
    staff.role === 'owner'
      ? { name: 'Insights', href: ROUTES.staff.analytics(slug) }
      : { name: 'Reports', href: ROUTES.staff.exportData(slug) },
    {
      name: 'More',
      href: ROUTES.staff.more(slug),
      alsoActiveOn: [
        ROUTES.staff.branches(slug),
        ROUTES.staff.billing,
        ...(staff.role === 'owner' ? [ROUTES.staff.exportData(slug)] : []),
      ],
    },
  ];

  return { counter, manage };
}

export function isNavItemActive(item: NavItem, path: string | null | undefined): boolean {
  if (!path) return false;
  return path === item.href || Boolean(item.alsoActiveOn?.includes(path));
}

export function StaffNav({ staff, currentPath }: StaffNavProps) {
  const router = useRouter();
  const browserPath = usePathname();
  const path = currentPath ?? browserPath;
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { counter, manage } = buildNavGroups(staff);

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

  function renderItem(item: NavItem) {
    const isActive = isNavItemActive(item, path);
    return (
      <li key={item.href} className="shrink-0">
        <Link
          href={item.href}
          aria-current={isActive ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-white text-plug-black'
              : 'text-plug-muted hover:bg-plug-elevated hover:text-white'
          }`}
        >
          {item.name}
        </Link>
      </li>
    );
  }

  return (
    // Sticky so the tabs stay in reach while scrolling long tables at the counter
    <header className="sticky top-0 z-20 w-full border-b border-plug-border bg-plug-black/90 text-white backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <Link
          href={ROUTES.staff.root}
          className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg"
        >
          <OdysseyLogo
            layout="monogram"
            colourway={NAV_LOGO}
            height={MIN_HEIGHT_PX.monogram}
            accessibilityLabel="ODYSSEY"
            className="shrink-0"
          />
          <span className="truncate text-lg font-bold leading-none tracking-tight">
            {staff.tenantName}
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
              {ROLE_LABELS[staff.role]}
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
          {counter.map(renderItem)}
          {manage.length > 0 && (
            <li aria-hidden="true" className="mx-2 h-6 w-px shrink-0 bg-plug-border" />
          )}
          {manage.map(renderItem)}
        </ul>
      </nav>
    </header>
  );
}
