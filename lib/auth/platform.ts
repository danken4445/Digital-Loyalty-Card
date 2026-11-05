import 'server-only';

import { redirect } from 'next/navigation';
import {
  ROUTES,
  type PlatformAdminSession,
  type PlatformAuthResult,
} from '@/lib/contracts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

/**
 * Authoritatively verifies whether the current request is authenticated as an active platform admin
 * with Multi-Factor Authentication (AAL2).
 *
 * 1. Calls getVerifiedUser() (supabase.auth.getUser()) - never getSession().
 * 2. Rejects unauthenticated or anonymous sessions -> reason: 'unauthenticated'.
 * 3. Checks membership in public.platform_admins via the service RPC public.is_platform_admin_user(p_user)
 *    -> reason: 'forbidden' if not a platform admin.
 * 4. Checks MFA authenticator assurance level via supabase.auth.mfa.getAuthenticatorAssuranceLevel()
 *    -> reason: 'mfa-required' if currentLevel !== 'aal2'.
 * 5. Returns { authorized: true, admin: { userId, email } } when all gates pass.
 */
export async function requirePlatformAdmin(): Promise<PlatformAuthResult> {
  const user = await getVerifiedUser();
  if (!user || user.is_anonymous) {
    return {
      authorized: false,
      reason: 'unauthenticated',
    };
  }

  const adminClient = createSupabaseAdminClient();
  const { data: isAdmin, error: adminError } = await adminClient.rpc('is_platform_admin_user', {
    p_user: user.id,
  });

  if (adminError || !isAdmin) {
    return {
      authorized: false,
      reason: 'forbidden',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (mfaError || mfaData?.currentLevel !== 'aal2') {
    return {
      authorized: false,
      reason: 'mfa-required',
    };
  }

  return {
    authorized: true,
    admin: {
      userId: user.id,
      email: user.email ?? null,
    },
  };
}

/**
 * Server Component page guard for /platform/* pages.
 * - Redirects unauthenticated callers to /staff/login?next=...
 * - Redirects non-admin users to /staff/login?error=forbidden
 * - Redirects admins without AAL2 to /platform/mfa?next=...
 */
export async function enforcePlatformPageAccess(
  nextPath: string = ROUTES.platform.root,
): Promise<PlatformAdminSession> {
  const auth = await requirePlatformAdmin();
  if (!auth.authorized) {
    if (auth.reason === 'mfa-required') {
      redirect(`${ROUTES.platform.mfa}?next=${encodeURIComponent(nextPath)}`);
    }
    if (auth.reason === 'forbidden') {
      redirect(`${ROUTES.staff.login}?error=forbidden`);
    }
    redirect(`${ROUTES.staff.login}?next=${encodeURIComponent(nextPath)}`);
  }

  return auth.admin;
}

/**
 * Sanitizes open redirect destinations for MFA gate flows.
 */
export function resolveSafeMfaDestination(nextParam?: string | null): string {
  return nextParam &&
    nextParam.startsWith('/') &&
    !nextParam.startsWith('//') &&
    !nextParam.startsWith('/\\')
    ? nextParam
    : ROUTES.platform.root;
}
