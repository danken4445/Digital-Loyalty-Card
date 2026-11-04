import 'server-only';

import { notFound, redirect } from 'next/navigation';
import {
  ROUTES,
  type StaffRole,
  type StaffSession,
} from '@/lib/contracts';
import { requireStaffSession } from '@/lib/auth/staff';

const ROLE_RANK: Record<StaffRole, number> = {
  owner: 3,
  manager: 2,
  staff: 1,
};

export class ConsoleAccessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number = 403, code: string = 'forbidden') {
    super(message);
    this.name = 'ConsoleAccessError';
    this.status = status;
    this.code = code;
  }
}

export function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { message?: string; digest?: string };
  return (
    anyErr.message === 'NEXT_NOT_FOUND' ||
    (typeof anyErr.digest === 'string' && anyErr.digest.includes('NEXT_NOT_FOUND'))
  );
}

/**
 * Authoritatively verifies whether the current request has console access to a specific tenant slug.
 *
 * 1. Runs requireStaffSession() to verify signed-in staff identity and load active memberships.
 * 2. Resolves membership strictly by slug from the session's memberships (m.tenantSlug === slug).
 * 3. Throws notFound() if user has no membership for that slug (URL strictly governs active shop).
 * 4. Enforces role hierarchy: owner > manager > staff. Throws 403 if role is insufficient.
 * 5. Returns { staff: StaffSession, tenantId: string } with staff's active tenant fields bound to slug.
 */
export async function requireConsoleAccess(
  slug: string,
  minRole: StaffRole = 'staff',
): Promise<{ staff: StaffSession; tenantId: string }> {
  const auth = await requireStaffSession();
  if (!auth.authorized) {
    if (auth.reason === 'unauthenticated') {
      throw new ConsoleAccessError('Unauthorized', 401, 'unauthenticated');
    }
    throw new ConsoleAccessError('Forbidden', 403, 'forbidden');
  }

  const targetMembership = auth.staff.memberships.find((m) => m.tenantSlug === slug);
  if (!targetMembership) {
    notFound();
  }

  if (ROLE_RANK[targetMembership.role] < ROLE_RANK[minRole]) {
    throw new ConsoleAccessError('Forbidden', 403, 'forbidden');
  }

  const staff: StaffSession = {
    ...auth.staff,
    tenantId: targetMembership.tenantId,
    tenantSlug: targetMembership.tenantSlug,
    tenantName: targetMembership.tenantName,
    role: targetMembership.role,
  };

  return {
    staff,
    tenantId: targetMembership.tenantId,
  };
}

/**
 * Server Component page guard for /staff/[slug]/settings/* pages.
 * Redirects unauthenticated users to staff login, 404s for unknown shops, and forbids lower roles.
 */
export async function enforceConsolePageAccess(
  slug: string,
  minRole: StaffRole = 'staff',
  nextPath?: string,
): Promise<{ staff: StaffSession; tenantId: string }> {
  try {
    return await requireConsoleAccess(slug, minRole);
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      if (err.status === 401) {
        redirect(
          `${ROUTES.staff.login}?next=${encodeURIComponent(nextPath ?? ROUTES.staff.settings(slug))}`,
        );
      }
      redirect(`${ROUTES.staff.login}?error=forbidden`);
    }
    throw err;
  }
}
