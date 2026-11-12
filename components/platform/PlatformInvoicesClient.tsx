'use client';

import { useMemo, useState } from 'react';
import { PrintableInvoiceModal } from '@/components/platform/PrintableInvoiceModal';
import { formatPesos } from '@/lib/billing/format';
import type { InvoiceStatus, TenantInvoice } from '@/lib/contracts';

interface PlatformInvoicesClientProps {
  initialInvoices: TenantInvoice[];
}

export function PlatformInvoicesClient({ initialInvoices }: PlatformInvoicesClientProps) {
  const [invoices, setInvoices] = useState<TenantInvoice[]>(initialInvoices);
  const [statusFilter, setStatusFilter] = useState<'all' | 'issued' | 'paid' | 'void'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<TenantInvoice | null>(null);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesNum = inv.invoiceNumber.toLowerCase().includes(q);
        const matchesName = inv.tenantName?.toLowerCase().includes(q) ?? false;
        const matchesSlug = inv.tenantSlug?.toLowerCase().includes(q) ?? false;
        if (!matchesNum && !matchesName && !matchesSlug) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, searchQuery]);

  const totalIssuedCentavos = useMemo(() => {
    return invoices
      .filter((i) => i.status === 'issued')
      .reduce((acc, i) => acc + i.totalCentavos, 0);
  }, [invoices]);

  const totalPaidCentavos = useMemo(() => {
    return invoices
      .filter((i) => i.status === 'paid')
      .reduce((acc, i) => acc + i.totalCentavos, 0);
  }, [invoices]);

  function handleStatusChanged(invoiceId: string, newStatus: InvoiceStatus) {
    setInvoices((prev) =>
      prev.map((i) => (i.id === invoiceId ? { ...i, status: newStatus } : i)),
    );
  }

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-plug-border bg-[#121214] p-5 shadow-lg">
          <p className="text-xs font-bold uppercase tracking-wider text-plug-muted">Total Invoices</p>
          <p className="mt-2 font-display text-3xl font-extrabold text-white">{invoices.length}</p>
          <p className="mt-1 text-xs text-plug-muted">Historical billing records</p>
        </div>

        <div className="rounded-2xl border border-amber-800/40 bg-[#121214] p-5 shadow-lg">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400">Unpaid / Issued</p>
          <p className="mt-2 font-display text-3xl font-extrabold text-amber-300">
            {formatPesos(totalIssuedCentavos)}
          </p>
          <p className="mt-1 text-xs text-plug-muted">
            {invoices.filter((i) => i.status === 'issued').length} pending settlement
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-800/40 bg-[#121214] p-5 shadow-lg">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">Total Collected</p>
          <p className="mt-2 font-display text-3xl font-extrabold text-emerald-400">
            {formatPesos(totalPaidCentavos)}
          </p>
          <p className="mt-1 text-xs text-plug-muted">
            {invoices.filter((i) => i.status === 'paid').length} settled invoices
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'issued', 'paid', 'void'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`rounded-xl border px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                statusFilter === tab
                  ? 'border-white bg-white text-plug-black'
                  : 'border-plug-border bg-plug-surface text-plug-muted hover:text-white'
              }`}
            >
              {tab === 'all' ? `All (${invoices.length})` : tab}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search by invoice # or tenant..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-plug-border bg-plug-elevated px-3 py-2 text-xs text-white placeholder-neutral-500 sm:w-72 focus:border-white focus:outline-none"
        />
      </div>

      {/* Invoices Table */}
      <div className="overflow-hidden rounded-2xl border border-plug-border bg-[#121214]">
        {filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-sm text-plug-muted">
            No invoices found. Generate invoices from the Super Admin Dashboard.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-plug-border bg-[#18181B] uppercase tracking-wider text-plug-muted">
                <tr>
                  <th scope="col" className="px-5 py-3.5 font-semibold">
                    Invoice #
                  </th>
                  <th scope="col" className="px-5 py-3.5 font-semibold">
                    Tenant
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">
                    Cycle
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3.5 font-semibold">
                    Due Date
                  </th>
                  <th scope="col" className="px-5 py-3.5 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-plug-border">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="transition-colors hover:bg-plug-elevated/40">
                    <td className="px-5 py-4 font-mono font-semibold text-white">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-5 py-4 font-semibold text-neutral-200">
                      {inv.tenantName ?? inv.tenantSlug}
                    </td>
                    <td className="px-4 py-4 font-mono text-neutral-400">
                      {inv.billingMonth}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          inv.status === 'paid'
                            ? 'border border-emerald-800 bg-emerald-950/60 text-emerald-400'
                            : inv.status === 'void'
                              ? 'border border-neutral-700 bg-neutral-800 text-neutral-400'
                              : 'border border-amber-800 bg-amber-950/60 text-amber-300'
                        }`}
                      >
                        ● {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-mono font-bold text-white">
                      {formatPesos(inv.totalCentavos)}
                    </td>
                    <td className="px-4 py-4 font-mono text-plug-muted">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="inline-flex min-h-8 items-center rounded-lg border border-plug-border bg-plug-elevated px-3 py-1 text-xs font-semibold text-white transition-colors hover:border-neutral-500"
                      >
                        View &amp; Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Printable Invoice Modal */}
      <PrintableInvoiceModal
        isOpen={selectedInvoice !== null}
        onClose={() => setSelectedInvoice(null)}
        invoice={selectedInvoice}
        onStatusChanged={handleStatusChanged}
      />
    </div>
  );
}
