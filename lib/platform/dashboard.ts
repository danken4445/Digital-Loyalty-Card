import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  InvoiceStatus,
  PlatformDashboardKpis,
  PlatformDashboardOverview,
  PlatformGenerateInvoiceResult,
  PlatformTenantRowEnriched,
  TenantIndustry,
  TenantInvoice,
  TenantStatus,
} from '@/lib/contracts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

function inferIndustry(name: string, slug: string): TenantIndustry {
  const s = `${name || ''} ${slug || ''}`.toLowerCase();
  if (s.includes('cafe') || s.includes('coffee') || s.includes('plug') || s.includes('brew')) {
    return 'cafe';
  }
  if (
    s.includes('pickleball') ||
    s.includes('court') ||
    s.includes('sport') ||
    s.includes('paddle') ||
    s.includes('club')
  ) {
    return 'sports';
  }
  if (s.includes('barber') || s.includes('cut') || s.includes('fade')) {
    return 'barbershop';
  }
  if (s.includes('gym') || s.includes('fitness') || s.includes('workout')) {
    return 'fitness';
  }
  if (s.includes('car') || s.includes('auto') || s.includes('detail') || s.includes('wash')) {
    return 'car_service';
  }
  if (s.includes('resto') || s.includes('diner') || s.includes('food') || s.includes('kitchen')) {
    return 'restaurant';
  }
  return 'retail';
}

/**
 * Direct fallback loader that computes the full PlatformDashboardOverview
 * in TypeScript by querying tables directly via Supabase Service Role client.
 * This guarantees the Super Admin dashboard works reliably even when custom
 * SQL RPCs have not been migrated to the remote database.
 */
export async function getPlatformDashboardOverviewDirect(
  adminClient: SupabaseClient,
  _actorId: string,
): Promise<PlatformDashboardOverview> {
  const [
    { data: tenantsRaw },
    { data: settingsRaw },
    { data: cardsRaw },
    { data: stampsRaw },
    { data: redemptionsRaw },
    { data: plansRaw },
    { data: selectionsRaw },
    { data: locationsRaw },
    { data: tagsRaw },
    { data: membersRaw },
  ] = await Promise.all([
    adminClient
      .from('tenants')
      .select('id, slug, name, status, created_at, suspended_at')
      .order('created_at', { ascending: false }),
    adminClient.from('tenant_settings').select('*'),
    adminClient.from('customer_cards').select('tenant_id, customer_id, added_at'),
    adminClient.from('stamps').select('tenant_id, customer_id, created_at'),
    adminClient.from('redemptions').select('tenant_id, created_at'),
    adminClient.from('billing_plans').select('*'),
    adminClient.from('tenant_plan_selections').select('*'),
    adminClient.from('locations').select('tenant_id, active'),
    adminClient.from('tags').select('tenant_id, active'),
    adminClient.from('tenant_members').select('tenant_id, user_id, role, display_name').eq('role', 'owner'),
  ]);

  const tenants = tenantsRaw ?? [];
  const settings = settingsRaw ?? [];
  const cards = cardsRaw ?? [];
  const stamps = stampsRaw ?? [];
  const redemptions = redemptionsRaw ?? [];
  const plans = plansRaw ?? [];
  const selections = selectionsRaw ?? [];
  const locations = locationsRaw ?? [];
  const tags = tagsRaw ?? [];
  const members = membersRaw ?? [];

  // Also fetch invoices from audit_log or tenant_invoices if available
  const invoices = await listPlatformInvoicesDirect(adminClient, null);

  const now = new Date();
  const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const endOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  const stampsThisMonth = stamps.filter((s) => new Date(s.created_at) >= startOfThisMonth);
  const stampsLastMonth = stamps.filter((s) => {
    const d = new Date(s.created_at);
    return d >= startOfLastMonth && d <= endOfLastMonth;
  });

  const activeCust30d = new Set(
    stamps.filter((s) => new Date(s.created_at) >= thirtyDaysAgo).map((s) => s.customer_id),
  ).size;
  const totalCards = cards.length;
  const utilizationRatePct = totalCards > 0 ? Math.round((activeCust30d / totalCards) * 1000) / 10 : 0;

  const redemptionsThisMonth = redemptions.filter((r) => new Date(r.created_at) >= startOfThisMonth).length;

  const planMap = new Map(plans.map((p) => [p.code, p]));
  const defaultPlan = planMap.get('pay-as-you-go') || plans[0];

  const selectionMap = new Map(selections.map((s) => [s.tenant_id, s.plan_code]));
  const settingsMap = new Map(settings.map((s) => [s.tenant_id, s]));
  const ownerMemberMap = new Map(members.map((m) => [m.tenant_id, m]));

  const industries: Record<string, number> = {};
  let totalRevenueCentavos = 0;
  let dueSoonCount = 0;

  const enrichedTenants: PlatformTenantRowEnriched[] = tenants.map((t) => {
    const s = settingsMap.get(t.id);
    const planCode = selectionMap.get(t.id) || 'pay-as-you-go';
    const plan = planMap.get(planCode) || defaultPlan;
    const industry: TenantIndustry = inferIndustry(t.name, t.slug);
    industries[industry] = (industries[industry] || 0) + 1;

    const tCards = cards.filter((c) => c.tenant_id === t.id);
    const tStamps = stamps.filter((st) => st.tenant_id === t.id);
    const tStamps7d = tStamps.filter((st) => new Date(st.created_at) >= sevenDaysAgo);
    const tStampsMonth = tStamps.filter((st) => new Date(st.created_at) >= startOfThisMonth);
    const activeThisMonth = new Set(tStampsMonth.map((st) => st.customer_id)).size;

    let lastStampAt: string | null = null;
    if (tStamps.length > 0) {
      const sorted = [...tStamps].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      lastStampAt = sorted[0]?.created_at ?? null;
    }

    // bill estimation
    let bill = 0;
    if (plan) {
      bill = plan.base_fee_centavos;
      const billable = Math.max(0, activeThisMonth - plan.included_customers);
      bill += billable * plan.per_customer_centavos;
      if (plan.monthly_cap_centavos && bill > plan.monthly_cap_centavos) {
        bill = plan.monthly_cap_centavos;
      }
    }
    if (t.status === 'active') {
      totalRevenueCentavos += bill;
    }

    // due date calculation: default 28th of current month
    const dueDay = 28;
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    let dueDateObj = new Date(Date.UTC(currentYear, currentMonth, dueDay));
    if (now.getTime() > dueDateObj.getTime()) {
      dueDateObj = new Date(Date.UTC(currentYear, currentMonth + 1, dueDay));
    }
    const dueDateStr = dueDateObj.toISOString().slice(0, 10);
    const daysUntilDue = Math.ceil((dueDateObj.getTime() - now.getTime()) / 86400000);
    const isDueSoon = daysUntilDue <= 7 && daysUntilDue >= 0;
    const isOverdue = daysUntilDue < 0;
    if (isDueSoon) dueSoonCount++;

    const activeFlags: string[] = [];
    if (s?.brand?.logoUrl || s?.brand?.cardArtUrl) activeFlags.push('Custom Brand Art');
    if (s?.milestone_step) activeFlags.push(`Mid-Card Milestone (Step ${s.milestone_step})`);
    if (s?.brand?.socialRewardEnabled || s?.perks?.instagram_follow_upsize) {
      activeFlags.push('Social Follow Perk');
    }
    const locs = locations.filter((l) => l.tenant_id === t.id && l.active);
    if (locs.length > 1) activeFlags.push(`Multi-Location (${locs.length})`);
    const tTags = tags.filter((tg) => tg.tenant_id === t.id && tg.active);
    if (tTags.length > 0) activeFlags.push(`NFC Physical Tags (${tTags.length})`);
    if (tCards.length > 0) activeFlags.push(`Active Customer Cards (${tCards.length})`);
    if (s?.daily_cap) activeFlags.push('Daily Throttle Shield');
    activeFlags.push('Audit Telemetry');

    // Latest invoice for this tenant
    const tenantInvoices = invoices.filter((inv) => inv.tenantId === t.id);
    const latestInvoice = tenantInvoices[0] ?? null;

    let billingBadge: PlatformTenantRowEnriched['billingBadge'] = 'current';
    if (t.status === 'trial') {
      billingBadge = 'trial';
    } else if (latestInvoice && latestInvoice.status === 'paid') {
      billingBadge = 'paid';
    } else if (isOverdue || (latestInvoice && latestInvoice.status === 'issued' && new Date(latestInvoice.dueDate) < now)) {
      billingBadge = 'overdue';
    } else if (isDueSoon || (latestInvoice && latestInvoice.status === 'issued')) {
      billingBadge = 'due_soon';
    }

    const ownerMember = ownerMemberMap.get(t.id);

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      industry,
      status: t.status as TenantStatus,
      createdAt: t.created_at,
      suspendedAt: t.suspended_at,
      ownerEmail: ownerMember?.display_name ?? null,
      billingDueDay: dueDay,
      planCode,
      planName: plan?.name || 'Pay as you go',
      totalCards: tCards.length,
      activeCustomersThisMonth: activeThisMonth,
      stamps7d: tStamps7d.length,
      lastStampAt,
      estimatedBillCentavos: bill,
      capabilitiesCount: activeFlags.length,
      activeFlags,
      dueDate: dueDateStr,
      daysUntilDue,
      isDueSoon,
      isOverdue,
      billingBadge,
      latestInvoice: latestInvoice
        ? {
            id: latestInvoice.id,
            invoiceNumber: latestInvoice.invoiceNumber,
            status: latestInvoice.status,
            totalCentavos: latestInvoice.totalCentavos,
            dueDate: latestInvoice.dueDate,
          }
        : null,
      hasTagLeakAlert: false,
    };
  });

  const unpaidInvoicesCount = invoices.filter(
    (inv) => inv.status === 'issued' || inv.status === 'draft',
  ).length;

  const kpis: PlatformDashboardKpis = {
    activeTenants: enrichedTenants.filter((t) => t.status === 'active').length,
    trialTenants: enrichedTenants.filter((t) => t.status === 'trial').length,
    suspendedTenants: enrichedTenants.filter((t) => t.status === 'suspended').length,
    totalTenants: enrichedTenants.length,
    totalCards,
    activeCustomers30d: activeCust30d,
    utilizationRatePct,
    monthlyStamps: stampsThisMonth.length,
    lastMonthStamps: stampsLastMonth.length,
    stampsMoMDeltaPct:
      stampsLastMonth.length > 0
        ? Math.round(((stampsThisMonth.length - stampsLastMonth.length) / stampsLastMonth.length) * 100)
        : 0,
    monthlyRedemptions: redemptionsThisMonth,
    monthlyRevenueCentavos: totalRevenueCentavos,
    lastMonthRevenueCentavos: 0,
    revenueMoMDeltaPct: 0,
    unpaidInvoicesCount,
    dueSoonCount,
  };

  return {
    kpis,
    industries,
    tenants: enrichedTenants,
  };
}

/**
 * Lists platform invoices. Attempts custom RPC first; if missing, reads from audit_log.
 */
export async function listPlatformInvoicesDirect(
  adminClient: SupabaseClient,
  tenantId?: string | null,
): Promise<TenantInvoice[]> {
  // 1. Try querying public.tenant_invoices table first if it exists
  const { data: tableRows, error: tableErr } = await adminClient
    .from('tenant_invoices')
    .select('*')
    .order('created_at', { ascending: false });

  if (!tableErr && tableRows) {
    let list = tableRows as TenantInvoice[];
    if (tenantId) {
      list = list.filter((i) => i.tenantId === tenantId);
    }
    return list;
  }

  // 2. Fallback to audit_log where action = 'platform.invoice.created'
  let query = adminClient
    .from('audit_log')
    .select('id, action, target, detail, created_at, tenant_id')
    .eq('action', 'platform.invoice.created')
    .order('created_at', { ascending: false });

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data: logs, error: logErr } = await query;
  if (logErr || !logs) {
    return [];
  }

  // Check for any status updates in audit_log
  const { data: updates } = await adminClient
    .from('audit_log')
    .select('target, detail, created_at')
    .eq('action', 'platform.invoice.status_updated')
    .order('created_at', { ascending: true });

  const statusMap = new Map<string, { status: InvoiceStatus; paidAt: string | null }>();
  if (updates) {
    for (const u of updates) {
      if (u.target && u.detail && (u.detail as any).status) {
        statusMap.set(u.target, {
          status: (u.detail as any).status as InvoiceStatus,
          paidAt: (u.detail as any).paidAt ?? null,
        });
      }
    }
  }

  const invoices: TenantInvoice[] = [];
  for (const log of logs) {
    if (log.detail && typeof log.detail === 'object') {
      const inv = log.detail as TenantInvoice;
      const update = statusMap.get(inv.invoiceNumber) || statusMap.get(inv.id);
      if (update) {
        inv.status = update.status;
        inv.paidAt = update.paidAt;
      }
      invoices.push(inv);
    }
  }

  return invoices;
}

/**
 * Generates an invoice. Attempts RPC first; if missing, computes line items and saves to audit_log.
 */
export async function generatePlatformInvoiceDirect(
  adminClient: SupabaseClient,
  params: {
    actorId: string;
    tenantId: string;
    month: string;
    dueDate: string;
    adjustmentCentavos?: number;
    lineItems?: Array<{
      id: string;
      description: string;
      quantity: number;
      unitPriceCentavos: number;
      totalCentavos: number;
    }>;
    notes?: string | null;
    status?: InvoiceStatus;
  },
): Promise<PlatformGenerateInvoiceResult> {
  const {
    actorId,
    tenantId,
    month,
    dueDate,
    adjustmentCentavos = 0,
    lineItems = [],
    notes = null,
    status = 'issued',
  } = params;

  // 1. Get tenant
  const { data: tenant, error: tErr } = await adminClient
    .from('tenants')
    .select('id, slug, name')
    .eq('id', tenantId)
    .single();

  if (tErr || !tenant) {
    throw new Error('Tenant not found.');
  }

  // 2. Get plan and usage for the month
  const normalizedMonth = month.length === 7 ? `${month}-01` : month;
  const monthDate = new Date(normalizedMonth);
  const startOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const [
    { data: plans },
    { data: selection },
    { data: stamps },
    { data: existingLogs },
  ] = await Promise.all([
    adminClient.from('billing_plans').select('*'),
    adminClient
      .from('tenant_plan_selections')
      .select('plan_code')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    adminClient
      .from('stamps')
      .select('customer_id, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', startOfMonth.toISOString())
      .lte('created_at', endOfMonth.toISOString()),
    adminClient
      .from('audit_log')
      .select('id')
      .eq('action', 'platform.invoice.created'),
  ]);

  const planMap = new Map((plans ?? []).map((p) => [p.code, p]));
  const planCode = selection?.plan_code || 'pay-as-you-go';
  const plan = planMap.get(planCode) || (plans ?? [])[0];

  const activeCustMonth = new Set((stamps ?? []).map((s) => s.customer_id)).size;
  const baseFeeCentavos = plan?.base_fee_centavos ?? 0;
  const includedCustomers = plan?.included_customers ?? 0;
  const perCustomerCentavos = plan?.per_customer_centavos ?? 1000;
  const billableCustomers = Math.max(0, activeCustMonth - includedCustomers);
  let usageFeeCentavos = billableCustomers * perCustomerCentavos;

  if (plan?.monthly_cap_centavos && baseFeeCentavos + usageFeeCentavos > plan.monthly_cap_centavos) {
    usageFeeCentavos = Math.max(0, plan.monthly_cap_centavos - baseFeeCentavos);
  }

  // Generate sequential invoice number: INV-YYYYMM-XXXX
  const seq = (existingLogs?.length ?? 0) + 1;
  const monthTag = normalizedMonth.slice(0, 7).replace('-', '');
  const invoiceNumber = `INV-${monthTag}-${String(seq).padStart(4, '0')}`;
  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Build line items
  const finalLineItems =
    lineItems.length > 0
      ? lineItems
      : [
          ...(baseFeeCentavos > 0
            ? [
                {
                  id: 'item_base_plan',
                  description: `${plan?.name ?? 'Base Plan'} monthly subscription`,
                  quantity: 1,
                  unitPriceCentavos: baseFeeCentavos,
                  totalCentavos: baseFeeCentavos,
                },
              ]
            : []),
          {
            id: 'item_active_customers',
            description: `Metered active customer usage (${billableCustomers} customer${billableCustomers === 1 ? '' : 's'} @ ₱${(perCustomerCentavos / 100).toFixed(2)})`,
            quantity: billableCustomers,
            unitPriceCentavos: perCustomerCentavos,
            totalCentavos: usageFeeCentavos,
          },
        ];

  const subtotal = finalLineItems.reduce((acc, item) => acc + item.totalCentavos, 0);
  const totalCentavos = Math.max(0, subtotal + adjustmentCentavos);

  const invoiceRecord: TenantInvoice = {
    id: invoiceId,
    invoiceNumber,
    tenantId,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    billingMonth: normalizedMonth,
    status,
    planCode,
    planName: plan?.name ?? 'Pay as you go',
    activeCustomers: activeCustMonth,
    includedCustomers,
    extraCustomers: billableCustomers,
    baseFeeCentavos,
    usageFeeCentavos,
    adjustmentCentavos,
    totalCentavos,
    lineItems: finalLineItems,
    notes,
    dueDate,
    issuedAt: new Date().toISOString(),
    paidAt: status === 'paid' ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };

  // Try storing in public.tenant_invoices table first
  const { error: insErr } = await adminClient.from('tenant_invoices').insert({
    id: invoiceId,
    invoice_number: invoiceNumber,
    tenant_id: tenantId,
    month: normalizedMonth,
    due_date: dueDate,
    status,
    base_fee_centavos: baseFeeCentavos,
    per_customer_centavos: perCustomerCentavos,
    active_customers_count: activeCustMonth,
    included_customers: includedCustomers,
    billable_customers_count: billableCustomers,
    usage_fee_centavos: usageFeeCentavos,
    adjustment_centavos: adjustmentCentavos,
    total_centavos: totalCentavos,
    line_items: finalLineItems,
    notes,
    paid_at: invoiceRecord.paidAt,
  });

  // If table does not exist or fails, record in audit_log
  if (insErr) {
    await adminClient.from('audit_log').insert({
      tenant_id: tenantId,
      actor: actorId,
      action: 'platform.invoice.created',
      target: invoiceNumber,
      detail: invoiceRecord,
    });
  }

  return {
    result: 'created',
    invoiceId,
    invoiceNumber,
    totalCentavos,
  };
}

/**
 * Updates an invoice status (e.g. issued -> paid or void).
 */
export async function updatePlatformInvoiceStatusDirect(
  adminClient: SupabaseClient,
  params: {
    actorId: string;
    invoiceId: string;
    status: InvoiceStatus;
  },
): Promise<TenantInvoice | null> {
  const { actorId, invoiceId, status } = params;
  const paidAt = status === 'paid' ? new Date().toISOString() : null;

  // Try update in public.tenant_invoices table
  const { data: updatedTable, error: tableErr } = await adminClient
    .from('tenant_invoices')
    .update({
      status,
      paid_at: paidAt,
      updated_at: new Date().toISOString(),
    })
    .or(`id.eq.${invoiceId},invoice_number.eq.${invoiceId}`)
    .select()
    .maybeSingle();

  if (!tableErr && updatedTable) {
    return updatedTable as TenantInvoice;
  }

  // Record status update in audit_log
  await adminClient.from('audit_log').insert({
    actor: actorId,
    action: 'platform.invoice.status_updated',
    target: invoiceId,
    detail: {
      invoiceId,
      status,
      paidAt,
      updatedAt: new Date().toISOString(),
    },
  });

  return null;
}

/**
 * Master entry point for loading the Super Admin dashboard overview.
 * First calls the RPC if available; gracefully falls back to the direct loader.
 */
export async function loadPlatformDashboardOverview(
  actorId: string,
): Promise<PlatformDashboardOverview> {
  const adminClient = createSupabaseAdminClient();

  try {
    const { data, error } = await adminClient.rpc('platform_get_dashboard_overview', {
      p_actor: actorId,
    });

    if (!error && data) {
      const raw = data as unknown as Record<string, unknown>;
      if (raw.result === 'ok') {
        return {
          kpis: raw.kpis as PlatformDashboardOverview['kpis'],
          industries: (raw.industries as Record<string, number>) ?? {},
          tenants: (raw.tenants as PlatformDashboardOverview['tenants']) ?? [],
        };
      }
    }
  } catch {
    // Graceful fallback below
  }

  // Call direct loader when RPC is missing or fails
  return getPlatformDashboardOverviewDirect(adminClient, actorId);
}
