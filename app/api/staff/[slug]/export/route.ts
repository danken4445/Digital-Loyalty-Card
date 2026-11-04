import { NextResponse } from 'next/server';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
import type { ApiResponse } from '@/lib/contracts';
import { toCsv } from '@/lib/ops/csv';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { slug } = await params;

  let access;
  try {
    access = await requireConsoleAccess(slug, 'manager');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<null>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<null>>(
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
    return NextResponse.json<ApiResponse<null>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many export requests. Please try again shortly.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get('kind');

  if (kind !== 'cards' && kind !== 'stamps') {
    return NextResponse.json<ApiResponse<null>>(
      {
        ok: false,
        error: 'invalid_input',
        message: "Invalid export kind. Must be 'cards' or 'stamps'.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = await createSupabaseServerClient();

  // Load locations to resolve branch names
  const { data: locationsData } = await supabase
    .from('locations')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  const locationMap = new Map<string, string>();
  const defaultBranchName =
    locationsData && locationsData.length > 0
      ? (locationsData[0] as unknown as { name: string }).name
      : 'Main Branch';
  if (locationsData) {
    for (const loc of locationsData as Array<{ id: string; name: string }>) {
      locationMap.set(loc.id, loc.name);
    }
  }

  let csvContent = '';
  let rowCount = 0;

  if (kind === 'cards') {
    const { data: cards, error: cardsErr } = await supabase
      .from('customer_cards')
      .select('customer_id, added_at, total_stamps, available_stamps, consent_version')
      .eq('tenant_id', tenantId);

    if (cardsErr) {
      return NextResponse.json<ApiResponse<null>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to query cards for export.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const rows = ((cards ?? []) as Array<Record<string, unknown>>).map((c) => ({
      customer_id: String(c.customer_id ?? ''),
      added_at: String(c.added_at ?? ''),
      branch: defaultBranchName,
      total_stamps: Number(c.total_stamps ?? 0),
      available_stamps: Number(c.available_stamps ?? 0),
      consent_version: String(c.consent_version ?? ''),
    }));

    rowCount = rows.length;
    csvContent = toCsv(rows, [
      'customer_id',
      'added_at',
      'branch',
      'total_stamps',
      'available_stamps',
      'consent_version',
    ]);
  } else {
    // stamps export
    const { data: stamps, error: stampsErr } = await supabase
      .from('stamps')
      .select('id, created_at, customer_id, source, tag_id, location_id, reason')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (stampsErr) {
      return NextResponse.json<ApiResponse<null>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to query stamps for export.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const rows = ((stamps ?? []) as Array<Record<string, unknown>>).map((s) => ({
      id: String(s.id ?? ''),
      created_at: String(s.created_at ?? ''),
      customer_id: String(s.customer_id ?? ''),
      source: String(s.source ?? ''),
      tag_id: String(s.tag_id ?? ''),
      branch: String((s.location_id && locationMap.get(String(s.location_id))) || defaultBranchName),
      reason: String(s.reason ?? ''),
    }));

    rowCount = rows.length;
    csvContent = toCsv(rows, [
      'id',
      'created_at',
      'customer_id',
      'source',
      'tag_id',
      'branch',
      'reason',
    ]);
  }

  // Audit event log_audit_event
  const admin = createSupabaseAdminClient();
  await admin.rpc('log_audit_event', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_action: 'export_csv',
    p_target: kind,
    p_detail: { kind, row_count: rowCount },
  });

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${slug}-${kind}-${dateStr}.csv`;

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...NO_STORE_HEADERS,
    },
  });
}
