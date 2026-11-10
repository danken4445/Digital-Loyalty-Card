'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readOfflineCards, type OfflineCardSnapshot } from '@/lib/offline/cardCache';

export interface OfflinePageProps {
  /** Optional storage override for deterministic SSR/unit testing */
  storageOverride?: Pick<Storage, 'getItem'> | null;
}

export default function OfflinePage({ storageOverride }: OfflinePageProps) {
  const [cards, setCards] = useState<Record<string, OfflineCardSnapshot>>(() =>
    readOfflineCards(storageOverride),
  );
  const [isOnline, setIsOnline] = useState<boolean>(false);

  useEffect(() => {
    // Re-read storage on client mount
    setCards(readOfflineCards(storageOverride));

    const checkOnline = () => {
      setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : false);
    };

    checkOnline();
    window.addEventListener('online', checkOnline);
    window.addEventListener('offline', checkOnline);

    return () => {
      window.removeEventListener('online', checkOnline);
      window.removeEventListener('offline', checkOnline);
    };
  }, [storageOverride]);

  const cardList = Object.values(cards);

  return (
    <main
      aria-label="Offline Loyalty Cards"
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-8 text-white selection:bg-white selection:text-black"
    >
      <div className="w-full max-w-md flex flex-col items-center">
        {/* Connection status banner */}
        {isOnline ? (
          <div
            role="status"
            className="w-full mb-6 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-center"
          >
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">
              Connection Restored
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 text-xs font-mono underline hover:text-white"
            >
              Reload to view live card
            </button>
          </div>
        ) : (
          <div
            role="status"
            className="w-full mb-6 rounded-2xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-center"
          >
            <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-amber-400">
              Offline Mode
            </span>
            <p className="mt-1 text-xs text-neutral-300">
              Showing cached cards. Show your Member Stamp QR to the barista to claim stamps.
            </p>
          </div>
        )}

        {cardList.length === 0 ? (
          <section
            aria-label="No Saved Cards"
            className="w-full rounded-3xl border border-plug-border bg-plug-surface/95 p-8 text-center shadow-2xl backdrop-blur-md"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-900 border border-neutral-800 text-neutral-400">
              <svg
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </div>
            <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              No saved loyalty cards found on this device
            </h1>
            <p className="mt-3 text-sm text-neutral-400 leading-relaxed">
              Open your shop loyalty card once while connected to the internet to save it for offline stamping.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full rounded-xl bg-white px-5 py-3 font-mono text-xs font-black uppercase tracking-wider text-black transition-colors hover:bg-neutral-200"
            >
              Try Reconnecting
            </button>
          </section>
        ) : (
          <div className="w-full space-y-6">
            {cardList.map((card) => (
              <section
                key={card.tenantSlug}
                aria-label={`${card.tenantName} Offline Card`}
                className="w-full rounded-3xl border border-plug-border bg-plug-surface/95 p-6 shadow-2xl backdrop-blur-md flex flex-col items-center text-center"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">
                  {card.displayName ?? 'Valued Customer'}
                </span>
                <h2 className="mt-1 font-display text-3xl font-bold uppercase tracking-wide text-white">
                  {card.tenantName}
                </h2>
                <p className="mt-1 font-mono text-xs font-semibold text-neutral-300">
                  {card.availableStamps} / {card.rewardThreshold} stamps
                </p>

                {/* Scannable QR Code Box */}
                <div className="mt-5 flex flex-col items-center">
                  <div className="rounded-2xl bg-white p-3 shadow-lg">
                    <div
                      className="w-52 h-52 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: card.qrSvg }}
                    />
                  </div>

                  <div className="mt-3 font-mono text-xs text-neutral-400">
                    Backup Code:{' '}
                    <span className="font-bold tracking-wider text-white select-all">
                      {card.displayCode}
                    </span>
                  </div>
                </div>

                <p className="mt-4 text-xs text-neutral-400">
                  Show this QR code to the barista to claim your stamp while offline.
                </p>
              </section>
            ))}

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900/80 px-4 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-neutral-300 hover:text-white transition-colors"
            >
              Check Connection & Reload
            </button>
          </div>
        )}
      </div>

      <footer className="mt-8 text-center">
        <Link
          href="/privacy"
          className="text-xs text-neutral-500 hover:text-neutral-400 underline underline-offset-4"
        >
          Privacy & Data Rights (RA 10173)
        </Link>
      </footer>
    </main>
  );
}
