'use client';

import { useEffect, useState } from 'react';

export function AddCardCelebrationBanner() {
  const [isDismissed, setIsDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Strip ?added= query parameter using replaceState without re-triggering navigation
    if (window.location.search) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('added')) {
        url.searchParams.delete('added');
        const remainingSearch = url.searchParams.toString();
        const targetPath = remainingSearch ? `${url.pathname}?${remainingSearch}` : url.pathname;
        window.history.replaceState(null, '', targetPath);
      }
    }

    const timer = setTimeout(() => {
      setIsDismissed(true);
    }, 6000);

    return () => clearTimeout(timer);
  }, []);

  if (isDismissed) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="add-card-moment-banner"
      className="banner-enter mb-3 w-full max-w-[390px] rounded-2xl border border-emerald-500/40 bg-emerald-950/80 px-4 py-3 text-sm text-emerald-200 flex items-center justify-between gap-3 shadow-lg shadow-black/40 backdrop-blur-md"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
          aria-hidden="true"
        />
        <span className="font-semibold text-white">Card added to your wallet!</span>
      </div>
      <button
        type="button"
        onClick={() => setIsDismissed(true)}
        aria-label="Dismiss banner"
        className="text-emerald-400 hover:text-white transition-colors text-xs font-mono px-1.5 py-0.5 rounded cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}

export default AddCardCelebrationBanner;
