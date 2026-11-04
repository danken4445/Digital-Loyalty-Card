import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
import type { ApiResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

import type { LocationSeparationPreview } from '@/components/console/SeparationModal';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const separatePostSchema = z.object({
  locationId: z.string().uuid('Invalid location ID'),
  confirmName: z.string().trim().min(1, 'Confirmation name is required'),
  childSlug: z
    .string()
    .trim()
    .regex(SLUG_REGEX, 'Slug must be 3-40 lowercase letters, numbers or hyphens, starting and ending with an alphanumeric character'),
});

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<LocationSeparationPreview>>> {
  const { slug } = await params;

  let access;
  try {
    access = await requireConsoleAccess(slug, 'manager');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<LocationSeparationPreview>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<LocationSeparationPreview>>(
        {
          ok: false,
          error: 'forbidden',
          message: `Shop "${slug}" not found.`,
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    throw err;
  }

  const { staff, tenantId } = access;
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('locationId');

  if (!locationId) {
    return NextResponse.json<ApiResponse<LocationSeparationPreview>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Missing locationId query parameter.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: previewData, error: previewErr } = await admin.rpc('preview_location_separation', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_location: locationId,
  });

  if (previewErr) {
    return NextResponse.json<ApiResponse<LocationSeparationPreview>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to load separation preview.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<LocationSeparationPreview>>(
    {
      ok: true,
      data: (previewData ?? {}) as LocationSeparationPreview,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<{ childTenantId: string; childSlug: string }>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const { slug } = await params;

  let access;
  try {
    access = await requireConsoleAccess(slug, 'owner');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
        {
          ok: false,
          error: 'forbidden',
          message: `Shop "${slug}" not found.`,
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    throw err;
  }

  const { staff, tenantId } = access;

  const ip = getClientIp(request);
  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'staff-tenant',
    ip,
    customerId: staff.userId,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many separation requests. Please wait before retrying.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid JSON request body.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = separatePostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: rpcRes, error: rpcErr } = await admin.rpc('set_location_card_mode', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_location: parsed.data.locationId,
    p_mode: 'separate',
    p_child_slug: parsed.data.childSlug,
    p_confirm_name: parsed.data.confirmName,
  });

  if (rpcErr) {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to separate branch card.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const resObj = (rpcRes ?? {}) as Record<string, unknown>;
  if (resObj.result === 'unauthorized') {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Only owners can separate branch cards.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result === 'confirmation-mismatch') {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Branch confirmation name does not match.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result === 'duplicate-slug') {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'A shop with this slug already exists.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result === 'invalid-slug') {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid shop slug.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result === 'already-separate') {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'This branch already has its own card.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result !== 'updated') {
    return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: `Branch separation failed: ${String(resObj.result)}`,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<{ childTenantId: string; childSlug: string }>>(
    {
      ok: true,
      data: {
        childTenantId: String(resObj.childTenantId),
        childSlug: parsed.data.childSlug,
      },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
