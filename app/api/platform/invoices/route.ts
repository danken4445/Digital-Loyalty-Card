import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import type {
  ApiErrorCode,
  ApiResponse,
  PlatformGenerateInvoiceResult,
  TenantInvoice,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1).max(200),
  quantity: z.number().int().min(1),
  unitPriceCentavos: z.number().int(),
  totalCentavos: z.number().int(),
});

const generateInvoiceSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID format.'),
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Month must be in YYYY-MM or YYYY-MM-DD format.'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format.'),
  adjustmentCentavos: z.number().int().optional().default(0),
  lineItems: z.array(lineItemSchema).optional().default([]),
  notes: z.string().max(1000).optional().nullable(),
  status: z.enum(['draft', 'issued', 'paid', 'void']).optional().default('issued'),
});

export async function GET(
  request: Request,
): Promise<NextResponse<ApiResponse<{ invoices: TenantInvoice[] }>>> {
  try {
    const auth = await requirePlatformAdmin();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<{ invoices: TenantInvoice[] }>>(
        {
          ok: false,
          error: (auth.reason === 'mfa-required' ? 'forbidden' : auth.reason) as ApiErrorCode,
          message:
            auth.reason === 'mfa-required'
              ? 'Multi-factor authentication (AAL2) required.'
              : auth.reason === 'unauthenticated'
                ? 'Authentication required.'
                : 'Forbidden. Platform admin access required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403, headers: NO_STORE_HEADERS },
      );
    }

    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get('tenantId');
    const tenantId = tenantIdParam && z.string().uuid().safeParse(tenantIdParam).success ? tenantIdParam : null;

    const adminClient = createSupabaseAdminClient();
    let invoices: TenantInvoice[] = [];

    const { data, error } = await adminClient.rpc('platform_list_invoices', {
      p_actor: auth.admin.userId,
      p_tenant: tenantId,
    });

    if (!error && data) {
      const raw = data as unknown as Record<string, unknown>;
      if (raw.result === 'ok') {
        invoices = (raw.invoices as TenantInvoice[]) ?? [];
      }
    } else {
      const { listPlatformInvoicesDirect } = await import('@/lib/platform/dashboard');
      invoices = await listPlatformInvoicesDirect(adminClient, tenantId);
    }

    return NextResponse.json<ApiResponse<{ invoices: TenantInvoice[] }>>(
      {
        ok: true,
        data: { invoices },
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<{ invoices: TenantInvoice[] }>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<PlatformGenerateInvoiceResult>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const auth = await requirePlatformAdmin();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
        {
          ok: false,
          error: (auth.reason === 'mfa-required' ? 'forbidden' : auth.reason) as ApiErrorCode,
          message:
            auth.reason === 'mfa-required'
              ? 'Multi-factor authentication (AAL2) required.'
              : auth.reason === 'unauthenticated'
                ? 'Authentication required.'
                : 'Forbidden. Platform admin access required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403, headers: NO_STORE_HEADERS },
      );
    }

    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tenant',
      ip,
      customerId: auth.admin.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many requests. Please wait a moment.',
        },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }

    let bodyJson: unknown;
    try {
      bodyJson = await request.json();
    } catch {
      return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Malformed request JSON.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = generateInvoiceSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
        {
          ok: false,
          error: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? 'Invalid request parameters.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { tenantId, month, dueDate, adjustmentCentavos, lineItems, notes, status } = parsed.data;

    // Normalise month to first of month (YYYY-MM-01)
    const normalizedMonth = month.length === 7 ? `${month}-01` : month;

    const adminClient = createSupabaseAdminClient();
    let generateResult: PlatformGenerateInvoiceResult | null = null;

    const { data, error } = await adminClient.rpc('platform_generate_invoice', {
      p_actor: auth.admin.userId,
      p_tenant: tenantId,
      p_month: normalizedMonth,
      p_due_date: dueDate,
      p_adjustment_centavos: adjustmentCentavos,
      p_line_items: lineItems as any,
      p_notes: notes ?? null,
      p_status: status,
    });

    if (!error && data) {
      const rpcResult = data as unknown as Record<string, unknown>;
      if (rpcResult.result === 'unauthorized') {
        return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
          {
            ok: false,
            error: 'forbidden',
            message: 'Platform admin unauthorized.',
          },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }
      if (rpcResult.result === 'not-found') {
        return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Tenant not found.',
          },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }
      generateResult = {
        result: (rpcResult.result as 'created' | 'updated') ?? 'created',
        invoiceId: String(rpcResult.invoiceId),
        invoiceNumber: String(rpcResult.invoiceNumber),
        totalCentavos: Number(rpcResult.totalCentavos ?? 0),
      };
    } else {
      const { generatePlatformInvoiceDirect } = await import('@/lib/platform/dashboard');
      generateResult = await generatePlatformInvoiceDirect(adminClient, {
        actorId: auth.admin.userId,
        tenantId,
        month: normalizedMonth,
        dueDate,
        adjustmentCentavos,
        lineItems,
        notes,
        status,
      });
    }

    return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
      {
        ok: true,
        data: generateResult,
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<PlatformGenerateInvoiceResult>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
