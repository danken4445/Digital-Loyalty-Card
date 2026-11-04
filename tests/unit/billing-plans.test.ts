import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePlanPricing,
  formatBillingMonth,
  formatPesos,
  priceForActiveCustomers,
} from '@/lib/billing/format';
import type { BillingPlan } from '@/lib/contracts';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();
const staffSession = vi.fn();
const platformAdmin = vi.fn();
let tenantLookup: { data: { id: string } | null } = { data: { id: 'tenant-from-slug' } };

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ rpc }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => tenantLookup }) }),
    }),
  }),
}));
vi.mock('@/lib/auth/staff', () => ({ requireStaffSession: () => staffSession() }));
vi.mock('@/lib/auth/platform', () => ({ requirePlatformAdmin: () => platformAdmin() }));
vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: () => '127.0.0.1',
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { POST as platformPlanPost } from '@/app/api/platform/tenants/[slug]/plan/route';
import { POST as staffBillingPost } from '@/app/api/staff/billing/route';

const payAsYouGo: BillingPlan = {
  code: 'pay-as-you-go',
  name: 'Pay as you go',
  description: '',
  baseFeeCentavos: 0,
  includedCustomers: 0,
  perCustomerCentavos: 1000,
  monthlyCapCentavos: null,
};
const starter: BillingPlan = {
  ...payAsYouGo,
  code: 'starter-50',
  baseFeeCentavos: 35000,
  includedCustomers: 50,
  perCustomerCentavos: 700,
};
const capped: BillingPlan = {
  ...payAsYouGo,
  code: 'worry-free',
  perCustomerCentavos: 800,
  monthlyCapCentavos: 120000,
};

describe('billing plan formatting and pricing', () => {
  it('formats pesos without needless decimals', () => {
    expect(formatPesos(35000)).toBe('₱350');
    expect(formatPesos(750)).toBe('₱7.50');
    expect(formatPesos(120000)).toBe('₱1,200');
    expect(formatPesos(0)).toBe('₱0');
  });

  it('formats a billing month in UTC so the date never shifts', () => {
    expect(formatBillingMonth('2026-11-01')).toBe('November 2026');
    expect(formatBillingMonth('2026-01-01')).toBe('January 2026');
  });

  it('describes each plan shape in plain language', () => {
    expect(describePlanPricing(payAsYouGo)).toBe('₱10 per active customer');
    expect(describePlanPricing(starter)).toBe(
      '₱350 a month covers 50 active customers, then ₱7 each',
    );
    expect(describePlanPricing(capped)).toBe(
      '₱8 per active customer, never more than ₱1,200 a month',
    );
  });

  it('prices usage the same way the database does', () => {
    expect(priceForActiveCustomers(payAsYouGo, 37)).toBe(37000);
    expect(priceForActiveCustomers(starter, 20)).toBe(35000);
    expect(priceForActiveCustomers(starter, 60)).toBe(42000);
    expect(priceForActiveCustomers(capped, 500)).toBe(120000);
    expect(priceForActiveCustomers(payAsYouGo, 0)).toBe(0);
  });
});

function jsonRequest(url: string, body: unknown, origin = 'http://localhost:3000') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
}

describe('POST /api/staff/billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    staffSession.mockResolvedValue({
      authorized: true,
      staff: { userId: 'owner-1', tenantId: 'tenant-from-session', role: 'owner' },
    });
  });

  it('uses the shop from the session, never one named in the body', async () => {
    rpc.mockResolvedValue({ data: 'updated', error: null });

    const res = await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', {
        plan: 'starter-50',
        tenantId: 'someone-elses-shop',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { result: 'updated' } });
    expect(rpc).toHaveBeenCalledWith('choose_billing_plan', {
      p_actor: 'owner-1',
      p_tenant: 'tenant-from-session',
      p_plan: 'starter-50',
      p_immediate: false,
    });
  });

  it('never lets a shop owner request an immediate change', async () => {
    rpc.mockResolvedValue({ data: 'updated', error: null });

    await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', {
        plan: 'starter-50',
        immediate: true,
      }),
    );

    expect(rpc).toHaveBeenCalledWith(
      'choose_billing_plan',
      expect.objectContaining({ p_immediate: false }),
    );
  });

  it('maps the SQL refusal for non-owners to 403', async () => {
    rpc.mockResolvedValue({ data: 'unauthorized', error: null });

    const res = await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', { plan: 'starter-50' }),
    );

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
  });

  it('maps an unknown plan to 400', async () => {
    rpc.mockResolvedValue({ data: 'invalid-plan', error: null });

    const res = await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', { plan: 'does-not-exist' }),
    );

    expect(res.status).toBe(400);
  });

  it('rejects cross-origin requests before doing anything', async () => {
    const res = await staffBillingPost(
      jsonRequest(
        'http://localhost:3000/api/staff/billing',
        { plan: 'starter-50' },
        'https://evil.example',
      ),
    );

    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(staffSession).not.toHaveBeenCalled();
  });

  it('requires a staff session', async () => {
    staffSession.mockResolvedValue({ authorized: false, reason: 'unauthenticated' });

    const res = await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', { plan: 'starter-50' }),
    );

    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const res = await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', { plan: 42 }),
    );

    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never caches the response', async () => {
    rpc.mockResolvedValue({ data: 'unchanged', error: null });

    const res = await staffBillingPost(
      jsonRequest('http://localhost:3000/api/staff/billing', { plan: 'starter-50' }),
    );

    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('POST /api/platform/tenants/[slug]/plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    tenantLookup = { data: { id: 'tenant-from-slug' } };
    platformAdmin.mockResolvedValue({
      authorized: true,
      admin: { userId: 'admin-1', email: null },
    });
  });

  it('resolves the shop from the slug and passes the immediate override through', async () => {
    rpc.mockResolvedValue({ data: 'updated', error: null });

    const res = await platformPlanPost(
      jsonRequest('http://localhost:3000/api/platform/tenants/alpha/plan', {
        plan: 'growth-200',
        immediate: true,
      }),
      { params: Promise.resolve({ slug: 'alpha' }) },
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('choose_billing_plan', {
      p_actor: 'admin-1',
      p_tenant: 'tenant-from-slug',
      p_plan: 'growth-200',
      p_immediate: true,
    });
  });

  it('returns 404 for an unknown shop', async () => {
    tenantLookup = { data: null };

    const res = await platformPlanPost(
      jsonRequest('http://localhost:3000/api/platform/tenants/nope/plan', { plan: 'growth-200' }),
      { params: Promise.resolve({ slug: 'nope' }) },
    );

    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks non-admins', async () => {
    platformAdmin.mockResolvedValue({ authorized: false, reason: 'forbidden' });

    const res = await platformPlanPost(
      jsonRequest('http://localhost:3000/api/platform/tenants/alpha/plan', { plan: 'growth-200' }),
      { params: Promise.resolve({ slug: 'alpha' }) },
    );

    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
