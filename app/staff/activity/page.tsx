import { StaffNav } from '@/components/staff/StaffNav';
import { enforceStaffPageAccess, getStaffActivityDashboardData } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';
import { formatManilaDateTime } from '@/lib/rules/display';

export default async function StaffActivityPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.activity);
  const activity = await getStaffActivityDashboardData();

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <StaffNav staff={staff} currentPath={ROUTES.staff.activity} />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Header */}
        <section
          className="mb-8 border-b border-[#27272A] pb-6"
          aria-label="Activity & Audit Header"
        >
          <p className="font-mono text-xs font-bold tracking-widest text-[#A1A1AA] uppercase">
            OPERATIONS // MODULE 04
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight uppercase sm:text-4xl">
            Activity &amp; Audit Log
          </h1>
          <p className="mt-2 text-sm text-[#A1A1AA]">
            Real-time feed of recent customer stamps, reward redemptions, automated anomaly
            detection flags, and immutable system audit trail.
          </p>
        </section>

        <div className="space-y-12">
          {/* Section 1: Anomaly Flags */}
          <section aria-label="Anomaly Flags" className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272A] pb-2">
              <h2 className="text-xl font-black tracking-tight text-white uppercase">
                Anomaly Flags
              </h2>
              <span className="font-mono text-xs text-[#A1A1AA]">
                {activity.anomalies.length} Flag{activity.anomalies.length === 1 ? '' : 's'}{' '}
                Detected
              </span>
            </div>

            {activity.anomalies.length === 0 ? (
              <div className="rounded-lg border border-[#27272A] bg-[#121214] p-6 text-sm text-[#A1A1AA]">
                No anomalies detected in recent activity.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {activity.anomalies.map((flag) => {
                  const isHigh = flag.severity === 'high';
                  return (
                    <article
                      key={flag.id}
                      className={`rounded-lg border p-5 ${
                        isHigh
                          ? 'border-red-500/60 bg-red-950/30 text-white'
                          : 'border-yellow-500/50 bg-yellow-950/20 text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-wider ${
                            isHigh ? 'bg-red-500 text-white' : 'bg-yellow-400 text-black'
                          }`}
                        >
                          {flag.severity.toUpperCase()}
                        </span>
                        <span className="font-mono text-[11px] text-[#A1A1AA]">
                          Target: {flag.targetId.slice(0, 16)}
                        </span>
                      </div>
                      <h3 className="mt-3 text-sm font-black tracking-wide uppercase">
                        {flag.title}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-[#A1A1AA]">
                        {flag.description}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section 2: Recent Stamps */}
          <section aria-label="Recent Stamps" className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272A] pb-2">
              <h2 className="text-xl font-black tracking-tight text-white uppercase">
                Recent Stamps ({activity.stamps.length})
              </h2>
              <span className="font-mono text-xs text-[#A1A1AA]">Last 50 Entries</span>
            </div>

            {activity.stamps.length === 0 ? (
              <div className="rounded-lg border border-[#27272A] bg-[#121214] p-6 text-sm text-[#A1A1AA]">
                No stamps recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[#27272A] bg-[#121214]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#27272A] bg-[#0A0A0A] font-mono text-[11px] text-[#A1A1AA] uppercase">
                    <tr>
                      <th className="px-4 py-3">Customer ID</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Tag / Audit Detail</th>
                      <th className="px-4 py-3">Timestamp (Manila)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272A]">
                    {activity.stamps.map((stamp) => (
                      <tr key={stamp.id} className="hover:bg-[#1C1C1F]/60">
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-white block">
                            Card #{stamp.customer_id.slice(0, 8).toUpperCase()}
                          </span>
                          <span className="font-mono text-[10px] text-[#A1A1AA] block truncate max-w-[160px]">
                            {stamp.customer_id}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {stamp.source === 'nfc' ? (
                            <span className="rounded bg-white px-2 py-0.5 font-mono text-[10px] font-black text-black uppercase">
                              NFC
                            </span>
                          ) : (
                            <span className="rounded border border-[#27272A] bg-[#1C1C1F] px-2 py-0.5 font-mono text-[10px] font-bold text-white uppercase">
                              MANUAL
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {stamp.source === 'nfc' ? (
                            <span className="font-mono text-neutral-300">
                              Tag: {stamp.tag_id || 'Unknown Tag'}
                            </span>
                          ) : (
                            <div>
                              <span className="font-mono text-[11px] text-neutral-200">
                                Reason: &ldquo;{stamp.reason || 'None'}&rdquo;
                              </span>
                              {stamp.staff_id && (
                                <span className="font-mono text-[10px] text-[#A1A1AA] block">
                                  Staff: {stamp.staff_id.slice(0, 8).toUpperCase()}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-[#A1A1AA] whitespace-nowrap">
                          {formatManilaDateTime(stamp.created_at)} PHT
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 3: Recent Redemptions */}
          <section aria-label="Recent Redemptions" className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272A] pb-2">
              <h2 className="text-xl font-black tracking-tight text-white uppercase">
                Recent Redemptions ({activity.redemptions.length})
              </h2>
              <span className="font-mono text-xs text-[#A1A1AA]">Last 50 Entries</span>
            </div>

            {activity.redemptions.length === 0 ? (
              <div className="rounded-lg border border-[#27272A] bg-[#121214] p-6 text-sm text-[#A1A1AA]">
                No redemptions recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[#27272A] bg-[#121214]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#27272A] bg-[#0A0A0A] font-mono text-[11px] text-[#A1A1AA] uppercase">
                    <tr>
                      <th className="px-4 py-3">Stamps Deducted</th>
                      <th className="px-4 py-3">Customer ID</th>
                      <th className="px-4 py-3">Staff Barista ID</th>
                      <th className="px-4 py-3">Timestamp (Manila)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272A]">
                    {activity.redemptions.map((redemption) => (
                      <tr key={redemption.id} className="hover:bg-[#1C1C1F]/60">
                        <td className="px-4 py-3">
                          <span className="rounded bg-white px-2 py-0.5 font-mono text-[10px] font-black text-black uppercase">
                            {redemption.stamps_used} STAMPS
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-white block">
                            Card #{redemption.customer_id.slice(0, 8).toUpperCase()}
                          </span>
                          <span className="font-mono text-[10px] text-[#A1A1AA] block truncate max-w-[160px]">
                            {redemption.customer_id}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-neutral-300">
                          {redemption.staff_id}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-[#A1A1AA] whitespace-nowrap">
                          {formatManilaDateTime(redemption.created_at)} PHT
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Section 4: Audit Log Viewer */}
          <section aria-label="Audit Log Viewer" className="space-y-4">
            <div className="flex items-center justify-between border-b border-[#27272A] pb-2">
              <h2 className="text-xl font-black tracking-tight text-white uppercase">
                Audit Log Viewer ({activity.auditLogs.length})
              </h2>
              <span className="font-mono text-xs text-[#A1A1AA]">Immutable Security Trail</span>
            </div>

            {activity.auditLogs.length === 0 ? (
              <div className="rounded-lg border border-[#27272A] bg-[#121214] p-6 text-sm text-[#A1A1AA]">
                No audit events recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[#27272A] bg-[#121214]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#27272A] bg-[#0A0A0A] font-mono text-[11px] text-[#A1A1AA] uppercase">
                    <tr>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Actor</th>
                      <th className="px-4 py-3">Target</th>
                      <th className="px-4 py-3">Detail (JSON)</th>
                      <th className="px-4 py-3">Timestamp (Manila)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#27272A]">
                    {activity.auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-[#1C1C1F]/60">
                        <td className="px-4 py-3 font-mono font-bold text-white whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-[#A1A1AA] whitespace-nowrap">
                          {log.actor ? log.actor.slice(0, 8).toUpperCase() : 'SYSTEM'}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-neutral-300 whitespace-nowrap">
                          {log.target ? log.target.slice(0, 16) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {log.detail ? (
                            <pre className="max-w-xs overflow-x-auto rounded border border-[#27272A] bg-[#0A0A0A] p-1.5 font-mono text-[10px] text-neutral-300">
                              {JSON.stringify(log.detail, null, 1)}
                            </pre>
                          ) : (
                            <span className="text-[#A1A1AA]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-[#A1A1AA] whitespace-nowrap">
                          {formatManilaDateTime(log.created_at)} PHT
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
