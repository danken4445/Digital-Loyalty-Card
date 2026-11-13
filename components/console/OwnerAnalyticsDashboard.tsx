import Link from 'next/link';
import { ROUTES, type OwnerAnalyticsData } from '@/lib/contracts';
import { formatDateTimeInZone } from '@/lib/rules/display';

export interface OwnerAnalyticsDashboardProps {
  data: OwnerAnalyticsData;
  shopName: string;
  /** Enables links to related screens (tap cards, reward). */
  slug?: string;
}

function formatPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

function formatDays(val: number | null): string {
  if (val == null) return '—';
  return `${val.toFixed(1)} days`;
}

export function OwnerAnalyticsDashboard({ data, shopName, slug }: OwnerAnalyticsDashboardProps) {
  const { pulse, retentionHealth, cardFunnel, cohorts, topCustomers, timezone } = data;

  const totalCards = Math.max(pulse.totalCards, 1);
  const activeRegPct = Math.round((retentionHealth.activeRegulars / totalCards) * 100);
  const newFirstPct = Math.round((retentionHealth.newFirstVisit / totalCards) * 100);
  const atRiskPct = Math.round((retentionHealth.atRisk / totalCards) * 100);
  const dormantPct = Math.max(0, 100 - activeRegPct - newFirstPct - atRiskPct);

  const halfwayThreshold = Math.ceil(cardFunnel.rewardThreshold / 2.0);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Insights</h1>
        <p className="mt-1.5 text-base text-neutral-300">
          How often customers come back to <span className="font-medium text-white">{shopName}</span>. Times are in{' '}
          {timezone}.
        </p>
      </div>

      {pulse.totalCards === 0 ? (
        <section
          aria-label="No customers yet"
          className="rounded-2xl border border-dashed border-plug-border p-8 text-center"
        >
          <p className="text-base font-semibold text-white">No customers yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-plug-muted">
            Once customers start tapping your card, you&apos;ll see here how often they come back.
          </p>
          {slug && (
            <Link
              href={ROUTES.staff.tapCards(slug)}
              className="mt-4 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-plug-black hover:bg-neutral-200"
            >
              Set up a tap card
            </Link>
          )}
        </section>
      ) : (
        <section aria-label="In short" className="rounded-2xl border border-emerald-700/40 bg-emerald-950/20 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-white">In short</h2>
          <ul className="mt-3 space-y-2 text-base leading-relaxed text-neutral-200">
            <li>
              <strong className="text-white">{pulse.activeMembers30d}</strong> customer
              {pulse.activeMembers30d === 1 ? '' : 's'} visited in the last 30 days
              {pulse.newCards30d > 0 && (
                <>
                  , including <strong className="text-white">{pulse.newCards30d}</strong> new
                </>
              )}
              .
            </li>
            <li>
              <strong className="text-white">{formatPct(pulse.repeatRate30dPct)}</strong> came back for another visit
              within 30 days.
            </li>
            {pulse.rewardsReadyCount > 0 && (
              <li>
                <strong className="text-white">{pulse.rewardsReadyCount}</strong> customer
                {pulse.rewardsReadyCount === 1 ? ' has' : 's have'} a reward waiting to be claimed.
              </li>
            )}
            {retentionHealth.atRisk > 0 && (
              <li>
                <strong className="text-white">{retentionHealth.atRisk}</strong> regular
                {retentionHealth.atRisk === 1 ? " hasn't" : "s haven't"} been back for a while. A good moment for a
                promo or a friendly post.
              </li>
            )}
          </ul>
          {slug && pulse.repeatRate30dPct < 20 && (
            <p className="mt-4 text-sm text-emerald-200">
              Tip: a{' '}
              <Link href={ROUTES.staff.settings(slug)} className="font-semibold underline underline-offset-4">
                halfway bonus
              </Link>{' '}
              gives customers a reason to come back sooner.
            </p>
          )}
        </section>
      )}

      <h2 className="pt-2 text-sm font-semibold text-plug-muted">The details</h2>

      {/* Section 1: 2x2 Headline Pulse Grid */}
      <section aria-label="Pulse Overview" className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {/* Repeat Rate */}
        <div className="rounded-2xl border border-plug-border bg-plug-surface p-4 sm:p-5 flex flex-col justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Repeat Rate (30d)
          </div>
          <div className="my-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
              {formatPct(pulse.repeatRate30dPct)}
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate">
            {formatPct(pulse.repeatRate14dPct)} within 14d
          </div>
        </div>

        {/* Active Members */}
        <div className="rounded-2xl border border-plug-border bg-plug-surface p-4 sm:p-5 flex flex-col justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Active Members (30d)
          </div>
          <div className="my-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
              {pulse.activeMembers30d}
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate">
            +{pulse.newCards30d} new cards (30d)
          </div>
        </div>

        {/* Visit Cadence */}
        <div className="rounded-2xl border border-plug-border bg-plug-surface p-4 sm:p-5 flex flex-col justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Visit Cadence
          </div>
          <div className="my-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
              {formatDays(pulse.medianDaysBetweenVisits)}
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate">
            Median between visits
          </div>
        </div>

        {/* Rewards Claimed */}
        <div className="rounded-2xl border border-plug-border bg-plug-surface p-4 sm:p-5 flex flex-col justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Rewards Claimed
          </div>
          <div className="my-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
              {pulse.rewardsClaimedTotal}
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 truncate">
            {pulse.rewardsReadyCount} ready in wallets
          </div>
        </div>
      </section>

      {/* Section 2: Customer Retention Health */}
      <section
        aria-label="Customer Retention Health"
        className="rounded-2xl border border-plug-border bg-plug-surface p-5 sm:p-6 space-y-6"
      >
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-wider text-white">
            Customer Retention Health
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Active regulars vs. slipping customers across all {pulse.totalCards} cards
          </p>
        </div>

        {/* 4-segment stacked progress bar */}
        <div className="space-y-2">
          <div
            className="flex h-3.5 w-full overflow-hidden rounded-full bg-neutral-800"
            role="progressbar"
            aria-label="Retention health distribution"
          >
            {retentionHealth.activeRegulars > 0 && (
              <div
                style={{ width: `${(retentionHealth.activeRegulars / totalCards) * 100}%` }}
                className="bg-emerald-500 transition-all duration-500"
                title={`Active Regulars: ${retentionHealth.activeRegulars}`}
              />
            )}
            {retentionHealth.newFirstVisit > 0 && (
              <div
                style={{ width: `${(retentionHealth.newFirstVisit / totalCards) * 100}%` }}
                className="bg-sky-500 transition-all duration-500"
                title={`New (1st Visit): ${retentionHealth.newFirstVisit}`}
              />
            )}
            {retentionHealth.atRisk > 0 && (
              <div
                style={{ width: `${(retentionHealth.atRisk / totalCards) * 100}%` }}
                className="bg-amber-500 transition-all duration-500"
                title={`At-Risk: ${retentionHealth.atRisk}`}
              />
            )}
            {retentionHealth.dormant > 0 && (
              <div
                style={{ width: `${(retentionHealth.dormant / totalCards) * 100}%` }}
                className="bg-neutral-600 transition-all duration-500"
                title={`Dormant: ${retentionHealth.dormant}`}
              />
            )}
          </div>

          {/* 2x2 Legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-white">Active Regulars</div>
                <div className="text-[11px] text-neutral-400">
                  {retentionHealth.activeRegulars} ({activeRegPct}%) &bull; &ge;2 visits, &le;14d
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-white">New (1st Visit)</div>
                <div className="text-[11px] text-neutral-400">
                  {retentionHealth.newFirstVisit} ({newFirstPct}%) &bull; 1 visit, &le;14d
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-white">At-Risk</div>
                <div className="text-[11px] text-neutral-400">
                  {retentionHealth.atRisk} ({atRiskPct}%) &bull; Inactive 15–30d
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-neutral-500" aria-hidden="true" />
              <div>
                <div className="text-xs font-semibold text-white">Dormant</div>
                <div className="text-[11px] text-neutral-400">
                  {retentionHealth.dormant} ({dormantPct}%) &bull; Inactive 30d+
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Monthly First-to-Second Visit Cohorts */}
        <div className="border-t border-plug-border pt-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 mb-3">
            First-to-Second Visit Cohorts (Recent Months)
          </h3>
          {cohorts.length === 0 ? (
            <p className="text-xs text-neutral-400 italic">No customer cohorts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-plug-border text-neutral-400">
                    <th scope="col" className="pb-2 font-medium">Month</th>
                    <th scope="col" className="pb-2 font-medium text-right">New Members</th>
                    <th scope="col" className="pb-2 font-medium text-right">&le;14 Days</th>
                    <th scope="col" className="pb-2 font-medium text-right">&le;30 Days</th>
                    <th scope="col" className="pb-2 font-medium text-right">Ever Returned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-plug-border/60">
                  {cohorts.map((row) => (
                    <tr key={row.cohortMonth} className="hover:bg-neutral-800/30">
                      <td className="py-2.5 font-mono text-white font-medium">{row.cohortMonth}</td>
                      <td className="py-2.5 text-right text-neutral-300 tabular-nums">{row.newCustomers}</td>
                      <td className="py-2.5 text-right font-medium text-emerald-400 tabular-nums">{formatPct(row.returned14dPct)}</td>
                      <td className="py-2.5 text-right font-medium text-emerald-300 tabular-nums">{formatPct(row.returned30dPct)}</td>
                      <td className="py-2.5 text-right text-neutral-300 tabular-nums">{formatPct(row.returnedEverPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Section 3: How Your Loyalty Card Is Doing */}
      <section
        aria-label="Loyalty Card Funnel"
        className="rounded-2xl border border-plug-border bg-plug-surface p-5 sm:p-6 space-y-6"
      >
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-wider text-white">
            How Your Loyalty Card Is Doing
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Cardholder progress toward {cardFunnel.rewardLabel} ({cardFunnel.rewardThreshold} stamps)
          </p>
        </div>

        {/* Progress bars per bucket */}
        <div className="space-y-3.5">
          {/* 0 Stamps */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium">0 Stamps (Enrolled)</span>
              <span className="font-mono text-neutral-400 tabular-nums">
                {cardFunnel.zeroStampsCount} ({Math.round((cardFunnel.zeroStampsCount / totalCards) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                style={{ width: `${(cardFunnel.zeroStampsCount / totalCards) * 100}%` }}
                className="h-full bg-neutral-600 rounded-full"
              />
            </div>
          </div>

          {/* Early Progress */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium">
                Early Progress (1–{halfwayThreshold - 1} stamps)
              </span>
              <span className="font-mono text-neutral-400 tabular-nums">
                {cardFunnel.earlyProgressCount} ({Math.round((cardFunnel.earlyProgressCount / totalCards) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                style={{ width: `${(cardFunnel.earlyProgressCount / totalCards) * 100}%` }}
                className="h-full bg-sky-500 rounded-full"
              />
            </div>
          </div>

          {/* Halfway+ */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-300 font-medium">
                Halfway+ ({halfwayThreshold}–{cardFunnel.rewardThreshold - 1} stamps)
              </span>
              <span className="font-mono text-neutral-400 tabular-nums">
                {cardFunnel.halfwayPlusCount} ({Math.round((cardFunnel.halfwayPlusCount / totalCards) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                style={{ width: `${(cardFunnel.halfwayPlusCount / totalCards) * 100}%` }}
                className="h-full bg-amber-500 rounded-full"
              />
            </div>
          </div>

          {/* Ready to Redeem */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white font-semibold">
                Ready to Redeem ({cardFunnel.rewardThreshold}+ stamps)
              </span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {cardFunnel.rewardReadyCount} ({Math.round((cardFunnel.rewardReadyCount / totalCards) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                style={{ width: `${(cardFunnel.rewardReadyCount / totalCards) * 100}%` }}
                className="h-full bg-emerald-500 rounded-full"
              />
            </div>
          </div>
        </div>

        {/* Footer strip: 3 key indicators */}
        <div className="border-t border-plug-border pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="text-[11px] font-medium text-neutral-400">2nd-Card Return</div>
            <div className="text-lg font-bold text-white tabular-nums my-0.5">
              {formatPct(cardFunnel.secondCardReturnPct)}
            </div>
            <div className="text-[10px] text-neutral-400">Earned stamps after 1st redemption</div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="text-[11px] font-medium text-neutral-400">Median Time to Reward</div>
            <div className="text-lg font-bold text-white tabular-nums my-0.5">
              {formatDays(cardFunnel.medianDaysToReward)}
            </div>
            <div className="text-[10px] text-neutral-400">From 1st stamp to reward redemption</div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
            <div className="text-[11px] font-medium text-neutral-400">Backed-Up Cards</div>
            <div className="text-lg font-bold text-white tabular-nums my-0.5">
              {formatPct(cardFunnel.backedUpRatePct)}
            </div>
            <div className="text-[10px] text-neutral-400">Members linked to Google / Email</div>
          </div>
        </div>
      </section>

      {/* Section 4: Top 10 Loyal Customers Leaderboard */}
      <section
        aria-label="Top 10 Loyal Customers"
        className="rounded-2xl border border-plug-border bg-plug-surface p-5 sm:p-6 space-y-4"
      >
        <div>
          <h2 className="font-display text-lg font-bold uppercase tracking-wider text-white">
            Top 10 Loyal Customers
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Ranked by lifetime stamps collected in this shop
          </p>
        </div>

        {topCustomers.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">
            No customers have collected stamps in this shop yet.
          </div>
        ) : (
          <div className="space-y-2.5">
            {topCustomers.map((c) => {
              const lastSeenText = c.lastStampedAt
                ? formatDateTimeInZone(c.lastStampedAt, timezone)
                : '—';

              return (
                <div
                  key={c.customerId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-3.5 hover:border-neutral-700 transition-colors"
                >
                  {/* Left: Rank, Name, Code, Backed Up Badge */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 font-mono text-xs font-bold text-neutral-200">
                      #{c.rank}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-white truncate">
                          {c.customerName}
                        </span>
                        <span className="font-mono text-xs text-neutral-400">
                          #{c.cardCode}
                        </span>
                        {c.isBackedUp ? (
                          <span className="inline-flex items-center rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                            Backed Up
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                        Last visit: {lastSeenText}
                      </div>
                    </div>
                  </div>

                  {/* Right: Stamps & Redemptions */}
                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    <div className="text-right text-xs">
                      <div className="font-bold text-white tabular-nums">
                        {c.totalStamps} stamps
                      </div>
                      <div className="text-[11px] text-neutral-400 tabular-nums">
                        {c.availableStamps} in wallet &bull; {c.rewardsClaimed} redeemed
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
