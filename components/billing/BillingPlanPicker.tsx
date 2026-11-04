'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  describePlanPricing,
  formatBillingMonth,
  formatPesos,
  priceForActiveCustomers,
} from '@/lib/billing/format';
import type {
  ApiResponse,
  BillingEstimate,
  BillingPlan,
  ChoosePlanResponse,
} from '@/lib/contracts';

interface BillingPlanPickerProps {
  plans: BillingPlan[];
  estimate: BillingEstimate | null;
  /** POST endpoint that records the choice */
  endpoint: string;
  /** Owners and platform admins can pick; managers only look */
  canChoose: boolean;
  /** Platform admins may apply a change to the current month instead of next month */
  allowImmediate?: boolean;
}

export function BillingPlanPicker({
  plans,
  estimate,
  endpoint,
  canChoose,
  allowImmediate = false,
}: BillingPlanPickerProps) {
  const router = useRouter();
  const activeCustomers = estimate?.activeCustomers ?? 0;
  const currentCode = estimate?.plan?.code ?? null;
  const pendingCode = estimate?.pendingPlan?.code ?? null;

  const [whatIf, setWhatIf] = useState(Math.max(activeCustomers, 100));
  const [immediate, setImmediate] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function choose(plan: BillingPlan) {
    setErrorMessage(null);
    setSuccessMessage(null);
    setBusyCode(plan.code);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan.code, ...(allowImmediate ? { immediate } : {}) }),
      });
      const body: ApiResponse<ChoosePlanResponse> = await res.json();

      if (!res.ok || !body.ok) {
        setErrorMessage(body.ok === false ? body.message : 'Could not change the plan.');
      } else if (body.data.result === 'unchanged') {
        setSuccessMessage('You are already on that plan.');
        router.refresh();
      } else {
        setSuccessMessage(
          currentCode === null || immediate
            ? `${plan.name} starts now.`
            : `${plan.name} starts next month. This month stays on your current plan.`,
        );
        router.refresh();
      }
    } catch {
      setErrorMessage('Network error. Please try again.');
    } finally {
      setBusyCode(null);
    }
  }

  const whatIfCount = Number.isFinite(whatIf) ? Math.max(0, Math.floor(whatIf)) : 0;

  return (
    <div className="space-y-6">
      {estimate ? (
        <section
          aria-label="This month's usage"
          className="rounded-2xl border border-plug-border bg-plug-surface p-6"
        >
          <h2 className="font-display text-lg font-bold uppercase tracking-wider text-white">
            {formatBillingMonth(estimate.month)}
          </h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-plug-muted">Active customers</dt>
              <dd className="mt-1 font-display text-2xl font-bold text-white">
                {estimate.activeCustomers}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-plug-muted">Plan</dt>
              <dd className="mt-1 text-white">{estimate.plan?.name ?? 'None chosen yet'}</dd>
            </div>
            <div>
              <dt className="text-xs text-plug-muted">
                {estimate.billed ? 'Bill so far' : 'Would cost'}
              </dt>
              <dd className="mt-1 font-display text-2xl font-bold text-white">
                {estimate.plan ? formatPesos(estimate.totalCentavos) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-plug-muted">Billing</dt>
              <dd className="mt-1 text-white">{estimate.billed ? 'Active' : 'Free trial'}</dd>
            </div>
          </dl>
          {estimate.capApplied ? (
            <p className="mt-4 text-xs text-emerald-400">
              Your cap is protecting you this month. Extra customers are free.
            </p>
          ) : null}
          {estimate.pendingPlan ? (
            <p className="mt-4 text-xs text-amber-400">
              Switching to{' '}
              {plans.find((p) => p.code === estimate.pendingPlan?.code)?.name ??
                estimate.pendingPlan.code}{' '}
              on {formatBillingMonth(estimate.pendingPlan.effectiveMonth)}.
            </p>
          ) : null}
          <p className="mt-4 text-xs text-plug-muted">
            An active customer is someone who collected at least one stamp this month. Customers who
            only hold your card are free.
          </p>
        </section>
      ) : null}

      <section aria-label="Plans" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
              Pick the plan you are comfortable with
            </h2>
            <p className="mt-1 text-sm text-plug-muted">
              Change any time. A change takes effect next month so every month has one price.
            </p>
          </div>
          <label className="text-xs text-plug-muted">
            If I had
            <input
              type="number"
              min={0}
              max={100000}
              inputMode="numeric"
              value={whatIf}
              onChange={(e) => setWhatIf(Number(e.target.value))}
              className="mx-2 w-24 rounded-lg border border-plug-border bg-plug-elevated px-2 py-1.5 text-sm text-white focus:border-white focus:outline-none"
            />
            active customers
          </label>
        </div>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-sm text-rose-300"
          >
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div
            role="status"
            className="rounded-xl border border-emerald-800 bg-emerald-950/60 p-4 text-sm text-emerald-300"
          >
            {successMessage}
          </div>
        ) : null}

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plans.map((plan) => {
            const isCurrent = plan.code === currentCode;
            const isPending = plan.code === pendingCode;
            return (
              <li
                key={plan.code}
                className={`flex flex-col rounded-2xl border p-5 ${
                  isCurrent ? 'border-white bg-plug-elevated' : 'border-plug-border bg-plug-surface'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-bold uppercase tracking-wide text-white">
                    {plan.name}
                  </h3>
                  {isCurrent ? (
                    <span className="rounded-full border border-white px-2 py-0.5 text-xs font-semibold text-white">
                      YOUR PLAN
                    </span>
                  ) : isPending ? (
                    <span className="rounded-full border border-amber-700 px-2 py-0.5 text-xs font-semibold text-amber-400">
                      NEXT MONTH
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-plug-muted">{plan.description}</p>
                <p className="mt-3 text-sm text-white">{describePlanPricing(plan)}</p>
                <p className="mt-3 text-xs text-plug-muted">
                  At {whatIfCount} customers:{' '}
                  <span className="font-semibold text-white">
                    {formatPesos(priceForActiveCustomers(plan, whatIfCount))}
                  </span>{' '}
                  a month
                </p>
                {canChoose ? (
                  <button
                    type="button"
                    onClick={() => choose(plan)}
                    disabled={busyCode !== null || isCurrent}
                    className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-white bg-white px-4 py-2 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:border-plug-border disabled:bg-transparent disabled:text-plug-muted"
                  >
                    {busyCode === plan.code
                      ? 'Saving...'
                      : isCurrent
                        ? 'Current plan'
                        : currentCode === null
                          ? 'Choose this plan'
                          : 'Switch next month'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {allowImmediate ? (
          <label className="flex items-center gap-2 text-xs text-plug-muted">
            <input
              type="checkbox"
              checked={immediate}
              onChange={(e) => setImmediate(e.target.checked)}
            />
            Apply to the current month instead of next month (platform override)
          </label>
        ) : null}

        {!canChoose ? (
          <p className="text-xs text-plug-muted">Only the shop owner can change the plan.</p>
        ) : null}
      </section>
    </div>
  );
}
