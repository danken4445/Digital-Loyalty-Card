import { enforceConsolePageAccess } from '@/lib/console/guard';
import { BrandSettingsForm } from '@/components/console/BrandSettingsForm';
import { getTenantBySlug } from '@/lib/tenants/context';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface BrandSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function BrandSettingsPage({ params }: BrandSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'manager');

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }

  const initialBrand = tenant.settings.brand ?? {};
  const canManage = staff.role === 'owner' || staff.role === 'manager';

  return (
    <BrandSettingsForm
      slug={slug}
      tenantId={tenantId}
      tenantName={tenant.name}
      canManage={canManage}
      initialBrand={initialBrand}
      rewardThreshold={tenant.settings.rewardThreshold}
      rewardLabel={tenant.settings.rewardLabel}
    />
  );
}
