import 'server-only';

/**
 * Cloudflare Turnstile integration notes:
 *
 * Server-side manual verification via `verifyTurnstileToken` was pruned (Deferred Minor #7).
 * In DigitalLoyalty, Supabase Auth directly consumes Turnstile captcha tokens at the GoTrue layer
 * via `supabase.auth.signInAnonymously({ options: { captchaToken } })`, signInWithPassword, and signInWithOtp.
 * Client widget rendering is managed by `components/auth/TurnstileWidget.tsx`.
 */
export {};
