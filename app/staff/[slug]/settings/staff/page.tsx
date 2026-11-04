import { StaffManagementClient } from '@/components/console/StaffManagementClient';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface StaffSettingsPageProps {
  params: Promise<{ slug: string }>;
}

interface TenantMemberRow {
  user_id: string;
  role: string;
  display_name: string;
  active: boolean;
  created_at: string;
}

interface TenantInviteRow {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export default async function StaffSettingsPage({ params }: StaffSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'staff');

  const supabase = await createSupabaseServerClient();

  const { data: rawMembers } = await supabase
    .from('tenant_members')
    .select('user_id, role, display_name, active, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  const { data: rawInvites } = await supabase
    .from('tenant_invites')
    .select('id, email, role, expires_at, accepted_at, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  const typedMembers = (rawMembers as unknown as TenantMemberRow[] | null) ?? [];
  const typedInvites = (rawInvites as unknown as TenantInviteRow[] | null) ?? [];

  const members = typedMembers.map((m) => ({
    user_id: m.user_id,
    role: m.role,
    display_name: m.display_name,
    active: m.active,
    created_at: m.created_at,
  }));

  const invites = typedInvites.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expires_at: inv.expires_at,
    accepted_at: inv.accepted_at,
    created_at: inv.created_at,
  }));

  const isOwner = staff.role === 'owner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wider text-white">
          Team &amp; Invitations
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Manage shop members, permissions, and pending staff invitations.
        </p>
      </div>

      <StaffManagementClient
        slug={slug}
        isOwner={isOwner}
        currentUserId={staff.userId}
        initialMembers={members}
        initialInvites={invites}
      />
    </div>
  );
}
