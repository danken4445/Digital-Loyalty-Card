import { RedeemRewardForm } from '@/components/staff/RedeemRewardForm';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffRedeemPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.redeem);

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.redeem}
      title="Redeem Reward"
      headerLabel="Redeem Module Header"
      description="Scan the customer's reward QR code, check the 8-character code matches their phone, then confirm. This uses 10 stamps for one free coffee."
    >
      <section aria-label="Customer Redemption Action">
        <RedeemRewardForm />
      </section>
    </StaffPageShell>
  );
}
