import { StaffPageShell } from '@/components/staff/StaffPageShell';
import { TagManagerClient } from '@/components/staff/TagManagerClient';
import { enforceStaffPageAccess, getStaffTagsList } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

export default async function StaffTagsPage() {
  const staff = await enforceStaffPageAccess(ROUTES.staff.tags);
  const initialTags = await getStaffTagsList();

  return (
    <StaffPageShell
      staff={staff}
      currentPath={ROUTES.staff.tags}
      title="NFC Tag Manager"
      headerLabel="NFC Tag Manager Header"
      description="Create, rotate or switch off the NFC cards you tap on customer phones. Copy a tag URL to write it onto a card with NFC Tools or NXP TagWriter."
    >
      <section aria-label="NFC Tag Manager Console">
        <TagManagerClient initialTags={initialTags} />
      </section>
    </StaffPageShell>
  );
}
