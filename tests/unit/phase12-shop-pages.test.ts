import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = 'a'.repeat(32);

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const headerStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (name: string) => headerStore.get(name.toLowerCase()) ?? null })),
}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? null,
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

let tableData: Record<string, unknown> = {};
const queriedTables: string[] = [];

function createQuery(data: unknown) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
  };
  return query;
}

const mockServerClient = {
  from: vi.fn((table: string) => {
    queriedTables.push(table);
    return createQuery(tableData[table] ?? null);
  }),
};
const mockAdminClient = { rpc: vi.fn(), from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
  getTenantById: vi.fn(),
  getTenantSlugForHost: vi.fn(),
}));

vi.mock('@/lib/auth/customer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/customer')>('@/lib/auth/customer');
  return {
    ...actual,
    getCustomerCardState: vi.fn(),
    listWalletCards: vi.fn(),
    // The real implementations are exercised through these aliases
    __actualGetCustomerCardState: actual.getCustomerCardState,
    __actualListWalletCards: actual.listWalletCards,
  };
});

import * as customerModule from '@/lib/auth/customer';
import { getTenantBySlug, getTenantSlugForHost } from '@/lib/tenants/context';
import { getVerifiedUser } from '@/lib/supabase/server';
import { verifyRedeemToken } from '@/lib/security/redeemToken';
import ShopPage from '@/app/s/[slug]/page';
import WalletPage from '@/app/wallet/page';
import CardRedirectPage from '@/app/card/page';
import { AddCardPanel } from '@/components/card/AddCardPanel';
import { StampGrid } from '@/components/card/StampGrid';
import { POST as redeemTokenPost } from '@/app/api/redeem-token/route';
import { POST as upsizeTokenPost } from '@/app/api/perks/instagram-upsize/route';
import {
  ROUTES,
  TENANT_ONE_ID,
  type CustomerCardState,
  type TenantContext,
  type WalletCardSummary,
} from '@/lib/contracts';

const actualGetCustomerCardState = (customerModule as any)
  .__actualGetCustomerCardState as typeof customerModule.getCustomerCardState;
const actualListWalletCards = (customerModule as any)
  .__actualListWalletCards as typeof customerModule.listWalletCards;

const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';
const SHOP_B_ID = '7c1f0000-0000-4000-8000-000000000002';

function makeTenant(overrides: Partial<TenantContext> = {}, settings: Partial<TenantContext['settings']> = {}): TenantContext {
  return {
    id: SHOP_B_ID,
    slug: 'tokyo-roast',
    name: 'Tokyo Roast',
    status: 'active',
    settings: {
      cooldownMinutes: 30,
      dailyCap: 2,
      rewardThreshold: 8,
      tagThrottleSeconds: 5,
      timezone: 'Asia/Tokyo',
      currency: 'JPY',
      rewardLabel: 'Free pastry',
      brand: { tagline: 'ROAST OF THE CITY' },
      perks: {},
      ...settings,
    },
    ...overrides,
  };
}

function makeCardState(tenant: TenantContext, overrides: Partial<CustomerCardState> = {}): CustomerCardState {
  return {
    customerId: CUSTOMER_ID,
    tenant,
    isAnonymous: true,
    totalStamps: 3,
    stampsRedeemed: 0,
    availableStamps: 3,
    lastStampedAt: '2026-11-01T12:00:00.000Z',
    createdAt: '2026-10-15T08:00:00.000Z',
    ...overrides,
  };
}

function summary(overrides: Partial<WalletCardSummary> = {}): WalletCardSummary {
  return {
    tenantId: SHOP_B_ID,
    tenantSlug: 'tokyo-roast',
    tenantName: 'Tokyo Roast',
    brand: {},
    rewardThreshold: 8,
    rewardLabel: 'Free pastry',
    availableStamps: 3,
    totalStamps: 3,
    lastStampedAt: null,
    addedAt: '2026-10-15T08:00:00.000Z',
    ...overrides,
  };
}

async function redirectTarget(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('NEXT_REDIRECT:')) {
      return message.slice('NEXT_REDIRECT:'.length);
    }
    throw error;
  }
  throw new Error('expected a redirect');
}

function post(url: string, body?: unknown) {
  return new Request(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableData = {};
  queriedTables.length = 0;
  headerStore.clear();
  mockAdminClient.rpc.mockResolvedValue({ data: CUSTOMER_ID, error: null });
  vi.mocked(getVerifiedUser).mockResolvedValue(null);
});

describe('shop card page (/s/[slug])', () => {
  const params = (slug: string) => Promise.resolve({ slug });

  it('shop_page_unknown_slug_404', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(null);
    await expect(
      ShopPage({ params: params('nope'), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('404s for a closed shop', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(makeTenant({ status: 'closed' }));
    await expect(
      ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('signed out: onboarding titled with the shop name', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(makeTenant());
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({ t: 'tag-1' }) }),
    );
    expect(html).toContain('Get a loyalty card at Tokyo Roast');
    expect(html).toContain('GET MY CARD');
    expect(html).not.toContain('ACTIVE WALLET');
  });

  it('no card: shows the add-card panel for that shop', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(makeTenant());
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue('no-card');
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('Add Tokyo Roast to your wallet');
    expect(html).toContain('Add card');
  });

  it('active card: uses the shop threshold, label, tagline, timezone and hides the perk when unconfigured', async () => {
    const tenant = makeTenant();
    vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(
      makeCardState(tenant, { totalStamps: 16, availableStamps: 3, cardsCompleted: 2 }),
    );
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('Tokyo Roast');
    expect(html).toContain('ROAST OF THE CITY');
    expect(html).toContain('Stamp 3 of 8, filled');
    expect(html).toContain('Stamp 8 of 8, empty (Free pastry reward)');
    expect(html).not.toContain('Stamp 9 of 8');
    expect(html).toContain('JST');
    expect(html).not.toContain('PHT');
    expect(html).not.toContain('Follow us, size up');
    expect(html).not.toContain('thecaffeineplug8400');
    expect(html).not.toMatch(/caffeine plug/i);
  });

  it('active card: shows the Instagram perk using the shop handle when configured', async () => {
    const tenant = makeTenant({}, {
      perks: { instagram_follow_upsize: { label: 'Free upsize', handle: '@tokyoroast' } },
    });
    vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(
      makeCardState(tenant, { instagramUpsizeClaimed: false }),
    );
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('Follow us, size up');
    expect(html).toContain('@tokyoroast');
    expect(html).toContain('https://www.instagram.com/tokyoroast/');
  });

  it('active card: keeps the ?r= result banner', async () => {
    const tenant = makeTenant();
    vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(makeCardState(tenant));
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({ r: 'cooldown' }) }),
    );
    expect(html).toContain('COOLDOWN ACTIVE');
  });
});

describe('/card redirector', () => {
  const search = (params: Record<string, string> = {}) => Promise.resolve(params);

  it('card_redirects_host_alias_to_shop', async () => {
    headerStore.set('host', 'card.tokyoroast.example');
    vi.mocked(getTenantSlugForHost).mockResolvedValue('tokyo-roast');
    const target = await redirectTarget(() => CardRedirectPage({ searchParams: search({ r: 'stamped' }) }));
    expect(target).toBe(ROUTES.shopWithResult('tokyo-roast', 'stamped'));
    expect(getTenantSlugForHost).toHaveBeenCalledWith('card.tokyoroast.example');
  });

  it('card_redirects_single_card_to_shop', async () => {
    vi.mocked(getTenantSlugForHost).mockResolvedValue(null);
    vi.mocked(customerModule.listWalletCards).mockResolvedValue([summary()]);
    const target = await redirectTarget(() => CardRedirectPage({ searchParams: search() }));
    expect(target).toBe(ROUTES.shop('tokyo-roast'));
  });

  it('card_redirects_multi_card_to_wallet', async () => {
    vi.mocked(getTenantSlugForHost).mockResolvedValue(null);
    vi.mocked(customerModule.listWalletCards).mockResolvedValue([
      summary(),
      summary({ tenantId: TENANT_ONE_ID, tenantSlug: 'caffeine-plug', tenantName: 'The Caffeine Plug' }),
    ]);
    const target = await redirectTarget(() => CardRedirectPage({ searchParams: search() }));
    expect(target).toBe(ROUTES.wallet);
  });

  it('forwards a valid ?r= result to the wallet and drops an invalid one', async () => {
    vi.mocked(getTenantSlugForHost).mockResolvedValue(null);
    vi.mocked(customerModule.listWalletCards).mockResolvedValue(null);
    expect(await redirectTarget(() => CardRedirectPage({ searchParams: search({ r: 'cooldown' }) }))).toBe(
      `${ROUTES.wallet}?r=cooldown`,
    );
    expect(await redirectTarget(() => CardRedirectPage({ searchParams: search({ r: 'bogus' }) }))).toBe(
      ROUTES.wallet,
    );
  });

  it('forwards a single-card ?r= result to that shop', async () => {
    vi.mocked(getTenantSlugForHost).mockResolvedValue(null);
    vi.mocked(customerModule.listWalletCards).mockResolvedValue([summary()]);
    const target = await redirectTarget(() => CardRedirectPage({ searchParams: search({ r: 'stamped' }) }));
    expect(target).toBe(ROUTES.shopWithResult('tokyo-roast', 'stamped'));
  });
});

describe('wallet page (/wallet)', () => {
  it('signed out: onboarding explaining cards are added at each shop', async () => {
    vi.mocked(customerModule.listWalletCards).mockResolvedValue(null);
    const html = renderToStaticMarkup(await WalletPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Your loyalty wallet');
    expect(html).toContain('each shop');
  });

  it('lists cards linking to their shop with progress and reward label', async () => {
    vi.mocked(customerModule.listWalletCards).mockResolvedValue([
      summary({ availableStamps: 5 }),
      summary({ tenantSlug: 'caffeine-plug', tenantName: 'The Caffeine Plug', rewardThreshold: 10, rewardLabel: 'FREE COFFEE', availableStamps: 2 }),
    ]);
    const html = renderToStaticMarkup(await WalletPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="${ROUTES.shop('tokyo-roast')}"`);
    expect(html).toContain('Tokyo Roast');
    expect(html).toContain('5/8');
    expect(html).toContain('Free pastry');
    expect(html).toContain(`href="${ROUTES.shop('caffeine-plug')}"`);
    expect(html).toContain('2/10');
  });

  it('renders the tap result banner for a valid ?r=', async () => {
    vi.mocked(customerModule.listWalletCards).mockResolvedValue([summary(), summary({ tenantSlug: 'b' })]);
    const html = renderToStaticMarkup(await WalletPage({ searchParams: Promise.resolve({ r: 'stamped' }) }));
    expect(html).toContain('STAMP COLLECTED');
  });
});

describe('lib/auth/customer tenant readers', () => {
  const tenant = makeTenant();

  it('get_customer_card_state_no_card', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValue({ id: CUSTOMER_ID, is_anonymous: true } as User);
    tableData.customer_cards = null;
    const state = await actualGetCustomerCardState(tenant);
    expect(state).toBe('no-card');
    expect(queriedTables).toEqual(['customer_cards']);
  });

  it('returns null when signed out', async () => {
    expect(await actualGetCustomerCardState(tenant)).toBeNull();
    expect(await actualListWalletCards()).toBeNull();
  });

  it('hydrates the card from the shop-scoped rows using the shop threshold', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValue({
      id: CUSTOMER_ID,
      is_anonymous: false,
      email: 'a@b.test',
      created_at: '2026-01-01T00:00:00.000Z',
    } as User);
    tableData.customer_cards = { tenant_id: SHOP_B_ID, customer_id: CUSTOMER_ID, added_at: '2026-10-15T08:00:00.000Z' };
    tableData.card_balances = {
      tenant_id: SHOP_B_ID,
      customer_id: CUSTOMER_ID,
      total_stamps: 17,
      stamps_redeemed: 8,
      available_stamps: 9,
      last_stamped_at: '2026-11-01T12:00:00.000Z',
    };
    tableData.perk_claims = { id: 'claim-1' };
    const state = await actualGetCustomerCardState(tenant);
    expect(state).toMatchObject({
      customerId: CUSTOMER_ID,
      isAnonymous: false,
      totalStamps: 17,
      availableStamps: 9,
      cardsCompleted: 2,
      createdAt: '2026-10-15T08:00:00.000Z',
      instagramUpsizeClaimed: true,
    });
    expect((state as CustomerCardState).tenant).toBe(tenant);
    expect(queriedTables).toEqual(['customer_cards', 'card_balances', 'perk_claims']);
  });

  it('lists wallet cards, most recently stamped first with unstamped cards by added_at desc', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValue({ id: CUSTOMER_ID } as User);
    const embed = (id: string, slug: string, threshold: number) => ({
      id,
      slug,
      name: slug.toUpperCase(),
      status: 'active',
      tenant_settings: { reward_threshold: threshold, reward_label: `label-${slug}`, brand: {} },
    });
    tableData.customer_cards = [
      { tenant_id: 'a', added_at: '2026-01-01T00:00:00.000Z', tenants: embed('a', 'old-unstamped', 10) },
      { tenant_id: 'b', added_at: '2026-02-01T00:00:00.000Z', tenants: embed('b', 'new-unstamped', 8) },
      { tenant_id: 'c', added_at: '2026-03-01T00:00:00.000Z', tenants: embed('c', 'stamped', 5) },
      { tenant_id: 'd', added_at: '2026-04-01T00:00:00.000Z', tenants: { ...embed('d', 'gone', 5), status: 'closed' } },
    ];
    tableData.card_balances = [
      { tenant_id: 'c', total_stamps: 4, available_stamps: 4, last_stamped_at: '2026-11-01T00:00:00.000Z' },
    ];
    const cards = await actualListWalletCards();
    expect(cards?.map((c) => c.tenantSlug)).toEqual(['stamped', 'new-unstamped', 'old-unstamped']);
    expect(cards?.[0]).toMatchObject({ availableStamps: 4, rewardThreshold: 5, rewardLabel: 'label-stamped' });
    expect(cards?.[1]).toMatchObject({ availableStamps: 0, totalStamps: 0, lastStampedAt: null });
  });
});

describe('shop-scoped token routes', () => {
  const tenant = makeTenant();

  function asCustomer() {
    vi.mocked(getVerifiedUser).mockResolvedValue({ id: CUSTOMER_ID } as User);
  }

  it('redeem_token_uses_tenant_threshold', async () => {
    asCustomer();
    vi.mocked(getTenantBySlug).mockResolvedValue(tenant);

    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(
      makeCardState(tenant, { availableStamps: 7, totalStamps: 7 }),
    );
    const short = await redeemTokenPost(post(ROUTES.api.redeemToken, { tenantSlug: 'tokyo-roast' }));
    expect(short.status).toBe(403);

    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(
      makeCardState(tenant, { availableStamps: 8, totalStamps: 8 }),
    );
    const res = await redeemTokenPost(post(ROUTES.api.redeemToken, { tenantSlug: 'tokyo-roast' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const json = await res.json();
    expect(json.data.payload.tenantId).toBe(SHOP_B_ID);
    const verified = verifyRedeemToken(json.data.token);
    expect(verified.valid && verified.payload.tenantId).toBe(SHOP_B_ID);
    expect(customerModule.getCustomerCardState).toHaveBeenCalledWith(tenant);
  });

  it('rejects an unknown or missing tenantSlug with 400 invalid_input', async () => {
    asCustomer();
    vi.mocked(getTenantBySlug).mockResolvedValue(null);
    for (const url of [ROUTES.api.redeemToken, ROUTES.api.instagramUpsizeToken]) {
      const post1 = url === ROUTES.api.redeemToken ? redeemTokenPost : upsizeTokenPost;
      const unknown = await post1(post(url, { tenantSlug: 'nope' }));
      expect(unknown.status).toBe(400);
      expect((await unknown.json()).error).toBe('invalid_input');
      const missing = await post1(post(url, {}));
      expect(missing.status).toBe(400);
      const noBody = await post1(post(url));
      expect(noBody.status).toBe(400);
    }
  });

  it('refuses to issue a token when the customer has no card at that shop', async () => {
    asCustomer();
    vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue('no-card');
    const res = await redeemTokenPost(post(ROUTES.api.redeemToken, { tenantSlug: 'tokyo-roast' }));
    expect(res.status).toBe(403);
  });

  it('perk_token_requires_configured_perk', async () => {
    asCustomer();
    // No perks configured: refused even though the card exists
    vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(
      makeCardState(tenant, { instagramUpsizeClaimed: false }),
    );
    const refused = await upsizeTokenPost(post(ROUTES.api.instagramUpsizeToken, { tenantSlug: 'tokyo-roast' }));
    expect(refused.status).toBe(403);

    const withPerk = makeTenant({}, {
      perks: { instagram_follow_upsize: { label: 'Free upsize', handle: '@tokyoroast' } },
    });
    vi.mocked(getTenantBySlug).mockResolvedValue(withPerk);
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(
      makeCardState(withPerk, { instagramUpsizeClaimed: false }),
    );
    const ok = await upsizeTokenPost(post(ROUTES.api.instagramUpsizeToken, { tenantSlug: 'tokyo-roast' }));
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.data.kind).toBe('instagram-upsize');
    expect(json.data.payload.tenantId).toBe(SHOP_B_ID);
  });
});

describe('components', () => {
  it('AddCardPanel offers to add the shop to the wallet', () => {
    const html = renderToStaticMarkup(
      React.createElement(AddCardPanel, {
        tenantSlug: 'tokyo-roast',
        tenantName: 'Tokyo Roast',
        rewardLabel: 'Free pastry',
        tagId: 'tag-1',
      }),
    );
    expect(html).toContain('Add Tokyo Roast to your wallet');
    expect(html).toContain('Free pastry');
    expect(html).toContain('Add card');
  });

  it('StampGrid honours a non-default threshold and reward label', () => {
    const html = renderToStaticMarkup(
      React.createElement(StampGrid, {
        availableStamps: 8,
        rewardThreshold: 8,
        rewardLabel: 'Free pastry',
        milestoneStep: null,
      }),
    );
    expect(html).toContain('Loyalty stamp grid, 8 slots');
    expect(html).toContain('Stamp 8 of 8, filled (Free pastry reward)');
    expect(html).toContain('FREE PASTRY');
    expect(html).not.toContain('50% OFF');
    expect(html).not.toContain('Stamp 9 of');
  });
});

describe('Phase 12 final fixes: shop-neutral onboarding', () => {
  const params = (slug: string) => Promise.resolve({ slug });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('other shop signed out: no 50% OFF preview, no Caffeine Plug mascot, natural title', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(makeTenant());
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({}) }),
    );
    expect(html).not.toContain('50%');
    expect(html).not.toContain('mascot');
    expect(html).toContain('Get a loyalty card at Tokyo Roast');
    expect(html).not.toContain('Get your Tokyo Roast');
  });

  it('other shop with no card yet: no 50% OFF preview or mascot', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(makeTenant());
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue('no-card');
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('tokyo-roast'), searchParams: Promise.resolve({}) }),
    );
    expect(html).not.toContain('50%');
    expect(html).not.toContain('mascot');
  });

  it('original shop keeps its mascot and 50% OFF preview', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(
      makeTenant({ id: TENANT_ONE_ID, slug: 'caffeine-plug', name: 'The Caffeine Plug' }),
    );
    vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await ShopPage({ params: params('caffeine-plug'), searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('50%');
    expect(html).toContain('The Caffeine Plug mascot');
    expect(html).toContain('Get a loyalty card at The Caffeine Plug');
  });

  it('/start is shop-neutral', async () => {
    const StartPage = (await import('@/app/start/page')).default;
    for (const search of [{}, { t: 'tag-1' }]) {
      const html = renderToStaticMarkup(await StartPage({ searchParams: Promise.resolve(search) }));
      expect(html).not.toMatch(/caffeine/i);
      expect(html).not.toMatch(/coffee/i);
      expect(html).not.toContain('50%');
      expect(html).not.toContain('mascot');
    }
  });
});
