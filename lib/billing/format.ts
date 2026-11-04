import type { BillingPlan } from '@/lib/contracts';

/** Whole pesos print without decimals ("₱350"); anything else keeps two ("₱7.50"). */
export function formatPesos(centavos: number): string {
  const pesos = centavos / 100;
  const hasCentavos = centavos % 100 !== 0;
  return `₱${pesos.toLocaleString('en-PH', {
    minimumFractionDigits: hasCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** "2026-11-01" -> "November 2026" (the date is a calendar month in the shop's timezone). */
export function formatBillingMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** One plain-language line describing what a plan charges. */
export function describePlanPricing(plan: BillingPlan): string {
  const perCustomer = formatPesos(plan.perCustomerCentavos);
  const cap =
    plan.monthlyCapCentavos === null
      ? ''
      : `, never more than ${formatPesos(plan.monthlyCapCentavos)} a month`;

  if (plan.baseFeeCentavos === 0) {
    return `${perCustomer} per active customer${cap}`;
  }
  return `${formatPesos(plan.baseFeeCentavos)} a month covers ${plan.includedCustomers} active customers, then ${perCustomer} each${cap}`;
}

/** What a month would cost on a plan for a given number of active customers (mirrors private.bill_for_usage). */
export function priceForActiveCustomers(plan: BillingPlan, activeCustomers: number): number {
  const extra = Math.max(activeCustomers - plan.includedCustomers, 0);
  const uncapped = plan.baseFeeCentavos + extra * plan.perCustomerCentavos;
  return plan.monthlyCapCentavos === null ? uncapped : Math.min(uncapped, plan.monthlyCapCentavos);
}
