import { type NextRequest, NextResponse } from 'next/server';
import {
  ROUTES,
  isStampResultCode,
  type ApiErrorResponse,
  type StampResultCode,
} from '@/lib/contracts';
import { verifyTap } from '@/lib/nfc/verifyTap';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tagId: string }> },
): Promise<NextResponse> {
  const { tagId } = await context.params;
  const ip = request.headers.get('x-forwarded-for');

  const ipLimit = await checkPublicEndpointRateLimit({
    endpoint: 'tap',
    ip,
  });

  if (!ipLimit.allowed) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many tap requests. Please wait a moment.',
      },
      { status: 429 },
    );
  }

  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.redirect(new URL(ROUTES.startWithTag(tagId), request.url), 303);
  }

  const custLimit = await checkPublicEndpointRateLimit({
    endpoint: 'tap',
    ip,
    customerId: user.id,
  });

  if (!custLimit.allowed) {
    return NextResponse.json<ApiErrorResponse>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many tap requests. Please wait a moment.',
      },
      { status: 429 },
    );
  }

  const tapVerification = verifyTap({ tagId });
  if (!tapVerification.valid) {
    return NextResponse.redirect(new URL(ROUTES.cardWithResult('invalid-tag'), request.url), 303);
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('record_stamp', {
      p_customer: user.id,
      p_tag: tapVerification.normalizedTagId,
      p_source: 'nfc',
    });

    const result: StampResultCode = !error && isStampResultCode(data) ? data : 'invalid-tag';
    return NextResponse.redirect(new URL(ROUTES.cardWithResult(result), request.url), 303);
  } catch {
    return NextResponse.redirect(new URL(ROUTES.cardWithResult('invalid-tag'), request.url), 303);
  }
}
