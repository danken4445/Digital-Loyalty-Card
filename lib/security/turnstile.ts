import 'server-only';
import { z } from 'zod';

const TURNSTILE_VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CLOUDFLARE_DUMMY_SECRET = '1x0000000000000000000000000000000AA';

const turnstileSiteverifyResponseSchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
});

export interface TurnstileVerificationResult {
  success: boolean;
  errorCodes: string[];
}

/**
 * Verifies a Cloudflare Turnstile token server-side.
 *
 * Note on Supabase Auth integration:
 * When Supabase Auth has CAPTCHA enabled in production, `supabase.auth.signInAnonymously({ options: { captchaToken } })`
 * consumes the single-use Turnstile token directly at the Supabase Auth (GoTrue) layer.
 * This helper is used when server-side endpoints verify Turnstile tokens directly or in local/test environments.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string | null,
): Promise<TurnstileVerificationResult> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 2048) {
    return {
      success: false,
      errorCodes: ['missing-or-invalid-input-response'],
    };
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY ?? CLOUDFLARE_DUMMY_SECRET;

  // In local development or test runs using Cloudflare's official dummy secret key,
  // accept non-empty tokens deterministically so offline/CI tests do not require external network calls.
  if (secretKey === CLOUDFLARE_DUMMY_SECRET) {
    if (trimmed === 'FAIL_TOKEN') {
      return {
        success: false,
        errorCodes: ['invalid-input-response'],
      };
    }
    return {
      success: true,
      errorCodes: [],
    };
  }

  try {
    const formData = new URLSearchParams();
    formData.set('secret', secretKey);
    formData.set('response', trimmed);
    if (remoteIp) {
      formData.set('remoteip', remoteIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      return {
        success: false,
        errorCodes: [`http-${response.status}`],
      };
    }

    const rawJson: unknown = await response.json();
    const parsed = turnstileSiteverifyResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      return {
        success: false,
        errorCodes: ['malformed-siteverify-response'],
      };
    }

    return {
      success: parsed.data.success,
      errorCodes: parsed.data['error-codes'] ?? [],
    };
  } catch {
    return {
      success: false,
      errorCodes: ['siteverify-network-error'],
    };
  }
}
