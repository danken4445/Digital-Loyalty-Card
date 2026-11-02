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
      description="Scan the customer's QR code and check the 8-character code matches their phone. A free coffee QR uses 10 stamps; an Instagram upsize QR is a one-time perk that uses none — check they follow us first."
    >
      <section aria-label="Customer Redemption Action">
        <RedeemRewardForm />
      </section>
    </StaffPageShell>
  );
}
