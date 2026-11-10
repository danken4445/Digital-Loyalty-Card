import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  OFFLINE_CARDS_STORAGE_KEY,
  clearAllOfflineCards,
  readOfflineCards,
  removeOfflineCard,
  saveOfflineCard,
  type OfflineCardSnapshot,
} from '@/lib/offline/cardCache';
import { MemberStampQrPanel } from '@/components/card/MemberStampQrPanel';

(globalThis as any).React = React;

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const SAMPLE_SNAPSHOT: OfflineCardSnapshot = {
  customerId: '11111111-1111-4111-8111-111111111111',
  tenantId: '7c1f0000-0000-4000-8000-000000000001',
  tenantSlug: 'caffeine-plug',
  tenantName: 'The Caffeine Plug',
  displayName: 'Alex Rivera',
  availableStamps: 3,
  rewardThreshold: 10,
  rewardLabel: 'Free Coffee',
  memberToken: 'tcpm1.payload.sig',
  displayCode: 'ABCD-2345',
  qrSvg: '<svg data-testid="member-qr-svg"></svg>',
  updatedAtIso: '2026-11-10T00:00:00.000Z',
};

describe('Offline Card Cache & MemberStampQrPanel', () => {
  it('saves, reads, removes single shop card, and clears all cards on wallet delete', () => {
    const storage = createMemoryStorage();
    saveOfflineCard(SAMPLE_SNAPSHOT, storage);
    saveOfflineCard(
      { ...SAMPLE_SNAPSHOT, tenantSlug: 'second-shop', tenantName: 'Second Shop' },
      storage,
    );

    const all = readOfflineCards(storage);
    expect(Object.keys(all)).toEqual(['caffeine-plug', 'second-shop']);

    removeOfflineCard('caffeine-plug', storage);
    expect(Object.keys(readOfflineCards(storage))).toEqual(['second-shop']);

    clearAllOfflineCards(storage);
    expect(readOfflineCards(storage)).toEqual({});
  });

  it('handles_corrupted_local_storage_json_gracefully', () => {
    const storage = createMemoryStorage();
    storage.setItem(OFFLINE_CARDS_STORAGE_KEY, '{not-valid-json');
    expect(readOfflineCards(storage)).toEqual({});
  });

  it('renders collapsed toggle button when online and auto-expands with offline banner when initialOffline=true', () => {
    const onlineHtml = renderToStaticMarkup(
      React.createElement(MemberStampQrPanel, {
        snapshot: SAMPLE_SNAPSHOT,
        initialOffline: false,
      }),
    );
    expect(onlineHtml).toContain('Show Member QR');
    expect(onlineHtml).not.toContain('OFFLINE MODE');

    const offlineHtml = renderToStaticMarkup(
      React.createElement(MemberStampQrPanel, {
        snapshot: SAMPLE_SNAPSHOT,
        initialOffline: true,
      }),
    );
    expect(offlineHtml).toContain('OFFLINE MODE');
    expect(offlineHtml).toContain('ABCD-2345');
    expect(offlineHtml).toContain('data-testid="member-qr-svg"');
  });
});

