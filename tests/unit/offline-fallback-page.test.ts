import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  saveOfflineCard,
  clearAllOfflineCards,
  type OfflineCardSnapshot,
} from '@/lib/offline/cardCache';
import OfflinePage from '@/app/offline/page';
import { OfflineCardViewer } from '@/components/offline/OfflineCardViewer';
import { OfflineServiceWorkerRegister } from '@/components/offline/OfflineServiceWorkerRegister';
import { config as middlewareConfig } from '@/middleware';

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

const SAMPLE_SNAPSHOT_1: OfflineCardSnapshot = {
  customerId: '11111111-1111-4111-8111-111111111111',
  tenantId: '7c1f0000-0000-4000-8000-000000000001',
  tenantSlug: 'caffeine-plug',
  tenantName: 'The Caffeine Plug',
  displayName: 'Alex Rivera',
  availableStamps: 4,
  rewardThreshold: 10,
  rewardLabel: 'Free Coffee',
  memberToken: 'tcpm1.payload.sig',
  displayCode: 'ABCD-2345',
  qrSvg: '<svg data-testid="offline-qr-svg-1"></svg>',
  updatedAtIso: '2026-11-10T00:00:00.000Z',
};

const SAMPLE_SNAPSHOT_2: OfflineCardSnapshot = {
  customerId: '22222222-2222-4222-8222-222222222222',
  tenantId: '7c1f0000-0000-4000-8000-000000000002',
  tenantSlug: 'tokyo-roast',
  tenantName: 'Tokyo Roast',
  displayName: null,
  availableStamps: 7,
  rewardThreshold: 8,
  rewardLabel: 'Pastry',
  memberToken: 'tcpm1.tokyo.sig',
  displayCode: 'TKRO-9988',
  qrSvg: '<svg data-testid="offline-qr-svg-2"></svg>',
  updatedAtIso: '2026-11-10T01:00:00.000Z',
};

describe('Task 5: Offline Fallback Page (/offline) & Service Worker (public/sw.js)', () => {
  it('middleware config excludes sw.js from Next.js session parsing', () => {
    const matcherPattern = middlewareConfig.matcher[0];
    expect(matcherPattern).toContain('sw.js');
  });

  it('public/sw.js exists and contains offline cache fallback logic', () => {
    const swPath = path.join(process.cwd(), 'public', 'sw.js');
    expect(fs.existsSync(swPath)).toBe(true);

    const swContent = fs.readFileSync(swPath, 'utf8');
    expect(swContent).toContain("addEventListener('install'");
    expect(swContent).toContain("addEventListener('fetch'");
    expect(swContent).toContain('/offline');
    // Ensure sensitive routes are never cached
    expect(swContent).toContain('/api/');
    expect(swContent).toContain('/staff/');
    expect(swContent).toContain('/auth/');
  });

  it('OfflineServiceWorkerRegister renders safely in SSR without throwing', () => {
    const html = renderToStaticMarkup(React.createElement(OfflineServiceWorkerRegister));
    expect(html).toBe('');
  });

  it('renders offline page default export without throwing', () => {
    const html = renderToStaticMarkup(React.createElement(OfflinePage));
    expect(html).toContain('Offline Mode');
  });

  it('renders offline page empty state when no cards are stored in localStorage', () => {
    const storage = createMemoryStorage();
    const html = renderToStaticMarkup(
      React.createElement(OfflineCardViewer, { storageOverride: storage }),
    );

    expect(html).toContain('Offline Mode');
    expect(html).toContain('No saved loyalty cards found on this device');
  });

  it('renders cached loyalty cards with scannable QR and stamp count', () => {
    const storage = createMemoryStorage();
    saveOfflineCard(SAMPLE_SNAPSHOT_1, storage);
    saveOfflineCard(SAMPLE_SNAPSHOT_2, storage);

    const html = renderToStaticMarkup(
      React.createElement(OfflineCardViewer, { storageOverride: storage }),
    );

    expect(html).toContain('The Caffeine Plug');
    expect(html).toContain('ABCD-2345');
    expect(html).toContain('data-testid="offline-qr-svg-1"');
    expect(html).toContain('4 / 10 stamps');

    expect(html).toContain('Tokyo Roast');
    expect(html).toContain('TKRO-9988');
    expect(html).toContain('data-testid="offline-qr-svg-2"');
    expect(html).toContain('7 / 8 stamps');
  });
});
