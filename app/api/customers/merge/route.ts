import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureCustomerRecord, getAuthenticatedCustomerCardState } from '@/lib/auth/customer';
import {
  MERGE_INTENT_COOKIE_NAME,
  type ApiResponse,
  type MergeCustomerResponse,
  type MergeResultCode,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { verifyMergeIntentToken } from '@/lib/security/mergeToken';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

interface MergeRpcClient {
  rpc: (
    fn: 'merge_anonymous_customer',
    args: { p_source_customer: string; p_target_customer: string },
  ) => Promise<{ data: MergeResultCode | null; error: { message: string } | null }>;
}

const mergeBodySchema = z.object({
  mergeToken: z.string().trim().min(1).max(2048).optional(),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<MergeCustomerResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403 },
    );
  }

  try {
    const targetUser = await getVerifiedUser();
    if (!targetUser) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'unauthenticated',
          message: 'Active session required to complete card merge.',
        },
        { status: 401 },
      );
    }

    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'merge',
      ip: getClientIp(request),
      customerId: targetUser.id,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many merge requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    let body: unknown = {};
    const contentLength = request.headers.get('content-length');

    if (contentLength !== '0') {
      try {
        const text = await request.text();
        if (text.trim().length > 0) {
          body = JSON.parse(text);
        }
      } catch {
        return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Invalid request payload.',
          },
          { status: 400 },
        );
      }
    }

    const parsed = mergeBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid request payload.',
        },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const rawToken = parsed.data.mergeToken ?? cookieStore.get(MERGE_INTENT_COOKIE_NAME)?.value;

    if (!rawToken) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Missing merge intent token.',
        },
        { status: 400 },
      );
    }

    const verification = verifyMergeIntentToken(rawToken);
    if (!verification.valid) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message:
            verification.reason === 'expired-token'
              ? 'Merge token has expired. Please try again.'
              : 'Invalid merge token.',
        },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: existingNonce, error: nonceError } = await admin
      .from('audit_log')
      .select('id')
      .eq('action', 'customer_merge_token_used')
      .eq('target', verification.payload.nonce)
      .maybeSingle();

    if (nonceError) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Unable to verify merge token status.',
        },
        { status: 500 },
      );
    }

    if (existingNonce) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'This merge token has already been used.',
        },
        { status: 400 },
      );
    }

    await ensureCustomerRecord(targetUser.id);

    // Call merge_anonymous_customer RPC
    const { data: rpcResult, error: rpcError } = await (admin as unknown as MergeRpcClient).rpc(
      'merge_anonymous_customer',
      {
        p_source_customer: verification.payload.sourceCustomerId,
        p_target_customer: targetUser.id,
      },
    );

    if (rpcError) {
      return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Unable to complete customer merge.',
        },
        { status: 500 },
      );
    }

    const mergeResultCode = (rpcResult ?? 'merged') as MergeResultCode;

    if (mergeResultCode === 'merged') {
      await admin.rpc('log_audit_event', {
        p_actor: targetUser.id,
        p_action: 'customer_merge_token_used',
        p_target: verification.payload.nonce,
        p_detail: {
          source_customer: verification.payload.sourceCustomerId,
          target_customer: targetUser.id,
        },
      });
    }

    const updatedCard = await getAuthenticatedCustomerCardState();

    const response = NextResponse.json<ApiResponse<MergeCustomerResponse>>(
      {
        ok: true,
        data: {
          result: mergeResultCode,
          sourceCustomerId: verification.payload.sourceCustomerId,
          targetCustomerId: targetUser.id,
          availableStampsAfter: updatedCard?.availableStamps ?? 0,
          totalStampsAfter: updatedCard?.totalStamps ?? 0,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    );

    response.cookies.set(MERGE_INTENT_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch {
    return NextResponse.json<ApiResponse<MergeCustomerResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Unable to complete customer merge.',
      },
      { status: 500 },
    );
  }
}
