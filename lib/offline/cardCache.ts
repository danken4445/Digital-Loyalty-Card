export const OFFLINE_CARDS_STORAGE_KEY = 'tcp_offline_cards_v1' as const;

export interface OfflineCardSnapshot {
  customerId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  displayName: string | null;
  availableStamps: number;
  rewardThreshold: number;
  rewardLabel: string;
  memberToken: string;
  displayCode: string;
  qrSvg: string;
  updatedAtIso: string;
}

export type OfflineStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(): OfflineStorage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
  return null;
}

export function readOfflineCards(
  storageOverride?: Pick<Storage, 'getItem'> | null,
): Record<string, OfflineCardSnapshot> {
  const storage = storageOverride !== undefined ? storageOverride : resolveStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(OFFLINE_CARDS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    const validated: Record<string, OfflineCardSnapshot> = {};
    for (const [slug, item] of Object.entries(parsed)) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as OfflineCardSnapshot).tenantSlug === 'string' &&
        typeof (item as OfflineCardSnapshot).memberToken === 'string' &&
        typeof (item as OfflineCardSnapshot).qrSvg === 'string'
      ) {
        validated[slug] = item as OfflineCardSnapshot;
      }
    }
    return validated;
  } catch {
    return {};
  }
}

export function saveOfflineCard(
  snapshot: OfflineCardSnapshot,
  storageOverride?: Pick<Storage, 'getItem' | 'setItem'> | null,
): void {
  const storage = storageOverride !== undefined ? storageOverride : resolveStorage();
  if (!storage) {
    return;
  }

  try {
    const existing = readOfflineCards(storage);
    existing[snapshot.tenantSlug] = snapshot;

    // Retain up to 10 most recently updated shops
    const slugs = Object.keys(existing);
    if (slugs.length > 10) {
      slugs.sort((a, b) => {
        const timeA = new Date(existing[a]?.updatedAtIso ?? 0).getTime();
        const timeB = new Date(existing[b]?.updatedAtIso ?? 0).getTime();
        return timeB - timeA;
      });
      const pruned: Record<string, OfflineCardSnapshot> = {};
      for (const slug of slugs.slice(0, 10)) {
        if (existing[slug]) pruned[slug] = existing[slug];
      }
      storage.setItem(OFFLINE_CARDS_STORAGE_KEY, JSON.stringify(pruned));
      return;
    }

    storage.setItem(OFFLINE_CARDS_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // quota exceeded or storage disabled
  }
}

export function removeOfflineCard(
  tenantSlug: string,
  storageOverride?: Pick<Storage, 'getItem' | 'setItem'> | null,
): void {
  const storage = storageOverride !== undefined ? storageOverride : resolveStorage();
  if (!storage) {
    return;
  }

  try {
    const existing = readOfflineCards(storage);
    if (existing[tenantSlug]) {
      delete existing[tenantSlug];
      storage.setItem(OFFLINE_CARDS_STORAGE_KEY, JSON.stringify(existing));
    }
  } catch {
    // ignore
  }
}

export function clearAllOfflineCards(
  storageOverride?: Pick<Storage, 'removeItem'> | null,
): void {
  const storage = storageOverride !== undefined ? storageOverride : resolveStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(OFFLINE_CARDS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

