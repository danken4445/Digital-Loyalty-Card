import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
import type { ApiResponse, TenantBrand } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const brandPatchSchema = z
  .object({
    primaryColor: z
      .string()
      .trim()
      .regex(HEX_COLOR_REGEX, 'Primary color must be a valid 6-character hex code (e.g. #0A0A0A)')
      .optional()
      .nullable(),
    accentColor: z
      .string()
      .trim()
      .regex(HEX_COLOR_REGEX, 'Accent color must be a valid 6-character hex code (e.g. #FFFFFF)')
      .optional()
      .nullable(),
    tagline: z
      .string()
      .trim()
      .max(60, 'Tagline must be 60 characters or fewer')
      .optional()
      .nullable(),
    logoUrl: z.string().trim().optional().nullable(),
    cardArtUrl: z.string().trim().optional().nullable(),
  })
  .strict();

function validateImageUrl(url: string | null | undefined, tenantId: string, label: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;

  // Reject SVG explicitly
  if (/\.svg(\?.*)?$/i.test(trimmed) || /image\/svg\+xml/i.test(trimmed) || /\.svg/i.test(trimmed)) {
    throw new Error(`${label} cannot be an SVG file.`);
  }

  // Reject unsafe schemes
  if (/^(data|javascript|vbscript):/i.test(trimmed)) {
    throw new Error(`${label} has an invalid URL scheme.`);
  }

  // Allow root-relative paths
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
      throw new Error(`${label} must not begin with '//' or '/\\'.`);
    }
    return trimmed;
  }

  // Allow tenant storage bucket URL
  const storagePattern = new RegExp(
    `^https://[^/\\s]+/storage/v1/object/public/tenant-brand/${tenantId}/.*$`,
    'i',
  );

  if (!storagePattern.test(trimmed)) {
    throw new Error(
      `${label} must be a root-relative path or hosted in the tenant-brand storage folder. Foreign hosts are not permitted.`,
    );
  }

  return trimmed;
}

interface RouteParams {
  params: Promise<{ slug: string }>;
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
    access = await requireConsoleAccess(slug, 'manager');
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
        message: 'Rate limit exceeded for brand updates. Please try again shortly.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
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

  const parsed = brandPatchSchema.safeParse(bodyJson);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join('; ');
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: msg || 'Invalid brand settings.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let validatedLogoUrl: string | null = null;
  let validatedCardArtUrl: string | null = null;

  try {
    if (parsed.data.logoUrl !== undefined) {
      validatedLogoUrl = validateImageUrl(parsed.data.logoUrl, tenantId, 'Logo URL');
    }
    if (parsed.data.cardArtUrl !== undefined) {
      validatedCardArtUrl = validateImageUrl(parsed.data.cardArtUrl, tenantId, 'Card art URL');
    }
  } catch (err) {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: err instanceof Error ? err.message : 'Invalid image URL.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const cleanBrand: TenantBrand = {};
  if (parsed.data.primaryColor !== undefined) {
    cleanBrand.primaryColor = parsed.data.primaryColor || undefined;
  }
  if (parsed.data.accentColor !== undefined) {
    cleanBrand.accentColor = parsed.data.accentColor || undefined;
  }
  if (parsed.data.tagline !== undefined) {
    cleanBrand.tagline = parsed.data.tagline || undefined;
  }
  if (parsed.data.logoUrl !== undefined) {
    cleanBrand.logoUrl = validatedLogoUrl || undefined;
  }
  if (parsed.data.cardArtUrl !== undefined) {
    cleanBrand.cardArtUrl = validatedCardArtUrl || undefined;
  }

  const admin = createSupabaseAdminClient();
  const { data: rpcResult, error: rpcErr } = await admin.rpc('update_tenant_brand', {
    p_actor: staff.userId,
    p_tenant: tenantId,
    p_brand: cleanBrand as unknown as Json,
  });

  if (rpcErr) {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to update brand settings.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult === 'unauthorized') {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'forbidden',
        message: 'Only owners and managers can update brand settings.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (rpcResult !== 'updated') {
    return NextResponse.json<ApiResponse<string>>(
      {
        ok: false,
        error: 'invalid_input',
        message: `Brand update failed: ${rpcResult}`,
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
