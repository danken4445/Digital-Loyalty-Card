import { redirect } from 'next/navigation';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';
import { ROUTES } from '@/lib/contracts';
import { getVerifiedUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Set-a-new-password screen. Only reachable with a real (non-anonymous) session, which a
 * verified recovery link establishes via /auth/callback or the hash handler.
 */
export default async function ResetPasswordPage() {
  const user = await getVerifiedUser();
  if (!user || user.is_anonymous) {
    redirect(
      `${ROUTES.staff.login}?error=${encodeURIComponent('This reset link is invalid or has expired. Request a new one.')}`,
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-odyssey-navy px-4 py-12 text-white">
      <ResetPasswordForm email={user.email ?? ''} />
    </main>
  );
}
