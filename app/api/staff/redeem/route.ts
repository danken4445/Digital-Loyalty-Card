import { NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/auth/staff';
import { type ApiResponse, type RedeemResultCode, type StaffRedeemResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { verifyRedeemToken } from '@/lib/security/redeemToken';
import {
  parseStaffRedeemBody,
  resolveTenantForRedeem,
} from '@/lib/security/reward-token-helpers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const REWARD_RESULTS = [
  'redeemed',
  'insufficient-stamps',
  'invalid-token',
  'no-card',
  'unauthorized',
  'tenant-unavailable',
] as const satisfies readonly RedeemResultCode[];

const PERK_RESULTS = [
  'redeemed',
  'already-claimed',
  'invalid-perk',
  'no-card',
  'unauthorized',
  'tenant-unavailable',
] as const satisfies readonly RedeemResultCode[];

const MILESTONE_RESULTS = [
  'redeemed',
  'milestone-already-claimed',
  'milestone-not-reached',
  'milestone-expired',
  'invalid-token',
  'no-card',
  'unauthorized',
  'tenant-unavailable',
  'invalid-perk',
] as const satisfies readonly RedeemResultCode[];

function isRewardResult(value: unknown): value is (typeof REWARD_RESULTS)[number] {
  return typeof value === 'string' && (REWARD_RESULTS as readonly string[]).includes(value);
}

function isPerkResult(value: unknown): value is (typeof PERK_RESULTS)[number] {
  return typeof value === 'string' && (PERK_RESULTS as readonly string[]).includes(value);
}

function isMilestoneResult(value: unknown): value is (typeof MILESTONE_RESULTS)[number] {
  return typeof value === 'string' && (MILESTONE_RESULTS as readonly string[]).includes(value);
}

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

    const ip = getClientIp(request);
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

    const parsed = parseStaffRedeemBody(body);
    if (!parsed.ok) {
      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: false,
          error: parsed.error,
          message: parsed.message,
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

    const staff = auth.staff;
    const { payload } = verification;

    // A reward QR is bound to the shop that issued it; only that shop's staff can redeem it.
    if (payload.tenantId !== staff.tenantId) {
      const wrongTenantMessage = 'This reward belongs to another shop.';
      if (parsed.data.action === 'preview') {
        return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
          { ok: false, error: 'invalid_input', message: wrongTenantMessage },
          { status: 400 },
        );
      }

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'confirm',
            result: 'wrong-tenant',
            rewardKind: verification.kind,
            customerId: payload.customerId,
            displayCode: verification.displayCode,
            availableStampsAfter: 0,
            message: wrongTenantMessage,
          },
        },
        { status: 200 },
      );
    }

    const resolved = await resolveTenantForRedeem(staff.tenantId, { byId: true });
    if (!resolved.ok) {
      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: false,
          error: resolved.error,
          message: resolved.message,
        },
        { status: resolved.status },
      );
    }
    const tenant = resolved.tenant;
    const { rewardThreshold, rewardLabel } = tenant.settings;

    // Session client: RLS scopes audit_log, card_balances and perk_claims to the staff member's shops.
    const supabase = await createSupabaseServerClient();
    const { data: existingNonce } = await supabase
      .from('audit_log')
      .select('id')
      .eq('tenant_id', staff.tenantId)
      .eq('action', 'staff_redeem_token_used')
      .eq('target', payload.nonce)
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
            customerId: payload.customerId,
            displayCode: verification.displayCode,
            availableStampsAfter: 0,
            message: 'This redemption QR token has already been used.',
          },
        },
        { status: 200 },
      );
    }

    if (parsed.data.action === 'preview') {
      const { data: bal } = await supabase
        .from('card_balances')
        .select('customer_id, total_stamps, stamps_redeemed, available_stamps, last_stamped_at')
        .eq('tenant_id', staff.tenantId)
        .eq('customer_id', payload.customerId)
        .maybeSingle<{
          total_stamps: number | null;
          stamps_redeemed: number | null;
          available_stamps: number | null;
        }>();

      const availableStamps = bal?.available_stamps ?? 0;
      const totalStamps = bal?.total_stamps ?? 0;
      const stampsRedeemed = bal?.stamps_redeemed ?? 0;

      let canRedeem = availableStamps >= rewardThreshold;
      if (verification.kind === 'instagram-upsize') {
        const { data: existingClaim } = await supabase
          .from('perk_claims')
          .select('id')
          .eq('tenant_id', staff.tenantId)
          .eq('customer_id', payload.customerId)
          .eq('perk', 'instagram_follow_upsize')
          .maybeSingle();
        canRedeem = !existingClaim;
      } else if (verification.kind === 'milestone-reward') {
        const cycleIndex = payload.cycleIndex ?? Math.floor(totalStamps / rewardThreshold);
        const { data: existingMilestone } = await supabase
          .from('milestone_claims')
          .select('id')
          .eq('tenant_id', staff.tenantId)
          .eq('customer_id', payload.customerId)
          .eq('cycle_index', cycleIndex)
          .maybeSingle();
        canRedeem = Boolean(
          tenant.settings.milestoneStep &&
            (totalStamps % rewardThreshold) >= tenant.settings.milestoneStep &&
            !existingMilestone,
        );
      }

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'preview',
            valid: true,
            rewardKind: verification.kind,
            customerId: payload.customerId,
            displayCode: verification.displayCode,
            availableStamps,
            totalStamps,
            stampsRedeemed,
            canRedeem,
            expiresAtIso: new Date(payload.exp * 1000).toISOString(),
          },
        },
        { status: 200 },
      );
    }

    // action === 'confirm'
    const admin = createSupabaseAdminClient();

    async function readAvailableStamps(): Promise<number> {
      const { data: after } = await supabase
        .from('card_balances')
        .select('available_stamps')
        .eq('tenant_id', staff.tenantId)
        .eq('customer_id', payload.customerId)
        .maybeSingle<{ available_stamps: number | null }>();
      return after?.available_stamps ?? 0;
    }

    if (verification.kind === 'instagram-upsize') {
      // One claim per card is enforced inside claim_card_perk, so token replay is harmless
      const { data: claimData, error: claimError } = await admin.rpc('claim_card_perk', {
        p_actor: staff.userId,
        p_tenant: staff.tenantId,
        p_customer: payload.customerId,
        p_perk: 'instagram_follow_upsize',
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

      const claimResult: RedeemResultCode = isPerkResult(claimData) ? claimData : 'invalid-token';

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'confirm',
            result: claimResult,
            rewardKind: 'instagram-upsize',
            customerId: payload.customerId,
            displayCode: verification.displayCode,
            availableStampsAfter: await readAvailableStamps(),
            message:
              claimResult === 'redeemed'
                ? 'Instagram upsize granted. Upsize their drink at no charge. No stamps used.'
                : claimResult === 'already-claimed'
                  ? 'This card has already used its Instagram upsize.'
                  : claimResult === 'unauthorized'
                    ? 'Staff member is not authorized to redeem.'
                    : claimResult === 'no-card'
                      ? `This customer has no ${staff.tenantName} card.`
                      : 'Upsize could not be granted.',
          },
        },
        { status: 200 },
      );
    }

    if (verification.kind === 'milestone-reward') {
      const { data: rpcData, error: rpcError } = await admin.rpc('redeem_milestone_reward', {
        p_actor: staff.userId,
        p_tenant: staff.tenantId,
        p_customer: payload.customerId,
        p_nonce: payload.nonce,
      });

      if (rpcError) {
        return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
          {
            ok: false,
            error: 'internal_error',
            message: 'Failed to process milestone redemption.',
          },
          { status: 500 },
        );
      }

      const milestoneResult: RedeemResultCode = isMilestoneResult(rpcData)
        ? rpcData
        : 'invalid-token';
      const milestoneLabel = tenant.settings.milestoneRewardLabel || 'Milestone reward';

      const message =
        milestoneResult === 'redeemed'
          ? `${milestoneLabel} redeemed successfully! No stamps deducted.`
          : milestoneResult === 'milestone-already-claimed'
            ? 'Milestone reward has already been claimed for this card.'
            : milestoneResult === 'milestone-not-reached'
              ? 'Customer has not reached the milestone for this card.'
              : milestoneResult === 'unauthorized'
                ? 'Staff member is not authorized to redeem.'
                : milestoneResult === 'no-card'
                  ? `This customer has no ${staff.tenantName} card.`
                  : 'Milestone reward could not be redeemed.';

      return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
        {
          ok: true,
          data: {
            mode: 'confirm',
            result: milestoneResult,
            rewardKind: 'milestone-reward',
            customerId: payload.customerId,
            displayCode: verification.displayCode,
            availableStampsAfter: await readAvailableStamps(),
            message,
          },
        },
        { status: 200 },
      );
    }

    // redeem_card_reward checks and records the single-use nonce atomically inside the customer
    // lock and writes the audit rows itself.
    const { data: rpcData, error: rpcError } = await admin.rpc('redeem_card_reward', {
      p_actor: staff.userId,
      p_tenant: staff.tenantId,
      p_customer: payload.customerId,
      p_nonce: payload.nonce,
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

    const redeemResult: RedeemResultCode = isRewardResult(rpcData) ? rpcData : 'invalid-token';

    const message =
      redeemResult === 'redeemed'
        ? `${rewardLabel} redeemed successfully! ${rewardThreshold} stamps deducted.`
        : redeemResult === 'insufficient-stamps'
          ? `Customer does not have enough stamps (${rewardThreshold} required).`
          : redeemResult === 'unauthorized'
            ? 'Staff member is not authorized to redeem.'
            : redeemResult === 'no-card'
              ? `This customer has no ${staff.tenantName} card.`
              : redeemResult === 'tenant-unavailable'
                ? 'Reward redemption for this shop has closed. The 30-day redemption window has expired.'
                : 'Redemption failed.';

    return NextResponse.json<ApiResponse<StaffRedeemResponse>>(
      {
        ok: true,
        data: {
          mode: 'confirm',
          result: redeemResult,
          rewardKind: 'free-coffee',
          customerId: payload.customerId,
          displayCode: verification.displayCode,
          availableStampsAfter: await readAvailableStamps(),
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
