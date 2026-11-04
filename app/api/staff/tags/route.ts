import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  decorateTagWithUrls,
  generateRandomTagId,
  logStaffAuditEvent,
  requireStaffSession,
} from '@/lib/auth/staff';
import type { ApiResponse, StaffTagActionResponse, TagRow, TagWithUrls } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

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

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('tags')
      .select('id, label, active, created_at, deactivated_at')
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

    if (parsed.data.action === 'create') {
      const newId = generateRandomTagId();
      const labelValue = parsed.data.label ? parsed.data.label.trim() : null;

      const { data: inserted, error: insertError } = await admin
        .from('tags')
        .insert({
          id: newId,
          label: labelValue,
          active: true,
        })
        .select('id, label, active, created_at, deactivated_at')
        .single();

      if (insertError || !inserted) {
        return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
          {
            ok: false,
            error: 'internal_error',
            message: 'Failed to create NFC tag.',
          },
          { status: 500 },
        );
      }

      await logStaffAuditEvent({
        actorId: auth.staff.userId,
        action: 'tag_created',
        target: newId,
        detail: { label: labelValue },
      });

      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: true,
          data: {
            action: 'create',
            tag: decorateTagWithUrls(inserted as TagRow),
          },
        },
        { status: 200 },
      );
    }

    if (parsed.data.action === 'deactivate') {
      const { data: existingTag } = await admin
        .from('tags')
        .select('id')
        .eq('id', parsed.data.tagId)
        .maybeSingle();

      if (!existingTag) {
        return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
          {
            ok: false,
            error: 'invalid_input',
            message: 'NFC tag not found.',
          },
          { status: 404 },
        );
      }

      const { data: updated, error: updateError } = await admin
        .from('tags')
        .update({
          active: false,
          deactivated_at: new Date().toISOString(),
        })
        .eq('id', parsed.data.tagId)
        .select('id, label, active, created_at, deactivated_at')
        .single();

      if (updateError || !updated) {
        return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
          {
            ok: false,
            error: 'internal_error',
            message: 'Failed to deactivate NFC tag.',
          },
          { status: 500 },
        );
      }

      await logStaffAuditEvent({
        actorId: auth.staff.userId,
        action: 'tag_deactivated',
        target: parsed.data.tagId,
        detail: {},
      });

      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: true,
          data: {
            action: 'deactivate',
            tag: decorateTagWithUrls(updated as TagRow),
            deactivatedTagId: parsed.data.tagId,
          },
        },
        { status: 200 },
      );
    }

    // action === 'rotate'
    const { data: existingTag } = await admin
      .from('tags')
      .select('id, label')
      .eq('id', parsed.data.tagId)
      .maybeSingle();

    if (!existingTag) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'NFC tag not found.',
        },
        { status: 404 },
      );
    }

    const { error: deactivateError } = await admin
      .from('tags')
      .update({
        active: false,
        deactivated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.tagId);

    if (deactivateError) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to deactivate tag during rotation.',
        },
        { status: 500 },
      );
    }

    const newId = generateRandomTagId();
    const newLabel =
      parsed.data.newLabel !== undefined && parsed.data.newLabel.trim().length > 0
        ? parsed.data.newLabel.trim()
        : existingTag.label || null;

    const { data: newTag, error: insertError } = await admin
      .from('tags')
      .insert({
        id: newId,
        label: newLabel,
        active: true,
      })
      .select('id, label, active, created_at, deactivated_at')
      .single();

    if (insertError || !newTag) {
      return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
        {
          ok: false,
          error: 'internal_error',
          message: 'Failed to create new tag during rotation.',
        },
        { status: 500 },
      );
    }

    await logStaffAuditEvent({
      actorId: auth.staff.userId,
      action: 'tag_rotated',
      target: newId,
      detail: {
        deactivated_tag_id: parsed.data.tagId,
        label: newTag.label,
      },
    });

    return NextResponse.json<ApiResponse<StaffTagActionResponse>>(
      {
        ok: true,
        data: {
          action: 'rotate',
          tag: decorateTagWithUrls(newTag as TagRow),
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
