'use client';

import { useEffect, useState } from 'react';
import {
  saveOfflineCard,
  type OfflineCardSnapshot,
} from '@/lib/offline/cardCache';

export interface MemberStampQrPanelProps {
  snapshot: OfflineCardSnapshot;
  /** Optional override for deterministic SSR/unit testing of offline state. */
  initialOffline?: boolean;
}

export function MemberStampQrPanel({
  snapshot,
  initialOffline = false,
}: MemberStampQrPanelProps) {
  const [isOffline, setIsOffline] = useState<boolean>(initialOffline);
  const [isOpen, setIsOpen] = useState<boolean>(initialOffline);

  useEffect(() => {
    // Cache current card snapshot locally whenever loaded
    saveOfflineCard(snapshot);

    const updateOnlineStatus = () => {
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      setIsOffline(offline);
      if (offline) {
        setIsOpen(true);
      }
    };

    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, [snapshot]);

  return (
    <div className="w-full mt-4">
      {/* Toggle Button when Online and not already open */}
      {!isOpen && !isOffline && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full py-2.5 px-4 rounded-xl border border-plug-border bg-plug-elevated/70 hover:bg-plug-elevated text-neutral-300 hover:text-white font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <svg
            className="h-3.5 w-3.5 text-neutral-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M7 7h.01" />
            <path d="M17 7h.01" />
            <path d="M7 17h.01" />
            <path d="M17 17h.01" />
          </svg>
          <span>No signal or NFC trouble? Show Member QR</span>
        </button>
      )}

      {/* Expanded QR Code Card */}
      {(isOpen || isOffline) && (
        <div
          role="region"
          aria-label="Member Stamp QR Code"
          className="w-full rounded-2xl border-2 border-white/60 bg-plug-black/95 p-5 text-white flex flex-col items-center text-center shadow-xl"
        >
          {/* Offline Banner */}
          {isOffline && (
            <div
              role="status"
              aria-live="polite"
              className="w-full mb-3 rounded-xl border border-amber-400 bg-amber-500/10 px-3 py-1.5 text-xs font-mono font-bold tracking-wider text-amber-300 uppercase"
            >
              OFFLINE MODE • SHOW QR TO BARISTA TO STAMP
            </div>
          )}

          <div className="flex items-center justify-between w-full mb-3">
            <span className="font-mono text-xs font-bold uppercase tracking-wider text-plug-muted">
              Member Stamp QR
            </span>
            {!isOffline && (
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs font-mono text-plug-muted hover:text-white underline"
              >
                Hide QR
              </button>
            )}
          </div>

          {/* SVG QR Code Display */}
          <div
            role="img"
            aria-label={`Member stamp QR code for card ${snapshot.displayCode}`}
            className="relative bg-white p-3 rounded-xl border-2 border-white shadow-md flex items-center justify-center w-52 h-52 max-w-full overflow-hidden"
          >
            {snapshot.qrSvg.startsWith('<svg') ? (
              <div
                dangerouslySetInnerHTML={{ __html: snapshot.qrSvg }}
                className="w-full h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
              />
            ) : (
              <span className="text-xs font-mono text-black">QR unavailable</span>
            )}
          </div>

          {/* Display Code & Customer Badge */}
          <div className="mt-3 flex flex-col items-center gap-1">
            <span className="font-mono text-xl font-black tracking-widest text-white">
              {snapshot.displayCode}
            </span>
            <span className="font-mono text-[11px] text-plug-muted">
              Card #{snapshot.customerId.slice(0, 8).toUpperCase()}
            </span>
            <p className="mt-1 text-[11px] text-neutral-400 max-w-xs">
              Show this to the barista if you have no internet signal or NFC is unavailable.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

