'use client';

import { useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type StaffRedeemConfirmData,
  type StaffRedeemPreviewData,
  type StaffRedeemRequest,
  type StaffRedeemResponse,
} from '@/lib/contracts';

export function RedeemRewardForm() {
  const [tokenInput, setTokenInput] = useState('');
  const [activeToken, setActiveToken] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [preview, setPreview] = useState<StaffRedeemPreviewData | null>(null);
  const [confirmResult, setConfirmResult] = useState<StaffRedeemConfirmData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function resetAll() {
    setTokenInput('');
    setActiveToken('');
    setPreview(null);
    setConfirmResult(null);
    setErrorMessage(null);
  }

  async function handleVerify(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanToken = tokenInput.trim();
    if (!cleanToken) {
      setErrorMessage('Please scan or paste a customer redemption token.');
      return;
    }

    setLoadingPreview(true);
    setErrorMessage(null);
    setPreview(null);
    setConfirmResult(null);

    try {
      const payload: StaffRedeemRequest = {
        action: 'preview',
        token: cleanToken,
      };

      const res = await fetch(ROUTES.api.staff.redeem, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as ApiResponse<StaffRedeemResponse>;

      if (!res.ok || !body.ok) {
        const errorText = !body.ok ? body.message : 'Failed to verify token.';
        setErrorMessage(errorText);
        return;
      }

      if (body.data.mode === 'preview') {
        setPreview(body.data);
        setActiveToken(cleanToken);
      } else {
        setErrorMessage('Unexpected response mode from verification endpoint.');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Network error verifying customer redemption token.',
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirm() {
    if (!preview || !activeToken) return;

    setLoadingConfirm(true);
    setErrorMessage(null);

    try {
      const payload: StaffRedeemRequest = {
        action: 'confirm',
        token: activeToken,
      };

      const res = await fetch(ROUTES.api.staff.redeem, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as ApiResponse<StaffRedeemResponse>;

      if (!res.ok || !body.ok) {
        const errorText = !body.ok ? body.message : 'Redemption failed.';
        setErrorMessage(errorText);
        return;
      }

      if (body.data.mode === 'confirm') {
        setConfirmResult(body.data);
        setPreview(null);
      } else {
        setErrorMessage('Unexpected response mode from confirmation endpoint.');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Network error confirming reward redemption.',
      );
    } finally {
      setLoadingConfirm(false);
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-6">
      {/* Input Section */}
      <div className="rounded-lg border border-[#27272A] bg-[#121214] p-6 text-white sm:p-8">
        <h2 className="text-xl font-black tracking-tight uppercase sm:text-2xl">
          Customer Reward Redemption
        </h2>
        <p className="mt-1 text-xs text-[#A1A1AA]">
          Scan or paste the customer&apos;s 5-minute QR code token to preview balance and deduct 10
          stamps for a free coffee.
        </p>

        <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="redeem-token-input"
              className="block text-xs font-bold tracking-wider text-[#A1A1AA] uppercase"
            >
              Customer Redemption Token (Scan or Paste)
            </label>
            <textarea
              id="redeem-token-input"
              rows={3}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Paste raw signed QR token payload here or scan via 2D handheld scanner..."
              disabled={loadingPreview || loadingConfirm}
              className="mt-2 w-full rounded border border-[#27272A] bg-[#0A0A0A] p-3 font-mono text-xs text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loadingPreview || loadingConfirm || !tokenInput.trim()}
              aria-busy={loadingPreview}
              className="rounded border border-white bg-white px-5 py-2.5 text-xs font-black tracking-widest text-black uppercase transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
            >
              {loadingPreview ? 'Verifying Token...' : 'Verify Token & Check Balance'}
            </button>

            {(preview || confirmResult || tokenInput) && (
              <button
                type="button"
                onClick={resetAll}
                disabled={loadingPreview || loadingConfirm}
                className="rounded border border-[#27272A] bg-[#1C1C1F] px-4 py-2.5 text-xs font-bold tracking-wider text-[#A1A1AA] uppercase transition-colors hover:border-white hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-red-500/60 bg-red-950/40 p-5 text-sm text-red-200"
        >
          <p className="font-bold text-red-100 uppercase tracking-wide">Verification Error</p>
          <p className="mt-1 text-xs text-red-200">{errorMessage}</p>
        </div>
      )}

      {/* Step 1: Preview Card */}
      {preview && (
        <div
          aria-label="Token Verification Preview"
          className="rounded-lg border border-white/40 bg-[#121214] p-6 text-white shadow-xl sm:p-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#27272A] pb-4">
            <div>
              <p className="font-mono text-xs font-semibold text-[#A1A1AA] uppercase">
                Customer Identity
              </p>
              <p className="mt-0.5 font-mono text-sm font-bold text-white">
                Card #{preview.customerId.slice(0, 8).toUpperCase()}
              </p>
              <p className="font-mono text-[11px] text-[#A1A1AA]">{preview.customerId}</p>
            </div>

            {preview.canRedeem ? (
              <span className="rounded bg-white px-3 py-1 font-mono text-xs font-black tracking-widest text-black uppercase">
                ELIGIBLE FOR FREE COFFEE
              </span>
            ) : (
              <span className="rounded border border-red-500/50 bg-red-950/50 px-3 py-1 font-mono text-xs font-bold tracking-wider text-red-300 uppercase">
                INSUFFICIENT STAMPS
              </span>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Display Code */}
            <div className="rounded border border-[#27272A] bg-[#0A0A0A] p-4 text-center">
              <p className="text-xs font-bold tracking-wider text-[#A1A1AA] uppercase">
                Verification Code
              </p>
              <p className="mt-2 font-mono text-3xl font-black tracking-widest text-white">
                {preview.displayCode}
              </p>
              <p className="mt-1 text-[11px] text-[#A1A1AA]">
                Match with digits on customer&apos;s phone screen
              </p>
            </div>

            {/* Current Balance */}
            <div className="rounded border border-[#27272A] bg-[#0A0A0A] p-4 text-center">
              <p className="text-xs font-bold tracking-wider text-[#A1A1AA] uppercase">
                Current Balance
              </p>
              <p className="mt-2 font-mono text-3xl font-black text-white">
                {preview.availableStamps}{' '}
                <span className="text-sm font-normal text-[#A1A1AA]">stamps available</span>
              </p>
              <p className="mt-1 text-[11px] text-[#A1A1AA]">
                Lifetime: {preview.totalStamps} earned / {preview.stampsRedeemed} redeemed
              </p>
            </div>
          </div>

          {/* Action */}
          <div className="mt-6 border-t border-[#27272A] pt-6">
            {preview.canRedeem ? (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loadingConfirm}
                aria-busy={loadingConfirm}
                className="w-full rounded border border-white bg-white px-6 py-3.5 text-xs font-black tracking-widest text-black uppercase transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
              >
                {loadingConfirm ? 'Deducting 10 Stamps...' : 'Confirm & Redeem 10 Stamps'}
              </button>
            ) : (
              <div className="rounded border border-[#27272A] bg-[#0A0A0A] p-4 text-center text-xs text-[#A1A1AA]">
                Customer has {preview.availableStamps} stamps. 10 stamps are required to redeem a
                free coffee reward.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Confirmation Card */}
      {confirmResult && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border-2 border-white bg-[#121214] p-6 text-white shadow-2xl sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-base font-black text-black">
              ✓
            </span>
            <div>
              <p className="text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
                Transaction Successful
              </p>
              <h3 className="text-xl font-black tracking-tight uppercase sm:text-2xl">
                REWARD REDEEMED — 10 STAMPS DEDUCTED
              </h3>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 border-y border-[#27272A] py-4 text-xs sm:grid-cols-3">
            <div>
              <span className="text-[#A1A1AA] uppercase tracking-wider block">Customer ID</span>
              <span className="font-mono font-bold text-white text-sm">
                Card #{confirmResult.customerId.slice(0, 8).toUpperCase()}
              </span>
            </div>
            <div>
              <span className="text-[#A1A1AA] uppercase tracking-wider block">Code Matched</span>
              <span className="font-mono font-bold text-white text-sm">
                {confirmResult.displayCode}
              </span>
            </div>
            <div>
              <span className="text-[#A1A1AA] uppercase tracking-wider block">
                Remaining Balance
              </span>
              <span className="font-mono font-bold text-white text-sm">
                {confirmResult.availableStampsAfter} stamps
              </span>
            </div>
          </div>

          <p className="mt-4 text-xs text-[#A1A1AA]">{confirmResult.message}</p>

          <div className="mt-6">
            <button
              type="button"
              onClick={resetAll}
              className="w-full rounded border border-white bg-white px-5 py-2.5 text-xs font-black tracking-widest text-black uppercase transition-transform active:scale-[0.99] hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
            >
              Scan Next Customer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
