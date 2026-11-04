'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ApiResponse, TenantStatus } from '@/lib/contracts';

interface TenantStatusFormProps {
  slug: string;
  currentStatus: TenantStatus;
}

export function TenantStatusForm({ slug, currentStatus }: TenantStatusFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<TenantStatus>(currentStatus);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      setErrorMessage('Reason must be at least 5 characters long.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/platform/tenants/${encodeURIComponent(slug)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          reason: trimmedReason,
        }),
      });

      const body: ApiResponse<{ status: TenantStatus }> = await res.json();

      if (!res.ok || !body.ok) {
        setErrorMessage(body.ok === false ? body.message : 'Failed to update tenant status.');
        setSubmitting(false);
        return;
      }

      setSuccessMessage(`Tenant status successfully updated to ${status}.`);
      setReason('');
      setSubmitting(false);
      router.refresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-sm text-rose-300"
        >
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="rounded-xl border border-emerald-800 bg-emerald-950/60 p-4 text-sm text-emerald-300"
        >
          {successMessage}
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-white">Target Operational Status</label>
        <p className="mb-3 text-xs text-plug-muted">
          Suspension halts new customer stamps immediately while allowing redemptions for 30 days.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(['active', 'trial', 'suspended'] as const).map((s) => {
            const isSelected = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex min-h-11 items-center justify-center rounded-xl border px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                  isSelected
                    ? s === 'active'
                      ? 'border-emerald-500 bg-emerald-950 text-emerald-300'
                      : s === 'trial'
                        ? 'border-amber-500 bg-amber-950 text-amber-300'
                        : 'border-rose-500 bg-rose-950 text-rose-300'
                    : 'border-plug-border bg-plug-elevated text-plug-muted hover:border-neutral-600 hover:text-white'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="status-reason" className="block text-sm font-semibold text-white">
          Mandatory Audit Reason
        </label>
        <p className="mb-2 text-xs text-plug-muted">
          Required for compliance logging (minimum 5 characters).
        </p>
        <textarea
          id="status-reason"
          required
          minLength={5}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Account subscription active; resuming operations."
          className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-white placeholder-neutral-500 transition-colors focus:border-white focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || (status === currentStatus && !reason.trim())}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white bg-white px-5 py-2.5 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
      >
        {submitting ? 'Updating Status...' : 'Apply Status Change'}
      </button>
    </form>
  );
}
