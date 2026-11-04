import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  decorateTagWithUrls,
  generateRandomTagId,
  getTenantAliasHost,
} from '@/lib/auth/staff';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
import type { ApiResponse, TagRow, TagWithUrls } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { logSecurityEvent } from '@/lib/security/logger';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const tagActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    label: z.string().trim().max(120).optional(),
    locationId: z.string().uuid().optional().nullable(),
  }),
  z.object({
    action: z.literal('rotate'),
    oldTagId: z.string().trim().min(4).max(128),
    newLabel: z.string().trim().max(120).optional(),
    locationId: z.string().uuid().optional().nullable(),
    reason: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal('deactivate'),
    tagId: z.string().trim().min(4).max(128),
  }),
]);

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export type TagWithBranch = TagWithUrls & { location_id?: string | null };

export type TagActionResponse =
  | {
      action: 'create';
      tag: TagWithBranch;
    }
  | {
      action: 'rotate';
      tag: TagWithBranch;
      deactivatedTagId: string;
    }
  | {
      action: 'deactivate';
      deactivatedTagId: string;
    };

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<TagWithBranch[]>>> {
  const { slug } = await params;

  let access;
  try {
    access = await requireConsoleAccess(slug, 'staff');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<TagWithBranch[]>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<TagWithBranch[]>>(
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
  const { data, error } = await supabase
    .from('tags')
    .select('id, label, active, created_at, deactivated_at, location_id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json<ApiResponse<TagWithBranch[]>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to fetch tags list.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const aliasHost = await getTenantAliasHost(tenantId);
  const tagsWithUrls = ((data ?? []) as Array<TagRow & { location_id?: string | null }>).map((tag) => ({
    ...decorateTagWithUrls(tag, aliasHost),
    location_id: tag.location_id,
  }));

  return NextResponse.json<ApiResponse<TagWithBranch[]>>(
    {
      ok: true,
      data: tagsWithUrls,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<TagActionResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
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
    access = await requireConsoleAccess(slug, 'manager');
  } catch (err: unknown) {
    if (err instanceof ConsoleAccessError) {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: err.status === 401 ? 'unauthenticated' : 'forbidden',
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
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
    endpoint: 'staff-tags',
    ip,
    customerId: staff.userId,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Rate limit exceeded for tag operations. Please try again shortly.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Invalid JSON request body.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = tagActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createSupabaseAdminClient();
  const aliasHost = await getTenantAliasHost(tenantId);

  if (parsed.data.action === 'create') {
    const newTagId = generateRandomTagId();
    const { data: result, error: rpcErr } = await admin.rpc('create_tag_at', {
      p_actor: staff.userId,
      p_tenant: tenantId,
      p_tag_id: newTagId,
      p_label: parsed.data.label ?? undefined,
      p_location: parsed.data.locationId ?? undefined,
    });

    if (rpcErr) {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: rpcErr.message,
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'unauthorized') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'Only owners and managers can create tags.',
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'invalid-location') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid branch location specified.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'duplicate') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Tag ID collision. Please retry provisioning.',
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    if (result !== 'created') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: `Failed to create tag: ${result}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const createdTagRow: TagRow & { location_id?: string | null } = {
      id: newTagId,
      label: parsed.data.label || null,
      active: true,
      created_at: new Date().toISOString(),
      deactivated_at: null,
      location_id: parsed.data.locationId || null,
    };

    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: true,
        data: {
          action: 'create',
          tag: {
            ...decorateTagWithUrls(createdTagRow, aliasHost),
            location_id: createdTagRow.location_id,
          },
        },
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  if (parsed.data.action === 'rotate') {
    const newTagId = generateRandomTagId();
    const { data: result, error: rpcErr } = await admin.rpc('rotate_tag_at', {
      p_actor: staff.userId,
      p_tenant: tenantId,
      p_old_tag_id: parsed.data.oldTagId,
      p_new_tag_id: newTagId,
      p_label: parsed.data.newLabel ?? undefined,
      p_location: parsed.data.locationId ?? undefined,
    });

    if (rpcErr) {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: rpcErr.message,
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'unauthorized') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'forbidden',
          message: 'Only owners and managers can rotate tags.',
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'not-found') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Active tag to rotate was not found.',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'invalid-location') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid branch location specified.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (result === 'duplicate') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'New tag ID collision. Please retry rotating.',
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    if (result !== 'rotated') {
      return NextResponse.json<ApiResponse<TagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: `Failed to rotate tag: ${result}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const newTagRow: TagRow & { location_id?: string | null } = {
      id: newTagId,
      label: parsed.data.newLabel || null,
      active: true,
      created_at: new Date().toISOString(),
      deactivated_at: null,
      location_id: parsed.data.locationId || null,
    };

    logSecurityEvent('warn', 'tag_rotated', {
      tenantId,
      actor: staff.userId,
      oldTagId: parsed.data.oldTagId,
      newTagId,
      reason: parsed.data.reason ?? 'operator_rotate',
    });

    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: true,
        data: {
          action: 'rotate',
          tag: {
            ...decorateTagWithUrls(newTagRow, aliasHost),
            location_id: newTagRow.location_id,
          },
          deactivatedTagId: parsed.data.oldTagId,
        },
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  // Deactivate
  const { data: result, error: rpcErr } = await admin.rpc('deactivate_tag', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_tag_id: parsed.data.tagId,
  });

  if (rpcErr) {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: rpcErr.message,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (result === 'unauthorized') {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Only owners and managers can deactivate tags.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (result === 'not-found') {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Tag not found.',
      },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  if (result !== 'deactivated') {
    return NextResponse.json<ApiResponse<TagActionResponse>>(
      {
        ok: false,
        error: 'invalid_input',
        message: `Failed to deactivate tag: ${result}`,
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<TagActionResponse>>(
    {
      ok: true,
      data: {
        action: 'deactivate',
        deactivatedTagId: parsed.data.tagId,
      },
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
