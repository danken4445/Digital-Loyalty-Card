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
      title="Add a stamp by hand"
      headerLabel="Manual Stamp Header"
      description="Use this when a customer's phone won't read the tap card. You'll be asked for a short reason so the owner can see why."
    >
      <section aria-label="Manual Stamp Form Section">
        <ManualStampForm />
      </section>
    </StaffPageShell>
  );
}
