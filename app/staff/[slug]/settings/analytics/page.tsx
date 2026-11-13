import { notFound } from 'next/navigation';
import { loadOwnerAnalytics } from '@/lib/analytics/owner';
import { enforceConsolePageAccess } from '@/lib/console/guard';
import { ROUTES } from '@/lib/contracts';
import { OwnerAnalyticsDashboard } from '@/components/console/OwnerAnalyticsDashboard';

export const dynamic = 'force-dynamic';

interface OwnerAnalyticsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function OwnerAnalyticsPage({ params }: OwnerAnalyticsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(
    slug,
    'owner',
    ROUTES.staff.analytics(slug),
  );

  const data = await loadOwnerAnalytics(staff.userId, tenantId);
  if (!data) {
    notFound();
  }

  return <OwnerAnalyticsDashboard data={data} shopName={staff.tenantName} slug={slug} />;
}
