import type { VerifyTapResult } from '@/lib/contracts';

const TAG_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
const COUNTER_HEX_REGEX = /^[0-9A-Fa-f]{6}$/;
const COMBINED_MIRROR_REGEX = /^([0-9A-Fa-f]{14})[xX]([0-9A-Fa-f]{6})$/;

export interface VerifyTapInput {
  tagId: string;
  /**
   * Optional query parameters from the tap URL.
   * Supports NTAG215 counter mirror (`?c=000013`) and combined UID+counter mirror (`?m=04930D01590F13x000013`).
   */
  query?: Record<string, string | string[] | undefined>;
}

/**
 * Isolated NFC tap verification boundary (`verifyTap`).
 *
 * Supports NXP NTAG215 static URL mode, counter mirror mode (?c=),
 * and combined factory UID + counter mirror mode (?m=).
 *
 * Dynamic NTAG 424 DNA SUN verification will extend this contract with CMAC signature checks.
 */
export function verifyTap(input: VerifyTapInput): VerifyTapResult {
  const trimmed = typeof input.tagId === 'string' ? input.tagId.trim() : '';

  if (!TAG_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      reason: 'malformed-tag-id',
    };
  }

  const rawC = input.query?.c;
  const cVal = Array.isArray(rawC) ? rawC[0] : rawC;
  const rawM = input.query?.m;
  const mVal = Array.isArray(rawM) ? rawM[0] : rawM;

  let tapCounter: number | null = null;
  let hardwareUid: string | null = null;

  if (mVal !== undefined) {
    const trimmedM = typeof mVal === 'string' ? mVal.trim() : '';
    const match = trimmedM.match(COMBINED_MIRROR_REGEX);
    if (!match || !match[1] || !match[2]) {
      return {
        valid: false,
        reason: 'malformed-tag-id',
      };
    }
    hardwareUid = match[1].toUpperCase();
    tapCounter = parseInt(match[2], 16);
  } else if (cVal !== undefined) {
    const trimmedC = typeof cVal === 'string' ? cVal.trim() : '';
    if (!COUNTER_HEX_REGEX.test(trimmedC)) {
      return {
        valid: false,
        reason: 'malformed-tag-id',
      };
    }
    tapCounter = parseInt(trimmedC, 16);
  }

  return {
    valid: true,
    normalizedTagId: trimmed,
    mode: 'ntag215-static',
    ...(tapCounter !== null ? { tapCounter } : {}),
    ...(hardwareUid !== null ? { hardwareUid } : {}),
  };
}
