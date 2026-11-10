import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { SECURITY_CONFIG, getServerEnv } from '@/lib/config';
import {
  MEMBER_STAMP_TOKEN_PREFIX,
  type IssuedMemberStampToken,
  type MemberStampTokenPayload,
  type VerifyMemberStampTokenResult,
} from '@/lib/contracts';
import { deriveDisplayCode } from '@/lib/security/redeemToken';

const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

const memberStampTokenPayloadSchema = z.object({
  customerId: z.string().uuid(),
  tenantId: z.string().uuid(),
  iat: z.number().int().nonnegative(),
});

export interface IssueMemberStampTokenOptions {
  nowMs?: number;
  secretOverride?: string;
}

export interface VerifyMemberStampTokenOptions {
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
  return createHmac('sha256', secret)
    .update(`${MEMBER_STAMP_TOKEN_PREFIX}.${payloadB64Url}`)
    .digest();
}

/**
 * Issues a shop-bound HMAC-SHA256 signed Member Stamp token (tcpm1) and SVG QR code
 * that the customer can display online or offline for staff to scan on /staff/stamp.
 */
export async function issueMemberStampToken(
  customerId: string,
  tenantId: string,
  options: IssueMemberStampTokenOptions = {},
): Promise<IssuedMemberStampToken> {
  const parsedCustomerId = z.string().uuid().parse(customerId);
  const parsedTenantId = z.string().uuid().parse(tenantId);
  const secret = resolveSecret(options.secretOverride);
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);

  const payload: MemberStampTokenPayload = {
    customerId: parsedCustomerId,
    tenantId: parsedTenantId,
    iat: nowSeconds,
  };

  const payloadB64Url = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signatureBuf = computeSignature(payloadB64Url, secret);
  const signatureB64Url = signatureBuf.toString('base64url');
  const token = `${MEMBER_STAMP_TOKEN_PREFIX}.${payloadB64Url}.${signatureB64Url}`;
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
    displayCode,
    qrSvg,
  };
}

/**
 * Verifies a signed Member Stamp token (tcpm1) in constant time.
 */
export function verifyMemberStampToken(
  token: string,
  options: VerifyMemberStampTokenOptions = {},
): VerifyMemberStampTokenResult {
  if (typeof token !== 'string') {
    return { valid: false, reason: 'invalid-token' };
  }

  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'invalid-token' };
  }

  const [prefix, payloadB64Url, signatureB64Url] = parts;
  if (prefix !== MEMBER_STAMP_TOKEN_PREFIX || !payloadB64Url || !signatureB64Url) {
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

  const parsedPayload = memberStampTokenPayloadSchema.safeParse(decodedPayload);
  if (!parsedPayload.success) {
    return { valid: false, reason: 'invalid-token' };
  }

  const payload = parsedPayload.data;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload.iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'invalid-token' };
  }

  return {
    valid: true,
    payload,
    displayCode: deriveDisplayCode(expectedSigBuf),
  };
}
