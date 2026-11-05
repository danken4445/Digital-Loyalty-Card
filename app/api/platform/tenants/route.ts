import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import type { ApiErrorCode, ApiResponse, PlatformCreateTenantResult } from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { logSecurityEvent } from '@/lib/security/logger';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const createTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Invalid tenant slug format.'),
  name: z.string().trim().min(1).max(80),
  ownerEmail: z.string().trim().email('Invalid owner email address.'),
  ownerPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .optional()
    .or(z.literal('')),
});

export async function POST(
  request: Request,
): Promise<NextResponse<ApiResponse<PlatformCreateTenantResult>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
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
      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
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
      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
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
      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Malformed request JSON.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const parsed = createTenantSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
        {
          ok: false,
          error: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? 'Invalid request parameters.',
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const { slug, name, ownerEmail, ownerPassword } = parsed.data;

    const adminClient = createSupabaseAdminClient();
    const { data, error } = await adminClient.rpc('platform_create_tenant', {
      p_actor: auth.admin.userId,
      p_slug: slug,
      p_name: name,
      p_owner_email: ownerEmail,
    });

    if (error || !data) {
      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
        {
          ok: false,
          error: 'internal_error',
          message: error?.message ?? 'Failed to create tenant.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const rpcResult = data as unknown as {
      result: string;
      tenantId?: string;
      inviteId?: string;
    };

    if (rpcResult.result === 'created') {
      if (ownerPassword && ownerPassword.trim().length >= 8 && rpcResult.inviteId) {
        try {
          const { data: userList } = await adminClient.auth.admin.listUsers();
          const existingUser = userList?.users?.find(
            (u) => u.email?.toLowerCase().trim() === ownerEmail.toLowerCase().trim(),
          );

          let userId: string;
          if (existingUser) {
            userId = existingUser.id;
            await adminClient.auth.admin.updateUserById(userId, {
              password: ownerPassword.trim(),
              email_confirm: true,
            });
          } else {
            const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
              email: ownerEmail.trim(),
              password: ownerPassword.trim(),
              email_confirm: true,
            });
            if (createError || !newUser?.user) {
              throw createError ?? new Error('User creation failed');
            }
            userId = newUser.user.id;
          }

          // Auto-accept the invite immediately so the owner has active membership
          await adminClient.rpc('accept_invite', {
            p_user: userId,
            p_invite: rpcResult.inviteId,
            p_display_name: name.trim(),
          });
        } catch (pwErr) {
          logSecurityEvent('warn', 'platform_create_tenant_password_setup_failed', {
            ownerEmail,
            reason: pwErr instanceof Error ? pwErr.message : 'unknown',
          });
        }
      }

      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
        {
          ok: true,
          data: {
            result: 'created',
            tenantId: rpcResult.tenantId,
            inviteId: rpcResult.inviteId,
          },
        },
        { status: 201, headers: NO_STORE_HEADERS },
      );
    }

    if (rpcResult.result === 'duplicate-slug') {
      return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'A shop with this slug already exists.',
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const statusMap: Record<string, number> = {
      'invalid-slug': 400,
      'invalid-email': 400,
      'invalid-name': 400,
      unauthorized: 403,
    };

    const statusCode = statusMap[rpcResult.result] ?? 400;

    return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
      {
        ok: false,
        error: (rpcResult.result === 'unauthorized' ? 'forbidden' : 'invalid_input') as ApiErrorCode,
        message: `Tenant creation failed: ${rpcResult.result}`,
      },
      { status: statusCode, headers: NO_STORE_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json<ApiResponse<PlatformCreateTenantResult>>(
      {
        ok: false,
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
