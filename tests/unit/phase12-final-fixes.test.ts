import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@/lib/contracts';

(globalThis as any).React = React;

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
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

const mockAdminClient = { rpc: vi.fn() };

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

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: vi.fn(),
}));

import { DELETE as deleteCard } from '@/app/api/cards/route';
import { signInStaffWithPassword, signInWithEmailLink } from '@/lib/auth/captchaSignIn';
import { BackupCardPanel } from '@/components/card/BackupCardPanel';
import { DeleteCardButton } from '@/components/card/DeleteCardButton';
import { StaffLoginForm } from '@/components/staff/StaffLoginForm';
import { checkPublicEndpointRateLimit } from '@/lib/security/ratelimit';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getTenantBySlug } from '@/lib/tenants/context';
import type { User } from '@supabase/supabase-js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_B_ID = '7c1f0000-0000-4000-8000-00000000000b';

describe('C-1: Turnstile token on password and OTP sign-in', () => {
  function fakeSupabase() {
    return {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    };
  }

  it('passes captchaToken to signInWithPassword', async () => {
    const supabase = fakeSupabase();
    await signInStaffWithPassword(supabase as never, {
      email: 'a@b.co',
      password: 'pw',
      captchaToken: 'tok-1',
    });
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'pw',
      options: { captchaToken: 'tok-1' },
    });
  });

  it('passes captchaToken (and the redirect) to signInWithOtp', async () => {
    const supabase = fakeSupabase();
    await signInWithEmailLink(supabase as never, {
      email: 'a@b.co',
      emailRedirectTo: 'http://localhost:3000/staff',
      captchaToken: 'tok-2',
    });
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.co',
      options: { emailRedirectTo: 'http://localhost:3000/staff', captchaToken: 'tok-2' },
    });
  });

  it('staff login submit is disabled until a token exists and renders the widget', () => {
    const html = renderToStaticMarkup(React.createElement(StaffLoginForm, {}));
    expect(html).toContain('data-testid="turnstile-container"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it('backup path (updateUser) is not captcha-gated, so no widget in backup mode', () => {
    // Only the recover (signInWithOtp) path needs a token; it is client state and not in static markup.
    const html = renderToStaticMarkup(
      React.createElement(BackupCardPanel, {
        customerId: USER_ID,
        isAnonymous: true,
        availableStamps: 0,
      }),
    );
    expect(html).toContain('SEND BACKUP LINK');
    expect(html).not.toContain('data-testid="turnstile-container"');
  });
});

describe('I-2: per-shop card removal', () => {
  function req(body: unknown, init: RequestInit = {}) {
    return new Request('http://localhost:3000/api/cards', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVerifiedUser).mockResolvedValue({ id: USER_ID } as User);
    vi.mocked(getTenantBySlug).mockResolvedValue({
      id: TENANT_B_ID,
      slug: 'bean-there',
      name: 'Bean There',
    } as never);
    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValue({
      allowed: true,
      limit: 30,
      remaining: 29,
      resetMs: 60_000,
    } as never);
    mockAdminClient.rpc.mockResolvedValue({ data: true, error: null });
  });

  it('delete_card_removes_only_that_shop_and_redirects_to_wallet', async () => {
    const res = await deleteCard(req({ tenantSlug: 'bean-there' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, data: { removed: true, redirectTo: ROUTES.wallet } });
    expect(mockAdminClient.rpc).toHaveBeenCalledTimes(1);
    expect(mockAdminClient.rpc).toHaveBeenCalledWith('remove_card', {
      p_customer: USER_ID,
      p_tenant: TENANT_B_ID,
    });
    expect(mockAdminClient.rpc).not.toHaveBeenCalledWith('delete_wallet', expect.anything());
    expect(checkPublicEndpointRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'cards', customerId: USER_ID }),
    );
  });

  it('delete_card_rejects_cross_origin_unauthenticated_unknown_shop', async () => {
    const cross = await deleteCard(
      req({ tenantSlug: 'bean-there' }, { headers: { 'sec-fetch-site': 'cross-site' } }),
    );
    expect(cross.status).toBe(403);

    vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);
    const anon = await deleteCard(req({ tenantSlug: 'bean-there' }));
    expect(anon.status).toBe(401);

    vi.mocked(getTenantBySlug).mockResolvedValueOnce(null);
    const unknown = await deleteCard(req({ tenantSlug: 'nope-shop' }));
    expect(unknown.status).toBe(404);

    const bad = await deleteCard(req('not json'));
    expect(bad.status).toBe(400);
    expect(mockAdminClient.rpc).not.toHaveBeenCalled();
  });

  it('delete_card_rate_limited_and_rpc_error', async () => {
    vi.mocked(checkPublicEndpointRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    expect((await deleteCard(req({ tenantSlug: 'bean-there' }))).status).toBe(429);

    mockAdminClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect((await deleteCard(req({ tenantSlug: 'bean-there' }))).status).toBe(500);
  });

  it('shop-scope button says it only removes that shop card', () => {
    const html = renderToStaticMarkup(
      React.createElement(DeleteCardButton, {
        variant: 'compact',
        scope: 'card',
        tenantSlug: 'bean-there',
        tenantName: 'Bean There',
      }),
    );
    expect(html).toContain('Remove this card');
    expect(html).toContain('Removes your Bean There card and its stamps. Your other cards stay.');
    expect(html).not.toMatch(/delete my wallet/i);
  });

  it('wallet-scope button says it erases every card', () => {
    const html = renderToStaticMarkup(
      React.createElement(DeleteCardButton, { variant: 'compact', scope: 'wallet' }),
    );
    expect(html).toContain('Delete my wallet &amp; data');
    expect(html).toMatch(/Erases every card/);
    expect(html).not.toContain('Remove this card');
  });
});
