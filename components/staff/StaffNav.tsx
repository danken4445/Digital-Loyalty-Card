'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROUTES, type StaffSession } from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface StaffNavProps {
  staff: StaffSession;
  currentPath?: string;
}

interface NavItem {
  name: string;
  href: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { name: 'Overview', href: ROUTES.staff.root },
  { name: 'Redeem Reward', href: ROUTES.staff.redeem },
  { name: 'Manual Stamp', href: ROUTES.staff.manualStamp },
  { name: 'NFC Tags', href: ROUTES.staff.tags },
  { name: 'Activity & Audit', href: ROUTES.staff.activity },
] as const;

export function StaffNav({ staff, currentPath }: StaffNavProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

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
    <header className="w-full border-b border-[#27272A] bg-[#0A0A0A] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {/* Brand & Identity */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={ROUTES.staff.root}
            className="text-sm font-black tracking-widest uppercase transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
          >
            THE CAFFEINE PLUG <span className="text-[#A1A1AA]">{'//'}</span> STAFF OPS
          </Link>
          <div
            className="flex items-center gap-2 rounded border border-[#27272A] bg-[#121214] px-2.5 py-1 text-xs"
            aria-label={`Logged in as ${staff.displayName}, ${staff.role}`}
          >
            <span className="font-semibold text-white">{staff.displayName}</span>
            <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-black tracking-wide text-black uppercase">
              {staff.role.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Sign Out Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            aria-busy={isSigningOut}
            className="rounded border border-[#27272A] bg-[#121214] px-3 py-1.5 text-xs font-semibold tracking-wider text-[#A1A1AA] uppercase transition-colors hover:border-white hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
          >
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </button>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="border-t border-[#27272A]/60 bg-[#0A0A0A]">
        <nav
          aria-label="Staff Portal Navigation"
          className="mx-auto flex max-w-7xl overflow-x-auto px-4 sm:px-6"
        >
          <ul className="flex items-center gap-1 py-1.5">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPath === item.href;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-block rounded px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A] ${
                      isActive
                        ? 'bg-white text-black'
                        : 'text-[#A1A1AA] hover:bg-[#121214] hover:text-white'
                    }`}
                  >
                    {item.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
