import { ConsoleTagsManager } from '@/components/console/ConsoleTagsManager';
import { PageIntro } from '@/components/console/ui';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { loadTapCardsData } from '@/lib/console/tags-data';

export const dynamic = 'force-dynamic';

interface TagsSettingsPageProps {
  params: Promise<{ slug: string }>;
}

/** Tap Cards: the one place to add, replace or turn off the NFC cards at the counter. */
export default async function TagsSettingsPage({ params }: TagsSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'manager');
  const { tags, locations, leakSignals } = await loadTapCardsData(tenantId, staff.userId);

  return (
    <div className="space-y-8">
      <PageIntro
        title="Tap Cards"
        description="The cards customers tap with their phone to collect a stamp."
      />
      <ConsoleTagsManager
        slug={slug}
        initialTags={tags}
        locations={locations}
        canManage={staff.role === 'owner' || staff.role === 'manager'}
        leakSignals={leakSignals}
      />
    </div>
  );
}
