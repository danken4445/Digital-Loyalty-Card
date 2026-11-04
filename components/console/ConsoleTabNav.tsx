'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface ConsoleTab {
  name: string;
  href: string;
}

export function ConsoleTabNav({ slug }: { slug: string }) {
  const pathname = usePathname();

  const tabs: readonly ConsoleTab[] = [
    { name: 'Rules', href: `/staff/${slug}/settings` },
    { name: 'Brand', href: `/staff/${slug}/settings/brand` },
    { name: 'Staff', href: `/staff/${slug}/settings/staff` },
    { name: 'Tags', href: `/staff/${slug}/settings/tags` },
    { name: 'Export', href: `/staff/${slug}/settings/export` },
    { name: 'Branches', href: `/staff/${slug}/settings/locations` },
  ];

  return (
    <nav
      className="flex space-x-1 overflow-x-auto border-b border-plug-border"
      aria-label="Console navigation"
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.name}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'border-white text-white'
                : 'border-transparent text-neutral-400 hover:border-neutral-500 hover:text-white'
            }`}
          >
            {tab.name}
          </Link>
        );
      })}
    </nav>
  );
}
