import { redirect } from 'next/navigation';
import { BillingPlanPicker } from '@/components/billing/BillingPlanPicker';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { loadBillingOverview } from '@/lib/billing/overview';
import { BILLING_VIEWER_ROLES, ROUTES } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

export default async function StaffBillingPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.billing);

  if (!(BILLING_VIEWER_ROLES as readonly string[]).includes(staff.role)) {
    redirect(ROUTES.staff.root);
  }

  const { plans, estimate } = await loadBillingOverview(staff.userId, staff.tenantId);

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.billing}
      title="Plan & Billing"
      headerLabel="Plan and Billing Header"
      description="You only pay for customers who actually collect stamps. Pick the plan that feels right for your shop."
    >
      <BillingPlanPicker
        plans={plans}
        estimate={estimate}
        endpoint={ROUTES.api.staff.billing}
        canChoose={staff.role === 'owner'}
      />
    </StaffPageShell>
  );
}
