import { notFound } from 'next/navigation';
import { MyCardHeader } from '@/components/console/MyCardHeader';
import { RulesSettingsForm } from '@/components/console/RulesSettingsForm';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { getTenantBySlug } from '@/lib/tenants/context';

export const dynamic = 'force-dynamic';

interface RulesSettingsPageProps {
  params: Promise<{ slug: string }>;
}

/** My Card → Reward */
export default async function RulesSettingsPage({ params }: RulesSettingsPageProps) {
  const { slug } = await params;
  const { staff } = await enforceConsolePageAccess(slug, 'manager');

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <MyCardHeader slug={slug} current="reward" />
      <RulesSettingsForm
        slug={slug}
        isOwner={staff.role === 'owner'}
        initialSettings={{
          cooldown_minutes: tenant.settings.cooldownMinutes,
          daily_cap: tenant.settings.dailyCap,
          reward_threshold: tenant.settings.rewardThreshold,
          tag_throttle_seconds: tenant.settings.tagThrottleSeconds,
          reward_label: tenant.settings.rewardLabel,
          milestone_step: tenant.settings.milestoneStep ?? null,
          milestone_reward_label: tenant.settings.milestoneRewardLabel ?? null,
        }}
      />
    </div>
  );
}
