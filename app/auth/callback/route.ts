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

  let nextPath: string = ROUTES.card;
  if (
    rawNext &&
    rawNext.startsWith('/') &&
    !rawNext.startsWith('//') &&
    !rawNext.startsWith('/\\')
  ) {
    nextPath = rawNext;
  }

  if (code) {
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.exchangeCodeForSession(code);
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
      await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: rawOtpType as EmailOtpType,
      });
    } catch (error) {
      logSecurityEvent('error', 'auth_callback_otp_verify_failed', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  const user = await getVerifiedUser();
  const mergeCookie = request.cookies.get(MERGE_INTENT_COOKIE_NAME)?.value;

  if (user) {
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
