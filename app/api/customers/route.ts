import { NextResponse } from 'next/server';

import { ensureCustomerRecord } from '@/lib/auth/customer';
import {
  MERGE_INTENT_COOKIE_NAME,
  type ApiResponse,
  type DeleteCustomerResponse,
  type EnsureCustomerResponse,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { logSecurityEvent } from '@/lib/security/logger';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

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
      ip: getClientIp(request),
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
      ip: getClientIp(request),
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
    const { error: rpcError } = await admin.rpc('delete_wallet', { p_customer: user.id });

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
