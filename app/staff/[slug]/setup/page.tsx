import { notFound, redirect } from 'next/navigation';
import { SetupWizard, type SetupWizardData } from '@/components/console/SetupWizard';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { loadShopHomeData } from '@/lib/console/setup-data';
import { isSetupStepId, type SetupStepId } from '@/lib/console/setup-progress';
import { loadTapCardsData } from '@/lib/console/tags-data';
import { loadTeamData } from '@/lib/console/team-data';
import { ROUTES } from '@/lib/contracts';
import { getTenantBySlug } from '@/lib/tenants/context';

export const dynamic = 'force-dynamic';

interface SetupPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ step?: string | string[] }>;
}

/** Guided first-run setup: one job per screen, with the owner's real forms. */
export default async function SetupPage({ params, searchParams }: SetupPageProps) {
  const { slug } = await params;
  const { step: rawStep } = await searchParams;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'staff', ROUTES.staff.setup(slug));

  if (staff.role !== 'owner') {
    redirect(ROUTES.staff.root);
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }

  const { progress } = await loadShopHomeData(tenant);
  const requested = Array.isArray(rawStep) ? rawStep[0] : rawStep;
  const step: SetupStepId = isSetupStepId(requested) ? requested : (progress.nextStep?.id ?? 'look');

  const data: SetupWizardData = {
    slug,
    tenantId,
    tenantName: tenant.name,
    currentUserId: staff.userId,
    brand: tenant.settings.brand ?? {},
    rules: {
      cooldown_minutes: tenant.settings.cooldownMinutes,
      daily_cap: tenant.settings.dailyCap,
      reward_threshold: tenant.settings.rewardThreshold,
      tag_throttle_seconds: tenant.settings.tagThrottleSeconds,
      reward_label: tenant.settings.rewardLabel,
      milestone_step: tenant.settings.milestoneStep ?? null,
      milestone_reward_label: tenant.settings.milestoneRewardLabel ?? null,
    },
    tapCards: null,
    team: null,
  };

  if (step === 'tapCard' || step === 'testTap') {
    data.tapCards = await loadTapCardsData(tenantId, staff.userId);
  }
  if (step === 'team') {
    data.team = await loadTeamData(tenantId);
  }

  return <SetupWizard step={step} progress={progress} data={data} />;
}
