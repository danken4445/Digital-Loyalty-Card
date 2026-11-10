import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = 'a'.repeat(32);

vi.mock('server-only', () => ({}));

const mockRouterRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRouterRefresh }),
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
  getClientIp: () => '127.0.0.1',
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

const mockServerClient = {
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
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
  };
});

import * as customerModule from '@/lib/auth/customer';
import { getTenantBySlug } from '@/lib/tenants/context';
import { ROUTES, type CustomerCardState, type TenantContext } from '@/lib/contracts';
import ShopPage from '@/app/s/[slug]/page';
import WalletsPage from '@/app/wallets/page';
import { BackToWalletButton } from '@/components/card/BackToWalletButton';
import { PullToRefresh, isPwa } from '@/components/card/PullToRefresh';

const SHOP_ID = '7c1f0000-0000-4000-8000-000000000002';
const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';

function makeTenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    id: SHOP_ID,
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

describe('Loyalty Card Page: Back button & PWA Scroll Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Route contract', () => {
    it('defines ROUTES.wallets pointing to /wallets and preserves ROUTES.wallet', () => {
      expect(ROUTES.wallets).toBe('/wallets');
      expect(ROUTES.wallet).toBe('/wallet');
    });

    it('exports default WalletPage from app/wallets/page.tsx', () => {
      expect(typeof WalletsPage).toBe('function');
    });
  });

  describe('BackToWalletButton component', () => {
    it('renders a link with text "Back" linking to /wallets by default', () => {
      const html = renderToStaticMarkup(React.createElement(BackToWalletButton));
      expect(html).toContain('href="/wallets"');
      expect(html).toContain('Back');
      expect(html).toContain('aria-label="Back to wallets"');
    });

    it('accepts a custom href override if specified', () => {
      const html = renderToStaticMarkup(React.createElement(BackToWalletButton, { href: '/custom-wallet' }));
      expect(html).toContain('href="/custom-wallet"');
      expect(html).toContain('Back');
    });
  });

  describe('Client Loyalty Card Page (ShopPage) Back button integration', () => {
    it('renders the "Back" button navigating to /wallets on active card view', async () => {
      const tenant = makeTenant();
      vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
      vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(makeCardState(tenant));

      const pageElement = await ShopPage({
        params: Promise.resolve({ slug: 'tokyo-roast' }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(pageElement);

      // Verifies the Back button exists and points to /wallets
      expect(html).toContain('href="/wallets"');
      expect(html).toContain('Back');
      expect(html).toContain('aria-label="Back to wallets"');
      // Verifies the pull-to-refresh component is rendered
      expect(html).toContain('data-testid="pull-to-refresh"');
    });

    it('renders the "Back" button navigating to /wallets on onboarding view', async () => {
      const tenant = makeTenant();
      vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
      vi.mocked(customerModule.getCustomerCardState).mockResolvedValue(null);

      const pageElement = await ShopPage({
        params: Promise.resolve({ slug: 'tokyo-roast' }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(pageElement);

      expect(html).toContain('href="/wallets"');
      expect(html).toContain('Back');
    });

    it('renders the "Back" button navigating to /wallets on no-card view', async () => {
      const tenant = makeTenant();
      vi.mocked(getTenantBySlug).mockResolvedValue(tenant);
      vi.mocked(customerModule.getCustomerCardState).mockResolvedValue('no-card');

      const pageElement = await ShopPage({
        params: Promise.resolve({ slug: 'tokyo-roast' }),
        searchParams: Promise.resolve({}),
      });
      const html = renderToStaticMarkup(pageElement);

      expect(html).toContain('href="/wallets"');
      expect(html).toContain('Back');
    });
  });

  describe('PullToRefresh for PWAs', () => {
    it('renders pull-to-refresh indicator with accessible status and role', () => {
      const html = renderToStaticMarkup(React.createElement(PullToRefresh));

      expect(html).toContain('data-testid="pull-to-refresh"');
      expect(html).toContain('data-testid="pull-to-refresh-indicator"');
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('PULL TO REFRESH');
      expect(html).toContain('data-testid="pull-to-refresh-trigger"');
    });

    it('detects PWA standalone mode when window.matchMedia indicates standalone', () => {
      // In node env without window, returns false
      expect(isPwa()).toBe(false);

      const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
      const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
      const originalDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');

      try {
        const mockNavigator: Record<string, unknown> = {};
        const mockDocument = { referrer: '' };
        const mockWindow = {
          matchMedia: vi.fn((query: string) => ({
            matches: query === '(display-mode: standalone)',
          })),
          navigator: mockNavigator,
          document: mockDocument,
        };

        Object.defineProperty(globalThis, 'window', { value: mockWindow, configurable: true, writable: true });
        Object.defineProperty(globalThis, 'navigator', { value: mockNavigator, configurable: true, writable: true });
        Object.defineProperty(globalThis, 'document', { value: mockDocument, configurable: true, writable: true });

        expect(isPwa()).toBe(true);

        // When matchMedia returns false
        mockWindow.matchMedia = vi.fn(() => ({ matches: false } as any));
        expect(isPwa()).toBe(false);

        // When iOS navigator.standalone is true
        mockNavigator.standalone = true;
        expect(isPwa()).toBe(true);

        // When Android PWA referrer is android-app://
        mockNavigator.standalone = false;
        mockDocument.referrer = 'android-app://org.chromium.webapk';
        expect(isPwa()).toBe(true);
      } finally {
        if (originalWindowDesc) {
          Object.defineProperty(globalThis, 'window', originalWindowDesc);
        } else {
          delete (globalThis as any).window;
        }
        if (originalNavigatorDesc) {
          Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
        }
        if (originalDocumentDesc) {
          Object.defineProperty(globalThis, 'document', originalDocumentDesc);
        } else {
          delete (globalThis as any).document;
        }
      }
    });
  });
});
