import { z } from 'zod';
import {
  REDEEM_TOKEN_KINDS,
  TENANT_STATUS_SUSPENDED_REDEEM_DAYS,
  type ApiErrorCode,
  type RedeemTokenRequest,
  type TenantContext,
} from '@/lib/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTenantById, getTenantBySlug } from '@/lib/tenants/context';

const redeemTokenRequestSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(64),
  kind: z.enum(REDEEM_TOKEN_KINDS).optional(),
}) satisfies z.ZodType<RedeemTokenRequest>;

const staffRedeemRequestSchema = z.object({
  action: z.enum(['preview', 'confirm']),
  token: z.string().trim().min(1).max(2048),
});

export type StaffRedeemRequest = z.infer<typeof staffRedeemRequestSchema>;

/**
 * Reads a tenant's suspended_at timestamp from the database.
 */
export async function getTenantSuspendedAt(tenantId: string): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('tenants')
      .select('suspended_at')
      .eq('id', tenantId)
      .maybeSingle<{ suspended_at: string | null }>();
    return data?.suspended_at ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks whether a suspended shop's 30-day reward redemption window has expired.
 * A null `suspendedAt` counts as within the window (mirroring the database trigger logic).
 */
export function isSuspendedRedeemExpired(
  tenant: { status: string; suspendedAt?: string | null },
  nowMs = Date.now(),
): boolean {
  if (tenant.status !== 'suspended') {
    return false;
  }
  if (!tenant.suspendedAt) {
    return false;
  }
  const suspendedMs = new Date(tenant.suspendedAt).getTime();
  if (Number.isNaN(suspendedMs)) {
    return false;
  }
  const windowMs = TENANT_STATUS_SUSPENDED_REDEEM_DAYS * 24 * 60 * 60 * 1000;
  return nowMs >= suspendedMs + windowMs;
}

/**
 * Parses and validates a customer redemption token request body.
 */
export function parseRedeemTokenBody(
  body: unknown,
): { ok: true; data: RedeemTokenRequest } | { ok: false; error: ApiErrorCode; message: string } {
  const parsed = redeemTokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      message: 'A valid shop is required.',
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Parses and validates a staff redemption action request body.
 */
export function parseStaffRedeemBody(
  body: unknown,
): { ok: true; data: StaffRedeemRequest } | { ok: false; error: ApiErrorCode; message: string } {
  const parsed = staffRedeemRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      message: 'Invalid request payload.',
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Validates tenant eligibility for reward redemption.
 * Rejects closed shops and suspended shops past the 30-day redemption window.
 */
export async function validateRedeemTenantStatus(
  tenant: TenantContext & { suspendedAt?: string | null },
  nowMs = Date.now(),
): Promise<
  | { ok: true }
  | {
      ok: false;
      error: ApiErrorCode;
      message: string;
      status: number;
    }
> {
  if (tenant.status === 'closed') {
    return {
      ok: false,
      error: 'invalid_input',
      message: 'A valid shop is required.',
      status: 400,
    };
  }

  if (tenant.status === 'suspended') {
    const suspendedAt = tenant.suspendedAt ?? (await getTenantSuspendedAt(tenant.id));
    if (isSuspendedRedeemExpired({ status: tenant.status, suspendedAt }, nowMs)) {
      return {
        ok: false,
        error: 'forbidden',
        message: 'Reward redemption for this shop has closed. The 30-day redemption window has expired.',
        status: 403,
      };
    }
  }

  return { ok: true };
}

/**
 * Resolves a tenant by slug or ID and validates its status for reward redemption.
 */
export async function resolveTenantForRedeem(
  identifier: string,
  options: { byId?: boolean; nowMs?: number } = {},
): Promise<
  | { ok: true; tenant: TenantContext }
  | {
      ok: false;
      error: ApiErrorCode;
      message: string;
      status: number;
    }
> {
  try {
    const tenant = options.byId
      ? await getTenantById(identifier)
      : await getTenantBySlug(identifier);

    if (!tenant) {
      return {
        ok: false,
        error: options.byId ? 'internal_error' : 'invalid_input',
        message: options.byId ? 'Shop settings are unavailable.' : 'A valid shop is required.',
        status: options.byId ? 500 : 400,
      };
    }

    const validation = await validateRedeemTenantStatus(tenant, options.nowMs);
    if (!validation.ok) {
      return validation;
    }

    return { ok: true, tenant };
  } catch {
    return {
      ok: false,
      error: 'internal_error',
      message: 'Shop lookup failed.',
      status: 500,
    };
  }
}
