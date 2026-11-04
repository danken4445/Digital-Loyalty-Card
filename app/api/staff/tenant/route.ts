import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaffSession } from '@/lib/auth/staff';
import {
  STAFF_TENANT_COOKIE_NAME,
  type ApiResponse,
  type StaffSwitchTenantResponse,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';

const STAFF_TENANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

type SwitchResponse = ApiResponse<StaffSwitchTenantResponse>;

export async function POST(request: Request): Promise<NextResponse<SwitchResponse>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<SwitchResponse>(
      { ok: false, error: 'forbidden', message: 'Cross-origin request blocked.' },
      { status: 403 },
    );
  }

  try {
    const auth = await requireStaffSession();
    if (!auth.authorized) {
      return NextResponse.json<SwitchResponse>(
        {
          ok: false,
          error: auth.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
          message:
            auth.reason === 'unauthenticated'
              ? 'Staff authentication required.'
              : 'Forbidden. Active staff credentials required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403 },
      );
    }

    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tenant',
      ip: getClientIp(request),
      customerId: auth.staff.userId,
    });
    if (!rl.allowed) {
      return NextResponse.json<SwitchResponse>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many shop changes. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = null;
    }
    const parsed = switchTenantSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json<SwitchResponse>(
        { ok: false, error: 'invalid_input', message: 'A valid tenantId is required.' },
        { status: 400 },
      );
    }

    const target = auth.staff.memberships.find(
      (membership) => membership.tenantId === parsed.data.tenantId,
    );
    if (!target) {
      return NextResponse.json<SwitchResponse>(
        { ok: false, error: 'forbidden', message: 'You are not a member of that shop.' },
        { status: 403 },
      );
    }

    const response = NextResponse.json<SwitchResponse>({
      ok: true,
      data: { tenantId: target.tenantId, tenantSlug: target.tenantSlug },
    });
    response.cookies.set(STAFF_TENANT_COOKIE_NAME, target.tenantId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: STAFF_TENANT_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json<SwitchResponse>(
      { ok: false, error: 'internal_error', message: 'Unable to switch shop right now.' },
      { status: 500 },
    );
  }
}
