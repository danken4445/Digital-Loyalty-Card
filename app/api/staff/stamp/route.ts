import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaffSession } from '@/lib/auth/staff';
import {
  isStampResultCode,
  type ApiResponse,
  type StaffManualStampResponse,
  type StampResultCode,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const manualStampSchema = z.object({
  customerId: z.string().uuid(),
  reason: z.string().trim().min(3).max(280),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<StaffManualStampResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403 },
    );
  }

  try {
    const auth = await requireStaffSession();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: auth.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
          message:
            auth.reason === 'unauthenticated'
              ? 'Staff authentication required.'
              : 'Forbidden. Active staff credentials required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403 },
      );
    }

    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-stamp',
      ip,
      customerId: auth.staff.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many manual stamp requests. Please wait a moment.',
        },
        { status: 429 },
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
        return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Invalid request payload.',
          },
          { status: 400 },
        );
      }
    }

    const parsed = manualStampSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid request payload.',
        },
        { status: 400 },
      );
    }

    const staff = auth.staff;
    const admin = createSupabaseAdminClient();
    const { data: stampResult, error: stampError } = await admin.rpc('stamp_card_manual', {
      p_actor: staff.userId,
      p_tenant: staff.tenantId,
      p_customer: parsed.data.customerId,
      p_reason: parsed.data.reason,
    });

    if (stampError) {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Unable to record manual stamp.',
        },
        { status: 500 },
      );
    }

    // stamp_card_manual writes its own audit_log row, so no separate audit call here.
    if (stampResult === 'no-card') {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: `This customer has no ${staff.tenantName} card.`,
        },
        { status: 404 },
      );
    }

    if (stampResult === 'unauthorized') {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'Forbidden. Active staff credentials required.',
        },
        { status: 403 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data: bal } = await supabase
      .from('card_balances')
      .select('available_stamps')
      .eq('tenant_id', staff.tenantId)
      .eq('customer_id', parsed.data.customerId)
      .maybeSingle<{ available_stamps: number | null }>();

    const result: StampResultCode = isStampResultCode(stampResult) ? stampResult : 'stamped';

    return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
      {
        ok: true,
        data: {
          result,
          customerId: parsed.data.customerId,
          availableStampsAfter: bal?.available_stamps ?? 0,
          reason: parsed.data.reason,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'An unexpected error occurred while processing manual stamp.',
      },
      { status: 500 },
    );
  }
}
