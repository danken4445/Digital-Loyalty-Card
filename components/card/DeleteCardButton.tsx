'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ROUTES,
  type ApiResponse,
  type DeleteCardResponse,
  type DeleteCustomerResponse,
} from '@/lib/contracts';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface DeleteCardButtonProps {
  customerId?: string | null;
  variant?: 'compact' | 'full';
  /**
   * 'wallet' (default) erases the whole wallet: every card and the account.
   * 'card' (or alias 'shop') removes only the card of `tenantSlug`; the customer's other cards stay.
   */
  scope?: 'wallet' | 'card' | 'shop';
  tenantSlug?: string;
  tenantName?: string;
}

export const REMOVE_CARD_LABEL = 'Remove this card';
export const DELETE_WALLET_LABEL = 'Delete my wallet & data';

export function removeCardNotice(tenantName: string): string {
  return `Removes your ${tenantName} card and its stamps. Your other cards stay.`;
}

export function DeleteCardButton({
  customerId: _customerId,
  variant = 'full',
  scope = 'wallet',
  tenantSlug,
  tenantName,
}: DeleteCardButtonProps) {
  const isCardScope = (scope === 'card' || scope === 'shop') && Boolean(tenantSlug);
  const buttonLabel = isCardScope ? REMOVE_CARD_LABEL : DELETE_WALLET_LABEL;
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [isDeleted, setIsDeleted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isDeleted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full rounded-xl border border-neutral-700 bg-plug-elevated p-4 text-center font-mono text-xs font-bold uppercase tracking-wider text-neutral-200"
      >
        {isCardScope
          ? 'Your card has been removed.'
          : 'Your wallet and all associated data have been permanently erased.'}
      </div>
    );
  }

  const handleRemoveCard = async () => {
    const response = await fetch(ROUTES.api.cards, {
      method: 'DELETE',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug }),
    });
    const payload = (await response.json().catch(() => null)) as ApiResponse<DeleteCardResponse> | null;
    if (!response.ok || !payload || !payload.ok) {
      setErrorMessage(
        payload && !payload.ok && payload.message
          ? payload.message
          : 'Unable to remove this card. Please try again.',
      );
      setIsDeleting(false);
      return;
    }
    setIsDeleted(true);
    setIsConfirming(false);
    setIsDeleting(false);
    router.push(payload.data.redirectTo);
    router.refresh();
  };

  const handleDelete = async () => {
    if (isDeleting) {
      return;
    }

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      if (isCardScope) {
        await handleRemoveCard();
        return;
      }

      const response = await fetch(ROUTES.api.customers, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        let friendlyMessage = 'No active loyalty card session found to erase.';
        try {
          const payload = (await response.json()) as ApiResponse<DeleteCustomerResponse>;
          if (!payload.ok && payload.message) {
            friendlyMessage = payload.message;
          }
        } catch {
          // Use default friendlyMessage
        }

        setErrorMessage(friendlyMessage);
        setIsDeleting(false);
        return;
      }

      // Customer data successfully deleted. Clean up browser Supabase session if any.
      try {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch {
        // Ignore signout error if session already cleared
      }

      setIsDeleted(true);
      setIsConfirming(false);
      setIsDeleting(false);

      router.push('/card?deleted=1');
      router.refresh();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to connect to service. Please check your connection and try again.';
      setErrorMessage(message);
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setIsConfirming(false);
    setErrorMessage(null);
  };

  if (isConfirming) {
    return (
      <div
        role="region"
        aria-label="Confirm Card Deletion"
        className="w-full rounded-2xl border-2 border-red-500 bg-plug-black p-4 text-center shadow-[0_0_25px_rgba(239,68,68,0.2)]"
      >
        <p className="text-xs sm:text-sm font-sans font-bold text-white leading-relaxed">
          {isCardScope
            ? `Remove your ${tenantName ?? 'shop'} card? ${removeCardNotice(tenantName ?? 'this shop')} This cannot be undone.`
            : 'Are you sure? This permanently erases your whole wallet: every shop card, all stamps, and any linked backup account under RA 10173. This cannot be undone.'}
        </p>

        {errorMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="mt-3 rounded-lg border border-red-500/80 bg-red-950/80 p-2.5 text-xs font-mono text-red-200 text-center leading-relaxed"
          >
            {errorMessage}
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleDelete}
            aria-busy={isDeleting}
            className="w-full sm:w-auto px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-mono text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer active:scale-[0.99]"
          >
            {isDeleting ? 'ERASING...' : isCardScope ? 'YES, REMOVE CARD' : 'YES, PERMANENTLY ERASE'}
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={handleCancel}
            className="w-full sm:w-auto px-4 py-2.5 bg-transparent hover:bg-neutral-800 disabled:opacity-50 text-neutral-300 hover:text-white font-mono text-xs font-bold uppercase tracking-wider border border-neutral-700 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer active:scale-[0.99]"
          >
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  // Initial State
  return (
    <div className="flex flex-col items-center w-full">
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-3 w-full rounded-lg border border-red-500/80 bg-red-950/80 p-2.5 text-xs font-mono text-red-200 text-center leading-relaxed"
        >
          {errorMessage}
        </div>
      )}

      <p className="mb-2 max-w-[300px] text-center text-[11px] leading-snug text-neutral-400">
        {isCardScope
          ? removeCardNotice(tenantName ?? 'this shop')
          : 'Erases every card in your wallet, all stamps, and your account.'}
      </p>

      {variant === 'compact' ? (
        <button
          type="button"
          onClick={() => {
            setIsConfirming(true);
            setErrorMessage(null);
          }}
          className="text-[10px] font-mono font-bold tracking-wider text-neutral-400 hover:text-red-400 transition-colors uppercase underline-offset-4 hover:underline py-1 px-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
        >
          {buttonLabel}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setIsConfirming(true);
            setErrorMessage(null);
          }}
          className="w-full py-3 px-4 rounded-xl border border-neutral-700 bg-plug-elevated hover:bg-neutral-800 hover:border-red-500/50 text-neutral-300 hover:text-white font-mono text-xs font-bold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-[0.99] cursor-pointer"
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}

export default DeleteCardButton;
