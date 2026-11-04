import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ApiErrorCode, ApiResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const acceptInviteSchema = z.object({
  inviteId: z.string().uuid('Invalid invite UUID.'),
  displayName: z.string().trim().max(120).optional(),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<{ result: 'accepted' }>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const user = await getVerifiedUser();
  if (!user || user.is_anonymous) {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'unauthenticated',
        message: 'Sign in to accept this invite.',
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const ip = getClientIp(request);
  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'staff-tenant',
    ip,
    customerId: user.id,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
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
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Malformed request JSON.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = acceptInviteSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues[0]?.message ?? 'Invalid invite input.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { inviteId, displayName } = parsed.data;

  const adminClient = createSupabaseAdminClient();
  const { data: rpcResult, error: rpcError } = await adminClient.rpc('accept_invite', {
    p_user: user.id,
    p_invite: inviteId,
    p_display_name: displayName ?? '',
  });

  if (rpcError || !rpcResult) {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to accept invite.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'email-mismatch') {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'email-mismatch' as unknown as ApiErrorCode,
        message: 'Signed-in account email does not match the invited email.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'invalid-invite') {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invite is invalid or already accepted.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'expired') {
    return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invite has expired.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<{ result: 'accepted' }>>(
    {
      ok: true,
      data: { result: 'accepted' },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
