import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { TenantContext } from '@/lib/contracts';

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
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

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
}));

import { GET } from '@/app/t/[tagId]/route';
import { POST as CLAIM } from '@/app/api/claim/route';
import { POST as ADD_CARD } from '@/app/api/cards/route';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getTenantBySlug } from '@/lib/tenants/context';

const TAG = 'tcp_tag_demo_9x8k2m4p7q1w';

const customer: User = {
  id: '11111111-1111-1111-1111-111111111111',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: new Date().toISOString(),
  is_anonymous: true,
};

const beanThere: TenantContext = {
  id: '22222222-2222-2222-2222-222222222222',
  slug: 'bean-there',
  name: 'Bean There',
  status: 'active',
  settings: {
    cooldownMinutes: 30,
    dailyCap: 2,
    rewardThreshold: 10,
    tagThrottleSeconds: 5,
    timezone: 'Asia/Manila',
    currency: 'PHP',
    rewardLabel: 'Free coffee',
    brand: {},
    perks: {},
  },
};

const rpc = vi.fn();

function tapRequest(tag = TAG): [NextRequest, { params: Promise<{ tagId: string }> }] {
  return [new NextRequest(`http://localhost:3000/t/${tag}`), { params: Promise.resolve({ tagId: tag }) }];
}

function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
  vi.mocked(getVerifiedUser).mockResolvedValue(customer);
  vi.mocked(getTenantBySlug).mockResolvedValue(beanThere);
  vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetMs: 60_000,
  });
});

describe('GET /t/[tagId] (tenant-aware)', () => {
  it('tap_no_card_redirects_to_add_card', async () => {
    rpc.mockResolvedValueOnce({ data: { result: 'no-card', tenant_slug: 'bean-there' }, error: null });

    const response = await GET(...tapRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`http://localhost:3000/s/bean-there?t=${TAG}`);
    expect(rpc).toHaveBeenCalledWith('stamp_card_nfc', { p_customer: customer.id, p_tag: TAG });
  });

  it('tap_stamped_redirects_to_shop_with_result', async () => {
    rpc.mockResolvedValueOnce({ data: { result: 'stamped', tenant_slug: 'bean-there' }, error: null });

    const response = await GET(...tapRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3000/s/bean-there?r=stamped');
  });

  it.each(['cooldown', 'daily-limit', 'tag-throttled', 'tenant-unavailable'])(
    'maps %s to the shop page',
    async (result) => {
      rpc.mockResolvedValueOnce({ data: { result, tenant_slug: 'bean-there' }, error: null });

      const response = await GET(...tapRequest());

      expect(response.headers.get('location')).toBe(
        `http://localhost:3000/s/bean-there?r=${result}`,
      );
    },
  );

  it('tap_invalid_tag_redirects_to_card', async () => {
    rpc.mockResolvedValueOnce({ data: { result: 'invalid-tag', tenant_slug: null }, error: null });

    const response = await GET(...tapRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost:3000/card?r=invalid-tag');
  });

  it('redirects to the card invalid-tag page on an RPC error or malformed payload', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const first = await GET(...tapRequest());
    expect(first.headers.get('location')).toBe('http://localhost:3000/card?r=invalid-tag');

    rpc.mockResolvedValueOnce({ data: { result: 'stamped', tenant_slug: null }, error: null });
    const second = await GET(...tapRequest());
    expect(second.headers.get('location')).toBe('http://localhost:3000/card?r=invalid-tag');
  });

  it('sends signed-out visitors to /start with the tag and never touches the database', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

    const response = await GET(...tapRequest());

    expect(response.headers.get('location')).toBe(`http://localhost:3000/start?t=${TAG}`);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/claim (tenant-aware)', () => {
  it('claim_returns_shop_redirect', async () => {
    rpc.mockResolvedValueOnce({ data: { result: 'stamped', tenant_slug: 'bean-there' }, error: null });

    const response = await CLAIM(jsonPost('http://localhost:3000/api/claim', { tagId: TAG }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      data: { result: 'stamped', redirectTo: '/s/bean-there?r=stamped' },
    });
    expect(rpc).toHaveBeenCalledWith('stamp_card_nfc', { p_customer: customer.id, p_tag: TAG });
  });

  it('sends first-time customers to the add-card page', async () => {
    rpc.mockResolvedValueOnce({ data: { result: 'no-card', tenant_slug: 'bean-there' }, error: null });

    const response = await CLAIM(jsonPost('http://localhost:3000/api/claim', { tagId: TAG }));
    const json = await response.json();

    expect(json.data).toEqual({
      result: 'no-card',
      redirectTo: `/s/bean-there?t=${TAG}`,
    });
  });

  it('maps invalid-tag to the card page', async () => {
    rpc.mockResolvedValueOnce({ data: { result: 'invalid-tag', tenant_slug: null }, error: null });

    const response = await CLAIM(jsonPost('http://localhost:3000/api/claim', { tagId: TAG }));
    const json = await response.json();

    expect(json.data).toEqual({ result: 'invalid-tag', redirectTo: '/card?r=invalid-tag' });
  });
});

describe('POST /api/cards', () => {
  const url = 'http://localhost:3000/api/cards';

  it('add_card_then_stamps', async () => {
    rpc
      .mockResolvedValueOnce({ data: 'added', error: null })
      .mockResolvedValueOnce({ data: { result: 'stamped', tenant_slug: 'bean-there' }, error: null });

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there', tagId: TAG }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      data: { result: 'added', stampResult: 'stamped', redirectTo: '/s/bean-there?r=stamped' },
    });
    expect(rpc).toHaveBeenNthCalledWith(1, 'add_card', {
      p_customer: customer.id,
      p_tenant: beanThere.id,
      p_consent_version: 'v1',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'stamp_card_nfc', {
      p_customer: customer.id,
      p_tag: TAG,
    });
  });

  it('adds a card without a tag and lands on the shop page', async () => {
    rpc.mockResolvedValueOnce({ data: 'already-added', error: null });

    const response = await ADD_CARD(
      jsonPost(url, { tenantSlug: 'bean-there', consentVersion: 'v2' }),
    );
    const json = await response.json();

    expect(json).toEqual({
      ok: true,
      data: { result: 'already-added', redirectTo: '/s/bean-there' },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('add_card', {
      p_customer: customer.id,
      p_tenant: beanThere.id,
      p_consent_version: 'v2',
    });
  });

  it('redirects to the shop without stamping when the tenant is unavailable', async () => {
    rpc.mockResolvedValueOnce({ data: 'tenant-unavailable', error: null });

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there', tagId: TAG }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual({ result: 'tenant-unavailable', redirectTo: '/s/bean-there' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('reports a cross-tenant tag result but redirects to this shop without a result param', async () => {
    rpc
      .mockResolvedValueOnce({ data: 'added', error: null })
      .mockResolvedValueOnce({ data: { result: 'no-card', tenant_slug: 'other-shop' }, error: null });

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there', tagId: TAG }));
    const json = await response.json();

    expect(json.data).toEqual({
      result: 'added',
      stampResult: 'no-card',
      redirectTo: '/s/bean-there',
    });
  });

  it('does not show another shop stamped result on this shop page', async () => {
    rpc
      .mockResolvedValueOnce({ data: 'already-added', error: null })
      .mockResolvedValueOnce({ data: { result: 'stamped', tenant_slug: 'other-shop' }, error: null });

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there', tagId: TAG }));
    const json = await response.json();

    expect(json.data).toEqual({
      result: 'already-added',
      stampResult: 'stamped',
      redirectTo: '/s/bean-there',
    });
  });

  it('add_card_unknown_slug_404', async () => {
    vi.mocked(getTenantBySlug).mockResolvedValueOnce(null);

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'no-such-shop' }));
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('invalid_input');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('add_card_requires_session', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there' }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('unauthenticated');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('add_card_csrf_blocked', async () => {
    const response = await ADD_CARD(
      jsonPost(url, { tenantSlug: 'bean-there' }, { origin: 'https://evil.example' }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('forbidden');
    expect(getVerifiedUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'x' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_input');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('applies the cards rate limit', async () => {
    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetMs: 1000,
    });

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there' }));

    expect(response.status).toBe(429);
    expect(checkPublicEndpointRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'cards', customerId: customer.id }),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns internal_error when add_card fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const response = await ADD_CARD(jsonPost(url, { tenantSlug: 'bean-there' }));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('internal_error');
  });
});
