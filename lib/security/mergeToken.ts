import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { SECURITY_CONFIG, getServerEnv } from '@/lib/config';
import type {
  IssuedMergeIntent,
  MergeIntentPayload,
  VerifyMergeIntentResult,
} from '@/lib/contracts';

const TOKEN_PREFIX = 'tcp_merge1';
const DEFAULT_MERGE_TTL_SECONDS = 600; // 10 minutes
const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

const mergeIntentPayloadSchema = z.object({
  sourceCustomerId: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  nonce: z.string().min(8).max(64),
});

export interface IssueMergeIntentOptions {
  nowMs?: number;
  ttlSeconds?: number;
  secretOverride?: string;
  nonceOverride?: string;
}

export interface VerifyMergeIntentOptions {
  nowMs?: number;
  secretOverride?: string;
}

function resolveSecret(secretOverride?: string): string {
  const secret = secretOverride ?? getServerEnv().REDEEM_TOKEN_SECRET;
  if (!secret || secret.length < SECURITY_CONFIG.minRedeemSecretLength) {
    throw new Error(
      `REDEEM_TOKEN_SECRET must be at least ${SECURITY_CONFIG.minRedeemSecretLength} characters.`,
    );
  }
  return secret;
}

function computeSignature(payloadB64Url: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${TOKEN_PREFIX}.${payloadB64Url}`).digest();
}

/**
 * Issues a short-lived (default 10-minute) HMAC-SHA256 signed merge intent token
 * proving that the current browser session was authenticated as the anonymous sourceCustomerId
 * prior to signing in to an existing backed-up Google or email account.
 */
export function issueMergeIntentToken(
  sourceCustomerId: string,
  options: IssueMergeIntentOptions = {},
): IssuedMergeIntent {
  const parsedSourceId = z.string().uuid().parse(sourceCustomerId);
  const secret = resolveSecret(options.secretOverride);
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_MERGE_TTL_SECONDS;

  const payload: MergeIntentPayload = {
    sourceCustomerId: parsedSourceId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    nonce: options.nonceOverride ?? randomBytes(12).toString('base64url'),
  };

  const payloadB64Url = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureB64Url = computeSignature(payloadB64Url, secret).toString('base64url');
  const mergeToken = `${TOKEN_PREFIX}.${payloadB64Url}.${signatureB64Url}`;

  return {
    mergeToken,
    payload,
    expiresAtIso: new Date(payload.exp * 1000).toISOString(),
    ttlSeconds,
  };
}

/**
 * Verifies a signed merge intent token in constant time and checks its 10-minute expiration window.
 */
export function verifyMergeIntentToken(
  mergeToken: string,
  options: VerifyMergeIntentOptions = {},
): VerifyMergeIntentResult {
  if (typeof mergeToken !== 'string') {
    return { valid: false, reason: 'invalid-token' };
  }

  const trimmed = mergeToken.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'invalid-token' };
  }

  const [prefix, payloadB64Url, signatureB64Url] = parts;
  if (prefix !== TOKEN_PREFIX || !payloadB64Url || !signatureB64Url) {
    return { valid: false, reason: 'invalid-token' };
  }

  let secret: string;
  try {
    secret = resolveSecret(options.secretOverride);
  } catch {
    return { valid: false, reason: 'invalid-token' };
  }

  let providedSigBuf: Buffer;
  try {
    providedSigBuf = Buffer.from(signatureB64Url, 'base64url');
  } catch {
    return { valid: false, reason: 'invalid-token' };
  }

  const expectedSigBuf = computeSignature(payloadB64Url, secret);
  if (
    providedSigBuf.length !== expectedSigBuf.length ||
    !timingSafeEqual(providedSigBuf, expectedSigBuf)
  ) {
    return { valid: false, reason: 'invalid-token' };
  }

  let decodedPayload: unknown;
  try {
    const jsonStr = Buffer.from(payloadB64Url, 'base64url').toString('utf8');
    decodedPayload = JSON.parse(jsonStr);
  } catch {
    return { valid: false, reason: 'invalid-token' };
  }

  const parsedPayload = mergeIntentPayloadSchema.safeParse(decodedPayload);
  if (!parsedPayload.success) {
    return { valid: false, reason: 'invalid-token' };
  }

  const payload = parsedPayload.data;
  if (payload.exp <= payload.iat) {
    return { valid: false, reason: 'invalid-token' };
  }

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload.iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'invalid-token' };
  }

  if (nowSeconds > payload.exp) {
    return { valid: false, reason: 'expired-token' };
  }

  return {
    valid: true,
    payload,
  };
}
