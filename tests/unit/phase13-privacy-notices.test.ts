import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { ROUTES, type CustomerCardState, type TenantContext } from '@/lib/contracts';

// Ensure React is globally available in Node test runner
(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  notFound: () => mockNotFound(),
}));

vi.mock('@/lib/security/ratelimit', () => ({
  getClientIp: (request: Request) => request.headers.get('cf-connecting-ip') ?? '127.0.0.1',
  checkPublicEndpointRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  }),
}));

const mockAdminClient = {
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
}));

vi.mock('@/lib/auth/customer', () => ({
  getCustomerCardState: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: vi.fn(),
}));

import { DELETE as deleteCard } from '@/app/api/cards/route';
import ShopPrivacyPage, { generateMetadata as generateShopPrivacyMetadata } from '@/app/s/[slug]/privacy/page';
import PlatformPrivacyPage from '@/app/privacy/page';
import { DeleteCardButton, REMOVE_CARD_LABEL, DELETE_WALLET_LABEL } from '@/components/card/DeleteCardButton';
import { getCustomerCardState } from '@/lib/auth/customer';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getTenantBySlug } from '@/lib/tenants/context';

const TEST_TENANT_A: TenantContext = {
  id: '7c1f0000-0000-4000-8000-00000000000a',
  slug: 'craft-coffee',
  name: 'Craft Coffee Co.',
  status: 'active',
  settings: {
    cooldownMinutes: 20,
    dailyCap: 2,
    rewardThreshold: 10,
    tagThrottleSeconds: 5,
    timezone: 'Asia/Manila',
    currency: 'PHP',
    rewardLabel: 'Free Pour Over',
    brand: {
      primaryColor: '#121212',
      accentColor: '#F59E0B',
      tagline: 'Artisan Pour Overs',
      logoUrl: 'https://cdn.example.com/craft-logo.png',
    },
    perks: {},
  },
};

const TEST_TENANT_B: TenantContext = {
  id: '7c1f0000-0000-4000-8000-00000000000b',
  slug: 'bean-there',
  name: 'Bean There Roasters',
  status: 'active',
  settings: {
    cooldownMinutes: 15,
    dailyCap: 3,
    rewardThreshold: 8,
    tagThrottleSeconds: 5,
    timezone: 'Asia/Manila',
    currency: 'PHP',
    rewardLabel: 'Free Cold Brew',
    brand: {
      primaryColor: '#0F172A',
      accentColor: '#38BDF8',
      tagline: 'Freshly Roasted Beans',
      logoUrl: 'https://cdn.example.com/bean-logo.png',
    },
    perks: {},
  },
};

const TEST_CUSTOMER_USER: User = {
  id: 'c1111111-2222-4333-8444-555566667777',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00.000Z',
  is_anonymous: true,
};

describe('Phase 13 Task 5: Per-Shop Privacy Notice & Scoped Data Rights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shop_privacy_page_displays_tenant_name_and_rules', () => {
    it('renders shop privacy page with tenant details, controller identity, counsel draft banner, rules, and scoped card removal', async () => {
      vi.mocked(getTenantBySlug).mockResolvedValue(TEST_TENANT_A);
      vi.mocked(getVerifiedUser).mockResolvedValue(TEST_CUSTOMER_USER);

      const activeCardState: CustomerCardState = {
        customerId: TEST_CUSTOMER_USER.id,
        tenant: TEST_TENANT_A,
        isAnonymous: true,
        totalStamps: 3,
        stampsRedeemed: 0,
        availableStamps: 3,
        lastStampedAt: '2026-11-02T15:00:00.000Z',
        createdAt: '2026-10-01T12:00:00.000Z',
        cardsCompleted: 0,
      };
      vi.mocked(getCustomerCardState).mockResolvedValue(activeCardState);

      const pageElement = await ShopPrivacyPage({
        params: Promise.resolve({ slug: 'craft-coffee' }),
      });
      const html = renderToStaticMarkup(pageElement);

      // Counsel Review Draft Notice Banner
      expect(html).toContain('DRAFT — this notice is pending review by Philippine legal counsel and is not final.');

      // Header & Controller identity
      expect(html).toContain('Craft Coffee Co.');
      expect(html).toContain('Artisan Pour Overs');
      expect(html).toContain('PRIVACY &amp; DATA RIGHTS');
      expect(html).toContain('PHILIPPINES REPUBLIC ACT NO. 10173');
      expect(html).toContain('DATA PRIVACY ACT OF 2012');

      // Softened legal roles
      expect(html).toMatch(/is intended to act as.*Data Controller.*subject to counsel review/i);
      expect(html).toMatch(/is intended to act as.*Data Processor.*subject to counsel review/i);

      // Rules disclosure
      expect(html).toContain('20 minutes'); // cooldown
      expect(html).toContain('2 stamps per day'); // daily cap
      expect(html).toContain('10 stamps'); // threshold
      expect(html).toContain('Free Pour Over'); // reward label

      // Retention policy (platform-wide cleanup of 0-stamp accounts)
      expect(html).toContain('30 days');
      expect(html).toContain('0 stamps');
      expect(html).toMatch(/platform-wide/i);

      // Comprehensive RA 10173 rights
      expect(html).toContain('Right to Be Informed:');
      expect(html).toContain('Right to Access:');
      expect(html).toContain('Right to Object:');
      expect(html).toContain('Right to Rectification / Correction:');
      expect(html).toContain('Right to Erasure / Blocking:');
      expect(html).toContain('Right to Data Portability:');
      expect(html).toContain('Right to Damages:');
      expect(html).toContain('Right to File a Complaint with the National Privacy Commission (NPC):');
      expect(html).toContain('https://privacy.gov.ph');
      expect(html).toContain('[DPO contact for Craft Coffee Co. to be confirmed by counsel]');

      // Navigation back to the specific shop
      expect(html).toContain(ROUTES.shop('craft-coffee'));
      expect(html).toMatch(/Back to Craft Coffee Co\./i);

      // Scoped Card Erasure button for this shop
      expect(html).toContain(REMOVE_CARD_LABEL);
      expect(html).toContain('Removes your Craft Coffee Co. card and its stamps. Your other cards stay.');
      expect(html).not.toContain(DELETE_WALLET_LABEL);

      // Connected card status badge
      expect(html).toContain('CONNECTED CARD #C1111111');
      expect(html).toContain('ANONYMOUS PASS');

      // Flat design rules: no fuzzy shadow or inner shadow
      expect(html).not.toContain('shadow-[0_20px_50px');
      expect(html).not.toContain('backdrop-blur-md');
      expect(html).not.toContain('border-2');
      expect(html).not.toContain('shadow-inner');
    });

    it('renders neutral copy and hides remove CTA when customer has no card at this shop', async () => {
      vi.mocked(getTenantBySlug).mockResolvedValue(TEST_TENANT_A);
      vi.mocked(getCustomerCardState).mockResolvedValue('no-card');

      const pageElement = await ShopPrivacyPage({
        params: Promise.resolve({ slug: 'craft-coffee' }),
      });
      const html = renderToStaticMarkup(pageElement);

      expect(html).toContain('NO ACTIVE CARD FOR THIS SHOP ON THIS DEVICE');
      expect(html).toContain('No active Craft Coffee Co. card was found in this wallet session');
      expect(html).not.toContain(REMOVE_CARD_LABEL);
    });

    it('generates metadata containing shop name and compliance statement', async () => {
      vi.mocked(getTenantBySlug).mockResolvedValue(TEST_TENANT_A);

      const metadata = await generateShopPrivacyMetadata({
        params: Promise.resolve({ slug: 'craft-coffee' }),
      });

      expect(metadata.title).toContain('Craft Coffee Co.');
      expect(metadata.title).toContain('RA 10173');
      expect(metadata.description).toContain('Craft Coffee Co.');
      expect(metadata.description).toContain('Republic Act No. 10173');
    });
  });

  describe('shop_privacy_page_returns_404_when_slug_invalid', () => {
    it('calls notFound when tenant does not exist', async () => {
      vi.mocked(getTenantBySlug).mockResolvedValue(null);

      await expect(
        ShopPrivacyPage({
          params: Promise.resolve({ slug: 'unknown-shop' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalled();
    });

    it('calls notFound when tenant status is closed', async () => {
      vi.mocked(getTenantBySlug).mockResolvedValue({
        ...TEST_TENANT_A,
        status: 'closed',
      });

      await expect(
        ShopPrivacyPage({
          params: Promise.resolve({ slug: 'craft-coffee' }),
        }),
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalled();
    });
  });

  describe('remove_card_preserves_other_shop_cards', () => {
    it('removes Shop A card via remove_card RPC while leaving Shop B untouched', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(TEST_CUSTOMER_USER);
      vi.mocked(getTenantBySlug).mockImplementation(async (slug: string) => {
        if (slug === 'craft-coffee') return TEST_TENANT_A;
        if (slug === 'bean-there') return TEST_TENANT_B;
        return null;
      });

      mockAdminClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      const request = new Request('http://localhost:3000/api/cards', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ tenantSlug: 'craft-coffee' }),
      });

      const response = await deleteCard(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.data.removed).toBe(true);
      expect(body.data.redirectTo).toBe(ROUTES.wallet);

      // Verify remove_card RPC was called ONLY for Tenant A
      expect(mockAdminClient.rpc).toHaveBeenCalledTimes(1);
      expect(mockAdminClient.rpc).toHaveBeenCalledWith('remove_card', {
        p_customer: TEST_CUSTOMER_USER.id,
        p_tenant: TEST_TENANT_A.id,
      });

      // Verify delete_wallet was NOT called
      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('delete_wallet', expect.anything());

      // Tenant B was NOT targeted
      expect(mockAdminClient.rpc).not.toHaveBeenCalledWith(
        'remove_card',
        expect.objectContaining({ p_tenant: TEST_TENANT_B.id }),
      );
    });
  });

  describe('platform_privacy_page_describes_platform_controller_and_wallet_scope', () => {
    it('renders platform privacy notice with processor/controller roles, cross-shop isolation, and wallet erasure', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(TEST_CUSTOMER_USER);

      const pageElement = await PlatformPrivacyPage();
      const html = renderToStaticMarkup(pageElement);

      // Counsel Review Draft Notice Banner
      expect(html).toContain('DRAFT — this notice is pending review by Philippine legal counsel and is not final.');

      // Back link to wallet
      expect(html).toContain(ROUTES.wallet);
      expect(html).toMatch(/Back to my wallet/i);

      // Platform Operator & Softened Roles
      expect(html).toMatch(/is intended to act as.*Data Controller.*subject to counsel review/i);
      expect(html).toMatch(/is intended to act as.*Data Processor.*subject to counsel review/i);

      // Cross-shop data isolation
      expect(html).toMatch(/cross-shop|isolation|never see cards from other shops/i);

      // Verifiable infrastructure claim
      expect(html).toContain('hosted on Supabase');
      expect(html).toContain('AWS ap-southeast-1 (Singapore)');

      // Unverified technical claims removed
      expect(html).not.toMatch(/cryptographic partition/i);
      expect(html).not.toMatch(/cryptographic keys are hosted/i);
      expect(html).not.toMatch(/AES-256/i);

      // Platform branding (not single shop brand)
      expect(html).toContain('DigitalLoyalty platform');
      expect(html).not.toContain('The Caffeine Plug PLATFORM');

      // Global wallet erasure CTA
      expect(html).toContain('Delete my wallet &amp; data');
      expect(html).toContain('Erases every card in your wallet, all stamps, and your account.');
      expect(html).not.toContain(REMOVE_CARD_LABEL);

      // Flat design rules: no fuzzy shadow or inner shadow
      expect(html).not.toContain('shadow-[0_20px_50px');
      expect(html).not.toContain('backdrop-blur-md');
      expect(html).not.toContain('border-2');
      expect(html).not.toContain('shadow-inner');
    });
  });

  describe('DeleteCardButton scoped behavior', () => {
    it('supports both scope="card" and scope="shop" for shop-scoped card removal', () => {
      const cardHtml = renderToStaticMarkup(
        React.createElement(DeleteCardButton, {
          scope: 'card',
          tenantSlug: 'craft-coffee',
          tenantName: 'Craft Coffee Co.',
        }),
      );
      expect(cardHtml).toContain(REMOVE_CARD_LABEL);
      expect(cardHtml).toContain('Removes your Craft Coffee Co. card and its stamps. Your other cards stay.');

      const shopHtml = renderToStaticMarkup(
        React.createElement(DeleteCardButton, {
          scope: 'shop',
          tenantSlug: 'craft-coffee',
          tenantName: 'Craft Coffee Co.',
        }),
      );
      expect(shopHtml).toContain(REMOVE_CARD_LABEL);
      expect(shopHtml).toContain('Removes your Craft Coffee Co. card and its stamps. Your other cards stay.');
    });

    it('renders global wallet erasure when scope="wallet"', () => {
      const walletHtml = renderToStaticMarkup(
        React.createElement(DeleteCardButton, {
          scope: 'wallet',
        }),
      );
      expect(walletHtml).toContain('Delete my wallet &amp; data');
      expect(walletHtml).toContain('Erases every card in your wallet, all stamps, and your account.');
    });
  });
});
