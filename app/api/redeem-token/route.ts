import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCustomerCardState } from '@/lib/auth/customer';
import type { ApiResponse, IssuedRedeemToken, RedeemTokenRequest } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { issueRedeemToken } from '@/lib/security/redeemToken';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getTenantBySlug } from '@/lib/tenants/context';

const requestBodySchema = z.object({
  tenantSlug: z.string().trim().min(1).max(64),
}) satisfies z.ZodType<RedeemTokenRequest>;

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

    const parsedBody = requestBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'A valid shop is required.',
        },
        { status: 400 },
      );
    }

    const tenant = await getTenantBySlug(parsedBody.data.tenantSlug);
    if (!tenant || tenant.status === 'closed') {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'A valid shop is required.',
        },
        { status: 400 },
      );
    }

    const cardState = await getCustomerCardState(tenant);
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

    if (cardState === 'no-card') {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'Add this shop to your wallet first.',
        },
        { status: 403 },
      );
    }

    const { rewardThreshold } = tenant.settings;
    if (cardState.availableStamps < rewardThreshold) {
      return NextResponse.json<ApiResponse<IssuedRedeemToken>>(
        {
          ok: false,
          error: 'forbidden',
          message: `At least ${rewardThreshold} stamps are required to redeem a reward.`,
        },
        { status: 403 },
      );
    }

    const issued = await issueRedeemToken(user.id, tenant.id);

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
