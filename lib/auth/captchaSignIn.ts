import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase Auth CAPTCHA (Turnstile) also gates password and OTP/magic-link sign-in,
 * not just anonymous sign-in. These helpers make sure every such call carries the
 * widget token. Tokens are single-use, so callers must reset the widget afterwards.
 */

/** Only the auth surface is needed, so any typed or untyped Supabase client fits. */
type AuthClient = {
  auth: Pick<
    SupabaseClient['auth'],
    'signInWithPassword' | 'signInWithOtp' | 'resetPasswordForEmail'
  >;
};

export function signInStaffWithPassword(
  supabase: AuthClient,
  params: { email: string; password: string; captchaToken: string },
) {
  return supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
    options: { captchaToken: params.captchaToken },
  });
}

export function signInWithEmailLink(
  supabase: AuthClient,
  params: { email: string; emailRedirectTo: string; captchaToken: string },
) {
  return supabase.auth.signInWithOtp({
    email: params.email,
    options: {
      emailRedirectTo: params.emailRedirectTo,
      captchaToken: params.captchaToken,
    },
  });
}

export function requestPasswordReset(
  supabase: AuthClient,
  params: { email: string; redirectTo: string; captchaToken: string },
) {
  return supabase.auth.resetPasswordForEmail(params.email, {
    redirectTo: params.redirectTo,
    captchaToken: params.captchaToken,
  });
}
