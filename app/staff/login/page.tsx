import { redirect } from 'next/navigation';
import { StaffLoginForm } from '@/components/staff/StaffLoginForm';
import { requireStaffSession } from '@/lib/auth/staff';
import { ROUTES } from '@/lib/contracts';

interface StaffLoginPageProps {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
}

export default async function StaffLoginPage({ searchParams }: StaffLoginPageProps) {
  const params = await searchParams;
  const rawNext = Array.isArray(params?.next) ? params.next[0] : params?.next;
  const isValidNext =
    typeof rawNext === 'string' &&
    (rawNext === ROUTES.staff.root || rawNext.startsWith('/staff/')) &&
    !rawNext.startsWith(ROUTES.staff.login);
  const nextPath = isValidNext ? rawNext : ROUTES.staff.root;

  const rawError = Array.isArray(params?.error) ? params.error[0] : params?.error;
  const initialError = typeof rawError === 'string' ? rawError : undefined;

  const auth = await requireStaffSession();
  if (auth.authorized) {
    redirect(nextPath);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-topo-pattern px-4 py-12 text-white">
      <StaffLoginForm nextPath={nextPath} initialError={initialError} />
    </main>
  );
}
