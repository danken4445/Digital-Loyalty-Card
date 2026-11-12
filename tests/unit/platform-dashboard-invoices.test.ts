import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@/lib/contracts';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? '127.0.0.1',
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

const mockAdminClient = {
  rpc: vi.fn(),
};

let verifiedUserMock: unknown = null;

const mockServerClient = {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(),
    },
  },
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(() => Promise.resolve(verifiedUserMock)),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

// Route handlers under test
import { GET as overviewGet } from '@/app/api/platform/overview/route';
import { GET as invoicesGet, POST as invoicesPost } from '@/app/api/platform/invoices/route';
import { PATCH as invoicePatch } from '@/app/api/platform/invoices/[id]/route';

describe('Platform Super Admin Dashboard & Invoice Generator Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifiedUserMock = null;
  });

  it('overview_route_enforces_platform_admin_and_aal2', async () => {
    // 1. Unauthenticated
    const req1 = new Request('http://localhost:3000/api/platform/overview');
    const res1 = await overviewGet(req1);
    expect(res1.status).toBe(401);
    const body1 = await res1.json();
    expect(body1.ok).toBe(false);
    expect(body1.error).toBe('unauthenticated');

    // 2. Non-admin authenticated user
    verifiedUserMock = { id: 'regular-user-1', is_anonymous: false };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: false, error: null }); // is_platform_admin_user => false
    const res2 = await overviewGet(req1);
    expect(res2.status).toBe(403);
    const body2 = await res2.json();
    expect(body2.ok).toBe(false);
    expect(body2.error).toBe('forbidden');

    // 3. Admin user without AAL2
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: true, error: null }); // is_platform_admin_user => true
    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1' },
      error: null,
    });
    const res3 = await overviewGet(req1);
    expect(res3.status).toBe(403);
    const body3 = await res3.json();
    expect(body3.ok).toBe(false);
    expect(body3.message).toContain('Multi-factor authentication (AAL2) required');

    // 4. Fully authenticated AAL2 admin
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'platform_get_dashboard_overview') {
        return {
          data: {
            result: 'ok',
            kpis: {
              activeTenants: 27,
              trialTenants: 5,
              suspendedTenants: 0,
              totalTenants: 32,
              totalCards: 5198,
              activeCustomers30d: 2012,
              utilizationRatePct: 38.7,
              monthlyStamps: 1998,
              lastMonthStamps: 2410,
              stampsMoMDeltaPct: -17.1,
              monthlyRedemptions: 142,
              monthlyRevenueCentavos: 181649000,
              lastMonthRevenueCentavos: 159331000,
              revenueMoMDeltaPct: 14.0,
              unpaidInvoicesCount: 4,
              dueSoonCount: 3,
            },
            industries: {
              cafe: 14,
              sports: 10,
              barbershop: 5,
              fitness: 3,
            },
            tenants: [],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2' },
      error: null,
    });

    const res4 = await overviewGet(req1);
    expect(res4.status).toBe(200);
    const body4 = await res4.json();
    expect(body4.ok).toBe(true);
    expect(body4.data.kpis.activeTenants).toBe(27);
    expect(body4.data.kpis.utilizationRatePct).toBe(38.7);
    expect(body4.data.industries.cafe).toBe(14);
  });

  it('generate_invoice_validates_inputs_csrf_and_creates_invoice', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false };
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'platform_generate_invoice') {
        return {
          data: {
            result: 'created',
            invoiceId: '55555555-5555-5555-5555-555555555555',
            invoiceNumber: 'ODC-202611-0001',
            totalCentavos: 125000,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2' },
      error: null,
    });

    // 1. Cross-origin CSRF rejected
    const crossReq = new Request('http://localhost:3000/api/platform/invoices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.com',
      },
      body: JSON.stringify({
        tenantId: '11111111-1111-1111-1111-111111111111',
        month: '2026-11',
        dueDate: '2026-12-05',
      }),
    });
    const crossRes = await invoicesPost(crossReq);
    expect(crossRes.status).toBe(403);

    // 2. Malformed date format rejected
    const badDateReq = new Request('http://localhost:3000/api/platform/invoices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        tenantId: '11111111-1111-1111-1111-111111111111',
        month: 'not-a-date',
        dueDate: '2026-12-05',
      }),
    });
    const badDateRes = await invoicesPost(badDateReq);
    expect(badDateRes.status).toBe(400);

    // 3. Valid invoice creation request with custom hardware adjustment line items
    const validReq = new Request('http://localhost:3000/api/platform/invoices', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        tenantId: '11111111-1111-1111-1111-111111111111',
        month: '2026-11',
        dueDate: '2026-12-05',
        adjustmentCentavos: 50000,
        lineItems: [
          {
            id: 'line-1',
            description: '2x NTAG 424 DNA Counter Cards',
            quantity: 2,
            unitPriceCentavos: 25000,
            totalCentavos: 50000,
          },
        ],
        notes: 'Please settle on or before December 5, 2026.',
        status: 'issued',
      }),
    });

    const validRes = await invoicesPost(validReq);
    expect(validRes.status).toBe(201);
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);
    expect(validBody.data.invoiceNumber).toBe('ODC-202611-0001');
    expect(validBody.data.totalCentavos).toBe(125000);

    // Verify RPC invocation parameters
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'platform_generate_invoice',
      expect.objectContaining({
        p_actor: 'admin-user-1',
        p_tenant: '11111111-1111-1111-1111-111111111111',
        p_month: '2026-11-01',
        p_due_date: '2026-12-05',
        p_adjustment_centavos: 50000,
      }),
    );
  });

  it('update_invoice_status_patches_invoice', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false };
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'platform_update_invoice_status') return { data: 'updated', error: null };
      return { data: null, error: null };
    });

    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2' },
      error: null,
    });

    // 1. Invalid status rejected
    const badStatusReq = new Request('http://localhost:3000/api/platform/invoices/55555555-5555-5555-5555-555555555555', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ status: 'invalid_status' }),
    });
    const badStatusRes = await invoicePatch(badStatusReq, {
      params: Promise.resolve({ id: '55555555-5555-5555-5555-555555555555' }),
    });
    expect(badStatusRes.status).toBe(400);

    // 2. Mark paid successfully
    const markPaidReq = new Request('http://localhost:3000/api/platform/invoices/55555555-5555-5555-5555-555555555555', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ status: 'paid', reason: 'Settled via GCash ref #82918' }),
    });
    const markPaidRes = await invoicePatch(markPaidReq, {
      params: Promise.resolve({ id: '55555555-5555-5555-5555-555555555555' }),
    });
    expect(markPaidRes.status).toBe(200);
    const markPaidBody = await markPaidRes.json();
    expect(markPaidBody.ok).toBe(true);
    expect(markPaidBody.data.status).toBe('paid');

    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'platform_update_invoice_status',
      expect.objectContaining({
        p_actor: 'admin-user-1',
        p_invoice: '55555555-5555-5555-5555-555555555555',
        p_status: 'paid',
        p_reason: 'Settled via GCash ref #82918',
      }),
    );
  });

  it('list_invoices_returns_invoice_records', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false };
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'platform_list_invoices') {
        return {
          data: {
            result: 'ok',
            invoices: [
              {
                id: 'inv-1',
                invoiceNumber: 'ODC-202611-0001',
                tenantId: '11111111-1111-1111-1111-111111111111',
                tenantName: 'KennyDink Pickleball',
                tenantSlug: 'kennydink-pickleball',
                billingMonth: '2026-11-01',
                status: 'issued',
                planCode: 'growth-200',
                planName: 'Growth 200',
                activeCustomers: 180,
                includedCustomers: 200,
                extraCustomers: 0,
                baseFeeCentavos: 100000,
                usageFeeCentavos: 0,
                adjustmentCentavos: 0,
                totalCentavos: 100000,
                lineItems: [],
                notes: null,
                dueDate: '2026-12-05',
                issuedAt: '2026-11-12T00:00:00Z',
                paidAt: null,
              },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2' },
      error: null,
    });

    const req = new Request('http://localhost:3000/api/platform/invoices');
    const res = await invoicesGet(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.invoices.length).toBe(1);
    expect(body.data.invoices[0].invoiceNumber).toBe('ODC-202611-0001');
    expect(body.data.invoices[0].totalCentavos).toBe(100000);
  });

  it('overview_route_falls_back_to_direct_table_queries_when_rpc_missing', async () => {
    verifiedUserMock = { id: 'admin-user-1', is_anonymous: false };
    mockAdminClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'is_platform_admin_user') return { data: true, error: null };
      if (fn === 'platform_get_dashboard_overview') {
        // Simulates remote Supabase lacking the custom RPC
        return {
          data: null,
          error: { code: 'PGRST202', message: 'Could not find the function public.platform_get_dashboard_overview' },
        };
      }
      return { data: null, error: null };
    });

    mockServerClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2' },
      error: null,
    });

    (mockAdminClient as any).from = vi.fn((table: string) => {
      const createBuilder = (resolveData: any) => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          then: (resolve: any) => Promise.resolve({ data: resolveData, error: null }).then(resolve),
        };
        return builder;
      };

      if (table === 'tenants') {
        return createBuilder([
          {
            id: '7c1f0000-0000-4000-8000-000000000001',
            slug: 'caffeine-plug',
            name: 'The Caffeine Plug',
            status: 'active',
            created_at: '2026-11-05T14:52:17.251Z',
            suspended_at: null,
          },
          {
            id: '41f363c4-e438-4dce-91fc-11ab662fee81',
            slug: 'test-shop',
            name: 'Test Shop',
            status: 'active',
            created_at: '2026-11-05T14:58:55.695Z',
            suspended_at: null,
          },
        ]);
      }
      if (table === 'tenant_settings') {
        return createBuilder([
          {
            tenant_id: '7c1f0000-0000-4000-8000-000000000001',
            brand: { logoUrl: 'https://example.com/logo.png' },
            milestone_step: 5,
            daily_cap: 2,
          },
        ]);
      }
      if (table === 'customer_cards') {
        return createBuilder([
          { tenant_id: '7c1f0000-0000-4000-8000-000000000001', customer_id: 'c1', added_at: '2026-11-05' },
        ]);
      }
      if (table === 'stamps') {
        return createBuilder([
          { tenant_id: '7c1f0000-0000-4000-8000-000000000001', customer_id: 'c1', created_at: new Date().toISOString() },
        ]);
      }
      if (table === 'redemptions') {
        return createBuilder([]);
      }
      if (table === 'billing_plans') {
        return createBuilder([
          { code: 'pay-as-you-go', name: 'Pay as you go', base_fee_centavos: 0, included_customers: 0, per_customer_centavos: 1000 },
        ]);
      }
      if (table === 'tenant_plan_selections') {
        return createBuilder([]);
      }
      if (table === 'locations' || table === 'tags') {
        return createBuilder([]);
      }
      if (table === 'tenant_members') {
        return createBuilder([
          { tenant_id: '7c1f0000-0000-4000-8000-000000000001', user_id: 'u1', role: 'owner', display_name: 'Dan (Owner)' },
        ]);
      }
      if (table === 'tenant_invoices' || table === 'audit_log') {
        return createBuilder([]);
      }

      return createBuilder([]);
    });

    const req = new Request('http://localhost:3000/api/platform/overview');
    const res = await overviewGet(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.kpis.activeTenants).toBe(2);
    expect(body.data.tenants.length).toBe(2);
    expect(body.data.tenants[0].name).toBe('The Caffeine Plug');
  });
});
