import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { ensureCustomerRecord } from '@/lib/auth/customer';
import { MERGE_INTENT_COOKIE_NAME, ROUTES, type RpcContracts } from '@/lib/contracts';
import { logSecurityEvent } from '@/lib/security/logger';
import { isMergeNonceUsed } from '@/lib/security/mergeNonce';
import { verifyMergeIntentToken } from '@/lib/security/mergeToken';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

const VALID_EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const rawOtpType = request.nextUrl.searchParams.get('type');
  const rawNext = request.nextUrl.searchParams.get('next');
  const errorParam =
    request.nextUrl.searchParams.get('error') ||
    request.nextUrl.searchParams.get('error_description');

  let nextPath: string = ROUTES.card;
  const isRecoveryLink = rawOtpType === 'recovery';
  if (
    rawNext &&
    rawNext.startsWith('/') &&
    !rawNext.startsWith('//') &&
    !rawNext.startsWith('/\\')
  ) {
    nextPath = rawNext;
  }

  // Handle remote error passed back by auth provider/Supabase
  if (errorParam) {
    logSecurityEvent('warn', 'auth_callback_remote_error', {
      error: errorParam,
      next: rawNext ?? undefined,
    });
    if (rawNext?.startsWith('/staff')) {
      return NextResponse.redirect(
        new URL(`${ROUTES.staff.login}?error=${encodeURIComponent(errorParam)}`, request.url),
        303,
      );
    }
  }

  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        logSecurityEvent('error', 'auth_callback_code_exchange_failed', {
          reason: error.message,
        });
      }
    } catch (error) {
      logSecurityEvent('error', 'auth_callback_code_exchange_failed', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  } else if (
    tokenHash &&
    rawOtpType &&
    VALID_EMAIL_OTP_TYPES.has(rawOtpType as EmailOtpType)
  ) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: rawOtpType as EmailOtpType,
      });
      if (error) {
        logSecurityEvent('error', 'auth_callback_otp_verify_failed', {
          reason: error.message,
        });
      } else if (isRecoveryLink) {
        // A verified recovery link always ends on the set-new-password screen.
        nextPath = ROUTES.resetPassword;
      }
    } catch (error) {
      logSecurityEvent('error', 'auth_callback_otp_verify_failed', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  const user = await getVerifiedUser();

  // An expired or already-used recovery link must not fall through to the customer wallet.
  if (isRecoveryLink && !user) {
    return NextResponse.redirect(
      new URL(
        `${ROUTES.staff.login}?error=${encodeURIComponent('This reset link is invalid or has expired. Request a new one.')}`,
        request.url,
      ),
      303,
    );
  }

  const mergeCookie = request.cookies.get(MERGE_INTENT_COOKIE_NAME)?.value;

  if (user) {
    // 1. If user is staff/owner or has pending invites, auto-accept and route appropriately
    if (user.email && !user.is_anonymous) {
      try {
        const adminClient = createSupabaseAdminClient();
        const cleanEmail = user.email.toLowerCase().trim();
        const { data: pendingInvites } = await adminClient
          .from('tenant_invites')
          .select('id, tenant_id, role')
          .eq('email', cleanEmail)
          .is('accepted_at', null)
          .gt('expires_at', new Date().toISOString());

        if (pendingInvites && pendingInvites.length > 0) {
          for (const invite of pendingInvites) {
            await adminClient.rpc('accept_invite', {
              p_user: user.id,
              p_invite: invite.id,
              p_display_name:
                (user.user_metadata?.display_name as string | undefined) ??
                user.email.split('@')[0] ??
                '',
            });
          }
          if (!rawNext) {
            nextPath = ROUTES.staff.root;
          }
        }
      } catch (inviteErr) {
        logSecurityEvent('warn', 'auth_callback_accept_invite_failed', {
          userId: user.id,
          reason: inviteErr instanceof Error ? inviteErr.message : 'unknown',
        });
      }
    }

    // 2. Direct existing staff without customer cards to /staff if no explicit destination was requested
    if (!rawNext && nextPath === ROUTES.card) {
      try {
        const supabase = await createSupabaseServerClient();
        const { data: staffMemberships } = await supabase
          .from('tenant_members')
          .select('tenant_id')
          .eq('user_id', user.id)
          .eq('active', true)
          .limit(1);

        if (staffMemberships && staffMemberships.length > 0) {
          const { data: customerCards } = await supabase
            .from('customer_cards')
            .select('tenant_id')
            .eq('customer_id', user.id)
            .limit(1);

          if (!customerCards || customerCards.length === 0) {
            nextPath = ROUTES.staff.root;
          }
        }
      } catch {
        // Fall back to default nextPath
      }
    }

    try {
      await ensureCustomerRecord(user.id);

      if (mergeCookie) {
        const verification = verifyMergeIntentToken(mergeCookie);
        if (verification.valid && verification.payload.sourceCustomerId !== user.id) {
          const admin = createSupabaseAdminClient();
          const { used: nonceUsed, failed: nonceCheckFailed } = await isMergeNonceUsed(
            admin,
            verification.payload.nonce,
          );

          // Fail closed: if the single-use check errors, skip the merge rather than risk replaying a token.
          if (!nonceUsed && !nonceCheckFailed) {
            const { data: rpcResult } = await admin.rpc('merge_wallets', {
              p_source: verification.payload.sourceCustomerId,
              p_target: user.id,
            });
            const mergeOutcome = rpcResult as RpcContracts['merge_wallets']['Returns'] | null;

            if (mergeOutcome?.result === 'merged') {
              await admin.rpc('log_audit_event', {
                p_actor: user.id,
                p_action: 'customer_merge_token_used',
                p_target: verification.payload.nonce,
                p_detail: {
                  source_customer: verification.payload.sourceCustomerId,
                  target_customer: user.id,
                },
              });
            }
          }
        }
      }
    } catch (error) {
      logSecurityEvent('error', 'auth_callback_merge_failed', {
        customerId: user.id,
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  const redirectResponse = NextResponse.redirect(new URL(nextPath, request.url), 303);

  if (mergeCookie) {
    redirectResponse.cookies.set(MERGE_INTENT_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  return redirectResponse;
}
