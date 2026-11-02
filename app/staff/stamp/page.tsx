import { ManualStampForm } from '@/components/staff/ManualStampForm';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffManualStampPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.manualStamp);

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.manualStamp}
      title="Manual Stamp"
      headerLabel="Manual Stamp Header"
      description="Add a stamp by hand when a customer's phone can't read the NFC card. Every manual stamp needs a reason and is saved to the audit log."
    >
      <section aria-label="Manual Stamp Form Section">
        <ManualStampForm />
      </section>
    </StaffPageShell>
  );
}
