import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ROUTES, type ApiResponse, type ClaimStampResponse } from '@/lib/contracts';
import { parseStampCardPayload, stampRedirectPath } from '@/lib/nfc/stampOutcome';
import { verifyTap } from '@/lib/nfc/verifyTap';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';

const claimStampBodySchema = z.object({
  tagId: z.string().trim().min(1).max(256),
  c: z.string().trim().optional(),
  m: z.string().trim().optional(),
  tapCounter: z.number().int().min(0).max(16777215).optional().nullable(),
  hardwareUid: z.string().trim().optional().nullable(),
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

  const ip = getClientIp(request);
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

  const tapVerification = verifyTap({
    tagId: parsed.data.tagId,
    query: {
      c: parsed.data.c,
      m: parsed.data.m,
    },
  });
  if (!tapVerification.valid) {
    return NextResponse.json<ApiResponse<ClaimStampResponse>>({
      ok: true,
      data: {
        result: 'invalid-tag',
        redirectTo: ROUTES.cardWithResult('invalid-tag'),
      },
    });
  }

  const tapCounter =
    tapVerification.tapCounter !== null && tapVerification.tapCounter !== undefined
      ? tapVerification.tapCounter
      : (parsed.data.tapCounter ?? null);
  const hardwareUid =
    tapVerification.hardwareUid ?? parsed.data.hardwareUid ?? null;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('stamp_card_nfc', {
      p_customer: user.id,
      p_tag: tapVerification.normalizedTagId,
      ...(tapCounter !== null ? { p_tap_counter: tapCounter } : {}),
      ...(hardwareUid ? { p_hardware_uid: hardwareUid } : {}),
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

    const outcome = parseStampCardPayload(data);

    const mirrorParams: Record<string, string> = {};
    if (parsed.data.m) mirrorParams.m = parsed.data.m;
    else if (parsed.data.c) mirrorParams.c = parsed.data.c;

    return NextResponse.json<ApiResponse<ClaimStampResponse>>({
      ok: true,
      data: {
        result: outcome.result,
        redirectTo: stampRedirectPath(outcome, tapVerification.normalizedTagId, mirrorParams),
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
