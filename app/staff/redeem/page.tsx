import { RedeemRewardForm } from '@/components/staff/RedeemRewardForm';
import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';
import { getTenantById } from '@/lib/tenants/context';

export default async function StaffRedeemPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.redeem);
  const settings = (await getTenantById(staff.tenantId))?.settings;

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.redeem}
      title="Redeem Reward"
      headerLabel="Redeem Module Header"
      description="Scan the QR code on the customer's phone, check the short code matches, and hand over their reward."
    >
      <section aria-label="Customer Redemption Action">
        <RedeemRewardForm
          rewardThreshold={settings?.rewardThreshold}
          rewardLabel={settings?.rewardLabel}
          instagramHandle={
            settings?.brand?.socialLinks?.instagram?.url ||
            settings?.perks.instagram_follow_upsize?.handle
          }
          socialRewardLabel={
            settings?.brand?.socialReward || settings?.perks.instagram_follow_upsize?.label
          }
        />
      </section>
    </StaffPageShell>
  );
}
