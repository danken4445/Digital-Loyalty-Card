import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decorateTagWithUrls, generateRandomTagId, requireStaffSession } from '@/lib/auth/staff';
import {
  TAG_MANAGER_ROLES,
  type ApiResponse,
  type StaffRole,
  type StaffTagActionResponse,
  type TagRow,
  type TagWithUrls,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const TAG_FORBIDDEN_MESSAGE = 'Only owners and managers can manage tags.';

const tagActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    label: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal('deactivate'),
    tagId: z.string().trim().min(4).max(128),
  }),
  z.object({
    action: z.literal('rotate'),
    tagId: z.string().trim().min(4).max(128),
    newLabel: z.string().trim().max(120).optional(),
  }),
]);

export async function GET(): Promise<NextResponse<ApiResponse<TagWithUrls[]>>>;
export async function GET(request: Request): Promise<NextResponse<ApiResponse<TagWithUrls[]>>>;
export async function GET(request?: Request): Promise<NextResponse<ApiResponse<TagWithUrls[]>>> {
  try {
    const auth = await requireStaffSession();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<TagWithUrls[]>>(
        {
          ok: false,
          error: auth.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
          message:
            auth.reason === 'unauthenticated'
              ? 'Staff authentication required.'
              : 'Forbidden. Active staff credentials required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403 },
      );
    }

    const ip = request ? getClientIp(request) : null;
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tags',
      ip,
      customerId: auth.staff.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<TagWithUrls[]>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many tag requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('tags')
      .select('id, label, active, created_at, deactivated_at')
      .eq('tenant_id', auth.staff.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json<ApiResponse<TagWithUrls[]>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to retrieve tags.',
        },
        { status: 500 },
      );
    }

    const tagsWithUrls = ((data ?? []) as TagRow[]).map(decorateTagWithUrls);

    return NextResponse.json<ApiResponse<TagWithUrls[]>>({
      ok: true,
      data: tagsWithUrls,
    });
  } catch {
    return NextResponse.json<ApiResponse<TagWithUrls[]>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'An unexpected error occurred while fetching tags.',
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<StaffTagActionResponse>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Cross-origin request blocked.',
      },
      { status: 403 },
    );
  }

  try {
    const auth = await requireStaffSession();
    if (!auth.authorized) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: false,
          error: auth.reason === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
          message:
            auth.reason === 'unauthenticated'
              ? 'Staff authentication required.'
              : 'Forbidden. Active staff credentials required.',
        },
        { status: auth.reason === 'unauthenticated' ? 401 : 403 },
      );
    }

    const ip = getClientIp(request);
    const rl = await checkPublicEndpointRateLimit({
      endpoint: 'staff-tags',
      ip,
      customerId: auth.staff.userId,
    });

    if (!rl.allowed) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: false,
          error: 'rate_limited',
          message: 'Too many tag requests. Please wait a moment.',
        },
        { status: 429 },
      );
    }

    const staff = auth.staff;
    if (!(TAG_MANAGER_ROLES as readonly StaffRole[]).includes(staff.role)) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        { ok: false, error: 'forbidden', message: TAG_FORBIDDEN_MESSAGE },
        { status: 403 },
      );
    }

    let body: unknown = {};
    const contentLength = request.headers.get('content-length');
    if (contentLength !== '0') {
      try {
        const text = await request.text();
        if (text.trim().length > 0) {
          body = JSON.parse(text);
        }
      } catch {
        return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'Invalid request payload.',
          },
          { status: 400 },
        );
      }
    }

    const parsed = tagActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Invalid request payload.',
        },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();
    const supabase = await createSupabaseServerClient();

    /** Re-reads a tag through the session client (RLS plus the explicit shop filter). */
    async function readTag(tagId: string): Promise<TagRow | null> {
      const { data } = await supabase
        .from('tags')
        .select('id, label, active, created_at, deactivated_at')
        .eq('tenant_id', staff.tenantId)
        .eq('id', tagId)
        .maybeSingle();
      return (data as TagRow | null) ?? null;
    }

    function failure(
      status: number,
      error: 'forbidden' | 'invalid_input' | 'internal_error',
      message: string,
    ) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        { ok: false, error, message },
        { status },
      );
    }

    if (parsed.data.action === 'create') {
      const labelValue = parsed.data.label ? parsed.data.label.trim() : null;

      // A random-ID collision is vanishingly rare, but 'duplicate' is retried once with a new ID.
      let newId = '';
      let createResult: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        newId = generateRandomTagId();
        const { data, error } = await admin.rpc('create_tag', {
          p_actor: staff.userId,
          p_tenant: staff.tenantId,
          p_tag_id: newId,
          p_label: labelValue ?? undefined,
        });
        if (error) {
          return failure(500, 'internal_error', 'Failed to create NFC tag.');
        }
        createResult = data;
        if (data !== 'duplicate') break;
      }

      if (createResult === 'unauthorized') {
        return failure(403, 'forbidden', TAG_FORBIDDEN_MESSAGE);
      }
      if (createResult !== 'created') {
        return failure(500, 'internal_error', 'Failed to create NFC tag.');
      }

      const inserted = await readTag(newId);
      if (!inserted) {
        return failure(500, 'internal_error', 'Failed to create NFC tag.');
      }

      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: true,
          data: {
            action: 'create',
            tag: decorateTagWithUrls(inserted),
          },
        },
        { status: 200 },
      );
    }

    if (parsed.data.action === 'deactivate') {
      const { data: result, error: rpcError } = await admin.rpc('deactivate_tag', {
        p_actor: staff.userId,
        p_tenant: staff.tenantId,
        p_tag_id: parsed.data.tagId,
      });

      if (rpcError) {
        return failure(500, 'internal_error', 'Failed to deactivate NFC tag.');
      }
      if (result === 'not-found') {
        return failure(404, 'invalid_input', 'NFC tag not found.');
      }
      if (result === 'unauthorized') {
        return failure(403, 'forbidden', TAG_FORBIDDEN_MESSAGE);
      }
      if (result !== 'deactivated') {
        return failure(500, 'internal_error', 'Failed to deactivate NFC tag.');
      }

      const updated = await readTag(parsed.data.tagId);
      if (!updated) {
        return failure(500, 'internal_error', 'Failed to deactivate NFC tag.');
      }

      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: true,
          data: {
            action: 'deactivate',
            tag: decorateTagWithUrls(updated),
            deactivatedTagId: parsed.data.tagId,
          },
        },
        { status: 200 },
      );
    }

    // action === 'rotate'. A blank newLabel keeps the old label (rotate_tag copies it when null).
    const rotateLabel =
      parsed.data.newLabel !== undefined && parsed.data.newLabel.trim().length > 0
        ? parsed.data.newLabel.trim()
        : null;

    let newTagId = '';
    let rotateResult: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      newTagId = generateRandomTagId();
      const { data, error } = await admin.rpc('rotate_tag', {
        p_actor: staff.userId,
        p_tenant: staff.tenantId,
        p_old_tag_id: parsed.data.tagId,
        p_new_tag_id: newTagId,
        p_label: rotateLabel ?? undefined,
      });
      if (error) {
        return failure(500, 'internal_error', 'Failed to rotate NFC tag.');
      }
      rotateResult = data;
      if (data !== 'duplicate') break;
    }

    if (rotateResult === 'not-found') {
      return failure(404, 'invalid_input', 'NFC tag not found.');
    }
    if (rotateResult === 'unauthorized') {
      return failure(403, 'forbidden', TAG_FORBIDDEN_MESSAGE);
    }
    if (rotateResult !== 'rotated') {
      return failure(500, 'internal_error', 'Failed to rotate NFC tag.');
    }

    const newTag = await readTag(newTagId);
    if (!newTag) {
      return failure(500, 'internal_error', 'Failed to rotate NFC tag.');
    }

    return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
      {
        ok: true,
        data: {
          action: 'rotate',
          tag: decorateTagWithUrls(newTag),
          deactivatedTagId: parsed.data.tagId,
        },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'An unexpected error occurred while modifying tags.',
      },
      { status: 500 },
    );
  }
}
