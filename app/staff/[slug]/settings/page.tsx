import { notFound } from 'next/navigation';
import { RulesSettingsForm } from '@/components/console/RulesSettingsForm';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface RulesSettingsPageProps {
  params: Promise<{ slug: string }>;
}

interface TenantSettingsRow {
  cooldown_minutes: number;
  daily_cap: number;
  reward_threshold: number;
  tag_throttle_seconds: number;
  reward_label: string;
}

export default async function RulesSettingsPage({ params }: RulesSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'staff');

  const supabase = await createSupabaseServerClient();
  const { data: rawSettings, error } = await supabase
    .from('tenant_settings')
    .select('cooldown_minutes, daily_cap, reward_threshold, tag_throttle_seconds, reward_label')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const settings = rawSettings as unknown as TenantSettingsRow | null;

  if (error || !settings) {
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
          cooldown_minutes: settings.cooldown_minutes,
          daily_cap: settings.daily_cap,
          reward_threshold: settings.reward_threshold,
          tag_throttle_seconds: settings.tag_throttle_seconds,
          reward_label: settings.reward_label,
        }}
      />
    </div>
  );
}
