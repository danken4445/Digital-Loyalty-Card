'use client';

import { useState } from 'react';
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
}

/**
 * Consent step for a signed-in customer who has no card at this shop yet: one tap adds the shop
 * to their wallet (and claims the pending stamp when they arrived from a tag).
 */
export function AddCardPanel({ tenantSlug, tenantName, rewardLabel, tagId }: AddCardPanelProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAdd = async () => {
    if (isLoading) {
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

      router.push(json.data.redirectTo);
      router.refresh();
    } catch {
      setErrorMessage('Network connection error. Please try again.');
      setIsLoading(false);
    }
  };

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
