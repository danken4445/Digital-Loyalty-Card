import { NextResponse } from 'next/server';
import { getAuthenticatedCustomerCardState } from '@/lib/auth/customer';
import type { ApiResponse, IssuedRedeemToken } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getVerifiedUser } from '@/lib/supabase/server';

/**
 * Issues a 5-minute signed QR token for the one-time Instagram follow upsize. The token alone
 * grants nothing: staff checks the follow on the customer's phone before confirming it.
 */
export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<IssuedRedeemToken>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
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
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'unauthenticated',
          message: 'Active session required to claim the Instagram upsize.',
        },
        { status: 401 },
      );
    }

    const ip = request.headers.get('x-forwarded-for');
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'instagram-upsize-token',
      ip,
      customerId: user.id,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many token requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    const cardState = await getAuthenticatedCustomerCardState();
    if (!cardState) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'unauthenticated',
          message: 'Active session required to claim the Instagram upsize.',
        },
        { status: 401 },
      );
    }

    if (cardState.instagramUpsizeClaimed === undefined) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Unable to issue upsize token.',
        },
        { status: 500 },
      );
    }

    if (cardState.instagramUpsizeClaimed) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'This card has already used its Instagram upsize.',
        },
        { status: 403 },
      );
    }

    const issued = await issueRedeemToken(user.id, { kind: 'instagram-upsize' });

    return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
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
  } catch {
    return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Unable to issue upsize token.',
      },
      { status: 500 },
    );
  }
}
