import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Ensure React is globally available
(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

vi.mock('server-only', () => ({}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/auth/customer', () => ({
  getCustomerCardState: vi.fn(),
  listWalletCards: vi.fn(),
}));

vi.mock('@/lib/security/redeemToken', () => ({
  issueRedeemToken: vi.fn().mockResolvedValue(null),
}));

import { getCustomerCardState } from '@/lib/auth/customer';
import { getTenantBySlug } from '@/lib/tenants/context';
import type { CustomerCardState, TenantContext } from '@/lib/contracts';
import ShopPage from '@/app/s/[slug]/page';
import { AddCardPanel } from '@/components/card/AddCardPanel';

const TEST_CUSTOM_TENANT: TenantContext = {
  id: '7c1f0000-0000-4000-8000-000000000002',
  slug: 'artisan-roast',
  name: 'Artisan Roast',
  status: 'active',
  settings: {
    cooldownMinutes: 15,
    dailyCap: 3,
    rewardThreshold: 8,
    tagThrottleSeconds: 5,
    timezone: 'America/New_York',
    currency: 'USD',
    rewardLabel: 'Free Batch Brew',
    brand: {
      primaryColor: '#1E293B',
      accentColor: '#38BDF8',
      logoUrl: 'https://cdn.example.com/artisan-logo.png',
      tagline: 'Precision Roasted Coffee',
    },
    perks: {},
  },
};

const TEST_CUSTOMER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('Phase 13 Task 3: Shop Card Dynamic Branding, Timezone Display & Celebration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shop_card_applies_dynamic_theme_colors_from_tenant_settings', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_CUSTOM_TENANT);
    const cardState: CustomerCardState = {
      customerId: TEST_CUSTOMER_ID,
      tenant: TEST_CUSTOM_TENANT,
      isAnonymous: false,
      totalStamps: 3,
      stampsRedeemed: 0,
      availableStamps: 3,
      lastStampedAt: '2026-11-02T15:00:00.000Z',
      createdAt: '2026-10-01T12:00:00.000Z',
      cardsCompleted: 0,
    };
    vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

    const pageElement = await ShopPage({
      params: Promise.resolve({ slug: TEST_CUSTOM_TENANT.slug }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(pageElement);

    // Primary color should be in the card container style (#1E293B or rgb(30, 41, 59))
    expect(html).toMatch(/background-color:\s*(#1E293B|rgb\(30,\s*41,\s*59\))/i);
    // Logo URL should be rendered from tenant branding
    expect(html).toContain('https://cdn.example.com/artisan-logo.png');
    expect(html).toContain('alt="Artisan Roast logo"');
    // Shop tagline
    expect(html).toContain('Precision Roasted Coffee');
  });

  it('shop_card_formats_member_since_in_tenant_timezone', async () => {
    // 2026-11-02T02:00:00.000Z in Asia/Manila (UTC+8) is Nov 2, 2026 (10:00 AM).
    // In America/New_York (UTC-5 / EDT or -4 / EDT on Nov 1), it is Nov 1, 2026 (9:00 PM / 10:00 PM).
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_CUSTOM_TENANT);
    const cardState: CustomerCardState = {
      customerId: TEST_CUSTOMER_ID,
      tenant: TEST_CUSTOM_TENANT,
      isAnonymous: false,
      totalStamps: 1,
      stampsRedeemed: 0,
      availableStamps: 1,
      lastStampedAt: null,
      createdAt: '2026-11-02T02:00:00.000Z',
      cardsCompleted: 0,
    };
    vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

    const pageElement = await ShopPage({
      params: Promise.resolve({ slug: TEST_CUSTOM_TENANT.slug }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(pageElement);

    // Must show Nov 1, 2026 for America/New_York, NOT Manila's Nov 2, 2026
    expect(html).toContain('Nov 1, 2026');
    expect(html).not.toContain('Nov 2, 2026');
  });

  it('signed_out_shop_page_without_tag_omits_claim_stamp_copy', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_CUSTOM_TENANT);
    vi.mocked(getCustomerCardState).mockResolvedValue(null);

    // Visiting without a tag: searchParams = {}
    const pageNoTag = await ShopPage({
      params: Promise.resolve({ slug: TEST_CUSTOM_TENANT.slug }),
      searchParams: Promise.resolve({}),
    });
    const htmlNoTag = renderToStaticMarkup(pageNoTag);

    expect(htmlNoTag).toContain('GET MY CARD');
    expect(htmlNoTag).not.toContain('GET MY CARD &amp; CLAIM STAMP');
    expect(htmlNoTag).not.toContain('GET MY CARD & CLAIM STAMP');

    // Visiting with a tag: searchParams = { t: 'test-tag-1' }
    const pageWithTag = await ShopPage({
      params: Promise.resolve({ slug: TEST_CUSTOM_TENANT.slug }),
      searchParams: Promise.resolve({ t: 'test-tag-1' }),
    });
    const htmlWithTag = renderToStaticMarkup(pageWithTag);

    expect(htmlWithTag).toContain('GET MY CARD &amp; CLAIM STAMP');
  });

  it('add_card_panel_links_to_tenant_privacy_notice', () => {
    const html = renderToStaticMarkup(
      React.createElement(AddCardPanel, {
        tenantSlug: 'artisan-roast',
        tenantName: 'Artisan Roast',
        rewardLabel: 'Free Batch Brew',
      })
    );

    expect(html).toContain('href="/s/artisan-roast/privacy"');
    expect(html).toMatch(/By adding this card, you agree to/i);
    expect(html).toMatch(/Artisan Roast.*Privacy Notice/i);
  });

  it('add_card_triggers_moment_animation', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValue(TEST_CUSTOM_TENANT);
    const cardState: CustomerCardState = {
      customerId: TEST_CUSTOMER_ID,
      tenant: TEST_CUSTOM_TENANT,
      isAnonymous: false,
      totalStamps: 1,
      stampsRedeemed: 0,
      availableStamps: 1,
      lastStampedAt: null,
      createdAt: '2026-11-01T12:00:00.000Z',
      cardsCompleted: 0,
    };
    vi.mocked(getCustomerCardState).mockResolvedValue(cardState);

    // When ?added=1 is present
    const pageWithAdded = await ShopPage({
      params: Promise.resolve({ slug: TEST_CUSTOM_TENANT.slug }),
      searchParams: Promise.resolve({ added: '1' }),
    });
    const htmlWithAdded = renderToStaticMarkup(pageWithAdded);

    expect(htmlWithAdded).toContain('role="status"');
    expect(htmlWithAdded).toContain('Card added to your wallet!');
    expect(htmlWithAdded).toContain('banner-enter');

    // When added is absent
    const pageWithoutAdded = await ShopPage({
      params: Promise.resolve({ slug: TEST_CUSTOM_TENANT.slug }),
      searchParams: Promise.resolve({}),
    });
    const htmlWithoutAdded = renderToStaticMarkup(pageWithoutAdded);

    expect(htmlWithoutAdded).not.toContain('Card added to your wallet!');
  });
});
