import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ROUTES,
  isStampResultCode,
  type ApiResponse,
  type ClaimStampResponse,
  type StampResultCode,
} from '@/lib/contracts';
import { verifyTap } from '@/lib/nfc/verifyTap';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

const claimStampBodySchema = z.object({
  tagId: z.string().trim().min(1).max(256),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<ClaimStampResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>(
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
      return NextResponse.json<ApiResponse<ClaimStampResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid request payload.',
        },
        { status: 400 },
      );
    }
  }

  const parsed = claimStampBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid request payload.',
      },
      { status: 400 },
    );
  }

  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>(
      {
        ok: false,
        error: 'unauthenticated',
        message: 'Active session required to claim stamp.',
      },
      { status: 401 },
    );
  }

  const ip = request.headers.get('x-forwarded-for');
  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'claim',
    ip,
    customerId: user.id,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many claim requests. Please wait a moment.',
      },
      { status: 429 },
    );
  }

  const tapVerification = verifyTap({ tagId: parsed.data.tagId });
  if (!tapVerification.valid) {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>({
      ok: true,
      data: {
        result: 'invalid-tag',
        redirectTo: ROUTES.cardWithResult('invalid-tag'),
      },
    });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('record_stamp', {
      p_customer: user.id,
      p_tag: tapVerification.normalizedTagId,
      p_source: 'nfc',
    });

    if (error) {
      return NextResponse.json<ApiResponse<ClaimStampResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Unable to record stamp.',
        },
        { status: 500 },
      );
    }

    const result: StampResultCode = isStampResultCode(data) ? data : 'invalid-tag';

    return NextResponse.json<ApiResponse<ClaimStampResponse>>({
      ok: true,
      data: {
        result,
        redirectTo: ROUTES.cardWithResult(result),
      },
    });
  } catch {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Unable to record stamp.',
      },
      { status: 500 },
    );
  }
}
