import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ensureCustomerRecord } from '@/lib/auth/customer';
import {
  MERGE_INTENT_COOKIE_NAME,
  type ApiResponse,
  type DeleteCustomerResponse,
  type EnsureCustomerResponse,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { logSecurityEvent } from '@/lib/security/logger';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { verifyTurnstileToken } from '@/lib/security/turnstile';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

interface DeleteCustomerRpcClient {
  rpc: (
    fn: 'delete_customer_data',
    args: { p_customer: string },
  ) => Promise<{ data: boolean | null; error: { message: string } | null }>;
}

const ensureCustomerBodySchema = z.object({
  captchaToken: z.string().trim().min(1).max(2048).optional(),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<EnsureCustomerResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403 },
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
      return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid request payload.',
        },
        { status: 400 },
      );
    }
  }

  const parsed = ensureCustomerBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid request payload.',
      },
      { status: 400 },
    );
  }

  try {
    const user = await getVerifiedUser();
    if (!user) {
      return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
        {
          ok: false,
          error: 'unauthenticated',
          message: 'Active session required to create or access a loyalty card.',
        },
        { status: 401 },
      );
    }

    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'customers',
      ip: request.headers.get('x-forwarded-for'),
      customerId: user.id,
    });
    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    if (parsed.data.captchaToken) {
      const verification = await verifyTurnstileToken(
        parsed.data.captchaToken,
        request.headers.get('x-forwarded-for'),
      );
      if (!verification.success) {
        return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
          {
            ok: false,
            error: 'captcha_failed',
            message: 'Security check failed. Please try again.',
          },
          { status: 403 },
        );
      }
    }

    await ensureCustomerRecord(user.id);

    return NextResponse.json<ApiResponse<EnsureCustomerResponse>>({
      ok: true,
      data: {
        customerId: user.id,
        isAnonymous: Boolean(user.is_anonymous),
      },
    });
  } catch {
    return NextResponse.json<ApiResponse<EnsureCustomerResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Unable to provision loyalty card right now.',
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
): Promise<NextResponse<ApiResponse<DeleteCustomerResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<DeleteCustomerResponse>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403 },
    );
  }

  try {
    const user = await getVerifiedUser();
    if (!user) {
      return NextResponse.json<ApiResponse<DeleteCustomerResponse>>(
        {
          ok: false,
          error: 'unauthenticated',
          message: 'Active session required to delete customer data.',
        },
        { status: 401 },
      );
    }

    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'delete-customer',
      ip: request.headers.get('x-forwarded-for'),
      customerId: user.id,
    });
    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<DeleteCustomerResponse>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    const admin = createSupabaseAdminClient();
    const { error: rpcError } = await (admin as unknown as DeleteCustomerRpcClient).rpc(
      'delete_customer_data',
      { p_customer: user.id },
    );

    if (rpcError) {
      logSecurityEvent('error', 'customer_delete_failed', { customerId: user.id });
      return NextResponse.json<ApiResponse<DeleteCustomerResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to erase customer data.',
        },
        { status: 500 },
      );
    }

    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // Non-blocking signOut failure
    }

    logSecurityEvent('info', 'customer_self_deleted', { customerId: user.id });

    const response = NextResponse.json<ApiResponse<DeleteCustomerResponse>>(
      {
        ok: true,
        data: {
          deletedCustomerId: user.id,
          deletedAtIso: new Date().toISOString(),
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
    return NextResponse.json<ApiResponse<DeleteCustomerResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to erase customer data.',
      },
      { status: 500 },
    );
  }
}
