'use client';

import { useEffect, useState } from 'react';
import {
  ROUTES,
  type ApiResponse,
  type StaffManualStampRequest,
  type StaffManualStampResponse,
} from '@/lib/contracts';
import { QrCameraScanner } from '@/components/staff/QrCameraScanner';

export const STAMP_QUICK_REASONS = [
  'Customer offline / no signal',
  'NFC antenna unavailable',
  'Counter tag unreachable',
] as const;

export type ScannedStampCodeResult =
  | { kind: 'member-token'; token: string }
  | { kind: 'customer-uuid'; customerId: string }
  | { kind: 'reward-token' }
  | { kind: 'unknown' };

export function classifyScannedStampCode(raw: string): ScannedStampCodeResult {
  const trimmed = raw.trim();
  if (/^tcpm1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { kind: 'member-token', token: trimmed };
  }
  if (/^(tcp2|tcpig2)\./.test(trimmed)) {
    return { kind: 'reward-token' };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return { kind: 'customer-uuid', customerId: trimmed };
  }
  return { kind: 'unknown' };
}

export function ManualStampForm() {
  const [customerId, setCustomerId] = useState('');
  const [memberToken, setMemberToken] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [inputMode, setInputMode] = useState<'camera' | 'manual'>('camera');
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<StaffManualStampResponse | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  function resetForm() {
    setCustomerId('');
    setMemberToken(null);
    setReason('');
    setErrorMessage(null);
    setSuccessData(null);
    setInputMode('camera');
  }

  function handleCameraScan(scannedText: string) {
    setErrorMessage(null);
    const classification = classifyScannedStampCode(scannedText);

    if (classification.kind === 'member-token') {
      setMemberToken(classification.token);
      setCustomerId('');
      if (!reason.trim()) {
        setReason('Customer offline / no signal');
      }
    } else if (classification.kind === 'customer-uuid') {
      setCustomerId(classification.customerId);
      setMemberToken(null);
      if (!reason.trim()) {
        setReason('Customer offline / no signal');
      }
      setInputMode('manual');
    } else if (classification.kind === 'reward-token') {
      setErrorMessage(
        'That looks like a Reward Redemption QR code. Switch to Redeem Reward to scan it.',
      );
    } else {
      setErrorMessage('Unrecognized QR code. Please scan a customer Member Stamp QR code.');
    }
  }

  async function handleSubmit(e?: React.FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    setErrorMessage(null);
    setSuccessData(null);

    const cleanCustomerId = customerId.trim();
    const cleanReason = reason.trim();

    if (!memberToken && !cleanCustomerId) {
      setErrorMessage('Please scan a member QR code or enter a customer UUID.');
      return;
    }

    if (cleanReason.length < 3) {
      setErrorMessage('Audit reason must be at least 3 characters long.');
      return;
    }

    setLoading(true);

    try {
      const payload: StaffManualStampRequest = memberToken
        ? { memberToken, reason: cleanReason }
        : { customerId: cleanCustomerId, reason: cleanReason };

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
      setMemberToken(null);
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
      {!successData && (
        <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-plug-border pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Issue Manual Stamp</h2>
              <p className="mt-0.5 text-xs text-plug-muted">
                Scan customer&apos;s Member QR code or enter their UUID.
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            {isMounted && (
              <div className="flex items-center gap-1.5 rounded-xl border border-plug-border bg-plug-black p-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setInputMode('camera');
                    setErrorMessage(null);
                  }}
                  aria-pressed={inputMode === 'camera'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-colors ${
                    inputMode === 'camera'
                      ? 'bg-white text-plug-black'
                      : 'text-plug-muted hover:text-white'
                  }`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                  Scan QR
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputMode('manual');
                    setErrorMessage(null);
                  }}
                  aria-pressed={inputMode === 'manual'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition-colors ${
                    inputMode === 'manual'
                      ? 'bg-white text-plug-black'
                      : 'text-plug-muted hover:text-white'
                  }`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="M6 8h.001" />
                    <path d="M10 8h.001" />
                    <path d="M14 8h.001" />
                    <path d="M18 8h.001" />
                    <path d="M8 12h.001" />
                    <path d="M12 12h.001" />
                    <path d="M16 12h.001" />
                    <path d="M7 16h10" />
                  </svg>
                  Enter UUID
                </button>
              </div>
            )}
          </div>

          {/* Camera Scanner View */}
          {isMounted && inputMode === 'camera' && !memberToken ? (
            <div className="mt-5 space-y-4">
              <QrCameraScanner
                active={!loading}
                onScan={handleCameraScan}
                onSwitchToManual={() => setInputMode('manual')}
              />
            </div>
          ) : (
            /* Manual Form or Scanned Member Token View */
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {memberToken ? (
                <div className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-xs font-black text-black">
                        ✓
                      </span>
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-200">
                        Member QR Scanned
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMemberToken(null)}
                      className="text-xs text-plug-muted hover:text-white transition-colors"
                    >
                      Clear &amp; Rescan
                    </button>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-neutral-300 truncate">
                    Token: {memberToken.slice(0, 32)}...
                  </p>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="manual-customer-id"
                    className="block text-sm font-medium text-neutral-200"
                  >
                    Customer UUID
                  </label>
                  <input
                    id="manual-customer-id"
                    type="text"
                    required={!memberToken}
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                    disabled={loading}
                    className="mt-1.5 w-full min-h-12 rounded-xl border border-plug-border bg-plug-black px-3 py-2 font-mono text-sm text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  />
                  <p className="mt-1 text-[11px] text-plug-muted">
                    Copy the full UUID from the customer&apos;s digital card or support ticket.
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="manual-stamp-reason"
                    className="block text-sm font-medium text-neutral-200"
                  >
                    Reason for Manual Stamp (Required for Audit Log)
                  </label>
                  <span className="text-[11px] font-mono text-plug-muted">{reason.length}/280</span>
                </div>

                {/* Quick-reason presets */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STAMP_QUICK_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        reason === preset
                          ? 'border-white bg-white text-plug-black font-semibold'
                          : 'border-plug-border bg-plug-elevated text-neutral-300 hover:border-neutral-500 hover:text-white'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <textarea
                  id="manual-stamp-reason"
                  required
                  minLength={3}
                  maxLength={280}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Customer offline / no signal, verified receipt #4092."
                  disabled={loading}
                  className="mt-2 w-full rounded-xl border border-plug-border bg-plug-black p-3 text-xs text-white placeholder-neutral-600 transition-colors focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                />
              </div>

              <button
                type="submit"
                disabled={loading || (!memberToken && !customerId.trim()) || reason.trim().length < 3}
                aria-busy={loading}
                className="w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-5 py-3 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black cursor-pointer"
              >
                {loading ? 'Recording Stamp...' : 'Award Manual Stamp'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-2xl border border-red-500/60 bg-red-950/40 p-5 text-sm text-red-200"
        >
          <p className="font-semibold text-red-100">Stamp Request Failed</p>
          <p className="mt-1 text-xs text-red-200">{errorMessage}</p>
        </div>
      )}

      {/* Success Banner */}
      {successData && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border-2 border-white bg-plug-surface p-6 text-white shadow-xl sm:p-8"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-base font-black text-black">
              ✓
            </span>
            <div>
              <p className="text-sm text-plug-muted">Manual Stamp Awarded</p>
              <h3 className="font-display text-2xl font-bold uppercase tracking-wide">
                STAMP RECORDED — RESULT: {successData.result.toUpperCase()}
              </h3>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 border-y border-plug-border py-4 text-xs sm:grid-cols-2">
            <div>
              <span className="text-plug-muted block">Customer</span>
              <span className="font-mono font-bold text-white text-sm">
                Card #{successData.customerId.slice(0, 8).toUpperCase()}
              </span>
              <span className="font-mono text-[10px] text-plug-muted block truncate">
                {successData.customerId}
              </span>
            </div>
            <div>
              <span className="text-plug-muted block">Updated Balance</span>
              <span className="font-mono font-bold text-white text-sm">
                {successData.availableStampsAfter} stamps available
              </span>
            </div>
          </div>

          <div className="mt-3 text-xs">
            <span className="text-plug-muted block">Logged Reason</span>
            <p className="mt-1 rounded bg-plug-black p-2.5 font-mono text-[11px] text-neutral-300 border border-plug-border">
              &ldquo;{successData.reason}&rdquo;
            </p>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={resetForm}
              className="w-full inline-flex min-h-12 items-center justify-center rounded-xl border border-white bg-white px-5 py-2.5 text-sm font-bold text-plug-black transition-transform active:scale-[0.99] hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-plug-black cursor-pointer"
            >
              Issue Another Stamp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
