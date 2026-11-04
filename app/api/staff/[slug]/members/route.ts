import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConsoleAccess, ConsoleAccessError } from '@/lib/console/guard';
import {
  STAFF_ROLES,
  type ApiErrorCode,
  type ApiResponse,
  type StaffRole,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const memberUpdateSchema = z.union([
  z.object({
    userId: z.string().uuid('Invalid user UUID.'),
    role: z.enum(STAFF_ROLES, {
      errorMap: () => ({ message: 'Role must be owner, manager, or staff.' }),
    }),
  }),
  z.object({
    userId: z.string().uuid('Invalid user UUID.'),
    active: z.boolean(),
  }),
]);

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<string>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { slug } = await params;

  let access;
  try {
    access = await requireConsoleAccess(slug, 'owner');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: (err.status === 401 ? 'unauthenticated' : 'forbidden') as ApiErrorCode,
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Tenant not found.',
      },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const ip = getClientIp(request);
  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'staff-tenant',
    ip,
    customerId: access.staff.userId,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<string>>(
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
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Malformed request JSON.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = memberUpdateSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? 'Invalid member update parameters.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const adminClient = createSupabaseAdminClient();

  if ('role' in parsed.data) {
    const { userId, role } = parsed.data;
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('set_member_role', {
      p_actor: access.staff.userId,
      p_tenant: access.tenantId,
      p_user: userId,
      p_role: role as StaffRole,
    });

    if (rpcError || !rpcResult) {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to update member role.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'last-owner') {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'last-owner' as unknown as ApiErrorCode,
          message: 'Cannot demote the last active owner of this shop.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'unauthorized') {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'Forbidden. Owner permissions required.',
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'not-found') {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Member not found in this shop.',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json<ApiResponse<string>>(
      {
        ok: true,
        data: 'updated',
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } else {
    const { userId, active } = parsed.data;
    const { data: rpcResult, error: rpcError } = await adminClient.rpc('set_member_active', {
      p_actor: access.staff.userId,
      p_tenant: access.tenantId,
      p_user: userId,
      p_active: active,
    });

    if (rpcError || !rpcResult) {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to update member status.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'last-owner') {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'last-owner' as unknown as ApiErrorCode,
          message: 'Cannot deactivate the last active owner of this shop.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'unauthorized') {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'Forbidden. Owner permissions required.',
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult === 'not-found') {
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Member not found in this shop.',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json<ApiResponse<string>>(
      {
        ok: true,
        data: 'updated',
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}
