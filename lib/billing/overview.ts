import 'server-only';

import type { BillingEstimate, BillingPlan } from '@/lib/contracts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

interface PlanRow {
  code: string;
  name: string;
  description: string;
  base_fee_centavos: number;
  included_customers: number;
  per_customer_centavos: number;
  monthly_cap_centavos: number | null;
}

export interface BillingOverview {
  plans: BillingPlan[];
  /** Null when the caller may not see this shop's billing. */
  estimate: BillingEstimate | null;
}

/** Plans a shop can pick from (active only; RLS hides retired ones). Pricing is not secret. */
export async function listBillingPlans(): Promise<BillingPlan[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('billing_plans')
    .select(
      'code, name, description, base_fee_centavos, included_customers, per_customer_centavos, monthly_cap_centavos',
    )
    .order('sort_order', { ascending: true });

  if (error || !data) return [];

  return (data as PlanRow[]).map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    baseFeeCentavos: row.base_fee_centavos,
    includedCustomers: row.included_customers,
    perCustomerCentavos: row.per_customer_centavos,
    monthlyCapCentavos: row.monthly_cap_centavos,
  }));
}

/**
 * Plan catalog plus this month's estimate for one shop. `actorId` must come from a verified session;
 * the SQL function re-checks that the actor is an owner/manager of the shop or a platform admin.
 */
export async function loadBillingOverview(
  actorId: string,
  tenantId: string,
): Promise<BillingOverview> {
  const admin = createSupabaseAdminClient();
  const [plans, { data, error }] = await Promise.all([
    listBillingPlans(),
    admin.rpc('get_billing_estimate', { p_actor: actorId, p_tenant: tenantId }),
  ]);

  const raw = data as Record<string, unknown> | null;
  if (error || !raw || raw.result !== 'ok') {
    return { plans, estimate: null };
  }

  return {
    plans,
    estimate: {
      month: String(raw.month),
      billed: raw.billed === true,
      plan: (raw.plan as BillingPlan | null) ?? null,
      activeCustomers: Number(raw.activeCustomers ?? 0),
      extraCustomers: Number(raw.extraCustomers ?? 0),
      baseFeeCentavos: Number(raw.baseFeeCentavos ?? 0),
      usageFeeCentavos: Number(raw.usageFeeCentavos ?? 0),
      capApplied: raw.capApplied === true,
      totalCentavos: Number(raw.totalCentavos ?? 0),
      pendingPlan: (raw.pendingPlan as BillingEstimate['pendingPlan']) ?? null,
    },
  };
}
