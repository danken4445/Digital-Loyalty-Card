import { notFound } from 'next/navigation';
import { RulesSettingsForm } from '@/components/console/RulesSettingsForm';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { getTenantBySlug } from '@/lib/tenants/context';

export const dynamic = 'force-dynamic';

interface RulesSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function RulesSettingsPage({ params }: RulesSettingsPageProps) {
  const { slug } = await params;
  const { staff } = await enforceConsolePageAccess(slug, 'manager');

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }

  const isOwner = staff.role === 'owner';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wider text-white">
          Loyalty &amp; Stamping Rules
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          Configure cooldown periods, stamp thresholds, and customer limits. Run a preview to inspect impact on existing cards before saving.
        </p>
      </div>

      <RulesSettingsForm
        slug={slug}
        isOwner={isOwner}
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
