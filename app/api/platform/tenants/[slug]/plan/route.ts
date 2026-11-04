import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import { BILLING_NO_STORE_HEADERS, choosePlanResponse } from '@/lib/billing/choosePlanResponse';
import type { ApiResponse, ChoosePlanResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const choosePlanSchema = z.object({
  plan: z.string().trim().min(3).max(40),
  /** Apply to the current month instead of next month (platform admins only). */
  immediate: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ slug: string }>;
}

function fail(
  status: number,
  error: 'forbidden' | 'unauthenticated' | 'invalid_input' | 'rate_limited' | 'internal_error',
  message: string,
) {
  return NextResponse.json<ApiResponse<ChoosePlanResponse>>(
    { ok: false, error, message },
    { status, headers: BILLING_NO_STORE_HEADERS },
  );
}

/** A platform admin sets a shop's billing plan on its behalf. */
export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<ChoosePlanResponse>>> {
  if (!verifySameOriginRequest(request).allowed) {
    return fail(403, 'forbidden', 'Cross-origin request blocked.');
  }

  try {
    const auth = await requirePlatformAdmin();
    if (!auth.authorized) {
      return auth.reason === 'unauthenticated'
        ? fail(401, 'unauthenticated', 'Authentication required.')
        : fail(
            403,
            'forbidden',
            auth.reason === 'mfa-required'
              ? 'Multi-factor authentication (AAL2) required.'
              : 'Forbidden. Platform admin access required.',
          );
    }

    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-billing',
      ip: getClientIp(request),
      customerId: auth.admin.userId,
    });
    if (!rl.allowed) {
      return fail(429, 'rate_limited', 'Too many requests. Please wait a moment.');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'invalid_input', 'Malformed request JSON.');
    }

    const parsed = choosePlanSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'invalid_input', 'Choose one of the listed plans.');
    }

    const { slug } = await params;
    const supabase = await createSupabaseServerClient();
    const { data: rawTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    const tenant = rawTenant as unknown as { id: string } | null;

    if (!tenant) {
      return fail(404, 'invalid_input', 'Shop not found.');
    }

    const { data, error } = await createSupabaseAdminClient().rpc('choose_billing_plan', {
      p_actor: auth.admin.userId,
      p_tenant: tenant.id,
      p_plan: parsed.data.plan,
      p_immediate: parsed.data.immediate ?? false,
    });

    return choosePlanResponse(data, error);
  } catch {
    return fail(500, 'internal_error', 'Unexpected server error.');
  }
}
