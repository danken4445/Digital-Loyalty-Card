'use client';

import { useEffect, useState } from 'react';
import { formatPesos } from '@/lib/billing/format';
import type { ApiResponse, InvoiceStatus, TenantInvoice } from '@/lib/contracts';

interface PrintableInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: TenantInvoice | null;
  onStatusChanged?: (invoiceId: string, newStatus: InvoiceStatus) => void;
}

export function PrintableInvoiceModal({
  isOpen,
  onClose,
  invoice,
  onStatusChanged,
}: PrintableInvoiceModalProps) {
  const [currentStatus, setCurrentStatus] = useState<InvoiceStatus>(invoice?.status ?? 'issued');
  const [updating, setUpdating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (invoice) {
      setCurrentStatus(invoice.status);
      setStatusMessage(null);
    }
  }, [invoice]);

  if (!isOpen || !invoice) return null;

  async function handleUpdateStatus(targetStatus: InvoiceStatus) {
    setUpdating(true);
    setStatusMessage(null);
    try {
      const res = await fetch(`/api/platform/invoices/${encodeURIComponent(invoice!.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus, reason: `Manual platform action by admin` }),
      });

      const body: ApiResponse<{ invoiceId: string; status: InvoiceStatus }> = await res.json();
      if (res.ok && body.ok) {
        setCurrentStatus(targetStatus);
        setStatusMessage(`Invoice marked as ${targetStatus}.`);
        onStatusChanged?.(invoice!.id, targetStatus);
      } else {
        setStatusMessage(body.ok === false ? body.message : 'Failed to update status.');
      }
    } catch {
      setStatusMessage('Network error updating status.');
    } finally {
      setUpdating(false);
    }
  }

  function handleCopySummary() {
    const summary = `🧾 *ODC PLATFORM INVOICE*
Invoice: ${invoice!.invoiceNumber}
Shop: ${invoice!.tenantName ?? invoice!.tenantSlug}
Billing Period: ${invoice!.billingMonth}
Due Date: ${invoice!.dueDate}
Plan: ${invoice!.planName}
Active Stamped Customers: ${invoice!.activeCustomers}
Total Due: ${formatPesos(invoice!.totalCentavos)}
Status: ${currentStatus.toUpperCase()}

Please settle via Bank Transfer / GCash / Maya. Thank you!`;

    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/85 p-3 sm:p-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-3xl rounded-2xl border border-plug-border bg-[#141416] p-6 shadow-2xl sm:p-8">
        {/* Top Controls Bar (hidden when printing) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-plug-border/80 pb-4 print:hidden">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                currentStatus === 'paid'
                  ? 'border border-emerald-800 bg-emerald-950/80 text-emerald-400'
                  : currentStatus === 'void'
                    ? 'border border-neutral-700 bg-neutral-800 text-neutral-400'
                    : 'border border-amber-800 bg-amber-950/80 text-amber-300'
              }`}
            >
              ● {currentStatus}
            </span>
            <span className="font-mono text-xs text-plug-muted">{invoice.invoiceNumber}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-plug-border bg-plug-elevated px-3 py-1.5 text-xs font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white px-3 py-1.5 text-xs font-bold text-plug-black transition-colors hover:bg-neutral-200"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              <span>Print / Save PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-plug-border p-1.5 text-plug-muted transition-colors hover:border-neutral-500 hover:text-white"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-3 rounded-lg border border-plug-border bg-plug-surface p-2.5 text-xs text-neutral-300 print:hidden">
            {statusMessage}
          </div>
        )}

        {/* Printable Paper Document Container */}
        <div className="mt-4 rounded-xl border border-plug-border bg-plug-surface p-6 sm:p-8 print:border-none print:bg-white print:p-0 print:text-black">
          {/* Header */}
          <div className="flex flex-col justify-between gap-4 border-b border-plug-border pb-6 sm:flex-row sm:items-start print:border-neutral-300">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-odyssey-navy font-display text-sm font-bold text-white print:bg-black">
                  ODC
                </div>
                <span className="font-display text-lg font-bold tracking-tight text-white print:text-black">
                  ODC PLATFORM
                </span>
              </div>
              <p className="mt-1 text-xs text-plug-muted print:text-neutral-600">
                Digital Loyalty &amp; Multi-Tenant Ops Ecosystem
              </p>
              <p className="text-[11px] text-plug-muted print:text-neutral-600">Philippines (Asia/Manila)</p>
            </div>

            <div className="text-left sm:text-right">
              <span className="font-display text-2xl font-bold tracking-tight text-white print:text-black">
                INVOICE
              </span>
              <p className="font-mono text-xs font-semibold text-neutral-300 print:text-neutral-800">
                #{invoice.invoiceNumber}
              </p>
              <p className="mt-1 text-xs text-plug-muted print:text-neutral-600">
                Issued: {new Date(invoice.issuedAt).toLocaleDateString()}
              </p>
              <p className="text-xs font-semibold text-amber-400 print:text-neutral-900">
                Due Date: {new Date(invoice.dueDate).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Billed To / Account Info */}
          <div className="grid grid-cols-1 gap-6 py-6 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-plug-muted print:text-neutral-500">
                Billed To
              </p>
              <p className="mt-1 font-display text-base font-bold text-white print:text-black">
                {invoice.tenantName ?? invoice.tenantSlug}
              </p>
              <p className="font-mono text-xs text-plug-muted print:text-neutral-700">
                Workspace: {invoice.tenantSlug}
              </p>
            </div>

            <div className="sm:text-right">
              <p className="text-[11px] font-bold uppercase tracking-widest text-plug-muted print:text-neutral-500">
                Billing Cycle
              </p>
              <p className="mt-1 text-sm font-semibold text-white print:text-black">
                {invoice.billingMonth}
              </p>
              <p className="text-xs text-plug-muted print:text-neutral-700">
                Plan: <strong className="text-white print:text-black">{invoice.planName}</strong>
              </p>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="overflow-x-auto rounded-xl border border-plug-border print:border-neutral-300">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-plug-border bg-plug-elevated uppercase tracking-wider text-plug-muted print:border-neutral-300 print:bg-neutral-100 print:text-neutral-700">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Description
                  </th>
                  <th scope="col" className="px-4 py-3 text-center font-semibold">
                    Qty / Rate
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-plug-border print:divide-neutral-200">
                {/* Plan Base Fee */}
                <tr>
                  <td className="px-4 py-3 text-white print:text-black">
                    <strong>Monthly Base Subscription</strong> ({invoice.planName})
                    <p className="text-[11px] text-plug-muted print:text-neutral-600">
                      Covers first {invoice.includedCustomers} active stamped customer cards
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center text-plug-muted print:text-neutral-700">
                    1 month
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-white print:text-black">
                    {formatPesos(invoice.baseFeeCentavos)}
                  </td>
                </tr>

                {/* Metered Overages */}
                {invoice.extraCustomers > 0 && (
                  <tr>
                    <td className="px-4 py-3 text-white print:text-black">
                      <strong>Active Customer Metered Usage</strong>
                      <p className="text-[11px] text-plug-muted print:text-neutral-600">
                        {invoice.extraCustomers} customers above the {invoice.includedCustomers} threshold
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center text-plug-muted print:text-neutral-700">
                      {invoice.extraCustomers} customers
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-white print:text-black">
                      {formatPesos(invoice.usageFeeCentavos)}
                    </td>
                  </tr>
                )}

                {/* Custom Adjustments / Line Items */}
                {invoice.lineItems &&
                  invoice.lineItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3 text-white print:text-black">
                        {item.description}
                      </td>
                      <td className="px-4 py-3 text-center text-plug-muted print:text-neutral-700">
                        {item.quantity} &times; {formatPesos(item.unitPriceCentavos)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-white print:text-black">
                        {formatPesos(item.totalCentavos)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="mt-4 flex flex-col items-end gap-2 text-xs">
            <div className="flex w-64 justify-between border-t border-plug-border/60 pt-3 text-sm font-bold text-white print:border-neutral-300 print:text-black">
              <span>Total Due:</span>
              <span className="font-mono text-base font-bold text-emerald-400 print:text-black">
                {formatPesos(invoice.totalCentavos)}
              </span>
            </div>
          </div>

          {/* Payment Notes / Instructions */}
          <div className="mt-6 rounded-xl border border-plug-border/60 bg-plug-elevated/40 p-4 print:border-neutral-300 print:bg-neutral-50">
            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-300 print:text-neutral-800">
              Payment Instructions &amp; Bank Details
            </p>
            <p className="mt-1 text-xs text-plug-muted print:text-neutral-700">
              {invoice.notes ?? 'Please settle the balance through GCash, Maya, or BDO/BPI Bank Transfer on or before the due date.'}
            </p>
          </div>
        </div>

        {/* Bottom Status Controls (hidden when printing) */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-plug-border/80 pt-4 print:hidden">
          <div className="flex items-center gap-2">
            <span className="text-xs text-plug-muted">Set Status:</span>
            <button
              type="button"
              disabled={updating || currentStatus === 'paid'}
              onClick={() => handleUpdateStatus('paid')}
              className="rounded-lg border border-emerald-800 bg-emerald-950/60 px-3 py-1.5 text-xs font-bold text-emerald-300 transition-colors hover:bg-emerald-900 disabled:opacity-40"
            >
              Mark Paid
            </button>
            <button
              type="button"
              disabled={updating || currentStatus === 'issued'}
              onClick={() => handleUpdateStatus('issued')}
              className="rounded-lg border border-amber-800 bg-amber-950/60 px-3 py-1.5 text-xs font-bold text-amber-300 transition-colors hover:bg-amber-900 disabled:opacity-40"
            >
              Mark Issued
            </button>
            <button
              type="button"
              disabled={updating || currentStatus === 'void'}
              onClick={() => handleUpdateStatus('void')}
              className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-bold text-neutral-400 transition-colors hover:bg-neutral-700 disabled:opacity-40"
            >
              Void
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-plug-border px-4 py-2 text-xs font-bold uppercase tracking-wider text-plug-muted hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
