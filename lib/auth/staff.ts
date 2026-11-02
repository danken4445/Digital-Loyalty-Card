import 'server-only';

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { SHOP_CONFIG } from '@/lib/config';
import {
  ROUTES,
  type ActivityAnomalyFlag,
  type AuditLogRow,
  type RedemptionRow,
  type StaffActivityDashboardData,
  type StaffAuthResult,
  type StaffRow,
  type StaffSession,
  type StampRow,
  type TagRow,
  type TagWithUrls,
} from '@/lib/contracts';
import { formatManilaDate } from '@/lib/rules/display';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

/**
 * Authoritatively verifies whether the current request is authenticated as an active staff member.
 *
 * 1. Calls getVerifiedUser() (supabase.auth.getUser()) — never getSession().
 * 2. Rejects unauthenticated or anonymous sessions.
 * 3. Calls public.is_staff() AND verifies an active row in public.staff.
 */
export async function requireStaffSession(): Promise<StaffAuthResult> {
  const user = await getVerifiedUser();
  if (!user || user.is_anonymous) {
    return {
      authorized: false,
      reason: 'unauthenticated',
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: isStaffFlag, error: rpcError } = await supabase.rpc('is_staff');
  if (rpcError || !isStaffFlag) {
    return {
      authorized: false,
      reason: 'forbidden',
    };
  }

  const { data: staffRow, error: rowError } = await supabase
    .from('staff')
    .select('user_id, display_name, role, active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle<StaffRow>();

  if (rowError || !staffRow || !staffRow.active) {
    return {
      authorized: false,
      reason: 'forbidden',
    };
  }

  return {
    authorized: true,
    staff: {
      userId: staffRow.user_id,
      email: user.email ?? null,
      displayName: staffRow.display_name,
      role: staffRow.role,
      active: true,
    },
  };
}

/**
 * Server Component page guard for /staff/* pages.
 * Redirects unauthenticated users to /staff/login and non-staff users to /staff/login?error=forbidden.
 */
export async function enforceStaffPageAccess(
  nextPath: string = ROUTES.staff.root,
): Promise<StaffSession> {
  const auth = await requireStaffSession();
  if (!auth.authorized) {
    if (auth.reason === 'forbidden') {
      redirect(`${ROUTES.staff.login}?error=forbidden`);
    }
    redirect(`${ROUTES.staff.login}?next=${encodeURIComponent(nextPath)}`);
  }
  return auth.staff;
}

/**
 * Appends an immutable audit log entry via the service_role SECURITY DEFINER RPC log_audit_event.
 */
export async function logStaffAuditEvent(input: {
  actorId: string;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('log_audit_event', {
    p_actor: input.actorId,
    p_action: input.action,
    p_target: input.target ?? undefined,
    p_detail: (input.detail as Json | undefined) ?? undefined,
  });

  if (error || !data) {
    throw new Error(
      `Failed to record staff audit event "${input.action}": ${error?.message ?? 'No id'}`,
    );
  }

  return data;
}

/**
 * Generates a cryptographically random, hard-to-guess NTAG215 tag identifier (e.g. tcp_tag_a9f3k2m8x1p7q4w6).
 */
export function generateRandomTagId(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstuvwxyz';
  const bytes = randomBytes(16);
  let suffix = '';
  for (let i = 0; i < 16; i++) {
    const b = bytes[i] ?? 0;
    suffix += alphabet[b % alphabet.length];
  }
  return `tcp_tag_${suffix}`;
}

/**
 * Decorates a TagRow with the exact URLs to write into NFC Tools / NXP TagWriter.
 */
export function decorateTagWithUrls(tag: TagRow): TagWithUrls {
  const encodedId = encodeURIComponent(tag.id);
  const configuredSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  return {
    ...tag,
    productionTapUrl: `https://${SHOP_CONFIG.defaultProductionDomain}/t/${encodedId}`,
    localTapUrl: `${configuredSiteUrl}/t/${encodedId}`,
  };
}

/**
 * Pure anomaly detector over recent stamps, redemptions, and audit logs.
 * Flags:
 * 1. Customers hitting the daily cap (2 NFC stamps/day in Asia/Manila) or repeated daily_limit/cooldown blocks.
 * 2. NFC tags with unusually high stamp volume (>= 10 stamps in the recent 50-stamp window) or tag_throttled events.
 * 3. Customers or staff with frequent manual stamp overrides (>= 3 manual stamps in the recent 50-stamp window).
 */
export function detectActivityAnomalies(input: {
  stamps: StampRow[];
  redemptions: RedemptionRow[];
  auditLogs: AuditLogRow[];
}): ActivityAnomalyFlag[] {
  const anomalies: ActivityAnomalyFlag[] = [];

  // 1. Check customers hitting daily cap (2 NFC stamps on the same Manila day) or repeated rate/cooldown blocks
  const customerDayCounts = new Map<string, { customerId: string; day: string; count: number }>();
  for (const stamp of input.stamps) {
    if (stamp.source !== 'nfc') continue;
    const day = formatManilaDate(stamp.created_at);
    const key = `${stamp.customer_id}:${day}`;
    const current = customerDayCounts.get(key) ?? {
      customerId: stamp.customer_id,
      day,
      count: 0,
    };
    current.count += 1;
    customerDayCounts.set(key, current);
  }

  const dailyCapCustomerDays = new Map<string, number>();
  for (const entry of customerDayCounts.values()) {
    if (entry.count >= 2) {
      dailyCapCustomerDays.set(
        entry.customerId,
        (dailyCapCustomerDays.get(entry.customerId) ?? 0) + 1,
      );
    }
  }

  // Also count audit_log rejections (stamp_rejected_daily_limit / stamp_rejected_cooldown) per target customer
  const customerRejectionCounts = new Map<string, number>();
  for (const log of input.auditLogs) {
    if (
      (log.action === 'stamp_rejected_daily_limit' || log.action === 'stamp_rejected_cooldown') &&
      log.target
    ) {
      customerRejectionCounts.set(log.target, (customerRejectionCounts.get(log.target) ?? 0) + 1);
    }
  }

  for (const [customerId, capDays] of dailyCapCustomerDays.entries()) {
    const rejections = customerRejectionCounts.get(customerId) ?? 0;
    if (capDays >= 2 || (capDays >= 1 && rejections >= 2)) {
      anomalies.push({
        id: `daily-cap-${customerId}`,
        severity: rejections >= 3 ? 'high' : 'warning',
        category: 'repeated-daily-cap',
        title: 'Repeated Daily Cap / Cooldown Activity',
        description: `Customer ${customerId.slice(0, 8).toUpperCase()} reached the 2-stamp daily cap on ${capDays} recent day(s) with ${rejections} blocked tap attempt(s).`,
        targetId: customerId,
      });
    }
  }

  for (const [customerId, rejections] of customerRejectionCounts.entries()) {
    if (rejections >= 3 && !anomalies.some((a) => a.id === `daily-cap-${customerId}`)) {
      anomalies.push({
        id: `daily-cap-${customerId}`,
        severity: 'high',
        category: 'repeated-daily-cap',
        title: 'Repeated Blocked Tap Attempts',
        description: `Customer ${customerId.slice(0, 8).toUpperCase()} triggered ${rejections} cooldown or daily-limit blocks in recent activity.`,
        targetId: customerId,
      });
    }
  }

  // 2. Check unusual tag volume (>= 10 stamps in the recent 50-stamp window or >= 3 tag_throttled events)
  const tagStampCounts = new Map<string, number>();
  for (const stamp of input.stamps) {
    if (stamp.tag_id) {
      tagStampCounts.set(stamp.tag_id, (tagStampCounts.get(stamp.tag_id) ?? 0) + 1);
    }
  }

  const tagThrottleCounts = new Map<string, number>();
  for (const log of input.auditLogs) {
    if (log.action === 'stamp_rejected_tag_throttled' && log.target) {
      tagThrottleCounts.set(log.target, (tagThrottleCounts.get(log.target) ?? 0) + 1);
    }
  }

  const allSeenTags = new Set<string>([...tagStampCounts.keys(), ...tagThrottleCounts.keys()]);
  for (const tagId of allSeenTags) {
    const count = tagStampCounts.get(tagId) ?? 0;
    const throttles = tagThrottleCounts.get(tagId) ?? 0;
    if (count >= 10 || throttles >= 3) {
      anomalies.push({
        id: `tag-vol-${tagId}`,
        severity: throttles >= 3 || count >= 20 ? 'high' : 'warning',
        category: 'high-tag-volume',
        title: 'High NFC Tag Volume / Rapid Taps',
        description: `Tag "${tagId}" recorded ${count} recent stamp(s) and ${throttles} rapid-tap throttle block(s). Verify the tag URL has not been shared.`,
        targetId: tagId,
      });
    }
  }

  // 3. Check frequent manual stamps (>= 3 manual stamps for the same customer in recent window)
  const manualCustomerCounts = new Map<string, number>();
  for (const stamp of input.stamps) {
    if (stamp.source === 'manual') {
      manualCustomerCounts.set(
        stamp.customer_id,
        (manualCustomerCounts.get(stamp.customer_id) ?? 0) + 1,
      );
    }
  }

  for (const [customerId, manualCount] of manualCustomerCounts.entries()) {
    if (manualCount >= 3) {
      anomalies.push({
        id: `manual-stamps-${customerId}`,
        severity: manualCount >= 5 ? 'high' : 'warning',
        category: 'frequent-manual-stamps',
        title: 'Frequent Manual Stamp Overrides',
        description: `Customer ${customerId.slice(0, 8).toUpperCase()} received ${manualCount} manual staff stamps in the recent window.`,
        targetId: customerId,
      });
    }
  }

  return anomalies;
}

/**
 * Fetches the complete staff activity dashboard dataset (last 50 stamps, last 50 redemptions,
 * last 50 audit_log rows, and computed anomaly flags) after verifying staff authorization.
 */
export async function getStaffActivityDashboardData(): Promise<StaffActivityDashboardData> {
  await enforceStaffPageAccess(ROUTES.staff.activity);
  const admin = createSupabaseAdminClient();

  const [stampsRes, redemptionsRes, auditRes] = await Promise.all([
    admin
      .from('stamps')
      .select('id, customer_id, tag_id, source, staff_id, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('redemptions')
      .select('id, customer_id, stamps_used, staff_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('audit_log')
      .select('id, actor, action, target, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const stamps = (stampsRes.data ?? []) as StampRow[];
  const redemptions = (redemptionsRes.data ?? []) as RedemptionRow[];
  const auditLogs = (auditRes.data ?? []) as AuditLogRow[];

  return {
    stamps,
    redemptions,
    auditLogs,
    anomalies: detectActivityAnomalies({ stamps, redemptions, auditLogs }),
  };
}

/**
 * Fetches all NFC tags ordered by newest first, decorated with their NTAG215 tap URLs.
 */
export async function getStaffTagsList(): Promise<TagWithUrls[]> {
  await enforceStaffPageAccess(ROUTES.staff.tags);
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from('tags')
    .select('id, label, active, created_at, deactivated_at')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch tags list: ${error.message}`);
  }

  return ((data ?? []) as TagRow[]).map(decorateTagWithUrls);
}
