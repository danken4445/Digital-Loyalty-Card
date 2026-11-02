import { StaffNav } from '@/components/staff/StaffNav';
import { TagManagerClient } from '@/components/staff/TagManagerClient';
import { enforceStaffPageAccess, getStaffTagsList } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffTagsPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.tags);
  const initialTags = await getStaffTagsList();

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <StaffNav staff={staff} currentPath={ROUTES.staff.tags} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section
          className="mb-8 border-b border-[#27272A] pb-6"
          aria-label="NFC Tag Manager Header"
        >
          <p className="font-mono text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
            OPERATIONS // MODULE 03
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight uppercase sm:text-4xl">
            NFC Tag Manager
          </h1>
          <p className="mt-2 text-sm text-[#A1A1AA]">
            Provision, inspect, rotate, and deactivate physical NTAG215 counter tags. Copy tap URLs
            directly to burn onto tags with NFC Tools or NXP TagWriter.
          </p>
        </section>

        <section aria-label="NFC Tag Manager Console">
          <TagManagerClient initialTags={initialTags} />
        </section>
      </main>
    </div>
  );
}
