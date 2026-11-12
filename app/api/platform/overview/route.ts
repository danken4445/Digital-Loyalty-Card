import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import type { ApiErrorCode, ApiResponse, PlatformDashboardOverview } from '@/lib/contracts';
import { loadPlatformDashboardOverview } from '@/lib/platform/dashboard';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export async function GET(
  request: Request,
): Promise<NextResponse<ApiResponse<PlatformDashboardOverview>>> {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<PlatformDashboardOverview>>(
        {
          ok: false,
          error: (auth.reason === 'mfa-required' ? 'forbidden' : auth.reason) as ApiErrorCode,
          message:
            auth.reason === 'mfa-required'
              ? 'Multi-factor authentication (AAL2) required.'
              : auth.reason === 'unauthenticated'
                ? 'Authentication required.'
                : 'Forbidden. Platform admin access required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403, headers: NO_STORE_HEADERS },
      );
    }

    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tenant',
      ip,
      customerId: auth.admin.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<PlatformDashboardOverview>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many requests. Please wait a moment.',
        },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }

    const overview = await loadPlatformDashboardOverview(auth.admin.userId);

    return NextResponse.json<ApiResponse<PlatformDashboardOverview>>(
      {
        ok: true,
        data: overview,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<PlatformDashboardOverview>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
