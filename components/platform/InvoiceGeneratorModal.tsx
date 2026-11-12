'use client';

import { useState } from 'react';
import { formatPesos } from '@/lib/billing/format';
import type {
  ApiResponse,
  InvoiceStatus,
  PlatformGenerateInvoiceResult,
  PlatformTenantRowEnriched,
  TenantInvoiceLineItem,
} from '@/lib/contracts';

interface InvoiceGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: PlatformTenantRowEnriched | null;
  onInvoiceCreated?: (result: PlatformGenerateInvoiceResult) => void;
}

export function InvoiceGeneratorModal({
  isOpen,
  onClose,
  tenant,
  onInvoiceCreated,
}: InvoiceGeneratorModalProps) {
  if (!isOpen || !tenant) return null;

  // Defaults
  const today = new Date();
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const defaultDueDay = tenant.billingDueDay || 5;
  // Default due date: next month on due day
  const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, defaultDueDay);
  const defaultDueDateStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(defaultDueDay).padStart(2, '0')}`;

  const [billingMonth, setBillingMonth] = useState(currentMonthStr);
  const [dueDate, setDueDate] = useState(defaultDueDateStr);
  const [status, setStatus] = useState<InvoiceStatus>('issued');
  const [notes, setNotes] = useState('');
  const [adjustmentCentavos, setAdjustmentCentavos] = useState(0);

  // Custom line items
  const [customItems, setCustomItems] = useState<TenantInvoiceLineItem[]>([]);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [newItemPricePesos, setNewItemPricePesos] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleAddLineItem() {
    if (!newItemDesc.trim()) return;
    const priceNum = parseFloat(newItemPricePesos) || 0;
    const priceCentavos = Math.round(priceNum * 100);
    const qty = Math.max(1, newItemQty);

    const item: TenantInvoiceLineItem = {
      id: crypto.randomUUID(),
      description: newItemDesc.trim(),
      quantity: qty,
      unitPriceCentavos: priceCentavos,
      totalCentavos: qty * priceCentavos,
    };

    setCustomItems([...customItems, item]);
    setNewItemDesc('');
    setNewItemQty(1);
    setNewItemPricePesos('');
  }

  function handleRemoveLineItem(id: string) {
    setCustomItems(customItems.filter((i) => i.id !== id));
  }

  const itemsTotalCentavos = customItems.reduce((acc, i) => acc + i.totalCentavos, 0);
  const baseEstimateCentavos = tenant.estimatedBillCentavos;
  const grandTotalCentavos = Math.max(0, baseEstimateCentavos + adjustmentCentavos + itemsTotalCentavos);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/platform/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant!.id,
          month: billingMonth,
          dueDate,
          adjustmentCentavos: adjustmentCentavos + itemsTotalCentavos,
          lineItems: customItems,
          notes: notes.trim() || null,
          status,
        }),
      });

      const body: ApiResponse<PlatformGenerateInvoiceResult> = await res.json();
      if (!res.ok || !body.ok) {
        setErrorMessage(body.ok === false ? body.message : 'Failed to generate invoice.');
        setSubmitting(false);
        return;
      }

      onInvoiceCreated?.(body.data);
      onClose();
    } catch {
      setErrorMessage('Network error while issuing invoice.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-plug-border bg-[#121214] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between border-b border-plug-border/80 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-odyssey-orange" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-odyssey-orange">
                Invoice Generator
              </p>
            </div>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-white">
              {tenant.name}
            </h2>
            <p className="font-mono text-xs text-plug-muted">Workspace: {tenant.slug}</p>
          </div>

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

        {errorMessage && (
          <div className="mt-4 rounded-xl border border-rose-800 bg-rose-950/60 p-3 text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5 text-sm">
          {/* Cycle & Due Date Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-300">Billing Month</label>
              <input
                type="date"
                required
                value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-plug-border bg-plug-elevated px-3 py-2 text-xs text-white focus:border-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300">Payment Due Date</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-plug-border bg-plug-elevated px-3 py-2 text-xs text-white focus:border-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                className="mt-1.5 w-full rounded-xl border border-plug-border bg-plug-elevated px-3 py-2 text-xs text-white focus:border-white focus:outline-none"
              >
                <option value="issued">Issued (Unpaid)</option>
                <option value="paid">Paid (Marked settled)</option>
                <option value="draft">Draft (Save only)</option>
              </select>
            </div>
          </div>

          {/* Metered Summary Breakdown Box */}
          <div className="rounded-xl border border-plug-border bg-plug-surface p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wider text-plug-muted">
                Active Plan: <span className="text-white">{tenant.planName}</span>
              </span>
              <span className="text-plug-muted">
                Billable Customers: <strong className="text-white">{tenant.activeCustomersThisMonth}</strong>
              </span>
            </div>

            <div className="mt-3 divide-y divide-plug-border/60 text-xs">
              <div className="flex items-center justify-between py-1.5">
                <span className="text-plug-muted">Metered Usage &amp; Plan Base Fee:</span>
                <span className="font-mono font-medium text-white">
                  {formatPesos(baseEstimateCentavos)}
                </span>
              </div>

              {customItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-1.5">
                  <span className="text-neutral-300">
                    {item.description} ({item.quantity}x @ {formatPesos(item.unitPriceCentavos)})
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-white">{formatPesos(item.totalCentavos)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveLineItem(item.id)}
                      className="text-rose-400 hover:text-rose-300"
                      title="Remove item"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between pt-2.5">
                <span className="text-sm font-bold uppercase tracking-wide text-white">
                  Total Amount Due:
                </span>
                <span className="font-mono text-base font-bold text-emerald-400">
                  {formatPesos(grandTotalCentavos)}
                </span>
              </div>
            </div>
          </div>

          {/* Custom Line Item / Adjustment Adder */}
          <div className="rounded-xl border border-plug-border/80 bg-plug-elevated/40 p-3.5">
            <p className="text-xs font-semibold text-neutral-200">
              + Add Custom Line Item or Hardware Fee (Optional)
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-6">
              <input
                type="text"
                placeholder="e.g. 2x NTAG 424 Counter Cards"
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                className="col-span-3 rounded-lg border border-plug-border bg-plug-elevated px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
              <input
                type="number"
                min="1"
                placeholder="Qty"
                value={newItemQty}
                onChange={(e) => setNewItemQty(parseInt(e.target.value) || 1)}
                className="col-span-1 rounded-lg border border-plug-border bg-plug-elevated px-2.5 py-1.5 text-xs text-white focus:border-white focus:outline-none"
              />
              <input
                type="number"
                step="0.01"
                placeholder="₱ Unit Price"
                value={newItemPricePesos}
                onChange={(e) => setNewItemPricePesos(e.target.value)}
                className="col-span-1 rounded-lg border border-plug-border bg-plug-elevated px-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddLineItem}
                disabled={!newItemDesc.trim()}
                className="col-span-1 rounded-lg border border-neutral-600 bg-plug-surface px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-neutral-800 disabled:opacity-40"
              >
                + Add
              </button>
            </div>
          </div>

          {/* Optional Notes */}
          <div>
            <label className="block text-xs font-semibold text-neutral-300">
              Payment Instructions / Invoice Notes <span className="font-normal text-plug-muted">(Optional)</span>
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Please settle via GCash or Bank Transfer before the 5th. Thank you!"
              className="mt-1.5 w-full rounded-xl border border-plug-border bg-plug-elevated px-3 py-2 text-xs text-white placeholder-neutral-500 focus:border-white focus:outline-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-plug-border px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-plug-muted transition-colors hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-odyssey-orange bg-odyssey-orange px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? 'Generating...' : `Issue Invoice (${formatPesos(grandTotalCentavos)})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
