import { NextResponse, type NextRequest } from 'next/server';
import { ensureCustomerRecord } from '@/lib/auth/customer';
import { MERGE_INTENT_COOKIE_NAME, ROUTES } from '@/lib/contracts';
import { logSecurityEvent } from '@/lib/security/logger';
import { verifyMergeIntentToken } from '@/lib/security/mergeToken';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

interface MergeRpcClient {
  rpc: (
    fn: 'merge_anonymous_customer',
    args: { p_source_customer: string; p_target_customer: string },
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get('code');
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
          const { data: existingNonce } = await admin
            .from('audit_log')
            .select('id')
            .eq('action', 'customer_merge_token_used')
            .eq('target', verification.payload.nonce)
            .maybeSingle();

          if (!existingNonce) {
            const { data: rpcResult } = await (admin as unknown as MergeRpcClient).rpc(
              'merge_anonymous_customer',
              {
                p_source_customer: verification.payload.sourceCustomerId,
                p_target_customer: user.id,
              },
            );

            if (rpcResult === 'merged') {
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
