import { NextResponse } from 'next/server';
import { ensureCustomerRecord } from '@/lib/auth/customer';
import {
  MERGE_INTENT_COOKIE_NAME,
  type ApiResponse,
  type IssuedMergeIntent,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { issueMergeIntentToken } from '@/lib/security/mergeToken';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { getVerifiedUser } from '@/lib/supabase/server';

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<IssuedMergeIntent>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<IssuedMergeIntent>>(
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
      return NextResponse.json<ApiResponse<IssuedMergeIntent>>(
        {
          ok: false,
          error: 'unauthenticated',
          message: 'Active session required to initiate card merge.',
        },
        { status: 401 },
      );
    }

    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'merge-intent',
      ip: request.headers.get('x-forwarded-for'),
      customerId: user.id,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<IssuedMergeIntent>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many merge requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    await ensureCustomerRecord(user.id);
    const issued = issueMergeIntentToken(user.id);

    const response = NextResponse.json<ApiResponse<IssuedMergeIntent>>(
      {
        ok: true,
        data: issued,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      },
    );

    response.cookies.set(MERGE_INTENT_COOKIE_NAME, issued.mergeToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: issued.ttlSeconds,
      secure: process.env.NODE_ENV === 'production',
    });

    return response;
  } catch {
    return NextResponse.json<ApiResponse<IssuedMergeIntent>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Unable to initiate card merge.',
      },
      { status: 500 },
    );
  }
}
