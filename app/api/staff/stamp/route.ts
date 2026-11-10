import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaffSession } from '@/lib/auth/staff';
import {
  isStampResultCode,
  type ApiResponse,
  type StaffManualStampResponse,
  type StampResultCode,
} from '@/lib/contracts';
import { verifyMemberStampToken } from '@/lib/security/memberStampToken';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const manualStampSchema = z
  .object({
    customerId: z.string().uuid().optional(),
    memberToken: z.string().trim().min(10).max(1024).optional(),
    reason: z.string().trim().min(3).max(280),
  })
  .refine((data) => Boolean(data.customerId || data.memberToken), {
    message: 'Either customerId or memberToken is required.',
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
    let resolvedCustomerId: string;

    if (parsed.data.memberToken) {
      const verified = verifyMemberStampToken(parsed.data.memberToken);
      if (!verified.valid) {
        return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Invalid or unrecognized member QR code.',
          },
          { status: 400 },
        );
      }

      if (verified.payload.tenantId !== staff.tenantId) {
        return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
          {
            ok: false,
            error: 'forbidden',
            message: 'This member QR code belongs to another shop.',
          },
          { status: 403 },
        );
      }

      resolvedCustomerId = verified.payload.customerId;
    } else {
      resolvedCustomerId = parsed.data.customerId!;
    }

    const admin = createSupabaseAdminClient();
    const { data: stampResult, error: stampError } = await admin.rpc('stamp_card_manual', {
      p_actor: staff.userId,
      p_tenant: staff.tenantId,
      p_customer: resolvedCustomerId,
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

    if (!isStampResultCode(stampResult)) {
      // Never report an unknown or null RPC result as a successful stamp.
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Unable to record manual stamp.',
        },
        { status: 500 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data: bal } = await supabase
      .from('card_balances')
      .select('available_stamps')
      .eq('tenant_id', staff.tenantId)
      .eq('customer_id', resolvedCustomerId)
      .maybeSingle<{ available_stamps: number | null }>();

    const result: StampResultCode = stampResult;

    return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
      {
        ok: true,
        data: {
          result,
          customerId: resolvedCustomerId,
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
