import { StaffManagementClient } from '@/components/console/StaffManagementClient';
import { PageIntro } from '@/components/console/ui';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { loadTeamData } from '@/lib/console/team-data';

export const dynamic = 'force-dynamic';

interface StaffSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function StaffSettingsPage({ params }: StaffSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'staff');
  const { members, invites } = await loadTeamData(tenantId);

  return (
    <div className="space-y-8">
      <PageIntro
        title="Team"
        description="Give each person their own login, so you can see who gave which reward."
      />
      <StaffManagementClient
        slug={slug}
        isOwner={staff.role === 'owner'}
        currentUserId={staff.userId}
        initialMembers={members}
        initialInvites={invites}
      />
    </div>
  );
}
