import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { PlatformMfaPanel } from '@/components/platform/PlatformMfaPanel';
import { ROUTES } from '@/lib/contracts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export function resolveSafeMfaDestination(nextParam?: string | null): string {
  return nextParam &&
    nextParam.startsWith('/') &&
    !nextParam.startsWith('//') &&
    !nextParam.startsWith('/\\')
    ? nextParam
    : ROUTES.platform.root;
}

interface MfaPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function PlatformMfaPage({ searchParams }: MfaPageProps) {
  const { next: nextParam } = await searchParams;
  const safeNext = resolveSafeMfaDestination(nextParam);

  const user = await getVerifiedUser();
  if (!user || user.is_anonymous) {
    redirect(`${ROUTES.staff.login}?next=${encodeURIComponent(ROUTES.platform.mfa)}`);
  }

  const adminClient = createSupabaseAdminClient();
  const { data: isAdmin, error: adminError } = await adminClient.rpc('is_platform_admin_user', {
    p_user: user.id,
  });

  if (adminError || !isAdmin) {
    redirect(`${ROUTES.staff.login}?error=forbidden`);
  }

  // If already at AAL2, redirect straight to sanitized target destination
  const supabase = await createSupabaseServerClient();
  const { data: mfaData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (mfaData?.currentLevel === 'aal2') {
    redirect(safeNext);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-plug-black px-4 py-12 text-white sm:px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <p className="font-display text-2xl font-bold uppercase tracking-wider text-white">
            Platform Ops Security
          </p>
          <p className="mt-1 text-xs text-plug-muted">Multi-Factor Authentication Gate</p>
        </div>

        <Suspense
          fallback={
            <div className="rounded-2xl border border-plug-border bg-plug-surface p-12 text-center text-sm text-plug-muted">
              Loading MFA security...
            </div>
          }
        >
          <PlatformMfaPanel />
        </Suspense>
      </div>
    </div>
  );
}
