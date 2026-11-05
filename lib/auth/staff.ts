import 'server-only';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ROUTES,
  STAFF_ROLES,
  STAFF_TENANT_COOKIE_NAME,
  type ActivityAnomalyFlag,
  type AuditLogRow,
  type RedemptionRow,
  type StaffActivityDashboardData,
  type StaffAuthResult,
  type StaffMembership,
  type StaffRole,
  type StaffSession,
  type StampRow,
  type TagRow,
  type TagWithUrls,
} from '@/lib/contracts';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';
import { getTenantById } from '@/lib/tenants/context';

interface MembershipRow {
  tenant_id: string;
  role: string;
  display_name: string;
  tenants:
    | { id: string; slug: string; name: string; status: string }
    | { id: string; slug: string; name: string; status: string }[]
    | null;
}

function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Authoritatively verifies whether the current request is authenticated as an active staff member.
 *
 * 1. Calls getVerifiedUser() (supabase.auth.getUser()) - never getSession().
 * 2. Rejects unauthenticated or anonymous sessions.
 * 3. Reads the caller's active public.tenant_members rows (joined to their non-closed shop) through
 *    the session client, so RLS only ever returns the caller's own memberships.
 * 4. The active shop is the STAFF_TENANT_COOKIE_NAME membership if still valid, else the first
 *    membership by shop name. Role and display name come from that membership.
 */
export async function requireStaffSession(): Promise<StaffAuthResult> {
  const user = await getVerifiedUser();
  if (!user || user.is_anonymous) {
    return {
      authorized: false,
      reason: 'unauthenticated',
    };
  }

  // Auto-accept any pending invites for this verified staff/owner email
  if (user.email) {
    try {
      const adminClient = createSupabaseAdminClient();
      const cleanEmail = user.email.toLowerCase().trim();
      const { data: pendingInvites } = await adminClient
        .from('tenant_invites')
        .select('id, tenant_id, role')
        .eq('email', cleanEmail)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString());

      if (pendingInvites && pendingInvites.length > 0) {
        for (const invite of pendingInvites) {
          await adminClient.rpc('accept_invite', {
            p_user: user.id,
            p_invite: invite.id,
            p_display_name:
              (user.user_metadata?.display_name as string | undefined) ??
              user.email.split('@')[0] ??
              '',
          });
        }
      }
    } catch {
      // Best-effort auto-accept; do not fail request if invite accept check errors
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('tenant_members')
    .select('tenant_id, role, display_name, tenants(id, slug, name, status)')
    .eq('user_id', user.id)
    .eq('active', true);

  if (error || !data) {
    return {
      authorized: false,
      reason: 'forbidden',
    };
  }

  const entries: Array<{ membership: StaffMembership; displayName: string }> = [];
  for (const row of data as unknown as MembershipRow[]) {
    const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
    if (!tenant || tenant.status === 'closed' || !isStaffRole(row.role)) continue;
    entries.push({
      membership: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        role: row.role,
      },
      displayName: row.display_name,
    });
  }
  entries.sort((a, b) => a.membership.tenantName.localeCompare(b.membership.tenantName));

  const first = entries[0];
  if (!first) {
    return {
      authorized: false,
      reason: 'forbidden',
    };
  }

  const cookieStore = await cookies();
  const cookieTenantId = cookieStore.get(STAFF_TENANT_COOKIE_NAME)?.value;
  const active = entries.find((entry) => entry.membership.tenantId === cookieTenantId) ?? first;

  return {
    authorized: true,
    staff: {
      userId: user.id,
      email: user.email ?? null,
      displayName: active.displayName,
      role: active.membership.role,
      active: true,
      tenantId: active.membership.tenantId,
      tenantSlug: active.membership.tenantSlug,
      tenantName: active.membership.tenantName,
      memberships: entries.map((entry) => entry.membership),
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
 * The active shop's alias host from tenant_domains (readable by the session client), or null.
 * Never throws: tag URLs fall back to the platform origin.
 */
export async function getTenantAliasHost(tenantId: string): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('tenant_domains')
      .select('host')
      .eq('tenant_id', tenantId)
      .order('host', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      return null;
    }
    const host = (data as { host?: string } | null)?.host;
    return typeof host === 'string' && host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Decorates a TagRow with the exact URLs to write into NFC Tools / NXP TagWriter.
 * Tags are shop-neutral URLs because SQL resolves the shop from the tag. The production URL uses the
 * shop's own alias host (tenant_domains) when it has one, otherwise NEXT_PUBLIC_SITE_URL (the
 * platform's public origin). The local URL always uses NEXT_PUBLIC_SITE_URL.
 */
export function decorateTagWithUrls(tag: TagRow, aliasHost?: string | null): TagWithUrls {
  const encodedId = encodeURIComponent(tag.id);
  const configuredSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  return {
    ...tag,
    productionTapUrl: aliasHost
      ? `https://${aliasHost}/t/${encodedId}`
      : `${configuredSiteUrl}/t/${encodedId}`,
    localTapUrl: `${configuredSiteUrl}/t/${encodedId}`,
  };
}

/**
 * Pure anomaly detector over recent stamps, redemptions, and audit logs.
 * Flags:
 * 1. Customers hitting the shop's daily cap (NFC stamps per day in the shop's timezone) or repeated daily_limit/cooldown blocks.
 * 2. NFC tags with unusually high stamp volume (>= 10 stamps in the recent 50-stamp window) or tag_throttled events.
 * 3. Customers or staff with frequent manual stamp overrides (>= 3 manual stamps in the recent 50-stamp window).
 */
export function detectActivityAnomalies(
  input: {
    stamps: StampRow[];
    redemptions: RedemptionRow[];
    auditLogs: AuditLogRow[];
  },
  rules: { dailyCap: number; timezone: string },
): ActivityAnomalyFlag[] {
  const anomalies: ActivityAnomalyFlag[] = [];
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: rules.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // 1. Check customers hitting the daily cap (dailyCap NFC stamps on the same shop-local day) or repeated rate/cooldown blocks
  const customerDayCounts = new Map<string, { customerId: string; day: string; count: number }>();
  for (const stamp of input.stamps) {
    if (stamp.source !== 'nfc') continue;
    const day = dayFormatter.format(new Date(stamp.created_at));
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
    if (entry.count >= rules.dailyCap) {
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
        description: `Customer ${customerId.slice(0, 8).toUpperCase()} reached the ${rules.dailyCap}-stamp daily cap on ${capDays} recent day(s) with ${rejections} blocked tap attempt(s).`,
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
 * Fetches the active shop's staff activity dashboard dataset (last 50 stamps, last 50 redemptions,
 * last 50 audit_log rows, and computed anomaly flags) after verifying staff authorization.
 * Reads go through the session client, so RLS and the explicit tenant filter both scope the rows.
 */
export async function getStaffActivityDashboardData(options?: { staff?: StaffMembership }): Promise<StaffActivityDashboardData> {
  const staff = options?.staff ?? (await enforceStaffPageAccess(ROUTES.staff.activity));
  const supabase = await createSupabaseServerClient();

  const [tenant, stampsRes, redemptionsRes, auditRes] = await Promise.all([
    getTenantById(staff.tenantId),
    supabase
      .from('stamps')
      .select('id, customer_id, tag_id, source, staff_id, reason, created_at')
      .eq('tenant_id', staff.tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('redemptions')
      .select('id, customer_id, stamps_used, staff_id, created_at')
      .eq('tenant_id', staff.tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('audit_log')
      .select('id, actor, action, target, detail, created_at')
      .eq('tenant_id', staff.tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (!tenant) {
    throw new Error('Failed to load shop settings for the activity dashboard.');
  }

  const stamps = (stampsRes.data ?? []) as StampRow[];
  const redemptions = (redemptionsRes.data ?? []) as RedemptionRow[];
  const auditLogs = (auditRes.data ?? []) as AuditLogRow[];

  return {
    stamps,
    redemptions,
    auditLogs,
    anomalies: detectActivityAnomalies(
      { stamps, redemptions, auditLogs },
      { dailyCap: tenant.settings.dailyCap, timezone: tenant.settings.timezone },
    ),
  };
}

/**
 * Fetches the active shop's NFC tags ordered by newest first, decorated with their tap URLs.
 */
export async function getStaffTagsList(options?: { staff?: StaffMembership }): Promise<TagWithUrls[]> {
  const staff = options?.staff ?? (await enforceStaffPageAccess(ROUTES.staff.tags));
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('tags')
    .select('id, label, active, created_at, deactivated_at')
    .eq('tenant_id', staff.tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch tags list: ${error.message}`);
  }

  const aliasHost = await getTenantAliasHost(staff.tenantId);
  return ((data ?? []) as TagRow[]).map((tag) => decorateTagWithUrls(tag, aliasHost));
}
