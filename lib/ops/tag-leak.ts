import type { TagLeakSignal } from '@/lib/contracts';

/**
 * Validates and normalizes raw tag leak signals returned from database RPC or API response.
 * Safely handles null, undefined, unauthorized error objects, and malformed entries.
 */
export function evaluateTagLeakSignals(raw: unknown): TagLeakSignal[] {
  if (!raw || !Array.isArray(raw)) {
    return [];
  }

  const validSignals: TagLeakSignal[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    const tagId = typeof candidate.tagId === 'string' ? candidate.tagId.trim() : '';
    const distinctCustomers =
      typeof candidate.distinctCustomers === 'number' && !Number.isNaN(candidate.distinctCustomers)
        ? candidate.distinctCustomers
        : 0;
    const throttleRejections =
      typeof candidate.throttleRejections === 'number' && !Number.isNaN(candidate.throttleRejections)
        ? candidate.throttleRejections
        : 0;

    if (!tagId) {
      continue;
    }

    validSignals.push({
      tagId,
      distinctCustomers,
      throttleRejections,
    });
  }

  return validSignals;
}
