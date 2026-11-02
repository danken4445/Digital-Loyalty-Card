import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { SECURITY_CONFIG, getServerEnv } from '@/lib/config';
import type {
  IssuedRedeemToken,
  RedeemTokenPayload,
  VerifyRedeemTokenResult,
} from '@/lib/contracts';

const TOKEN_PREFIX = 'tcp1';
const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

const redeemTokenPayloadSchema = z.object({
  customerId: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  nonce: z.string().min(8).max(64),
});

export interface IssueRedeemTokenOptions {
  nowMs?: number;
  ttlSeconds?: number;
  secretOverride?: string;
  nonceOverride?: string;
}

export interface VerifyRedeemTokenOptions {
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
 * Derives an 8-character uppercase alphanumeric fingerprint (XXXX-XXXX) from the HMAC signature
 * so staff can visually cross-verify the customer's screen against the scanned token.
 */
export function deriveDisplayCode(signature: Buffer): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // unambiguous crockford-like alphabet
  let chars = '';
  for (let i = 0; i < 8; i++) {
    const byte = signature[i] ?? 0;
    chars += alphabet[byte % alphabet.length];
  }
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/**
 * Issues a short-lived (default 5-minute) HMAC-SHA256 signed redemption token
 * and generates a self-contained monochrome SVG QR code without external network calls.
 */
export async function issueRedeemToken(
  customerId: string,
  options: IssueRedeemTokenOptions = {},
): Promise<IssuedRedeemToken> {
  const parsedCustomerId = z.string().uuid().parse(customerId);
  const secret = resolveSecret(options.secretOverride);
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttlSeconds = options.ttlSeconds ?? SECURITY_CONFIG.redeemTokenTtlSeconds;

  const payload: RedeemTokenPayload = {
    customerId: parsedCustomerId,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    nonce: options.nonceOverride ?? randomBytes(12).toString('base64url'),
  };

  const payloadB64Url = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureBuf = computeSignature(payloadB64Url, secret);
  const signatureB64Url = signatureBuf.toString('base64url');
  const token = `${TOKEN_PREFIX}.${payloadB64Url}.${signatureB64Url}`;
  const displayCode = deriveDisplayCode(signatureBuf);

  const qrSvg = await QRCode.toString(token, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
    color: {
      dark: '#0A0A0A',
      light: '#FFFFFF',
    },
  });

  return {
    token,
    payload,
    expiresAtIso: new Date(payload.exp * 1000).toISOString(),
    ttlSeconds,
    displayCode,
    qrSvg,
  };
}

/**
 * Verifies a signed redemption token in constant time and checks its 5-minute expiration window.
 */
export function verifyRedeemToken(
  token: string,
  options: VerifyRedeemTokenOptions = {},
): VerifyRedeemTokenResult {
  if (typeof token !== 'string') {
    return { valid: false, reason: 'invalid-token' };
  }

  const trimmed = token.trim();
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

  const parsedPayload = redeemTokenPayloadSchema.safeParse(decodedPayload);
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
    displayCode: deriveDisplayCode(expectedSigBuf),
  };
}
