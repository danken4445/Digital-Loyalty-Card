'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ROUTES,
  type AddCardRequest,
  type AddCardResponse,
  type ApiResponse,
} from '@/lib/contracts';

export interface AddCardPanelProps {
  tenantSlug: string;
  tenantName: string;
  rewardLabel: string;
  /** Present when the customer arrived from an NFC tap; the stamp is claimed right after the card is added. */
  tagId?: string | null;
  /** When true, the shop is suspended and cannot issue new cards. */
  isSuspended?: boolean;
}

/**
 * Consent step for a signed-in customer who has no card at this shop yet: one tap adds the shop
 * to their wallet (and claims the pending stamp when they arrived from a tag).
 */
export function AddCardPanel({
  tenantSlug,
  tenantName,
  rewardLabel,
  tagId,
  isSuspended = false,
}: AddCardPanelProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAdd = async () => {
    if (isLoading || isSuspended) {
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const trimmedTag = tagId?.trim();
      const body: AddCardRequest = {
        tenantSlug,
        ...(trimmedTag ? { tagId: trimmedTag } : {}),
      };
      const response = await fetch(ROUTES.api.cards, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as ApiResponse<AddCardResponse>;

      if (!response.ok || !json.ok) {
        setErrorMessage(
          !json.ok && json.message ? json.message : 'Unable to add this card. Please try again.',
        );
        setIsLoading(false);
        return;
      }

      if (json.data.result === 'tenant-unavailable') {
        setErrorMessage('This shop is currently paused and not issuing new cards.');
        setIsLoading(false);
        return;
      }

      const separator = json.data.redirectTo.includes('?') ? '&' : '?';
      const redirectWithAdded = `${json.data.redirectTo}${separator}added=1`;
      router.push(redirectWithAdded);
      router.refresh();
    } catch {
      setErrorMessage('Network connection error. Please try again.');
      setIsLoading(false);
    }
  };

  if (isSuspended) {
    return (
      <div className="w-full flex flex-col items-center">
        <div
          role="status"
          aria-live="polite"
          className="w-full mb-3 rounded-2xl border border-yellow-500/50 bg-yellow-950/20 px-4 py-3 text-sm text-yellow-200 text-center"
        >
          This shop is temporarily paused and is not currently issuing new stamp cards.
        </div>
        <p className="text-base font-semibold text-white">{tenantName} loyalty card</p>
        <p className="mt-1 text-sm text-neutral-400">Card creation is currently paused.</p>

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="mt-5 w-full py-4 px-6 bg-neutral-800 text-neutral-400 font-display font-black text-sm tracking-widest uppercase border-2 border-neutral-700 opacity-50 cursor-not-allowed select-none rounded-xl"
        >
          Shop Paused
        </button>

        <p className="mt-4 text-xs text-neutral-400 text-center">
          <Link
            href={ROUTES.shopPrivacy(tenantSlug)}
            className="text-neutral-300 hover:text-white underline underline-offset-2 transition-colors"
          >
            {tenantName}&apos;s Privacy Notice
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center">
      <p className="text-base font-semibold text-white">Add {tenantName} to your wallet</p>
      <p className="mt-1 text-sm text-neutral-300">Collect stamps toward: {rewardLabel}</p>

      <button
        type="button"
        disabled={isLoading}
        aria-disabled={isLoading}
        aria-busy={isLoading}
        onClick={handleAdd}
        className="mt-5 w-full py-4 px-6 bg-white text-black font-display font-black text-sm tracking-widest uppercase border-2 border-white hover:bg-neutral-200 transition-all select-none shadow-[0_0_20px_rgba(255,255,255,0.15)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99] rounded-xl"
      >
        {isLoading ? 'Adding...' : 'Add card'}
      </button>

      <p className="mt-4 text-xs text-neutral-400 text-center">
        By adding this card, you agree to{' '}
        <Link
          href={ROUTES.shopPrivacy(tenantSlug)}
          className="text-neutral-300 hover:text-white underline underline-offset-2 transition-colors"
        >
          {tenantName}&apos;s Privacy Notice
        </Link>
      </p>

      {errorMessage && (
        <p
          role="alert"
          aria-live="assertive"
          className="w-full mt-3 p-3 bg-neutral-900 border border-red-500/60 rounded-xl text-red-200 text-xs font-mono text-center"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}

export default AddCardPanel;
