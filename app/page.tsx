import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/contracts';

interface RootPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RootPage({ searchParams }: RootPageProps): Promise<never> {
  const resolved = await searchParams;
  if (resolved && (resolved.code || resolved.token_hash)) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(resolved)) {
      if (typeof value === 'string') {
        query.set(key, value);
      } else if (Array.isArray(value) && value[0]) {
        query.set(key, value[0]);
      }
    }
    redirect(`${ROUTES.authCallback}?${query.toString()}`);
  }

  redirect(ROUTES.card);
}
