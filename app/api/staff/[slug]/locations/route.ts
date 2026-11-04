import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
import type { ApiResponse } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const createLocationSchema = z.object({
  name: z.string().trim().min(1, 'Branch name is required').max(80, 'Branch name must be 80 characters or fewer'),
  address: z.string().trim().max(200, 'Address must be 200 characters or fewer').optional().nullable(),
});

const updateLocationSchema = z.object({
  locationId: z.string().uuid('Invalid location ID'),
  name: z.string().trim().min(1, 'Branch name is required').max(80, 'Branch name must be 80 characters or fewer'),
  address: z.string().trim().max(200, 'Address must be 200 characters or fewer').optional().nullable(),
  active: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export interface LocationItem {
  id: string;
  name: string;
  address: string | null;
  active: boolean;
  card_mode: string;
  child_tenant_id: string | null;
  created_at: string;
}

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<LocationItem[]>>> {
  const { slug } = await params;

  let access;
  try {
    access = await requireConsoleAccess(slug, 'staff');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<LocationItem[]>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<LocationItem[]>>(
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

  const { tenantId } = access;
  const supabase = await createSupabaseServerClient();
  const { data: locations, error } = await supabase
    .from('locations')
    .select('id, name, address, active, card_mode, child_tenant_id, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json<ApiResponse<LocationItem[]>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to fetch branch locations.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<LocationItem[]>>(
    {
      ok: true,
      data: (locations ?? []) as LocationItem[],
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<{ locationId: string }>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
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
      return NextResponse.json<ApiResponse<{ locationId: string }>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<{ locationId: string }>>(
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
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Rate limit exceeded. Please try again shortly.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid JSON request body.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = createLocationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: rpcRes, error: rpcErr } = await admin.rpc('create_location', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_name: parsed.data.name,
    p_address: parsed.data.address ?? undefined,
  });

  if (rpcErr) {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to create branch location.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const resObj = (rpcRes ?? {}) as Record<string, unknown>;
  if (resObj.result === 'unauthorized') {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Only owners can create branch locations.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result === 'duplicate') {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'A branch with this name already exists.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (resObj.result !== 'created') {
    return NextResponse.json<ApiResponse<{ locationId: string }>>(
      {
        ok: false,
        error: 'invalid_input',
        message: `Failed to create branch location: ${String(resObj.result)}`,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<{ locationId: string }>>(
    {
      ok: true,
      data: { locationId: String(resObj.locationId) },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<string>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<string>>(
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
      return NextResponse.json<ApiResponse<string>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<string>>(
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
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Rate limit exceeded. Please try again shortly.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid JSON request body.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = updateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: rpcRes, error: rpcErr } = await admin.rpc('update_location', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_location: parsed.data.locationId,
    p_name: parsed.data.name,
    p_address: parsed.data.address ?? '',
    p_active: parsed.data.active ?? true,
  });

  if (rpcErr) {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to update branch location.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcRes === 'unauthorized') {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Only owners can update branch locations.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcRes === 'not-found') {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Branch location not found.',
      },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcRes === 'duplicate') {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Another branch with this name already exists.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcRes !== 'updated') {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: `Branch update failed: ${rpcRes}`,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<string>>(
    {
      ok: true,
      data: 'updated',
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
