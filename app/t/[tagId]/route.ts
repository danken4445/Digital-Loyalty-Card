import { type NextRequest, NextResponse } from 'next/server';
import { ROUTES, type ApiErrorResponse } from '@/lib/contracts';
import { parseStampCardPayload, stampRedirectPath } from '@/lib/nfc/stampOutcome';
import { verifyTap } from '@/lib/nfc/verifyTap';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tagId: string }> },
): Promise<NextResponse> {
  const { tagId } = await context.params;
  const ip = getClientIp(request);

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
    const { data, error } = await admin.rpc('stamp_card_nfc', {
      p_customer: user.id,
      p_tag: tapVerification.normalizedTagId,
    });

    const outcome = parseStampCardPayload(error ? null : data);
    return NextResponse.redirect(
      new URL(stampRedirectPath(outcome, tapVerification.normalizedTagId), request.url),
      303,
    );
  } catch {
    return NextResponse.redirect(new URL(ROUTES.cardWithResult('invalid-tag'), request.url), 303);
  }
}
