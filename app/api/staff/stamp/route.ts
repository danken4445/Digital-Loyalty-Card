import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logStaffAuditEvent, requireStaffSession } from '@/lib/auth/staff';
import {
  isStampResultCode,
  type ApiResponse,
  type StaffManualStampResponse,
  type StampResultCode,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

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

    const admin = createSupabaseAdminClient();
    const { data: customerRow } = await admin
      .from('customers')
      .select('id')
      .eq('id', parsed.data.customerId)
      .maybeSingle();

    if (!customerRow) {
      return NextResponse.json<ApiResponse<StaffManualStampResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Customer ID not found.',
        },
        { status: 404 },
      );
    }

    const { data: stampResult, error: stampError } = await admin.rpc('record_stamp', {
      p_customer: parsed.data.customerId,
      p_source: 'manual',
      p_staff: auth.staff.userId,
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

    await logStaffAuditEvent({
      actorId: auth.staff.userId,
      action: 'staff_manual_stamp_issued',
      target: parsed.data.customerId,
      detail: {
        reason: parsed.data.reason,
        result: stampResult,
      },
    });

    const { data: bal } = await admin
      .from('customer_balances')
      .select('available_stamps')
      .eq('customer_id', parsed.data.customerId)
      .maybeSingle();

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
