import { StaffNav } from '@/components/staff/StaffNav';
import { ManualStampForm } from '@/components/staff/ManualStampForm';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffManualStampPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.manualStamp);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <StaffNav staff={staff} currentPath={ROUTES.staff.manualStamp} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="mb-8 border-b border-[#27272A] pb-6" aria-label="Manual Stamp Header">
          <p className="font-mono text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
            OPERATIONS // MODULE 02
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight uppercase sm:text-4xl">
            Manual Stamp
          </h1>
          <p className="mt-2 text-sm text-[#A1A1AA]">
            Manually credit a loyalty stamp to a customer whose device cannot interact with NFC
            tags. A mandatory audit reason is required and preserved.
          </p>
        </section>

        <section aria-label="Manual Stamp Form Section">
          <ManualStampForm />
        </section>
      </main>
    </div>
  );
}
