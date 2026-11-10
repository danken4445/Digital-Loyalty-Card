import Link from 'next/link';
import { ROUTES } from '@/lib/contracts';

export interface BackToWalletButtonProps {
  href?: string;
  className?: string;
}

/**
 * Accessible back navigation button returning customers from a shop's loyalty card
 * back to their collectible wallets view. Styled with the platform's high-contrast
 * streetwear design language.
 */
export function BackToWalletButton({
  href = ROUTES.wallets,
  className = '',
}: BackToWalletButtonProps) {
  return (
    <div
      className={`w-full max-w-[390px] flex items-center justify-between text-xs font-mono tracking-widest uppercase mb-3 px-1 ${className}`}
    >
      <Link
        href={href}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-plug-border/70 bg-plug-surface/80 px-3.5 py-1.5 text-xs font-medium text-neutral-300 shadow-sm backdrop-blur transition-colors hover:border-neutral-500 hover:bg-plug-elevated hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Back to wallets"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        <span>Back</span>
      </Link>
      <span className="text-[10px] text-neutral-500 font-semibold tracking-wider">
        DIGITAL WALLET
      </span>
    </div>
  );
}
