import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STAFF_TENANT_COOKIE_NAME } from '@/lib/contracts';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT: ${url}`);
});

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
  notFound: () => mockNotFound(),
  usePathname: () => '/staff/shop-a/settings/brand',
}));

let mockCookieMap = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const val = mockCookieMap.get(name);
      return val !== undefined ? { name, value: val } : undefined;
    },
    getAll: () => Array.from(mockCookieMap.entries()).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      mockCookieMap.set(name, value);
    },
  })),
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

interface QueryState {
  table: string;
  filters: Array<{ type: string; column: string; value: unknown }>;
}

let queryResults: Record<string, { data: unknown; error: unknown }> = {};

function createMockQuery(table: string) {
  const state: QueryState = { table, filters: [] };
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push({ type: 'eq', column, value });
    return query;
  });
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => queryResults[table] ?? { data: null, error: null });
  query.single = vi.fn(async () => queryResults[table] ?? { data: null, error: null });
  query.then = (onResolve: (val: unknown) => unknown, onReject: (err: unknown) => unknown) =>
    Promise.resolve(queryResults[table] ?? { data: null, error: null }).then(onResolve, onReject);

  return query;
}

const mockAdminClient = {
  rpc: vi.fn(),
};

const mockServerClient = {
  from: vi.fn((table: string) => createMockQuery(table)),
  auth: {
    getUser: vi.fn(),
  },
};

let verifiedUserMock: unknown = null;

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(() => Promise.resolve(mockServerClient)),
  getVerifiedUser: vi.fn(() => Promise.resolve(verifiedUserMock)),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => mockAdminClient),
}));

// Modules under test
import { toCsv } from '@/lib/ops/csv';
import { resolveCardTheme, getContrastRatio } from '@/lib/brand/contrast';
import { PATCH as brandPatch } from '@/app/api/staff/[slug]/brand/route';
import { GET as exportGet } from '@/app/api/staff/[slug]/export/route';
import {
  POST as locationsPost,
  PATCH as locationsPatch,
} from '@/app/api/staff/[slug]/locations/route';
import { POST as separatePost } from '@/app/api/staff/[slug]/locations/separate/route';
import { POST as tagsPost } from '@/app/api/staff/[slug]/tags/route';
import {
  SEPARATION_WARNINGS,
  isSeparationConfirmDisabled,
  DEFAULT_FOCUS_ELEMENT,
} from '@/components/console/SeparationModal';
import { groupTagsByBranch } from '@/lib/tags/grouping';

const SHOP_A = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'shop-a',
  name: 'Shop A',
  status: 'active',
};

const SHOP_B = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'shop-b',
  name: 'Shop B',
  status: 'active',
};

function setupStandardUserMemberships() {
  verifiedUserMock = {
    id: 'user-owner-1',
    email: 'owner@shop-a.com',
    is_anonymous: false,
  };

  queryResults['tenant_members'] = {
    data: [
      {
        tenant_id: SHOP_A.id,
        role: 'owner',
        display_name: 'Shop A Owner',
        tenants: SHOP_A,
      },
      {
        tenant_id: SHOP_B.id,
        role: 'manager',
        display_name: 'Shop B Manager',
        tenants: SHOP_B,
      },
    ],
    error: null,
  };
}

describe('Phase 14 Task 7: Branding, Tags Tab, CSV Export, Locations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieMap.clear();
    queryResults = {};
    verifiedUserMock = null;
  });

  // 1. csv_export_neutralizes_formulas (Review Focus 5)
  it('csv_export_neutralizes_formulas', () => {
    const rows = [
      {
        id: 'row-1',
        name: '=SUM(A1:B1)',
        notes: '+CMD|"/C calc"!A0',
        ref: '-12345',
        mention: '@admin',
        tabbed: '\tunsafe',
        cr: '\runsafe',
        safe: 'Regular Text',
      },
      {
        id: 'row-2',
        name: 'Normal, with comma',
        notes: 'Quote "embedded"',
        ref: 42,
        mention: null,
        tabbed: '',
        cr: 'Line\r\nBreak',
        safe: '100%',
      },
    ];

    const columns = ['id', 'name', 'notes', 'ref', 'mention', 'tabbed', 'cr', 'safe'];
    const csv = toCsv(rows, columns);

    // Formula injection characters at the start of cells must have a leading single quote
    expect(csv).toContain("'=SUM(A1:B1)");
    expect(csv).toContain('\'+CMD|""/C calc""!A0');
    expect(csv).toContain("'-12345");
    expect(csv).toContain("'@admin");
    expect(csv).toContain("'\tunsafe");
    expect(csv).toContain("'\runsafe");

    // RFC 4180 quotes escaping: quotes within cells must be doubled ""
    expect(csv).toContain('"Quote ""embedded"""');
    // Cells with comma must be quoted
    expect(csv).toContain('"Normal, with comma"');
    // CRLF line endings
    expect(csv).toContain('\r\n');
  });

  // 2. csv_export_is_slug_member_scoped (Review Focus 5)
  it('csv_export_is_slug_member_scoped', async () => {
    setupStandardUserMemberships();

    // User is NOT a member of 'shop-c'
    const nonMemberReq = new Request('http://localhost:3000/api/staff/shop-c/export?kind=cards');
    const nonMemberRes = await exportGet(nonMemberReq, {
      params: Promise.resolve({ slug: 'shop-c' }),
    });
    expect(nonMemberRes.status).toBe(404);

    // User is manager in shop-b -> export authorized
    queryResults['customer_cards'] = {
      data: [
        {
          customer_id: 'cust-1',
          added_at: '2026-11-01T00:00:00Z',
          total_stamps: 5,
          available_stamps: 3,
        },
      ],
      error: null,
    };
    queryResults['locations'] = {
      data: [{ id: 'loc-1', name: 'Downtown' }],
      error: null,
    };
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'audit-id', error: null });

    const memberReq = new Request('http://localhost:3000/api/staff/shop-b/export?kind=cards');
    const memberRes = await exportGet(memberReq, { params: Promise.resolve({ slug: 'shop-b' }) });
    expect(memberRes.status).toBe(200);
    expect(memberRes.headers.get('Content-Type')).toContain('text/csv');
    expect(memberRes.headers.get('Content-Disposition')).toContain(
      'attachment; filename="shop-b-cards-',
    );
    expect(memberRes.headers.get('Cache-Control')).toContain('no-store');
  });

  // 3. csv_export_omits_email_columns
  it('csv_export_omits_email_columns', async () => {
    setupStandardUserMemberships();

    queryResults['customer_cards'] = {
      data: [
        {
          customer_id: 'cust-1',
          email: 'secret@customer.com', // even if table had email or phone
          phone: '+639171234567',
          added_at: '2026-11-01T00:00:00Z',
          total_stamps: 10,
          available_stamps: 2,
        },
      ],
      error: null,
    };
    queryResults['locations'] = {
      data: [{ id: 'loc-1', name: 'Main Branch' }],
      error: null,
    };
    mockAdminClient.rpc.mockResolvedValue({ data: 'audit-id', error: null });

    const cardsReq = new Request('http://localhost:3000/api/staff/shop-a/export?kind=cards');
    const cardsRes = await exportGet(cardsReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    const cardsCsv = await cardsRes.text();

    const header = (cardsCsv.split('\r\n')[0] ?? '').toLowerCase();
    expect(header).not.toContain('email');
    expect(header).not.toContain('phone');
    expect(cardsCsv).not.toContain('secret@customer.com');
    expect(cardsCsv).not.toContain('+639171234567');

    // Also check stamps export
    queryResults['stamps'] = {
      data: [
        {
          id: 'stamp-1',
          customer_id: 'cust-1',
          created_at: '2026-11-02T10:00:00Z',
          source: 'nfc',
          tag_id: 'tag-1',
          location_id: 'loc-1',
          reason: null,
        },
      ],
      error: null,
    };

    const stampsReq = new Request('http://localhost:3000/api/staff/shop-a/export?kind=stamps');
    const stampsRes = await exportGet(stampsReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    const stampsCsv = await stampsRes.text();
    const stampsHeader = (stampsCsv.split('\r\n')[0] ?? '').toLowerCase();
    expect(stampsHeader).not.toContain('email');
    expect(stampsHeader).not.toContain('phone');
  });

  // 4. brand_route_rejects_svg_and_oversize_metadata
  it('brand_route_rejects_svg_and_oversize_metadata', async () => {
    setupStandardUserMemberships();

    // Reject SVG
    const svgReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        logoUrl:
          'https://example.com/storage/v1/object/public/tenant-brand/11111111-1111-1111-1111-111111111111/logo.svg',
      }),
    });
    const svgRes = await brandPatch(svgReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(svgRes.status).toBe(400);
    const svgBody = await svgRes.json();
    expect(svgBody.ok).toBe(false);
    expect(svgBody.message).toMatch(/SVG/i);

    // Reject tagline > 60 chars
    const taglineReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        tagline: 'This tagline is way too long and exceeds the sixty character limit set by bounds',
      }),
    });
    const taglineRes = await brandPatch(taglineReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(taglineRes.status).toBe(400);

    // Reject foreign host
    const foreignReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        logoUrl: 'https://evil-hacker.com/image.png',
      }),
    });
    const foreignRes = await brandPatch(foreignReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(foreignRes.status).toBe(400);

    // Reject data: or javascript: URLs
    const dataReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...',
      }),
    });
    const dataRes = await brandPatch(dataReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(dataRes.status).toBe(400);

    // Reject invalid hex color
    const colorReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        primaryColor: 'not-a-color',
      }),
    });
    const colorRes = await brandPatch(colorReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(colorRes.status).toBe(400);

    // Accept valid brand patch
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });
    const validReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        primaryColor: '#0A0A0A',
        accentColor: '#E6A15C',
        tagline: 'Best coffee in town',
        logoUrl: '/logos/shop-a.png',
      }),
    });
    const validRes = await brandPatch(validReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(validRes.status).toBe(200);
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);

    // Accept partial brand patch (only primaryColor) without overwriting other fields
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });
    const partialReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        primaryColor: '#123456',
      }),
    });
    const partialRes = await brandPatch(partialReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(partialRes.status).toBe(200);
    expect(mockAdminClient.rpc).toHaveBeenLastCalledWith('update_tenant_brand', {
      p_actor: expect.any(String),
      p_tenant: expect.any(String),
      p_brand: {
        primaryColor: '#123456',
      },
    });

    // Stamp icon: unknown ids rejected, known ids passed through
    const badIconReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ stampIcon: 'rocket-launcher' }),
    });
    const badIconRes = await brandPatch(badIconReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(badIconRes.status).toBe(400);

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });
    const iconReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ stampIcon: 'scissors' }),
    });
    const iconRes = await brandPatch(iconReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(iconRes.status).toBe(200);
    expect(mockAdminClient.rpc).toHaveBeenLastCalledWith('update_tenant_brand', {
      p_actor: expect.any(String),
      p_tenant: expect.any(String),
      p_brand: { stampIcon: 'scissors' },
    });

    // Verify new icons (pickleball, shoe, vape) pass Zod and RPC dispatch
    for (const newIcon of ['pickleball', 'shoe', 'vape'] as const) {
      mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });
      const newIconReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ stampIcon: newIcon }),
      });
      const newIconRes = await brandPatch(newIconReq, {
        params: Promise.resolve({ slug: 'shop-a' }),
      });
      expect(newIconRes.status).toBe(200);
      expect(mockAdminClient.rpc).toHaveBeenLastCalledWith('update_tenant_brand', {
        p_actor: expect.any(String),
        p_tenant: expect.any(String),
        p_brand: { stampIcon: newIcon },
      });
    }

    // Social follow perks & links patch
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });
    const socialPatchReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        socialReward: 'Free pastry with drink',
        socialRewardEnabled: true,
        socialLinks: {
          instagram: { enabled: true, url: '@artisancoffee' },
          facebook: { enabled: true, url: 'artisancoffee' },
          tiktok: { enabled: false, url: '' },
        },
      }),
    });
    const socialPatchRes = await brandPatch(socialPatchReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(socialPatchRes.status).toBe(200);
    expect(mockAdminClient.rpc).toHaveBeenLastCalledWith('update_tenant_brand', {
      p_actor: expect.any(String),
      p_tenant: expect.any(String),
      p_brand: {
        socialReward: 'Free pastry with drink',
        socialRewardEnabled: true,
        socialLinks: {
          instagram: { enabled: true, url: '@artisancoffee' },
          facebook: { enabled: true, url: 'artisancoffee' },
          tiktok: { enabled: false, url: '' },
        },
      },
    });

    // Reject excessively long socialReward (> 80 chars)
    const longRewardReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ socialReward: 'x'.repeat(100) }),
    });
    const longRewardRes = await brandPatch(longRewardReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(longRewardRes.status).toBe(400);

    // Reject empty brand patch
    const emptyReq = new Request('http://localhost:3000/api/staff/shop-a/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({}),
    });
    const emptyRes = await brandPatch(emptyReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(emptyRes.status).toBe(400);
  });

  // 5. brand_preview_flags_failed_contrast
  it('brand_preview_flags_failed_contrast', () => {
    // Failing contrast: black on dark gray (#111111 on #000000)
    const lowContrast = resolveCardTheme({
      primaryColor: '#000000',
      accentColor: '#111111',
    });
    expect(lowContrast.passesAA).toBe(false);
    expect(getContrastRatio(lowContrast.accentColor, lowContrast.primaryColor)).toBeLessThan(4.5);

    // Passing contrast: white on black (#FFFFFF on #0A0A0A)
    const highContrast = resolveCardTheme({
      primaryColor: '#0A0A0A',
      accentColor: '#FFFFFF',
    });
    expect(highContrast.passesAA).toBe(true);
    expect(
      getContrastRatio(highContrast.accentColor, highContrast.primaryColor),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // 6. tags_tab_rotate_uses_generated_id
  it('tags_tab_rotate_uses_generated_id', async () => {
    setupStandardUserMemberships();

    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'rotated', error: null });

    const req = new Request('http://localhost:3000/api/staff/shop-a/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        action: 'rotate',
        oldTagId: 'tcp_tag_old12345678',
        newLabel: 'Rotated Register Tag',
        locationId: '11111111-2222-3333-4444-555555555555',
      }),
    });

    const res = await tagsPost(req, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify rotate_tag_at was called on admin client
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'rotate_tag_at',
      expect.objectContaining({
        p_actor: 'user-owner-1',
        p_tenant: SHOP_A.id,
        p_old_tag_id: 'tcp_tag_old12345678',
        p_new_tag_id: expect.stringMatching(/^tcp_tag_[0-9a-z]{16}$/),
      }),
    );

    // Duplicate collision returns 409 Conflict
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'duplicate', error: null });
    const dupReq = new Request('http://localhost:3000/api/staff/shop-a/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        action: 'rotate',
        oldTagId: 'tcp_tag_old12345678',
        newLabel: 'Rotated Register Tag',
        locationId: '11111111-2222-3333-4444-555555555555',
      }),
    });
    const dupRes = await tagsPost(dupReq, { params: Promise.resolve({ slug: 'shop-a' }) });
    expect(dupRes.status).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.ok).toBe(false);
  });

  // 7. tags_tab_assigns_branch_and_groups_by_it
  it('tags_tab_assigns_branch_and_groups_by_it', async () => {
    setupStandardUserMemberships();

    // Create tag assigning branch
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'created', error: null });

    const branchUuid = '11111111-2222-3333-4444-555555555555';
    const makeCreateReq = () =>
      new Request('http://localhost:3000/api/staff/shop-a/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          action: 'create',
          label: 'Patio Counter',
          locationId: branchUuid,
        }),
      });

    const createRes = await tagsPost(makeCreateReq(), {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(createRes.status).toBe(200);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith(
      'create_tag_at',
      expect.objectContaining({
        p_tenant: SHOP_A.id,
        p_location: branchUuid,
      }),
    );

    // Duplicate creation returns 409 Conflict
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'duplicate', error: null });
    const dupCreateRes = await tagsPost(makeCreateReq(), {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(dupCreateRes.status).toBe(409);

    // Invalid location returns 400 Bad Request
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'invalid-location', error: null });
    const invalidLocRes = await tagsPost(makeCreateReq(), {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(invalidLocRes.status).toBe(400);

    // Test grouping helper
    const testTags = [
      {
        id: 'tag-1',
        label: 'Counter 1',
        active: true,
        created_at: '2026-11-01',
        deactivated_at: null,
        location_id: 'loc-1',
      },
      {
        id: 'tag-2',
        label: 'Drive-Thru',
        active: true,
        created_at: '2026-11-02',
        deactivated_at: null,
        location_id: 'loc-2',
      },
      {
        id: 'tag-3',
        label: 'Counter 2',
        active: true,
        created_at: '2026-11-03',
        deactivated_at: null,
        location_id: 'loc-1',
      },
      {
        id: 'tag-4',
        label: 'Unassigned',
        active: true,
        created_at: '2026-11-04',
        deactivated_at: null,
        location_id: null,
      },
    ];
    const testLocations = [
      { id: 'loc-1', name: 'Downtown Branch' },
      { id: 'loc-2', name: 'Uptown Branch' },
    ];

    const grouped = groupTagsByBranch(testTags as any, testLocations);
    expect(grouped['Downtown Branch']).toHaveLength(2);
    expect(grouped['Uptown Branch']).toHaveLength(1);
    expect(grouped['Unassigned / Brand']).toHaveLength(1);
  });

  // 8. locations_route_owner_only
  it('locations_route_owner_only', async () => {
    setupStandardUserMemberships();

    // User is manager in shop-b -> POST location forbidden
    const managerPostReq = new Request('http://localhost:3000/api/staff/shop-b/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ name: 'Mall Branch' }),
    });
    const managerPostRes = await locationsPost(managerPostReq, {
      params: Promise.resolve({ slug: 'shop-b' }),
    });
    expect(managerPostRes.status).toBe(403);

    // User is manager in shop-b -> PATCH location forbidden
    const managerPatchReq = new Request('http://localhost:3000/api/staff/shop-b/locations', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ locationId: 'loc-1', name: 'Mall Branch Renamed' }),
    });
    const managerPatchRes = await locationsPatch(managerPatchReq, {
      params: Promise.resolve({ slug: 'shop-b' }),
    });
    expect(managerPatchRes.status).toBe(403);

    const validLocUuid = '11111111-2222-3333-4444-555555555555';
    // User is owner in shop-a -> POST location succeeds
    mockAdminClient.rpc.mockResolvedValueOnce({
      data: { result: 'created', locationId: validLocUuid },
      error: null,
    });
    const ownerPostReq = new Request('http://localhost:3000/api/staff/shop-a/locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ name: 'New Uptown Branch', address: '123 Main St' }),
    });
    const ownerPostRes = await locationsPost(ownerPostReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(ownerPostRes.status).toBe(200);
    const ownerPostBody = await ownerPostRes.json();
    expect(ownerPostBody.ok).toBe(true);

    // User is owner in shop-a -> PATCH location succeeds
    mockAdminClient.rpc.mockResolvedValueOnce({ data: 'updated', error: null });
    const ownerPatchReq = new Request('http://localhost:3000/api/staff/shop-a/locations', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ locationId: validLocUuid, name: 'Updated Branch Name', active: true }),
    });
    const ownerPatchRes = await locationsPatch(ownerPatchReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(ownerPatchRes.status).toBe(200);
  });

  // 9. card_mode_toggle_requires_confirmation_and_slug
  it('card_mode_toggle_requires_confirmation_and_slug', async () => {
    setupStandardUserMemberships();

    // Missing confirmation name
    const missingNameReq = new Request(
      'http://localhost:3000/api/staff/shop-a/locations/separate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          locationId: 'loc-1',
          childSlug: 'shop-a-mall',
        }),
      },
    );
    const missingNameRes = await separatePost(missingNameReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(missingNameRes.status).toBe(400);

    // Missing slug
    const missingSlugReq = new Request(
      'http://localhost:3000/api/staff/shop-a/locations/separate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          locationId: 'loc-1',
          confirmName: 'Mall Branch',
        }),
      },
    );
    const missingSlugRes = await separatePost(missingSlugReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(missingSlugRes.status).toBe(400);

    // Invalid slug format (uppercase, spaces)
    const invalidSlugReq = new Request(
      'http://localhost:3000/api/staff/shop-a/locations/separate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({
          locationId: 'loc-1',
          confirmName: 'Mall Branch',
          childSlug: 'Shop A Mall!',
        }),
      },
    );
    const invalidSlugRes = await separatePost(invalidSlugReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(invalidSlugRes.status).toBe(400);
  });

  // 10. separation_dialog_lists_all_seven_warnings
  it('separation_dialog_lists_all_seven_warnings', () => {
    // Verify all 7 warnings exist in uncollapsed configuration
    expect(SEPARATION_WARNINGS).toHaveLength(7);

    const keys = SEPARATION_WARNINGS.map((w) => w.id);
    expect(keys).toContain('one-way');
    expect(keys).toContain('not-retroactive');
    expect(keys).toContain('two-cards');
    expect(keys).toContain('independent-rules');
    expect(keys).toContain('staff-copied-once');
    expect(keys).toContain('tags-change-shop');
    expect(keys).toContain('separate-billing');

    // Each warning has non-empty title and description
    for (const warning of SEPARATION_WARNINGS) {
      expect(warning.title.length).toBeGreaterThan(5);
      expect(warning.description.length).toBeGreaterThan(15);
    }
  });

  // 11. separation_confirm_disabled_until_name_slug_checkbox_and_preview
  it('separation_confirm_disabled_until_name_slug_checkbox_and_preview', () => {
    const branchName = 'Mall Branch';

    // (a) Name mismatch -> disabled
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: 'Wrong Name',
        childSlug: 'mall-branch',
        agreedCheckbox: true,
        previewLoaded: true,
        previewError: null,
        secondsRemaining: 0,
      }),
    ).toBe(true);

    // (b) Empty or invalid slug -> disabled
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: branchName,
        childSlug: '',
        agreedCheckbox: true,
        previewLoaded: true,
        previewError: null,
        secondsRemaining: 0,
      }),
    ).toBe(true);

    // (c) Checkbox not ticked -> disabled
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: branchName,
        childSlug: 'mall-branch',
        agreedCheckbox: false,
        previewLoaded: true,
        previewError: null,
        secondsRemaining: 0,
      }),
    ).toBe(true);

    // (d) Preview not loaded or errored -> disabled
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: branchName,
        childSlug: 'mall-branch',
        agreedCheckbox: true,
        previewLoaded: false,
        previewError: null,
        secondsRemaining: 0,
      }),
    ).toBe(true);
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: branchName,
        childSlug: 'mall-branch',
        agreedCheckbox: true,
        previewLoaded: true,
        previewError: 'Failed to load preview',
        secondsRemaining: 0,
      }),
    ).toBe(true);

    // (e) 5-second delay not elapsed -> disabled
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: branchName,
        childSlug: 'mall-branch',
        agreedCheckbox: true,
        previewLoaded: true,
        previewError: null,
        secondsRemaining: 3,
      }),
    ).toBe(true);

    // All requirements satisfied -> ENABLED
    expect(
      isSeparationConfirmDisabled({
        branchName,
        typedName: branchName,
        childSlug: 'mall-branch',
        agreedCheckbox: true,
        previewLoaded: true,
        previewError: null,
        secondsRemaining: 0,
      }),
    ).toBe(false);
  });

  // 12. separation_route_rejects_name_mismatch
  it('separation_route_rejects_name_mismatch', async () => {
    setupStandardUserMemberships();

    // RPC returns confirmation-mismatch when confirmName does not match
    mockAdminClient.rpc.mockResolvedValueOnce({
      data: { result: 'confirmation-mismatch' },
      error: null,
    });

    const mismatchReq = new Request('http://localhost:3000/api/staff/shop-a/locations/separate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        locationId: 'loc-1',
        confirmName: 'Downtown Branch Typo',
        childSlug: 'shop-a-downtown',
      }),
    });

    const mismatchRes = await separatePost(mismatchReq, {
      params: Promise.resolve({ slug: 'shop-a' }),
    });
    expect(mismatchRes.status).toBe(400);
    const body = await mismatchRes.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_input');
  });

  // 13. separation_dialog_defaults_focus_to_cancel
  it('separation_dialog_defaults_focus_to_cancel', () => {
    // Separation modal component options specify autoFocus on the cancel button
    expect(DEFAULT_FOCUS_ELEMENT).toBe('cancel');
  });

  // 14. export_includes_branch_column
  it('export_includes_branch_column', async () => {
    setupStandardUserMemberships();

    queryResults['customer_cards'] = {
      data: [
        {
          customer_id: 'cust-1',
          added_at: '2026-11-01T00:00:00Z',
          total_stamps: 4,
          available_stamps: 4,
        },
      ],
      error: null,
    };
    queryResults['locations'] = {
      data: [{ id: 'loc-1', name: 'Downtown' }],
      error: null,
    };
    mockAdminClient.rpc.mockResolvedValue({ data: 'audit-id', error: null });

    const cardsRes = await exportGet(
      new Request('http://localhost:3000/api/staff/shop-a/export?kind=cards'),
      { params: Promise.resolve({ slug: 'shop-a' }) },
    );
    const cardsCsv = await cardsRes.text();
    const cardsHeader = (cardsCsv.split('\r\n')[0] ?? '').split(',');
    expect(cardsHeader).toContain('branch');

    queryResults['stamps'] = {
      data: [
        {
          id: 'stamp-1',
          customer_id: 'cust-1',
          created_at: '2026-11-01T12:00:00Z',
          source: 'nfc',
          tag_id: 'tag-1',
          location_id: 'loc-1',
          reason: null,
        },
      ],
      error: null,
    };

    const stampsRes = await exportGet(
      new Request('http://localhost:3000/api/staff/shop-a/export?kind=stamps'),
      { params: Promise.resolve({ slug: 'shop-a' }) },
    );
    const stampsCsv = await stampsRes.text();
    const stampsHeader = (stampsCsv.split('\r\n')[0] ?? '').split(',');
    expect(stampsHeader).toContain('branch');
    expect(stampsCsv).toContain('Downtown');
  });
});
