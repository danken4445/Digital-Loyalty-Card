import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { listWalletCards } from '@/lib/auth/customer';
import { isStampResultCode, ROUTES } from '@/lib/contracts';
import { getTenantSlugForHost } from '@/lib/tenants/context';

interface CardRedirectPageProps {
  searchParams: Promise<{
    r?: string | string[] | undefined;
    result?: string | string[] | undefined;
    deleted?: string | string[] | undefined;
  }>;
}

function withQuery(path: string, params: { result: string | null; deleted: boolean }): string {
  const query = new URLSearchParams();
  if (params.result) {
    query.set('r', params.result);
  }
  if (params.deleted) {
    query.set('deleted', '1');
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Legacy entry point (QR codes, bookmarks, post-sign-in): routes to the right shop.
 * 1. A custom-domain alias for the request host goes to that shop.
 * 2. Exactly one wallet card goes to that shop.
 * 3. Anything else (signed out, no cards, several cards) goes to the wallet.
 * A valid tap result (`?r=`) is carried along so it is never lost.
 */
export default async function CardRedirectPage({
  searchParams,
}: CardRedirectPageProps): Promise<never> {
  const resolvedParams = await searchParams;
  const rawResult = resolvedParams?.r ?? resolvedParams?.result;
  const rValue = Array.isArray(rawResult) ? rawResult[0] : rawResult;
  const forwarded = {
    result: typeof rValue === 'string' && isStampResultCode(rValue) ? rValue : null,
    deleted: resolvedParams?.deleted === '1',
  };

  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  const aliasSlug = await getTenantSlugForHost(host);
  if (aliasSlug) {
    redirect(withQuery(ROUTES.shop(aliasSlug), forwarded));
  }

  const cards = await listWalletCards();
  const onlyCard = cards?.length === 1 ? cards[0] : undefined;
  if (onlyCard) {
    redirect(withQuery(ROUTES.shop(onlyCard.tenantSlug), forwarded));
  }

  redirect(withQuery(ROUTES.wallet, forwarded));
}
