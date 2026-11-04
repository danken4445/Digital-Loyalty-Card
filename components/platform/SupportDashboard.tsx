'use client';

import { useEffect, useState } from 'react';
import type { ApiResponse, SupportActivityRow, SupportTenantOverview } from '@/lib/contracts';

interface SupportDashboardProps {
  slug: string;
  initialSessionId?: string;
}

export function SupportDashboard({ slug, initialSessionId }: SupportDashboardProps) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId ?? null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [overview, setOverview] = useState<SupportTenantOverview | null>(null);
  const [activity, setActivity] = useState<SupportActivityRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Live countdown timer
  useEffect(() => {
    if (!expiresAt) {
      setRemainingSeconds(null);
      return;
    }

    function calculate() {
      const diffMs = new Date(expiresAt!).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(diffMs / 1000));
      setRemainingSeconds(secs);
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Fetch overview and activity when active sessionId is present
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    async function loadSessionData() {
      setLoadingData(true);
      try {
        const [overviewRes, activityRes] = await Promise.all([
          fetch('/api/platform/support', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'overview', sessionId }),
          }),
          fetch('/api/platform/support', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'activity', sessionId, limit: 50 }),
          }),
        ]);

        if (cancelled) return;

        const overviewJson: ApiResponse<SupportTenantOverview> = await overviewRes.json();
        const activityJson: ApiResponse<{ activity: SupportActivityRow[] }> =
          await activityRes.json();

        if (overviewJson.ok && overviewJson.data) {
          setOverview(overviewJson.data);
        } else if (!overviewJson.ok) {
          setErrorMessage(overviewJson.message ?? 'Support session unauthorized or expired.');
          setSessionId(null);
        }

        if (activityJson.ok && activityJson.data?.activity) {
          setActivity(activityJson.data.activity);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Failed to load support session data.');
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    }

    loadSessionData();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleStartSession(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10) {
      setErrorMessage('Reason must be at least 10 characters long.');
      return;
    }

    setStarting(true);
    try {
      const res = await fetch('/api/platform/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          slug,
          reason: trimmedReason,
        }),
      });

      const body: ApiResponse<{ sessionId: string; expiresAt: string }> = await res.json();
      if (!res.ok || !body.ok || !body.data) {
        setErrorMessage(body.ok === false ? body.message : 'Failed to start support session.');
        setStarting(false);
        return;
      }

      setSessionId(body.data.sessionId);
      setExpiresAt(body.data.expiresAt);
      setReason('');
      setStarting(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Network error.');
      setStarting(false);
    }
  }

  async function handleEndSession() {
    if (!sessionId) return;
    setEnding(true);
    try {
      await fetch('/api/platform/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'end',
          sessionId,
        }),
      });

      setSessionId(null);
      setExpiresAt(null);
      setOverview(null);
      setActivity([]);
      setRemainingSeconds(null);
    } catch {
      setErrorMessage('Failed to end support session cleanly.');
    } finally {
      setEnding(false);
    }
  }

  function formatCountdown(totalSecs: number | null) {
    if (totalSecs === null) return '--:--';
    if (totalSecs <= 0) return 'EXPIRED';
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return (
    <div className="space-y-8">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-sm text-rose-300"
        >
          {errorMessage}
        </div>
      )}

      {!sessionId ? (
        <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
            Initiate Support Session
          </h2>
          <p className="mt-1 text-sm text-plug-muted">
            Start a time-boxed, 30-minute read-only support session for this merchant. Only
            pseudonymous, aggregated metrics and audit entries are exposed.
          </p>

          <form onSubmit={handleStartSession} className="mt-6 space-y-5">
            <div>
              <label htmlFor="support-reason" className="block text-sm font-semibold text-white">
                Ticket / Support Justification
              </label>
              <p className="mb-2 text-xs text-plug-muted">
                Document why platform admin access is requested (minimum 10 characters).
              </p>
              <textarea
                id="support-reason"
                required
                minLength={10}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Investigating customer point sync dispute for ticket #4829."
                className="w-full rounded-xl border border-plug-border bg-plug-elevated px-4 py-3 text-sm text-white placeholder-neutral-500 transition-colors focus:border-white focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={starting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white bg-white px-6 py-2.5 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
            >
              {starting ? 'Starting Session...' : 'Start 30-Minute Support Session'}
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Session Status & Live Countdown Bar */}
          <div className="flex flex-col gap-4 rounded-2xl border border-amber-800/80 bg-amber-950/40 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                  Active Read-Only Support Session
                </span>
              </div>
              <p className="font-mono text-xs text-neutral-400">Session ID: {sessionId}</p>
            </div>

            <div className="flex items-center gap-4">
              <div className="rounded-xl border border-amber-700/60 bg-plug-black px-4 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                  Time Remaining
                </p>
                <p
                  className={`font-mono text-2xl font-bold ${
                    remainingSeconds !== null && remainingSeconds <= 60
                      ? 'text-rose-400'
                      : 'text-amber-200'
                  }`}
                  aria-live="polite"
                >
                  {formatCountdown(remainingSeconds)}
                </p>
              </div>

              <button
                type="button"
                onClick={handleEndSession}
                disabled={ending}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-700 bg-rose-950 px-4 py-2 text-xs font-bold uppercase tracking-wider text-rose-300 transition-colors hover:bg-rose-900 disabled:opacity-50"
              >
                {ending ? 'Ending...' : 'End Session'}
              </button>
            </div>
          </div>

          {/* Aggregated Shop Overview Metrics */}
          {loadingData && !overview ? (
            <div className="rounded-2xl border border-plug-border bg-plug-surface p-12 text-center text-sm text-plug-muted">
              Loading support overview metrics...
            </div>
          ) : overview ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-plug-border bg-plug-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-plug-muted">
                  Customer Cards
                </p>
                <p className="mt-2 font-display text-3xl font-bold text-white">{overview.cards}</p>
              </div>

              <div className="rounded-xl border border-plug-border bg-plug-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-plug-muted">
                  Active Staff
                </p>
                <p className="mt-2 font-display text-3xl font-bold text-white">
                  {overview.activeStaff}
                </p>
              </div>

              <div className="rounded-xl border border-plug-border bg-plug-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-plug-muted">
                  Stamps (7 Days)
                </p>
                <p className="mt-2 font-display text-3xl font-bold text-white">
                  {overview.stampsLast7Days}
                </p>
              </div>

              <div className="rounded-xl border border-plug-border bg-plug-surface p-5">
                <p className="text-xs font-medium uppercase tracking-wider text-plug-muted">
                  Status
                </p>
                <p className="mt-2 font-display text-3xl font-bold uppercase text-white">
                  {overview.status}
                </p>
              </div>
            </div>
          ) : null}

          {/* Pseudonymous Recent Activity List */}
          <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 sm:p-8">
            <h3 className="font-display text-lg font-bold uppercase tracking-wider text-white">
              Recent Activity (Pseudonymous)
            </h3>
            <p className="mt-1 text-xs text-plug-muted">
              Privacy protected: No customer emails or user IDs are displayed.
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-plug-border">
              {activity.length === 0 ? (
                <div className="p-8 text-center text-xs text-plug-muted">
                  No recent activity records found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-plug-border bg-plug-elevated uppercase text-plug-muted">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold">
                          Timestamp
                        </th>
                        <th scope="col" className="px-4 py-3 font-semibold">
                          Kind
                        </th>
                        <th scope="col" className="px-4 py-3 font-semibold">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-plug-border font-mono">
                      {activity.map((item, idx) => (
                        <tr key={idx} className="hover:bg-plug-elevated/40">
                          <td className="whitespace-nowrap px-4 py-3 text-plug-muted">
                            {new Date(item.at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                item.kind === 'stamp'
                                  ? 'bg-blue-950 text-blue-300'
                                  : item.kind === 'redeem'
                                    ? 'bg-emerald-950 text-emerald-300'
                                    : 'bg-neutral-800 text-neutral-300'
                              }`}
                            >
                              {item.kind}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-neutral-200">{item.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
