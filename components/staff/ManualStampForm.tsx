'use client';

import { useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type StaffManualStampRequest,
  type StaffManualStampResponse,
} from '@/lib/contracts';

export function ManualStampForm() {
  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<StaffManualStampResponse | null>(null);

  function resetForm() {
    setCustomerId('');
    setReason('');
    setErrorMessage(null);
    setSuccessData(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessData(null);

    const cleanCustomerId = customerId.trim();
    const cleanReason = reason.trim();

    if (!cleanCustomerId) {
      setErrorMessage('Customer UUID is required.');
      return;
    }

    if (cleanReason.length < 3) {
      setErrorMessage('Audit reason must be at least 3 characters long.');
      return;
    }

    setLoading(true);

    try {
      const payload: StaffManualStampRequest = {
        customerId: cleanCustomerId,
        reason: cleanReason,
      };

      const res = await fetch(ROUTES.api.staff.stamp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as ApiResponse<StaffManualStampResponse>;

      if (!res.ok || !body.ok) {
        const errorText = !body.ok ? body.message : 'Failed to issue manual stamp.';
        setErrorMessage(errorText);
        return;
      }

      setSuccessData(body.data);
      setCustomerId('');
      setReason('');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Network error issuing manual loyalty stamp.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-xl space-y-6">
      {/* Form Card */}
      <div className="rounded-lg border border-[#27272A] bg-[#121214] p-6 text-white sm:p-8">
        <h2 className="text-xl font-black tracking-tight uppercase sm:text-2xl">
          Issue Manual Stamp
        </h2>
        <p className="mt-1 text-xs text-[#A1A1AA]">
          Bypass NFC tap when a customer&apos;s phone has broken NFC hardware or iOS issues. A clear
          reason is required and recorded in the immutable audit log.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="manual-customer-id"
              className="block text-xs font-bold tracking-wider text-[#A1A1AA] uppercase"
            >
              Customer UUID
            </label>
            <input
              id="manual-customer-id"
              type="text"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              disabled={loading}
              className="mt-1.5 w-full rounded border border-[#27272A] bg-[#0A0A0A] px-3 py-2 font-mono text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
            <p className="mt-1 text-[11px] text-[#A1A1AA]">
              Copy the full UUID from the customer&apos;s digital card or support ticket.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="manual-stamp-reason"
                className="block text-xs font-bold tracking-wider text-[#A1A1AA] uppercase"
              >
                Reason for Manual Stamp (Required for Audit Log)
              </label>
              <span className="text-[11px] font-mono text-[#A1A1AA]">{reason.length}/280</span>
            </div>
            <textarea
              id="manual-stamp-reason"
              required
              minLength={3}
              maxLength={280}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer iPhone 11 NFC antenna failing; verified receipt #4092 for espresso."
              disabled={loading}
              className="mt-1.5 w-full rounded border border-[#27272A] bg-[#0A0A0A] p-3 text-xs text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !customerId.trim() || reason.trim().length < 3}
            aria-busy={loading}
            className="w-full rounded border border-white bg-white px-5 py-3 text-xs font-black tracking-widest text-black uppercase transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
          >
            {loading ? 'Recording Stamp...' : 'Award Manual Stamp'}
          </button>
        </form>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-red-500/60 bg-red-950/40 p-5 text-sm text-red-200"
        >
          <p className="font-bold text-red-100 uppercase tracking-wide">Stamp Request Failed</p>
          <p className="mt-1 text-xs text-red-200">{errorMessage}</p>
        </div>
      )}

      {/* Success Banner */}
      {successData && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border-2 border-white bg-[#121214] p-6 text-white shadow-xl sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-base font-black text-black">
              ✓
            </span>
            <div>
              <p className="text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
                Manual Stamp Awarded
              </p>
              <h3 className="text-xl font-black tracking-tight uppercase sm:text-2xl">
                STAMP RECORDED — RESULT: {successData.result.toUpperCase()}
              </h3>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 border-y border-[#27272A] py-4 text-xs sm:grid-cols-2">
            <div>
              <span className="text-[#A1A1AA] uppercase tracking-wider block">Customer</span>
              <span className="font-mono font-bold text-white text-sm">
                Card #{successData.customerId.slice(0, 8).toUpperCase()}
              </span>
              <span className="font-mono text-[10px] text-[#A1A1AA] block truncate">
                {successData.customerId}
              </span>
            </div>
            <div>
              <span className="text-[#A1A1AA] uppercase tracking-wider block">Updated Balance</span>
              <span className="font-mono font-bold text-white text-sm">
                {successData.availableStampsAfter} stamps available
              </span>
            </div>
          </div>

          <div className="mt-3 text-xs">
            <span className="text-[#A1A1AA] uppercase tracking-wider block">Logged Reason</span>
            <p className="mt-1 rounded bg-[#0A0A0A] p-2.5 font-mono text-[11px] text-neutral-300 border border-[#27272A]">
              &ldquo;{successData.reason}&rdquo;
            </p>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={resetForm}
              className="w-full rounded border border-white bg-white px-5 py-2.5 text-xs font-black tracking-widest text-black uppercase transition-transform active:scale-[0.99] hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]"
            >
              Issue Another Stamp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
