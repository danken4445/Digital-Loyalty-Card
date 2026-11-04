'use client';

import { useState } from 'react';
import { SHOP_CONFIG, STAMP_RULES } from '@/lib/config';
import {
  ROUTES,
  type ApiResponse,
  type StaffRedeemConfirmData,
  type StaffRedeemPreviewData,
  type StaffRedeemRequest,
  type StaffRedeemResponse,
} from '@/lib/contracts';

export interface RedeemRewardFormProps {
  /** The active shop's reward threshold; falls back to the platform default. */
  rewardThreshold?: number;
  /** The active shop's reward label, e.g. "FREE COFFEE". */
  rewardLabel?: string;
  /** The active shop's Instagram handle for the follow perk. */
  instagramHandle?: string;
}

export function RedeemRewardForm({
  rewardThreshold = STAMP_RULES.rewardThreshold,
  rewardLabel = 'FREE COFFEE',
  instagramHandle = SHOP_CONFIG.instagramHandle,
}: RedeemRewardFormProps = {}) {
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
      <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-white sm:p-8">
        <h2 className="text-lg font-semibold text-white">Customer Reward Redemption</h2>

        <form onSubmit={handleVerify} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="redeem-token-input"
              className="block text-sm font-medium text-neutral-200"
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
              className="mt-2 w-full rounded-xl border border-plug-border bg-plug-black p-3 font-mono text-xs text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loadingPreview || loadingConfirm || !tokenInput.trim()}
              aria-busy={loadingPreview}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-5 py-2.5 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black"
            >
              {loadingPreview ? 'Verifying Token...' : 'Verify Token & Check Balance'}
            </button>

            {(preview || confirmResult || tokenInput) && (
              <button
                type="button"
                onClick={resetAll}
                disabled={loadingPreview || loadingConfirm}
                className="inline-flex min-h-12 items-center rounded-xl border border-plug-border bg-plug-elevated px-4 text-sm font-semibold text-neutral-300 transition-colors hover:border-white hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
          className="rounded-2xl border border-red-500/60 bg-red-950/40 p-5 text-sm text-red-200"
        >
          <p className="font-semibold text-red-100">Verification Error</p>
          <p className="mt-1 text-xs text-red-200">{errorMessage}</p>
        </div>
      )}

      {/* Step 1: Preview Card */}
      {preview && (
        <div
          aria-label="Token Verification Preview"
          className="rounded-2xl border border-white/40 bg-plug-surface p-6 text-white shadow-xl sm:p-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-plug-border pb-4">
            <div>
              <p className="text-sm text-plug-muted">Customer Identity</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-white">
                Card #{preview.customerId.slice(0, 8).toUpperCase()}
              </p>
              <p className="font-mono text-[11px] text-plug-muted">{preview.customerId}</p>
            </div>

            {preview.rewardKind === 'instagram-upsize' ? (
              preview.canRedeem ? (
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-plug-black">
                  INSTAGRAM PERK • FREE UPSIZE
                </span>
              ) : (
                <span className="rounded-full border border-red-500/50 bg-red-950/50 px-3 py-1 text-xs font-semibold text-red-300">
                  UPSIZE ALREADY USED
                </span>
              )
            ) : preview.canRedeem ? (
              <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-plug-black">
                ELIGIBLE FOR {rewardLabel.toUpperCase()}
              </span>
            ) : (
              <span className="rounded-full border border-red-500/50 bg-red-950/50 px-3 py-1 text-xs font-semibold text-red-300">
                INSUFFICIENT STAMPS
              </span>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Display Code */}
            <div className="rounded-xl border border-plug-border bg-plug-black p-4 text-center">
              <p className="text-sm text-plug-muted">Verification Code</p>
              <p className="mt-2 font-mono text-3xl font-black tracking-widest text-white">
                {preview.displayCode}
              </p>
              <p className="mt-1 text-[11px] text-plug-muted">
                Match with digits on customer&apos;s phone screen
              </p>
            </div>

            {/* Current Balance */}
            <div className="rounded-xl border border-plug-border bg-plug-black p-4 text-center">
              <p className="text-sm text-plug-muted">Current Balance</p>
              <p className="mt-2 font-mono text-3xl font-black text-white">
                {preview.availableStamps}{' '}
                <span className="text-sm font-normal text-plug-muted">stamps available</span>
              </p>
              <p className="mt-1 text-[11px] text-plug-muted">
                Lifetime: {preview.totalStamps} earned / {preview.stampsRedeemed} redeemed
              </p>
            </div>
          </div>

          {/* Action */}
          <div className="mt-6 border-t border-plug-border pt-6">
            {preview.rewardKind === 'instagram-upsize' ? (
              preview.canRedeem ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/40 bg-plug-black p-4 text-sm text-neutral-200">
                    <p className="font-semibold text-white">Before you confirm</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-300">
                      Ask the customer to open Instagram on their phone and show that they follow{' '}
                      <span className="font-semibold text-white">{instagramHandle}</span> (the
                      profile button should say &ldquo;Following&rdquo;). No stamps are used.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={loadingConfirm}
                    aria-busy={loadingConfirm}
                    className="w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-6 py-3.5 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black"
                  >
                    {loadingConfirm ? 'Granting Upsize...' : 'Follow Checked — Grant Free Upsize'}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-plug-border bg-plug-black p-4 text-center text-xs text-plug-muted">
                  This card has already used its one-time Instagram upsize.
                </div>
              )
            ) : preview.canRedeem ? (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={loadingConfirm}
                aria-busy={loadingConfirm}
                className="w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-6 py-3.5 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black"
              >
                {loadingConfirm
                  ? `Deducting ${rewardThreshold} Stamps...`
                  : `Confirm & Redeem ${rewardThreshold} Stamps`}
              </button>
            ) : (
              <div className="rounded-xl border border-plug-border bg-plug-black p-4 text-center text-xs text-plug-muted">
                Customer has {preview.availableStamps} stamps. {rewardThreshold} stamps are required
                to redeem:
                {rewardLabel}.
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
          className="rounded-2xl border-2 border-white bg-plug-surface p-6 text-white shadow-2xl sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-base font-black text-black">
              {confirmResult.result === 'redeemed' ? '✓' : '✕'}
            </span>
            <div>
              <p className="text-sm text-plug-muted">
                {confirmResult.result === 'redeemed' ? 'Transaction Successful' : 'Not Redeemed'}
              </p>
              <h3 className="font-display text-2xl font-bold uppercase tracking-wide">
                {confirmResult.result !== 'redeemed'
                  ? 'NOTHING WAS GIVEN'
                  : confirmResult.rewardKind === 'instagram-upsize'
                    ? 'FREE UPSIZE GRANTED — NO STAMPS USED'
                    : `REWARD REDEEMED — ${rewardThreshold} STAMPS DEDUCTED`}
              </h3>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 border-y border-plug-border py-4 text-xs sm:grid-cols-3">
            <div>
              <span className="text-plug-muted block">Customer ID</span>
              <span className="font-mono font-bold text-white text-sm">
                Card #{confirmResult.customerId.slice(0, 8).toUpperCase()}
              </span>
            </div>
            <div>
              <span className="text-plug-muted block">Code Matched</span>
              <span className="font-mono font-bold text-white text-sm">
                {confirmResult.displayCode}
              </span>
            </div>
            <div>
              <span className="text-plug-muted block">Remaining Balance</span>
              <span className="font-mono font-bold text-white text-sm">
                {confirmResult.availableStampsAfter} stamps
              </span>
            </div>
          </div>

          <p className="mt-4 text-xs text-plug-muted">{confirmResult.message}</p>

          <div className="mt-6">
            <button
              type="button"
              onClick={resetAll}
              className="w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-5 py-2.5 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black"
            >
              Scan Next Customer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
