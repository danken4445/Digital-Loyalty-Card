import { PlatformInvoicesClient } from '@/components/platform/PlatformInvoicesClient';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { enforcePlatformPageAccess } from '@/lib/auth/platform';
import { ROUTES, type TenantInvoice } from '@/lib/contracts';
import { listPlatformInvoicesDirect } from '@/lib/platform/dashboard';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function PlatformInvoicesPage() {
  const admin = await enforcePlatformPageAccess(ROUTES.platform.invoices);

  const adminClient = createSupabaseAdminClient();
  let invoices: TenantInvoice[] = [];

  try {
    const { data, error } = await adminClient.rpc('platform_list_invoices', {
      p_actor: admin.userId,
      p_tenant: null,
    });
    const raw = data as Record<string, unknown> | null;
    if (!error && raw && raw.result === 'ok') {
      invoices = (raw.invoices as TenantInvoice[]) ?? [];
    } else {
      invoices = await listPlatformInvoicesDirect(adminClient, null);
    }
  } catch {
    invoices = await listPlatformInvoicesDirect(adminClient, null);
  }

  return (
    <PlatformShell
      admin={admin}
      currentPath={ROUTES.platform.invoices}
      title="Invoices & Billing"
      description="Track client subscription settlements, generate monthly invoices, and record payments."
      backHref={ROUTES.platform.root}
      backLabel="Dashboard"
    >
      <PlatformInvoicesClient initialInvoices={invoices} />
    </PlatformShell>
  );
}
