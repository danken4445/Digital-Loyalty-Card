import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logStaffAuditEvent, requireStaffSession } from '@/lib/auth/staff';
import { STAMP_RULES } from '@/lib/config';
import type { ApiResponse, RedeemResultCode, StaffRedeemResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { verifyRedeemToken } from '@/lib/security/redeemToken';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const staffRedeemSchema = z.object({
  action: z.enum(['preview', 'confirm']),
  token: z.string().trim().min(1).max(2048),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<StaffRedeemResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
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
      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
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

    const ip = request.headers.get('x-forwarded-for');
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-redeem',
      ip,
      customerId: auth.staff.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many redemption requests. Please wait a moment.',
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
        return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Invalid request payload.',
          },
          { status: 400 },
        );
      }
    }

    const parsed = staffRedeemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid request payload.',
        },
        { status: 400 },
      );
    }

    const verification = verifyRedeemToken(parsed.data.token);
    if (!verification.valid) {
      if (parsed.data.action === 'preview') {
        return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message:
              verification.reason === 'expired-token'
                ? 'Redemption QR token has expired.'
                : 'Invalid redemption QR token.',
          },
          { status: 400 },
        );
      }

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'confirm',
            result: verification.reason,
            customerId: '',
            displayCode: '',
            availableStampsAfter: 0,
            message:
              verification.reason === 'expired-token'
                ? 'Redemption QR token has expired.'
                : 'Invalid redemption QR token.',
          },
        },
        { status: 200 },
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: existingNonce } = await admin
      .from('audit_log')
      .select('id')
      .eq('action', 'staff_redeem_token_used')
      .eq('target', verification.payload.nonce)
      .maybeSingle();

    if (existingNonce) {
      if (parsed.data.action === 'preview') {
        return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'This redemption QR token has already been used.',
          },
          { status: 400 },
        );
      }

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'confirm',
            result: 'invalid-token',
            rewardKind: verification.kind,
            customerId: verification.payload.customerId,
            displayCode: verification.displayCode,
            availableStampsAfter: 0,
            message: 'This redemption QR token has already been used.',
          },
        },
        { status: 200 },
      );
    }

    if (parsed.data.action === 'preview') {
      const { data: bal } = await admin
        .from('customer_balances')
        .select('customer_id, total_stamps, stamps_redeemed, available_stamps, last_stamped_at')
        .eq('customer_id', verification.payload.customerId)
        .maybeSingle();

      const availableStamps = bal?.available_stamps ?? 0;
      const totalStamps = bal?.total_stamps ?? 0;
      const stampsRedeemed = bal?.stamps_redeemed ?? 0;

      let canRedeem = availableStamps >= STAMP_RULES.rewardThreshold;
      if (verification.kind === 'instagram-upsize') {
        const { data: existingClaim } = await admin
          .from('perk_claims')
          .select('id')
          .eq('customer_id', verification.payload.customerId)
          .eq('perk', 'instagram_follow_upsize')
          .maybeSingle();
        canRedeem = !existingClaim;
      }

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'preview',
            valid: true,
            rewardKind: verification.kind,
            customerId: verification.payload.customerId,
            displayCode: verification.displayCode,
            availableStamps,
            totalStamps,
            stampsRedeemed,
            canRedeem,
            expiresAtIso: new Date(verification.payload.exp * 1000).toISOString(),
          },
        },
        { status: 200 },
      );
    }

    // action === 'confirm'
    if (verification.kind === 'instagram-upsize') {
      // One claim per card is enforced inside claim_instagram_upsize, so token replay is harmless
      const { data: claimData, error: claimError } = await admin.rpc('claim_instagram_upsize', {
        p_customer: verification.payload.customerId,
        p_staff: auth.staff.userId,
      });

      if (claimError) {
        return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
          {
            ok: false,
            error: 'internal_error',
            message: 'Failed to process Instagram upsize.',
          },
          { status: 500 },
        );
      }

      const claimResult: RedeemResultCode =
        claimData === 'redeemed' || claimData === 'already-claimed' || claimData === 'unauthorized'
          ? claimData
          : 'invalid-token';

      const { data: claimBal } = await admin
        .from('customer_balances')
        .select('available_stamps')
        .eq('customer_id', verification.payload.customerId)
        .maybeSingle();

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'confirm',
            result: claimResult,
            rewardKind: 'instagram-upsize',
            customerId: verification.payload.customerId,
            displayCode: verification.displayCode,
            availableStampsAfter: claimBal?.available_stamps ?? 0,
            message:
              claimResult === 'redeemed'
                ? 'Instagram upsize granted. Upsize their drink at no charge. No stamps used.'
                : claimResult === 'already-claimed'
                  ? 'This card has already used its Instagram upsize.'
                  : claimResult === 'unauthorized'
                    ? 'Staff member is not authorized to redeem.'
                    : 'Upsize could not be granted.',
          },
        },
        { status: 200 },
      );
    }

    // Pass p_nonce so single-use nonce check & consumption execute atomically inside the customer advisory lock
    const { data: rpcData, error: rpcError } = await admin.rpc('redeem_reward', {
      p_customer: verification.payload.customerId,
      p_staff: auth.staff.userId,
      p_nonce: verification.payload.nonce,
    });

    if (rpcError) {
      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to process redemption.',
        },
        { status: 500 },
      );
    }

    const { data: updatedBal } = await admin
      .from('customer_balances')
      .select('available_stamps')
      .eq('customer_id', verification.payload.customerId)
      .maybeSingle();

    if (rpcData === 'redeemed') {
      await logStaffAuditEvent({
        actorId: auth.staff.userId,
        action: 'staff_redeem_token_used',
        target: verification.payload.nonce,
        detail: {
          customer_id: verification.payload.customerId,
          display_code: verification.displayCode,
        },
      }).catch(() => {
        // Nonce is already atomically recorded inside redeem_reward(p_customer, p_staff, p_nonce)
      });
    }

    const redeemResult: RedeemResultCode =
      rpcData === 'redeemed' ||
      rpcData === 'insufficient-stamps' ||
      rpcData === 'unauthorized' ||
      rpcData === 'invalid-token' ||
      rpcData === 'expired-token'
        ? rpcData
        : 'invalid-token';

    const message =
      redeemResult === 'redeemed'
        ? 'Reward redeemed successfully! 10 stamps deducted.'
        : redeemResult === 'insufficient-stamps'
          ? 'Customer does not have enough stamps (10 required).'
          : redeemResult === 'unauthorized'
            ? 'Staff member is not authorized to redeem.'
            : 'Redemption failed.';

    return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
      {
        ok: true,
        data: {
          mode: 'confirm',
          result: redeemResult,
          rewardKind: 'free-coffee',
          customerId: verification.payload.customerId,
          displayCode: verification.displayCode,
          availableStampsAfter: updatedBal?.available_stamps ?? 0,
          message,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'An unexpected error occurred while processing redemption.',
      },
      { status: 500 },
    );
  }
}
