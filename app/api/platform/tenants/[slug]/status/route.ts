import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import type { ApiErrorCode, ApiResponse, TenantStatus } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const statusUpdateSchema = z.object({
  status: z.enum(['trial', 'active', 'suspended'], {
    errorMap: () => ({ message: 'Status must be trial, active, or suspended.' }),
  }),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters.'),
});

interface RouteParams {
  params: Promise<{ slug: string }>;
}

interface TenantLookupRow {
  id: string;
  slug: string;
  status: string;
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<{ status: TenantStatus }>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const auth = await requirePlatformAdmin();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
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

    const { slug } = await params;
    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tenant',
      ip,
      customerId: auth.admin.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many requests. Please wait a moment.',
        },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }

    let bodyJson: unknown;
    try {
      bodyJson = await request.json();
    } catch {
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Malformed request JSON.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = statusUpdateSchema.safeParse(bodyJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
        {
          ok: false,
          error: 'invalid-reason' as unknown as ApiErrorCode,
          message: issue?.message ?? 'Invalid parameters.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { status, reason } = parsed.data;

    // Look up tenant strictly in database by slug
    const supabase = await createSupabaseServerClient();
    const { data: rawTenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, slug, status')
      .eq('slug', slug)
      .maybeSingle();

    const tenant = rawTenant as unknown as TenantLookupRow | null;

    if (tenantError || !tenant) {
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Tenant not found.',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const adminClient = createSupabaseAdminClient();
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('set_tenant_status', {
      p_actor: auth.admin.userId,
      p_tenant: tenant.id,
      p_status: status,
      p_reason: reason,
    });

    if (rpcError || !rpcResult) {
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
        {
          ok: false,
          error: 'internal_error',
          message: rpcError?.message ?? 'Failed to update tenant status.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'updated') {
      return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
        {
          ok: true,
          data: { status },
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    const statusMap: Record<string, number> = {
      'invalid-reason': 400,
      'invalid-status': 400,
      'not-found': 404,
      unauthorized: 403,
    };

    const statusCode = statusMap[rpcResult] ?? 400;

    return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
      {
        ok: false,
        error: (rpcResult === 'unauthorized' ? 'forbidden' : rpcResult) as unknown as ApiErrorCode,
        message: `Status update failed: ${rpcResult}`,
      },
      { status: statusCode, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<{ status: TenantStatus }>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
