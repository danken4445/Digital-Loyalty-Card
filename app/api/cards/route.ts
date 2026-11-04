import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ROUTES,
  type AddCardResponse,
  type AddCardResultCode,
  type ApiResponse,
  type StampResultCode,
} from '@/lib/contracts';
import { parseStampCardPayload } from '@/lib/nfc/stampOutcome';
import { verifyTap } from '@/lib/nfc/verifyTap';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getTenantBySlug } from '@/lib/tenants/context';

const addCardBodySchema = z.object({
  tenantSlug: z.string().trim().min(3).max(40),
  tagId: z.string().trim().min(1).max(256).optional(),
  consentVersion: z.string().trim().min(1).max(32).default('v1'),
});

function fail(
  status: number,
  error: Extract<ApiResponse<AddCardResponse>, { ok: false }>['error'],
  message: string,
): NextResponse<ApiResponse<AddCardResponse>> {
  return NextResponse.json<ApiResponse<AddCardResponse>>({ ok: false, error, message }, { status });
}

function isAddCardResult(value: unknown): value is AddCardResultCode {
  return value === 'added' || value === 'already-added' || value === 'tenant-unavailable';
}

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<AddCardResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return fail(403, 'forbidden', 'Cross-origin request blocked.');
  }

  const user = await getVerifiedUser();
  if (!user) {
    return fail(401, 'unauthenticated', 'Active session required to add a card.');
  }

  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'cards',
    ip: getClientIp(request),
    customerId: user.id,
  });
  if (!rl.allowed) {
    return fail(429, 'rate_limited', 'Too many requests. Please wait a moment.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'invalid_input', 'Invalid request payload.');
  }

  const parsed = addCardBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, 'invalid_input', 'Invalid request payload.');
  }
  const { tenantSlug, tagId, consentVersion } = parsed.data;

  try {
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return fail(404, 'invalid_input', 'Shop not found.');
    }

    const admin = createSupabaseAdminClient();
    const { data: addData, error: addError } = await admin.rpc('add_card', {
      p_customer: user.id,
      p_tenant: tenant.id,
      p_consent_version: consentVersion,
    });
    if (addError || !isAddCardResult(addData)) {
      return fail(500, 'internal_error', 'Unable to add this card.');
    }

    const shopPath = ROUTES.shop(tenant.slug);
    if (addData === 'tenant-unavailable') {
      return NextResponse.json<ApiResponse<AddCardResponse>>({
        ok: true,
        data: { result: addData, redirectTo: shopPath },
      });
    }

    let stampResult: StampResultCode | undefined;
    let stampedOtherShop = false;
    if (tagId) {
      const tap = verifyTap({ tagId });
      if (!tap.valid) {
        stampResult = 'invalid-tag';
      } else {
        // The card is already added at this point, so a stamping failure only drops the stamp result.
        const { data: stampData, error: stampError } = await admin.rpc('stamp_card_nfc', {
          p_customer: user.id,
          p_tag: tap.normalizedTagId,
        });
        if (!stampError) {
          const outcome = parseStampCardPayload(stampData);
          stampResult = outcome.result;
          stampedOtherShop = outcome.tenantSlug !== null && outcome.tenantSlug !== tenant.slug;
        }
      }
    }

    return NextResponse.json<ApiResponse<AddCardResponse>>({
      ok: true,
      data: {
        result: addData,
        ...(stampResult ? { stampResult } : {}),
        // A tag from another shop acted on that shop's card, so its result must not show on this page.
        redirectTo:
          stampResult && !stampedOtherShop
            ? ROUTES.shopWithResult(tenant.slug, stampResult)
            : shopPath,
      },
    });
  } catch {
    return fail(500, 'internal_error', 'Unable to add this card.');
  }
}
