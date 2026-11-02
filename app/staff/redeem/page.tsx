import { StaffNav } from '@/components/staff/StaffNav';
import { RedeemRewardForm } from '@/components/staff/RedeemRewardForm';
import { enforceStaffPageAccess } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffRedeemPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.redeem);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <StaffNav staff={staff} currentPath={ROUTES.staff.redeem} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <section className="mb-8 border-b border-[#27272A] pb-6" aria-label="Redeem Module Header">
          <p className="font-mono text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
            OPERATIONS // MODULE 01
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight uppercase sm:text-4xl">
            Redeem Reward
          </h1>
          <p className="mt-2 text-sm text-[#A1A1AA]">
            Verify customer QR tokens in real-time, cross-reference the 8-character match code, and
            deduct 10 stamps for a complimentary coffee.
          </p>
        </section>

        <section aria-label="Customer Redemption Action">
          <RedeemRewardForm />
        </section>
      </main>
    </div>
  );
}
