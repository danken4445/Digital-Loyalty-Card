import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
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

const inviteSchema = z.object({
  email: z.string().trim().email('Invalid email address format.'),
  role: z.enum(STAFF_ROLES, {
    errorMap: () => ({ message: 'Role must be owner, manager, or staff.' }),
  }),
});

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<{ result: 'invited' }>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
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
      return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
        {
          ok: false,
          error: (err.status === 401 ? 'unauthenticated' : 'forbidden') as ApiErrorCode,
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Tenant not found.',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Internal server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const ip = getClientIp(request);
  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'staff-tenant',
    ip,
    customerId: access.staff.userId,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
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
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Malformed request JSON.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = inviteSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? 'Invalid invite input.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { email, role } = parsed.data;

  const adminClient = createSupabaseAdminClient();
  const { data: rpcResult, error: rpcError } = await adminClient.rpc('invite_member', {
    p_actor: access.staff.userId,
    p_tenant: access.tenantId,
    p_email: email,
    p_role: role as StaffRole,
  });

  if (rpcError || !rpcResult) {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to create member invite.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'unauthorized') {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Forbidden. Owner permissions required to invite members.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'already-member') {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'User is already an active member of this shop.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'invalid-email') {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid email address provided.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'invalid-role') {
    return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid member role provided.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<{ result: 'invited' }>>(
    {
      ok: true,
      data: { result: 'invited' },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
