import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from '@supabase/supabase-js';

// Ensure React is globally available in Node test runner
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

let tableData: Record<string, unknown> = {};

function createQuery(data: unknown) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
  };
  return query;
}

const mockServerClient = {
  from: vi.fn((table: string) => createQuery(tableData[table] ?? null)),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(),
}));

import { getVerifiedUser } from '@/lib/supabase/server';
import { listWalletCards } from '@/lib/auth/customer';
import { WalletCardStack } from '@/components/wallet/WalletCardStack';
import { WalletBackupModal } from '@/components/wallet/WalletBackupModal';
import WalletPage from '@/app/wallet/page';
import { ROUTES, type WalletCardSummary } from '@/lib/contracts';

describe('Phase 13 Task 4: Collectible /wallet Stack & Wallet-Level Backup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableData = {};
  });

  describe('list_wallet_cards_populates_cards_completed', () => {
    it('populates cardsCompleted based on total lifetime stamps and reward threshold', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: 'cust-123',
        is_anonymous: false,
      } as User);

      // 3 shops with different thresholds and total stamps
      tableData.customer_cards = [
        {
          tenant_id: 'tenant-a',
          added_at: '2026-01-01T00:00:00.000Z',
          tenants: {
            id: 'tenant-a',
            slug: 'shop-a',
            name: 'Shop A',
            status: 'active',
            tenant_settings: {
              reward_threshold: 10,
              reward_label: 'Free Drink',
              brand: { primaryColor: '#0A0A0A' },
            },
          },
        },
        {
          tenant_id: 'tenant-b',
          added_at: '2026-02-01T00:00:00.000Z',
          tenants: {
            id: 'tenant-b',
            slug: 'shop-b',
            name: 'Shop B',
            status: 'active',
            tenant_settings: {
              reward_threshold: 8,
              reward_label: 'Free Pastry',
              brand: { primaryColor: '#1E293B' },
            },
          },
        },
        {
          tenant_id: 'tenant-c',
          added_at: '2026-03-01T00:00:00.000Z',
          tenants: {
            id: 'tenant-c',
            slug: 'shop-c',
            name: 'Shop C',
            status: 'active',
            tenant_settings: {
              reward_threshold: 10,
              reward_label: 'Free Sandwich',
              brand: { primaryColor: '#064E3B' },
            },
          },
        },
      ];

      tableData.card_balances = [
        // Shop A: 25 total stamps, threshold 10 => 2 completed cards
        {
          tenant_id: 'tenant-a',
          total_stamps: 25,
          available_stamps: 5,
          last_stamped_at: '2026-11-01T10:00:00.000Z',
        },
        // Shop B: 8 total stamps, threshold 8 => 1 completed card
        {
          tenant_id: 'tenant-b',
          total_stamps: 8,
          available_stamps: 0,
          last_stamped_at: '2026-11-02T10:00:00.000Z',
        },
        // Shop C: 4 total stamps, threshold 10 => 0 completed cards
        {
          tenant_id: 'tenant-c',
          total_stamps: 4,
          available_stamps: 4,
          last_stamped_at: '2026-11-03T10:00:00.000Z',
        },
      ];

      const cards = await listWalletCards();
      expect(cards).not.toBeNull();
      expect(cards).toHaveLength(3);

      const shopA = cards!.find((c) => c.tenantSlug === 'shop-a');
      const shopB = cards!.find((c) => c.tenantSlug === 'shop-b');
      const shopC = cards!.find((c) => c.tenantSlug === 'shop-c');

      expect(shopA?.cardsCompleted).toBe(2);
      expect(shopB?.cardsCompleted).toBe(1);
      expect(shopC?.cardsCompleted).toBe(0);
    });
  });

  describe('wallet_stack_renders_distinct_shop_branding_for_multiple_cards', () => {
    it('renders distinct shop styling, colors, logo, and links for multiple cards', () => {
      const cards: WalletCardSummary[] = [
        {
          tenantId: 'tenant-a',
          tenantSlug: 'caffeine-plug',
          tenantName: 'The Caffeine Plug',
          brand: {
            primaryColor: '#0A0A0A',
            accentColor: '#FFFFFF',
            tagline: 'Your daily dose',
          },
          rewardThreshold: 10,
          rewardLabel: 'Free Coffee',
          availableStamps: 3,
          totalStamps: 13,
          cardsCompleted: 1,
          lastStampedAt: '2026-11-01T12:00:00Z',
          addedAt: '2026-10-01T12:00:00Z',
        },
        {
          tenantId: 'tenant-b',
          tenantSlug: 'neon-roast',
          tenantName: 'Neon Roast',
          brand: {
            primaryColor: '#1E293B',
            accentColor: '#38BDF8',
          },
          rewardThreshold: 8,
          rewardLabel: 'Free Oat Latte',
          availableStamps: 5,
          totalStamps: 5,
          cardsCompleted: 0,
          lastStampedAt: '2026-11-02T12:00:00Z',
          addedAt: '2026-10-05T12:00:00Z',
        },
        {
          tenantId: 'tenant-c',
          tenantSlug: 'green-matcha',
          tenantName: 'Green Matcha Bar',
          brand: {
            primaryColor: '#064E3B',
            accentColor: '#34D399',
          },
          rewardThreshold: 10,
          rewardLabel: 'Free Pastry',
          availableStamps: 7,
          totalStamps: 27,
          cardsCompleted: 2,
          lastStampedAt: '2026-11-03T12:00:00Z',
          addedAt: '2026-10-10T12:00:00Z',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(WalletCardStack, { cards }),
      );

      // Links to each shop
      expect(html).toContain(`href="${ROUTES.shop('caffeine-plug')}"`);
      expect(html).toContain(`href="${ROUTES.shop('neon-roast')}"`);
      expect(html).toContain(`href="${ROUTES.shop('green-matcha')}"`);

      // Shop names
      expect(html).toContain('The Caffeine Plug');
      expect(html).toContain('Neon Roast');
      expect(html).toContain('Green Matcha Bar');

      // Rewards
      expect(html).toContain('Free Coffee');
      expect(html).toContain('Free Oat Latte');
      expect(html).toContain('Free Pastry');

      // Stamp progress counts in tabular format
      expect(html).toContain('3/10');
      expect(html).toContain('5/8');
      expect(html).toContain('7/10');

      // Distinct brand backgrounds
      expect(html).toMatch(/#0A0A0A|rgb\(10,\s*10,\s*10\)/i);
      expect(html).toMatch(/#1E293B|rgb\(30,\s*41,\s*59\)/i);
      expect(html).toMatch(/#064E3B|rgb\(6,\s*78,\s*59\)/i);
    });
  });

  describe('wallet_stack_shows_cards_collected_count', () => {
    it('shows cards collected counter badge with total completed cards count', () => {
      const cards: WalletCardSummary[] = [
        {
          tenantId: 'tenant-a',
          tenantSlug: 'shop-a',
          tenantName: 'Shop A',
          brand: {},
          rewardThreshold: 10,
          rewardLabel: 'Free Item',
          availableStamps: 2,
          totalStamps: 12,
          cardsCompleted: 1,
          lastStampedAt: '2026-11-01T00:00:00Z',
          addedAt: '2026-10-01T00:00:00Z',
        },
        {
          tenantId: 'tenant-b',
          tenantSlug: 'shop-b',
          tenantName: 'Shop B',
          brand: {},
          rewardThreshold: 10,
          rewardLabel: 'Free Item',
          availableStamps: 5,
          totalStamps: 25,
          cardsCompleted: 2,
          lastStampedAt: '2026-11-02T00:00:00Z',
          addedAt: '2026-10-02T00:00:00Z',
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(WalletCardStack, { cards }),
      );

      // Shows collected count badge
      expect(html).toMatch(/Cards collected:\s*2/i);
      // Shows total completed count badge (1 + 2 = 3 completed)
      expect(html).toMatch(/3\s*completed/i);
    });
  });

  describe('wallet_empty_renders_mascot_and_copy', () => {
    it('renders clean empty state with restored mascot illustration and friendly zero-state copy when signed out', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue(null);

      const html = renderToStaticMarkup(
        await WalletPage({ searchParams: Promise.resolve({}) }),
      );

      // Restored mascot illustration
      expect(html).toContain('/brand/mascot-full.png');

      // Friendly zero-state copy
      expect(html).toContain('Your loyalty wallet');
      expect(html).toMatch(/each shop|add it here|No cards/i);
    });

    it('renders clean empty state with mascot when signed in but holding 0 cards', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: 'cust-empty',
        is_anonymous: true,
      } as User);
      tableData.customer_cards = [];
      tableData.card_balances = [];

      const html = renderToStaticMarkup(
        await WalletPage({ searchParams: Promise.resolve({}) }),
      );

      // Restored mascot illustration
      expect(html).toContain('/brand/mascot-full.png');

      // Friendly zero-state copy
      expect(html).toMatch(/No cards/i);
    });
  });

  describe('wallet_backup_preserves_all_cards', () => {
    it('displays wallet-level backup prompt for anonymous customer with cards', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: 'cust-anon-1',
        is_anonymous: true,
      } as User);

      tableData.customer_cards = [
        {
          tenant_id: 'shop-1',
          added_at: '2026-10-01T00:00:00Z',
          tenants: {
            id: 'shop-1',
            slug: 'shop-1',
            name: 'Shop 1',
            status: 'active',
            tenant_settings: { reward_threshold: 10, reward_label: 'Coffee', brand: {} },
          },
        },
        {
          tenant_id: 'shop-2',
          added_at: '2026-10-02T00:00:00Z',
          tenants: {
            id: 'shop-2',
            slug: 'shop-2',
            name: 'Shop 2',
            status: 'active',
            tenant_settings: { reward_threshold: 8, reward_label: 'Tea', brand: {} },
          },
        },
      ];
      tableData.card_balances = [
        { tenant_id: 'shop-1', total_stamps: 3, available_stamps: 3, last_stamped_at: null },
        { tenant_id: 'shop-2', total_stamps: 5, available_stamps: 5, last_stamped_at: null },
      ];

      const html = renderToStaticMarkup(
        await WalletPage({ searchParams: Promise.resolve({}) }),
      );

      // Prompt for wallet-level backup
      expect(html).toContain('Back up all your cards with Google or Email');
    });

    it('WalletBackupModal renders backup trigger and privacy consent linking to /privacy in card and modal', () => {
      const html = renderToStaticMarkup(
        React.createElement(WalletBackupModal, {
          customerId: 'cust-anon-1',
          isAnonymous: true,
          email: null,
          totalCards: 3,
          isOpen: true,
        }),
      );

      // Prompt headline
      expect(html).toContain('Back up all your cards with Google or Email');
      // Privacy consent link to RA 10173 policy
      expect(html).toContain(`href="${ROUTES.privacy}"`);
      // Consent checkbox rendered inside modal as well
      expect(html).toContain('id="wallet-backup-modal-consent"');
    });

    it('WalletPage renders protected backup status for authenticated customer', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: 'cust-authed-1',
        is_anonymous: false,
        email: 'authed.customer@example.com',
      } as User);

      tableData.customer_cards = [
        {
          tenant_id: 'shop-1',
          added_at: '2026-10-01T00:00:00Z',
          tenants: {
            id: 'shop-1',
            slug: 'shop-1',
            name: 'Shop 1',
            status: 'active',
            tenant_settings: { reward_threshold: 10, reward_label: 'Coffee', brand: {} },
          },
        },
      ];
      tableData.card_balances = [
        { tenant_id: 'shop-1', total_stamps: 3, available_stamps: 3, last_stamped_at: null },
      ];

      const html = renderToStaticMarkup(
        await WalletPage({ searchParams: Promise.resolve({}) }),
      );

      expect(html).toContain('WALLET BACKED UP • PROTECTED');
      expect(html).toContain('Linked to authed.customer@example.com');
    });

    it('anonymous customer with 3 shop cards connects Google/email at wallet level and preserves all 3 cards in /wallet', async () => {
      // Step 1: Anonymous customer with 3 cards in wallet
      const anonUserId = 'cust-anon-3cards';
      const targetUserId = 'cust-google-authed';

      const shopCards = [
        {
          tenant_id: 'shop-a',
          added_at: '2026-10-01T00:00:00Z',
          tenants: {
            id: 'shop-a',
            slug: 'shop-a',
            name: 'Shop A',
            status: 'active',
            tenant_settings: { reward_threshold: 10, reward_label: 'Free Coffee', brand: {} },
          },
        },
        {
          tenant_id: 'shop-b',
          added_at: '2026-10-02T00:00:00Z',
          tenants: {
            id: 'shop-b',
            slug: 'shop-b',
            name: 'Shop B',
            status: 'active',
            tenant_settings: { reward_threshold: 8, reward_label: 'Free Pastry', brand: {} },
          },
        },
        {
          tenant_id: 'shop-c',
          added_at: '2026-10-03T00:00:00Z',
          tenants: {
            id: 'shop-c',
            slug: 'shop-c',
            name: 'Shop C',
            status: 'active',
            tenant_settings: { reward_threshold: 10, reward_label: 'Free Matcha', brand: {} },
          },
        },
      ];

      tableData.customer_cards = shopCards;
      tableData.card_balances = [
        { tenant_id: 'shop-a', total_stamps: 4, available_stamps: 4, last_stamped_at: null },
        { tenant_id: 'shop-b', total_stamps: 6, available_stamps: 6, last_stamped_at: null },
        { tenant_id: 'shop-c', total_stamps: 2, available_stamps: 2, last_stamped_at: null },
      ];

      // Anonymous view
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: anonUserId,
        is_anonymous: true,
      } as User);

      const anonHtml = renderToStaticMarkup(
        await WalletPage({ searchParams: Promise.resolve({}) }),
      );
      expect(anonHtml).toContain('Back up all your cards with Google or Email');
      expect(anonHtml).toContain('Shop A');
      expect(anonHtml).toContain('Shop B');
      expect(anonHtml).toContain('Shop C');

      // Step 2: After authenticating to Google/Email, customer visits /wallet as backed-up user
      vi.mocked(getVerifiedUser).mockResolvedValue({
        id: targetUserId,
        email: 'customer@gmail.com',
        is_anonymous: false,
      } as User);

      const authedHtml = renderToStaticMarkup(
        await WalletPage({ searchParams: Promise.resolve({}) }),
      );
      // All 3 cards remain present in the wallet
      expect(authedHtml).toContain('Shop A');
      expect(authedHtml).toContain('Shop B');
      expect(authedHtml).toContain('Shop C');
      expect(authedHtml).toContain('Cards collected: 3');
      // No longer prompts for anonymous backup
      expect(authedHtml).not.toContain('Back up all your cards with Google or Email');
    });
  });
});
