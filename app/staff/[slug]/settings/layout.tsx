import type { ReactNode } from 'react';
import { StaffNav } from '@/components/staff/StaffNav';
import { enforceConsolePageAccess } from '@/lib/console/guard';

export const dynamic = 'force-dynamic';

interface SettingsLayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Shop management pages share the same top navigation as the counter screens, so owners never
 * feel they have "left the app" when they change a setting.
 */
export default async function SettingsLayout({ children, params }: SettingsLayoutProps) {
  const { slug } = await params;
  const { staff } = await enforceConsolePageAccess(slug, 'staff');

  return (
    <div className="min-h-dvh bg-plug-black text-white">
      <StaffNav staff={staff} />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}
