import type { VerifyTapResult } from '@/lib/contracts';

const TAG_ID_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

export interface VerifyTapInput {
  tagId: string;
  /**
   * Optional query parameters from the tap URL.
   * Reserved for Phase 9 NTAG 424 DNA (SUN) dynamic `picc_data` and `cmac` verification.
   */
  query?: Record<string, string | string[] | undefined>;
}

/**
 * Isolated NFC tap verification boundary (`verifyTap`).
 *
 * Current v1 implementation (NXP NTAG215):
 * Validates that the static random tag identifier is well-formed (`8..128` URL-safe characters).
 * Authoritative active-status and 5-second per-tag throttle checks execute atomically inside
 * Postgres `public.record_stamp`.
 *
 * Future upgrade path (Phase 9 NTAG 424 DNA SUN):
 * Swap internals here to verify AES-128 CMAC signature + monotonic tap counter from `query`
 * without changing route handler callers.
 */
export function verifyTap(input: VerifyTapInput): VerifyTapResult {
  const trimmed = typeof input.tagId === 'string' ? input.tagId.trim() : '';

  if (!TAG_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      reason: 'malformed-tag-id',
    };
  }

  return {
    valid: true,
    normalizedTagId: trimmed,
    mode: 'ntag215-static',
  };
}
