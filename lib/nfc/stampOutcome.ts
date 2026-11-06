import { ROUTES, isStampResultCode, type StampResultCode } from '@/lib/contracts';

export interface StampOutcome {
  result: StampResultCode;
  /** Shop the tag belongs to; null only for an unknown tag. */
  tenantSlug: string | null;
}

/** Validates the `stamp_card_nfc` JSON payload; anything unexpected collapses to an invalid tag. */
export function parseStampCardPayload(data: unknown): StampOutcome {
  if (typeof data === 'object' && data !== null) {
    const { result, tenant_slug: tenantSlug } = data as { result?: unknown; tenant_slug?: unknown };
    if (isStampResultCode(result) && result !== 'invalid-tag') {
      if (typeof tenantSlug === 'string' && tenantSlug.length > 0) {
        return { result, tenantSlug };
      }
    }
  }
  return { result: 'invalid-tag', tenantSlug: null };
}

/** Where a tap lands: unknown tag -> /card, no card yet -> add-card screen, otherwise the shop with the result. */
export function stampRedirectPath(
  outcome: StampOutcome,
  tagId: string,
  extra?: Record<string, string | null | undefined>,
): string {
  if (outcome.result === 'invalid-tag' || !outcome.tenantSlug) {
    return ROUTES.cardWithResult('invalid-tag');
  }
  if (outcome.result === 'no-card') {
    return ROUTES.shopAddCard(outcome.tenantSlug, tagId, extra);
  }
  return ROUTES.shopWithResult(outcome.tenantSlug, outcome.result);
}
