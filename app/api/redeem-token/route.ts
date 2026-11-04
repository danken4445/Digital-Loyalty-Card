import { NextResponse } from 'next/server';
import { getAuthenticatedCustomerCardState } from '@/lib/auth/customer';
import { STAMP_RULES } from '@/lib/config';
import { TENANT_ONE_ID, type ApiResponse, type IssuedRedeemToken } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getVerifiedUser } from '@/lib/supabase/server';

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
          message: 'Active session required to generate a redemption token.',
        },
        { status: 401 },
      );
    }

    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'redeem-token',
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
          message: 'Active session required to generate a redemption token.',
        },
        { status: 401 },
      );
    }

    if (cardState.availableStamps < STAMP_RULES.rewardThreshold) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'At least 10 stamps are required to redeem a reward.',
        },
        { status: 403 },
      );
    }

    const issued = await issueRedeemToken(user.id, TENANT_ONE_ID);

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
        message: 'Unable to issue redemption token.',
      },
      { status: 500 },
    );
  }
}
