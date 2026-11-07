import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { enforceStaffPageAccess, getStaffActivityDashboardData } from '@/lib/auth/staff';
import { SHOP_CONFIG } from '@/lib/config';
import { ROUTES } from '@/lib/contracts';
import { formatDateTimeInZone } from '@/lib/rules/display';
import { getTenantById } from '@/lib/tenants/context';

export default async function StaffActivityPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.activity);
  const activity = await getStaffActivityDashboardData();
  const timezone = (await getTenantById(staff.tenantId))?.settings.timezone ?? SHOP_CONFIG.timezone;

  const tagLabelMap = new Map<string, string>();
  if (activity.tags) {
    for (const t of activity.tags) {
      if (t.label) tagLabelMap.set(t.id, t.label);
    }
  }

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.activity}
      title="Activity & Audit Log"
      headerLabel="Activity & Audit Header"
      description="Recent stamps and rewards, anything that looks unusual, and the full record of staff actions. Times are shown in your shop's timezone."
    >
      <div className="space-y-12">
        {/* Section 1: Anomaly Flags */}
        <section aria-label="Anomaly Flags" className="space-y-4">
          <div className="flex items-center justify-between border-b border-plug-border pb-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              Anomaly Flags
            </h2>
            <span className="font-mono text-xs text-plug-muted">
              {activity.anomalies.length} Flag{activity.anomalies.length === 1 ? '' : 's'} Detected
            </span>
          </div>

          {activity.anomalies.length === 0 ? (
            <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-sm text-plug-muted">
              No anomalies detected in recent activity.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {activity.anomalies.map((flag) => {
                const isHigh = flag.severity === 'high';
                return (
                  <article
                    key={flag.id}
                    className={`rounded-2xl border p-5 ${isHigh
                        ? 'border-red-500/60 bg-red-950/30 text-white'
                        : 'border-yellow-500/50 bg-yellow-950/20 text-white'
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isHigh ? 'bg-red-500 text-white' : 'bg-yellow-400 text-black'
                          }`}
                      >
                        {flag.severity.toUpperCase()}
                      </span>
                      <span className="font-mono text-[11px] text-plug-muted">
                        Target: {flag.targetId.slice(0, 16)}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold">{flag.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-plug-muted">
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
          <div className="flex items-center justify-between border-b border-plug-border pb-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              Recent Stamps ({activity.stamps.length})
            </h2>
            <span className="font-mono text-xs text-plug-muted">Last 50 Entries</span>
          </div>

          {activity.stamps.length === 0 ? (
            <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-sm text-plug-muted">
              No stamps recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-plug-border bg-plug-surface">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-plug-border bg-plug-black text-xs font-medium text-plug-muted">
                  <tr>
                    <th className="px-4 py-3">Customer ID</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Tag / Audit Detail</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-plug-border">
                  {activity.stamps.map((stamp) => (
                    <tr key={stamp.id} className="hover:bg-plug-elevated/60">
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-white block">
                          Card #{stamp.customer_id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="font-mono text-[10px] text-plug-muted block truncate max-w-[160px]">
                          {stamp.customer_id}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {stamp.source === 'nfc' ? (
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-plug-black">
                            NFC
                          </span>
                        ) : (
                          <span className="rounded-full border border-plug-border px-2.5 py-0.5 text-xs font-semibold text-white">
                            MANUAL
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {stamp.source === 'nfc' ? (
                          <span className="font-mono text-neutral-300">
                            {stamp.tag_id && tagLabelMap.get(stamp.tag_id) ? (
                              <>
                                <span className="font-bold text-white">{tagLabelMap.get(stamp.tag_id)}</span>{' '}
                                <span className="text-plug-muted text-[10px]">({stamp.tag_id})</span>
                              </>
                            ) : (
                              `Tag: ${stamp.tag_id || 'Unknown Tag'}`
                            )}
                          </span>
                        ) : (
                          <div>
                            <span className="font-mono text-[11px] text-neutral-200">
                              Reason: &ldquo;{stamp.reason || 'None'}&rdquo;
                            </span>
                            {stamp.staff_id && (
                              <span className="font-mono text-[10px] text-plug-muted block">
                                Staff: {stamp.staff_id.slice(0, 8).toUpperCase()}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-plug-muted whitespace-nowrap">
                        {formatDateTimeInZone(stamp.created_at, timezone)}
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
          <div className="flex items-center justify-between border-b border-plug-border pb-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              Recent Redemptions ({activity.redemptions.length})
            </h2>
            <span className="font-mono text-xs text-plug-muted">Last 50 Entries</span>
          </div>

          {activity.redemptions.length === 0 ? (
            <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-sm text-plug-muted">
              No redemptions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-plug-border bg-plug-surface">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-plug-border bg-plug-black text-xs font-medium text-plug-muted">
                  <tr>
                    <th className="px-4 py-3">Stamps Deducted</th>
                    <th className="px-4 py-3">Customer ID</th>
                    <th className="px-4 py-3">Staff Barista ID</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-plug-border">
                  {activity.redemptions.map((redemption) => (
                    <tr key={redemption.id} className="hover:bg-plug-elevated/60">
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-plug-black">
                          {redemption.stamps_used} STAMPS
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono font-bold text-white block">
                          Card #{redemption.customer_id.slice(0, 8).toUpperCase()}
                        </span>
                        <span className="font-mono text-[10px] text-plug-muted block truncate max-w-[160px]">
                          {redemption.customer_id}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-300">
                        {redemption.staff_id}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-plug-muted whitespace-nowrap">
                        {formatDateTimeInZone(redemption.created_at, timezone)}
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
          <div className="flex items-center justify-between border-b border-plug-border pb-2">
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-white">
              Audit Log Viewer ({activity.auditLogs.length})
            </h2>
            <span className="font-mono text-xs text-plug-muted">Immutable Security Trail</span>
          </div>

          {activity.auditLogs.length === 0 ? (
            <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 text-sm text-plug-muted">
              No audit events recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-plug-border bg-plug-surface">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-plug-border bg-plug-black text-xs font-medium text-plug-muted">
                  <tr>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Detail (JSON)</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-plug-border">
                  {activity.auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-plug-elevated/60">
                      <td className="px-4 py-3 font-mono font-bold text-white whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-plug-muted whitespace-nowrap">
                        {log.actor ? log.actor.slice(0, 8).toUpperCase() : 'SYSTEM'}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-neutral-300 whitespace-nowrap">
                        {log.target ? log.target.slice(0, 16) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {log.detail ? (
                          <pre className="max-w-xs overflow-x-auto rounded-lg border border-plug-border bg-plug-black p-2 font-mono text-[11px] text-neutral-300">
                            {JSON.stringify(log.detail, null, 1)}
                          </pre>
                        ) : (
                          <span className="text-plug-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-plug-muted whitespace-nowrap">
                        {formatDateTimeInZone(log.created_at, timezone)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </StaffPageShell>
  );
}
