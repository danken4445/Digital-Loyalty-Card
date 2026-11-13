import 'server-only';

import type { InviteItem, MemberItem } from '@/components/console/StaffManagementClient';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface TeamData {
  members: MemberItem[];
  invites: InviteItem[];
}

/** Members and invites for the Team screen and the setup wizard's team step. */
export async function loadTeamData(tenantId: string): Promise<TeamData> {
  const supabase = await createSupabaseServerClient();

  const [membersRes, invitesRes] = await Promise.all([
    supabase
      .from('tenant_members')
      .select('user_id, role, display_name, active, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
    supabase
      .from('tenant_invites')
      .select('id, email, role, expires_at, accepted_at, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
  ]);

  const members = ((membersRes.data as unknown as MemberItem[] | null) ?? []).map((m) => ({
    user_id: m.user_id,
    role: m.role,
    display_name: m.display_name,
    active: m.active,
    created_at: m.created_at,
  }));

  const invites = ((invitesRes.data as unknown as InviteItem[] | null) ?? []).map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expires_at: inv.expires_at,
    accepted_at: inv.accepted_at,
    created_at: inv.created_at,
  }));

  return { members, invites };
}
