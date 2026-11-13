import { notFound } from 'next/navigation';
import { BrandSettingsForm } from '@/components/console/BrandSettingsForm';
import { MyCardHeader } from '@/components/console/MyCardHeader';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { getTenantBySlug } from '@/lib/tenants/context';

export const dynamic = 'force-dynamic';

interface BrandSettingsPageProps {
  params: Promise<{ slug: string }>;
}

/** My Card → Look & feel */
export default async function BrandSettingsPage({ params }: BrandSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'manager');

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <MyCardHeader slug={slug} current="look" />
      <BrandSettingsForm
        slug={slug}
        tenantId={tenantId}
        tenantName={tenant.name}
        canManage={staff.role === 'owner' || staff.role === 'manager'}
        initialBrand={tenant.settings.brand ?? {}}
        rewardThreshold={tenant.settings.rewardThreshold}
        rewardLabel={tenant.settings.rewardLabel}
      />
    </div>
  );
}
