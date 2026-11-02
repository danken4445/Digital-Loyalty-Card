'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export interface CardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CardError({ error, reset }: CardErrorProps) {
  useEffect(() => {
    // Log unexpected runtime error for client diagnostics
    console.error('CardPage runtime error:', error);
  }, [error]);

  return (
    <main
      aria-label="Error loading loyalty card"
      className="min-h-dvh w-full bg-topo-pattern bg-street-grid flex flex-col items-center justify-between px-4 py-6 sm:py-10"
    >
      {/* Top Header Label */}
      <div className="w-full max-w-[390px] flex items-center justify-between text-[10px] font-mono tracking-widest text-plug-muted uppercase px-1 pb-3">
        <span>NFC LOYALTY CARD</span>
        <span className="text-red-400 font-bold">ERROR</span>
      </div>

      {/* High-Contrast Error Card Shell */}
      <section
        role="alert"
        aria-live="assertive"
        className="w-full max-w-[390px] bg-plug-surface/95 border border-red-500/50 rounded-2xl p-6 sm:p-7 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md relative overflow-hidden flex flex-col items-center text-center"
      >
        {/* Error Icon Badge */}
        <div className="w-14 h-14 rounded-full bg-red-950/60 border border-red-500/60 flex items-center justify-center text-red-400 mb-4 shadow-inner">
          <svg
            className="w-7 h-7"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 className="font-display text-xl sm:text-2xl font-black uppercase tracking-wider text-white">
          CARD UNAVAILABLE
        </h1>

        <p className="font-sans text-sm text-neutral-300 mt-2 leading-relaxed">
          We couldn&apos;t load your loyalty card right now.
        </p>

        <p className="text-xs font-mono text-plug-muted uppercase tracking-wider mt-1">
          Please check your connection and try again.
        </p>

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-2.5 mt-6">
          <button
            type="button"
            onClick={() => reset()}
            className="w-full py-3.5 px-4 bg-white text-black font-display font-black text-xs tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_15px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            TRY AGAIN
          </button>

          <Link
            href="/"
            className="w-full py-3 px-4 bg-plug-elevated text-white font-mono font-bold text-xs tracking-wider uppercase border border-plug-border hover:bg-zinc-800 transition-all select-none flex items-center justify-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            RETURN TO HOME
          </Link>
        </div>
      </section>

      {/* Streetwear Footer */}
      <footer className="w-full max-w-[390px] text-center text-[10px] font-mono tracking-widest text-plug-muted uppercase pt-4">
        <span>THE CAFFEINE PLUG &copy; 2026 // STREETWEAR LOYALTY</span>
      </footer>
    </main>
  );
}
