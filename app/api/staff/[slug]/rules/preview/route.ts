import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConsoleAccess, ConsoleAccessError, isNotFoundError } from '@/lib/console/guard';
import {
  TENANT_RULE_BOUNDS,
  type ApiErrorCode,
  type ApiResponse,
  type TenantRulesPreview,
} from '@/lib/contracts';
import { verifySameOriginRequest } from '@/lib/security/csrf';
import { checkPublicEndpointRateLimit, getClientIp } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

const ALLOWED_RULE_KEYS = new Set([
  'cooldown_minutes',
  'daily_cap',
  'reward_threshold',
  'tag_throttle_seconds',
  'reward_label',
  'milestone_step',
  'milestone_reward_label',
]);

const rulesPreviewSchema = z
  .object({
    cooldown_minutes: z
      .number()
      .int()
      .min(TENANT_RULE_BOUNDS.cooldown_minutes.min)
      .max(TENANT_RULE_BOUNDS.cooldown_minutes.max)
      .optional(),
    daily_cap: z
      .number()
      .int()
      .min(TENANT_RULE_BOUNDS.daily_cap.min)
      .max(TENANT_RULE_BOUNDS.daily_cap.max)
      .optional(),
    reward_threshold: z
      .number()
      .int()
      .min(TENANT_RULE_BOUNDS.reward_threshold.min)
      .max(TENANT_RULE_BOUNDS.reward_threshold.max)
      .optional(),
    tag_throttle_seconds: z
      .number()
      .int()
      .min(TENANT_RULE_BOUNDS.tag_throttle_seconds.min)
      .max(TENANT_RULE_BOUNDS.tag_throttle_seconds.max)
      .optional(),
    reward_label: z
      .string()
      .trim()
      .min(TENANT_RULE_BOUNDS.reward_label.minLength)
      .max(TENANT_RULE_BOUNDS.reward_label.maxLength)
      .optional(),
    milestone_step: z
      .number()
      .int()
      .min(TENANT_RULE_BOUNDS.milestone_step.min)
      .max(TENANT_RULE_BOUNDS.milestone_step.max)
      .nullable()
      .optional(),
    milestone_reward_label: z
      .string()
      .trim()
      .min(TENANT_RULE_BOUNDS.milestone_reward_label.minLength)
      .max(TENANT_RULE_BOUNDS.milestone_reward_label.maxLength)
      .nullable()
      .optional(),
  })
  .strict();

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<NextResponse<ApiResponse<TenantRulesPreview>>> {
  const csrf = verifySameOriginRequest(request);
  if (!csrf.allowed) {
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
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
      return NextResponse.json<ApiResponse<TenantRulesPreview>>(
        {
          ok: false,
          error: (err.status === 401 ? 'unauthenticated' : 'forbidden') as ApiErrorCode,
          message: err.message,
        },
        { status: err.status, headers: NO_STORE_HEADERS },
      );
    }
    if (isNotFoundError(err)) {
      return NextResponse.json<ApiResponse<TenantRulesPreview>>(
        {
          ok: false,
          error: 'invalid_input',
          message: 'Tenant not found.',
        },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Internal server error.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const ip = getClientIp(request);
  const rl = await checkPublicEndpointRateLimit({
    endpoint: 'staff-tenant',
    ip,
    customerId: access.staff.userId,
  });

  if (!rl.allowed) {
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
      {
        ok: false,
        error: 'rate_limited',
        message: 'Too many requests. Please wait a moment.',
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let bodyJson: unknown = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      bodyJson = JSON.parse(text);
    }
  } catch {
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Malformed request JSON.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (typeof bodyJson !== 'object' || bodyJson === null || Array.isArray(bodyJson)) {
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
      {
        ok: false,
        error: 'invalid_input',
        message: 'Patch must be an object.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  for (const key of Object.keys(bodyJson)) {
    if (!ALLOWED_RULE_KEYS.has(key)) {
      return NextResponse.json<ApiResponse<TenantRulesPreview>>(
        {
          ok: false,
          error: 'invalid_input',
          message: `Unknown configuration key: ${key}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
  }

  const parsed = rulesPreviewSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
      {
        ok: false,
        error: 'invalid_input',
        message: parsed.error?.issues[0]?.message ?? 'Invalid rules patch for preview.',
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const adminClient = createSupabaseAdminClient();
  const { data: previewData, error: rpcError } = await adminClient.rpc('preview_tenant_rules', {
    p_actor: access.staff.userId,
    p_tenant: access.tenantId,
    p_patch: parsed.data as unknown as Json,
  });

  if (rpcError || !previewData) {
    return NextResponse.json<ApiResponse<TenantRulesPreview>>(
      {
        ok: false,
        error: 'internal_error',
        message: 'Failed to calculate rules preview.',
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json<ApiResponse<TenantRulesPreview>>(
    {
      ok: true,
      data: previewData as unknown as TenantRulesPreview,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
