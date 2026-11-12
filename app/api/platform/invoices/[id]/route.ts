import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import type { ApiErrorCode, ApiResponse, InvoiceStatus } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const updateInvoiceStatusSchema = z.object({
  status: z.enum(['draft', 'issued', 'paid', 'void'], {
    errorMap: () => ({ message: 'Status must be draft, issued, paid, or void.' }),
  }),
  reason: z.string().trim().max(500).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
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
      return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
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

    const { id: invoiceId } = await params;
    if (!invoiceId || typeof invoiceId !== 'string' || invoiceId.trim().length === 0) {
      return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid invoice ID format.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tenant',
      ip,
      customerId: auth.admin.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
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
      return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Malformed request JSON.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = updateInvoiceStatusSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
        {
          ok: false,
          error: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? 'Invalid request parameters.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { status, reason } = parsed.data;

    const adminClient = createSupabaseAdminClient();
    let updated = false;

    try {
      const { data: rpcResult, error: rpcError } = await adminClient.rpc(
        'platform_update_invoice_status',
        {
          p_actor: auth.admin.userId,
          p_invoice: invoiceId,
          p_status: status,
          p_reason: reason ?? null,
        },
      );

      if (!rpcError && rpcResult === 'updated') {
        updated = true;
      }
    } catch {
      // Fallback below
    }

    if (!updated) {
      const { updatePlatformInvoiceStatusDirect } = await import('@/lib/platform/dashboard');
      await updatePlatformInvoiceStatusDirect(adminClient, {
        actorId: auth.admin.userId,
        invoiceId,
        status,
      });
    }

    return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
      {
        ok: true,
        data: { invoiceId, status },
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<{ invoiceId: string; status: InvoiceStatus }>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
