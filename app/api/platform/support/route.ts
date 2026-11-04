import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import type { ApiErrorCode, ApiResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const supportActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    slug: z.string().trim().min(1, 'Tenant slug is required.'),
    reason: z.string().trim().min(10, 'Support session reason must be at least 10 characters.'),
    // Allow any extra fields in body (like rogue tenantId), but do not use them
    tenantId: z.unknown().optional(),
  }),
  z.object({
    action: z.literal('end'),
    sessionId: z.string().uuid('Invalid session ID format.'),
  }),
  z.object({
    action: z.literal('overview'),
    sessionId: z.string().uuid('Invalid session ID format.'),
  }),
  z.object({
    action: z.literal('activity'),
    sessionId: z.string().uuid('Invalid session ID format.'),
    limit: z.number().int().min(1).max(100).optional(),
  }),
]);

interface TenantLookupRow {
  id: string;
  slug: string;
  name: string;
}

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<Record<string, unknown>>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<Record<string, unknown>>>(
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
      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
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
      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
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
      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Malformed request JSON.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = supportActionSchema.safeParse(bodyJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
        {
          ok: false,
          error: 'invalid_input',
          message: issue?.message ?? 'Invalid request parameters.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const adminClient = createSupabaseAdminClient();

    if (parsed.data.action === 'start') {
      const { slug, reason } = parsed.data;

      // Invariant: Tenant always comes from the database via slug lookup, NEVER from request body
      const supabase = await createSupabaseServerClient();
      const { data: rawTenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id, slug, name')
        .eq('slug', slug)
        .maybeSingle();

      const tenant = rawTenant as unknown as TenantLookupRow | null;

      if (tenantError || !tenant) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Tenant not found.',
          },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      const { data: startData, error: startError } = await adminClient.rpc('start_support_session', {
        p_admin: auth.admin.userId,
        p_tenant: tenant.id,
        p_reason: reason,
      });

      if (startError || !startData) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'internal_error',
            message: startError?.message ?? 'Failed to start support session.',
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      const resObj = startData as unknown as {
        result: string;
        sessionId?: string;
        expiresAt?: string;
      };

      if (resObj.result === 'started' && resObj.sessionId) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: true,
            data: {
              result: 'started',
              sessionId: resObj.sessionId,
              expiresAt: resObj.expiresAt,
              tenantId: tenant.id,
              slug: tenant.slug,
            },
          },
          { status: 201, headers: NO_STORE_HEADERS },
        );
      }

      const statusMap: Record<string, number> = {
        'invalid-reason': 400,
        'not-found': 404,
        unauthorized: 403,
      };

      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
        {
          ok: false,
          error: (resObj.result === 'unauthorized' ? 'forbidden' : 'invalid_input') as ApiErrorCode,
          message: `Support session start failed: ${resObj.result}`,
        },
        { status: statusMap[resObj.result] ?? 400, headers: NO_STORE_HEADERS },
      );
    }

    if (parsed.data.action === 'end') {
      const { sessionId } = parsed.data;
      const { data: endResult, error: endError } = await adminClient.rpc('end_support_session', {
        p_admin: auth.admin.userId,
        p_session: sessionId,
      });

      if (endError || !endResult) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'internal_error',
            message: endError?.message ?? 'Failed to end support session.',
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      if (endResult === 'ended') {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: true,
            data: {
              sessionId,
              status: 'ended',
            },
          },
          { status: 200, headers: NO_STORE_HEADERS },
        );
      }

      const statusMap: Record<string, number> = {
        'not-found': 404,
        unauthorized: 403,
      };

      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
        {
          ok: false,
          error: (endResult === 'unauthorized' ? 'forbidden' : 'invalid_input') as ApiErrorCode,
          message: `Failed to end support session: ${endResult}`,
        },
        { status: statusMap[endResult] ?? 400, headers: NO_STORE_HEADERS },
      );
    }

    if (parsed.data.action === 'overview') {
      const { sessionId } = parsed.data;
      const { data: overviewData, error: overviewError } = await adminClient.rpc(
        'support_get_tenant_overview',
        {
          p_admin: auth.admin.userId,
          p_session: sessionId,
        },
      );

      if (overviewError || !overviewData) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'internal_error',
            message: overviewError?.message ?? 'Failed to retrieve support overview.',
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      const overviewObj = overviewData as Record<string, unknown>;
      if (overviewObj.result === 'unauthorized') {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'forbidden',
            message: 'Support session is expired, ended, or unauthorized.',
          },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
        {
          ok: true,
          data: overviewObj,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    if (parsed.data.action === 'activity') {
      const { sessionId, limit } = parsed.data;
      const { data: activityData, error: activityError } = await adminClient.rpc(
        'support_list_recent_activity',
        {
          p_admin: auth.admin.userId,
          p_session: sessionId,
          p_limit: limit ?? 50,
        },
      );

      if (activityError || !activityData) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'internal_error',
            message: activityError?.message ?? 'Failed to retrieve support activity.',
          },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }

      if (
        typeof activityData === 'object' &&
        activityData !== null &&
        'result' in activityData &&
        (activityData as Record<string, unknown>).result === 'unauthorized'
      ) {
        return NextResponse.json<ApiResponse<Record<string, unknown>>>(
          {
            ok: false,
            error: 'forbidden',
            message: 'Support session is expired, ended, or unauthorized.',
          },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json<ApiResponse<Record<string, unknown>>>(
        {
          ok: true,
          data: {
            activity: activityData,
          },
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json<ApiResponse<Record<string, unknown>>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Unsupported action.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<Record<string, unknown>>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
