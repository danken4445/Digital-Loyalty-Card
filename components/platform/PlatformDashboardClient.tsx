'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { InvoiceGeneratorModal } from '@/components/platform/InvoiceGeneratorModal';
import { PrintableInvoiceModal } from '@/components/platform/PrintableInvoiceModal';
import { formatPesos } from '@/lib/billing/format';
import {
  ROUTES,
  type ApiResponse,
  type InvoiceStatus,
  type PlatformDashboardOverview,
  type PlatformGenerateInvoiceResult,
  type PlatformTenantRowEnriched,
  type TenantInvoice,
} from '@/lib/contracts';

interface PlatformDashboardClientProps {
  initialOverview: PlatformDashboardOverview;
}

type StatusFilter = 'all' | 'due_soon' | 'active' | 'trial' | 'suspended';

export function PlatformDashboardClient({ initialOverview }: PlatformDashboardClientProps) {
  const router = useRouter();
  const [overview, setOverview] = useState<PlatformDashboardOverview>(initialOverview);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);

  // Modals state
  const [generatorTenant, setGeneratorTenant] = useState<PlatformTenantRowEnriched | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<TenantInvoice | null>(null);
  const [activeMatrixTenant, setActiveMatrixTenant] = useState<PlatformTenantRowEnriched | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(ROUTES.api.platform.overview);
      const body: ApiResponse<PlatformDashboardOverview> = await res.json();
      if (res.ok && body.ok) {
        setOverview(body.data);
      }
    } finally {
      setRefreshing(false);
      router.refresh();
    }
  }

  // Filtered tenants list
  const filteredTenants = useMemo(() => {
    return overview.tenants.filter((tenant) => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = tenant.name.toLowerCase().includes(q);
        const matchesSlug = tenant.slug.toLowerCase().includes(q);
        const matchesId = tenant.id.toLowerCase().includes(q);
        const matchesEmail = tenant.ownerEmail?.toLowerCase().includes(q) ?? false;
        if (!matchesName && !matchesSlug && !matchesId && !matchesEmail) {
          return false;
        }
      }

      // Status filter
      if (statusFilter === 'due_soon') {
        if (!tenant.isDueSoon && !tenant.isOverdue) return false;
      } else if (statusFilter !== 'all') {
        if (tenant.status !== statusFilter) return false;
      }

      // Industry filter
      if (selectedIndustry !== null) {
        if (tenant.industry !== selectedIndustry) return false;
      }

      return true;
    });
  }, [overview.tenants, searchQuery, statusFilter, selectedIndustry]);

  const kpis = overview.kpis;
  const dueSoonCount = overview.tenants.filter((t) => t.isDueSoon || t.isOverdue).length;

  function handleInvoiceSuccess(_result: PlatformGenerateInvoiceResult) {
    handleRefresh();
  }

  function handleInvoiceStatusChanged(_invoiceId: string, _newStatus: InvoiceStatus) {
    handleRefresh();
  }

  return (
    <div className="space-y-7">
      {/* Due-Date Proximity Alert Strip */}
      {dueSoonCount > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-600/60 bg-amber-950/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Billing Due Date Radar: {dueSoonCount} Tenant{dueSoonCount > 1 ? 's' : ''} Require Attention
              </p>
              <p className="text-xs text-amber-200/80">
                Client billing cycles approaching or overdue. Click below to generate or review invoices.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('due_soon');
                setSelectedIndustry(null);
              }}
              className="inline-flex min-h-9 items-center justify-center rounded-xl border border-amber-500/80 bg-amber-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-plug-black transition-colors hover:bg-amber-400"
            >
              Filter Due Soon ({dueSoonCount})
            </button>
          </div>
        </div>
      )}

      {/* 4 Top Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Active Tenants */}
        <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-plug-muted">
            <span>Active Tenants</span>
            <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-extrabold text-white">
              {kpis.activeTenants}
            </span>
            <span className="text-xs text-plug-muted">
              / {kpis.totalTenants} total
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-plug-muted">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              ● {kpis.activeTenants} active
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1 text-amber-400">
              ● {kpis.trialTenants} trial
            </span>
            {kpis.suspendedTenants > 0 && (
              <>
                <span>•</span>
                <span className="text-rose-400">● {kpis.suspendedTenants} suspended</span>
              </>
            )}
          </div>
        </div>

        {/* KPI 2: Utilization Rate */}
        <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-plug-muted">
            <span>Utilization Rate</span>
            <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-extrabold text-white">
              {kpis.utilizationRatePct}%
            </span>
          </div>
          <p className="mt-2 text-[11px] text-plug-muted">
            <strong className="text-neutral-200">{kpis.activeCustomers30d.toLocaleString()}</strong> active 30d customers / {kpis.totalCards.toLocaleString()} cards
          </p>
        </div>

        {/* KPI 3: Monthly Activity / Stamps */}
        <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-plug-muted">
            <span>Monthly Stamps</span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
                kpis.stampsMoMDeltaPct >= 0
                  ? 'bg-emerald-950 text-emerald-400'
                  : 'bg-rose-950 text-rose-400'
              }`}
            >
              {kpis.stampsMoMDeltaPct >= 0 ? `+${kpis.stampsMoMDeltaPct}%` : `${kpis.stampsMoMDeltaPct}%`}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-extrabold text-white">
              {kpis.monthlyStamps.toLocaleString()}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-plug-muted">
            vs {kpis.lastMonthStamps.toLocaleString()} last month • {kpis.monthlyRedemptions} redemptions
          </p>
        </div>

        {/* KPI 4: Monthly Revenue */}
        <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-plug-muted">
            <span>Monthly Revenue</span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
                kpis.revenueMoMDeltaPct >= 0
                  ? 'bg-emerald-950 text-emerald-400'
                  : 'bg-rose-950 text-rose-400'
              }`}
            >
              {kpis.revenueMoMDeltaPct >= 0 ? `+${kpis.revenueMoMDeltaPct}%` : `${kpis.revenueMoMDeltaPct}%`}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-display text-3xl font-extrabold text-emerald-400">
              {formatPesos(Number(kpis.monthlyRevenueCentavos))}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-plug-muted">
            vs {formatPesos(Number(kpis.lastMonthRevenueCentavos))} last month • {kpis.unpaidInvoicesCount} unpaid invoices
          </p>
        </div>
      </div>

      {/* Multi-Tenant Industry Ecosystem Bar */}
      <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 shadow-lg">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
              Multi-Tenant Industry Ecosystem
            </h2>
            <p className="text-xs text-plug-muted">
              Distribution of registered merchant tenants across active business domains
            </p>
          </div>

          {selectedIndustry && (
            <button
              type="button"
              onClick={() => setSelectedIndustry(null)}
              className="text-xs text-odyssey-orange hover:underline"
            >
              Reset Industry Filter &times;
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {Object.entries(overview.industries).map(([ind, count]) => {
            const isSelected = selectedIndustry === ind;
            return (
              <button
                key={ind}
                type="button"
                onClick={() => setSelectedIndustry(isSelected ? null : ind)}
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold capitalize transition-all ${
                  isSelected
                    ? 'border-odyssey-orange bg-odyssey-orange/15 text-white shadow-sm'
                    : 'border-plug-border bg-plug-surface text-neutral-300 hover:border-neutral-500 hover:text-white'
                }`}
              >
                <span>{ind.replace('_', ' ')}</span>
                <span className="rounded-md bg-plug-elevated px-2 py-0.5 font-mono text-[11px] text-white">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tenant Management & Capabilities Section */}
      <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col gap-4 border-b border-plug-border/80 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold uppercase tracking-wider text-white">
              Tenant Management &amp; Capabilities
            </h2>
            <p className="mt-0.5 text-xs text-plug-muted">
              Showing <strong className="text-white">{filteredTenants.length}</strong> organizations ({overview.tenants.length} total registered)
            </p>
          </div>

          {/* Quick Refresh & Onboard Buttons in Table Header */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-plug-border bg-plug-elevated px-3 py-1.5 text-xs font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
            >
              <svg
                className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            <Link
              href={ROUTES.platform.newTenant}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-odyssey-orange bg-odyssey-orange px-3.5 py-1.5 text-xs font-bold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              + Onboard Client
            </Link>
          </div>
        </div>

        {/* Search Bar & Filter Tabs */}
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All Tenants (${overview.tenants.length})` },
                { id: 'due_soon', label: `Due Soon / Unpaid (${dueSoonCount})`, alert: dueSoonCount > 0 },
                { id: 'active', label: `Active (${kpis.activeTenants})` },
                { id: 'trial', label: `Trial (${kpis.trialTenants})` },
                { id: 'suspended', label: `Suspended (${kpis.suspendedTenants})` },
              ] as Array<{ id: StatusFilter; label: string; alert?: boolean }>
            ).map((tab) => {
              const isSelected = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? 'border-white bg-white text-plug-black'
                      : tab.alert
                        ? 'border-amber-600/70 bg-amber-950/40 text-amber-300 hover:border-amber-500'
                        : 'border-plug-border bg-plug-surface text-plug-muted hover:border-neutral-600 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative w-full lg:w-80">
            <input
              type="text"
              placeholder="Search by name, ID, or slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-plug-border bg-plug-elevated py-2 pl-9 pr-3 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
            />
            <svg
              className="absolute left-3 top-2.5 h-3.5 w-3.5 text-plug-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        {/* Tenant Rows Table */}
        <div className="mt-5 overflow-hidden rounded-xl border border-plug-border bg-plug-surface">
          {filteredTenants.length === 0 ? (
            <div className="p-12 text-center text-sm text-plug-muted">
              No matching merchant organizations found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-plug-border bg-[#18181B] uppercase tracking-wider text-plug-muted">
                  <tr>
                    <th scope="col" className="px-5 py-3.5 font-semibold">
                      Tenant &amp; Identity
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Industry
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Status &amp; Billing
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Usage &amp; Rate
                    </th>
                    <th scope="col" className="px-4 py-3.5 font-semibold">
                      Capabilities
                    </th>
                    <th scope="col" className="px-5 py-3.5 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-plug-border">
                  {filteredTenants.map((tenant) => {
                    const isOverdue = tenant.isOverdue;
                    const isDueSoon = tenant.isDueSoon;

                    return (
                      <tr key={tenant.id} className="transition-colors hover:bg-plug-elevated/40">
                        {/* Tenant Identity */}
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-plug-border bg-plug-elevated text-sm font-bold text-white">
                              {tenant.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white">{tenant.name}</span>
                              </div>
                              <p className="font-mono text-[11px] text-plug-muted">
                                {tenant.slug} • {tenant.ownerEmail ?? 'No owner email'}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Industry */}
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center rounded-lg border border-teal-800/80 bg-teal-950/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-teal-300">
                            {tenant.industry}
                          </span>
                        </td>

                        {/* Status & Billing Badge */}
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                  tenant.status === 'active'
                                    ? 'border-emerald-800 bg-emerald-950/60 text-emerald-400'
                                    : tenant.status === 'trial'
                                      ? 'border-amber-800 bg-amber-950/60 text-amber-400'
                                      : 'border-rose-800 bg-rose-950/60 text-rose-400'
                                }`}
                              >
                                ● {tenant.status}
                              </span>
                              <span className="font-mono text-[10px] text-plug-muted">
                                {tenant.planName}
                              </span>
                            </div>

                            {/* Billing Due Badge */}
                            {isOverdue ? (
                              <span className="inline-block rounded border border-rose-700 bg-rose-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-300">
                                BILLED UNPAID (Due: {tenant.dueDate})
                              </span>
                            ) : isDueSoon ? (
                              <span className="inline-block rounded border border-amber-600 bg-amber-950 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                                DUE IN {Math.max(0, tenant.daysUntilDue)} DAYS
                              </span>
                            ) : tenant.latestInvoice?.status === 'paid' ? (
                              <span className="inline-block rounded border border-emerald-900 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                SETTLED PAID
                              </span>
                            ) : null}
                          </div>
                        </td>

                        {/* Usage & Metered Bill */}
                        <td className="px-4 py-4">
                          <div>
                            <span className="font-mono font-bold text-white">
                              {formatPesos(tenant.estimatedBillCentavos)}
                            </span>
                            <p className="mt-0.5 text-[11px] text-plug-muted">
                              {tenant.activeCustomersThisMonth} billable • {tenant.stamps7d} stamps (7d)
                            </p>
                          </div>
                        </td>

                        {/* Capabilities Matrix */}
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            onClick={() => setActiveMatrixTenant(tenant)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-plug-elevated px-2.5 py-1 text-[11px] font-semibold text-neutral-300 transition-colors hover:border-white hover:text-white"
                          >
                            <span>{tenant.capabilitiesCount} Flags Active</span>
                            <svg className="h-3 w-3 text-plug-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <circle cx="12" cy="12" r="1" />
                              <circle cx="19" cy="12" r="1" />
                              <circle cx="5" cy="12" r="1" />
                            </svg>
                          </button>
                        </td>

                        {/* Actions */}
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Invoice Button */}
                            <button
                              type="button"
                              onClick={() => setGeneratorTenant(tenant)}
                              className={`inline-flex min-h-8 items-center rounded-lg border px-3 py-1 text-xs font-bold uppercase tracking-wider transition-all ${
                                isDueSoon || isOverdue
                                  ? 'border-odyssey-orange bg-odyssey-orange text-white shadow-md hover:opacity-90'
                                  : 'border-plug-border bg-plug-elevated text-neutral-200 hover:border-neutral-500 hover:text-white'
                              }`}
                            >
                              Invoice
                            </button>

                            {/* Configure & Matrix Button */}
                            <Link
                              href={ROUTES.platform.tenant(tenant.slug)}
                              className="inline-flex min-h-8 items-center rounded-lg border border-plug-border bg-plug-elevated px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-800"
                            >
                              Configure &amp; Matrix
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Capabilities Details Modal */}
      {activeMatrixTenant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-plug-border bg-[#141416] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-plug-border pb-3">
              <h3 className="font-display text-base font-bold text-white">
                {activeMatrixTenant.name} Capabilities
              </h3>
              <button
                type="button"
                onClick={() => setActiveMatrixTenant(null)}
                className="text-plug-muted hover:text-white"
              >
                &times;
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs text-plug-muted">Active capabilities &amp; feature toggles:</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {activeMatrixTenant.activeFlags.map((flag, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-950/60 px-3 py-1 text-xs font-semibold text-emerald-300"
                  >
                    ✓ {flag}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveMatrixTenant(null)}
                className="rounded-xl border border-plug-border px-4 py-1.5 text-xs font-bold text-white hover:bg-plug-elevated"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Generator Modal */}
      <InvoiceGeneratorModal
        isOpen={generatorTenant !== null}
        onClose={() => setGeneratorTenant(null)}
        tenant={generatorTenant}
        onInvoiceCreated={handleInvoiceSuccess}
      />

      {/* Printable Invoice Modal */}
      <PrintableInvoiceModal
        isOpen={viewingInvoice !== null}
        onClose={() => setViewingInvoice(null)}
        invoice={viewingInvoice}
        onStatusChanged={handleInvoiceStatusChanged}
      />
    </div>
  );
}
