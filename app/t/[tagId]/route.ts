import { type NextRequest, NextResponse } from 'next/server';
import { ROUTES, type ApiErrorResponse } from '@/lib/contracts';
import { parseStampCardPayload, stampRedirectPath } from '@/lib/nfc/stampOutcome';
import { verifyTap } from '@/lib/nfc/verifyTap';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

function createHardenedRedirect(url: URL | string): NextResponse {
  const res = NextResponse.redirect(url, 303);
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

function createHardenedJson<T>(data: T, status: number): NextResponse<T> {
  const res = NextResponse.json(data, { status });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tagId: string }> },
): Promise<NextResponse> {
  const { tagId } = await context.params;
  const ip = getClientIp(request);

  const rawC = request.nextUrl.searchParams.get('c');
  const rawM = request.nextUrl.searchParams.get('m');
  const mirrorParams: Record<string, string> = {};
  if (rawM) mirrorParams.m = rawM;
  else if (rawC) mirrorParams.c = rawC;

  const ipLimit = await checkPublicEndpointRateLimit({
    endpoint: 'tap',
    ip,
  });

  if (!ipLimit.allowed) {
    return createHardenedJson<ApiErrorResponse>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many tap requests. Please wait a moment.',
      },
      429,
    );
  }

  const user = await getVerifiedUser();
  if (!user) {
    return createHardenedRedirect(new URL(ROUTES.startWithTag(tagId, mirrorParams), request.url));
  }

  const custLimit = await checkPublicEndpointRateLimit({
    endpoint: 'tap',
    ip,
    customerId: user.id,
  });

  if (!custLimit.allowed) {
    return createHardenedJson<ApiErrorResponse>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many tap requests. Please wait a moment.',
      },
      429,
    );
  }

  const tapVerification = verifyTap({
    tagId,
    query: {
      c: rawC ?? undefined,
      m: rawM ?? undefined,
    },
  });

  if (!tapVerification.valid) {
    return createHardenedRedirect(new URL(ROUTES.cardWithResult('invalid-tag'), request.url));
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('stamp_card_nfc', {
      p_customer: user.id,
      p_tag: tapVerification.normalizedTagId,
      ...(tapVerification.tapCounter !== null && tapVerification.tapCounter !== undefined
        ? { p_tap_counter: tapVerification.tapCounter }
        : {}),
      ...(tapVerification.hardwareUid
        ? { p_hardware_uid: tapVerification.hardwareUid }
        : {}),
    });

    const outcome = parseStampCardPayload(error ? null : data);
    return createHardenedRedirect(
      new URL(stampRedirectPath(outcome, tapVerification.normalizedTagId, mirrorParams), request.url),
    );
  } catch {
    return createHardenedRedirect(new URL(ROUTES.cardWithResult('invalid-tag'), request.url));
  }
}
