import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

vi.mock('server-only', () => ({}));

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { verifyOtp, exchangeCodeForSession },
    from: vi.fn(() => {
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: () => Promise.resolve({ data: [], error: null }),
      };
      return q;
    }),
  })),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => {
    const q: any = {
      select: () => q,
      eq: () => q,
      is: () => q,
      gt: () => Promise.resolve({ data: [], error: null }),
    };
    return { from: () => q, rpc: vi.fn() };
  }),
}));

vi.mock('@/lib/auth/customer', () => ({
  ensureCustomerRecord: vi.fn().mockResolvedValue('id'),
}));

import { GET as authCallbackGet } from '@/app/auth/callback/route';
import { ROUTES } from '@/lib/contracts';
import { getVerifiedUser } from '@/lib/supabase/server';

const STAFF_USER = { id: 'u1', email: 'owner@shop.test', is_anonymous: false } as never;

function callbackRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/auth/callback?${query}`);
}

describe('password recovery: auth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyOtp.mockResolvedValue({ error: null });
  });

  it('sends a verified recovery token to the reset-password screen, not the wallet', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValue(STAFF_USER);
    const res = await authCallbackGet(callbackRequest('token_hash=abc&type=recovery'));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' });
    expect(new URL(res.headers.get('location')!).pathname).toBe(ROUTES.resetPassword);
  });

  it('sends an expired or used recovery token to staff login with an error', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    vi.mocked(getVerifiedUser).mockResolvedValue(null);
    const res = await authCallbackGet(callbackRequest('token_hash=abc&type=recovery'));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe(ROUTES.staff.login);
    expect(location.searchParams.get('error')).toMatch(/invalid or has expired/i);
  });

  it('honours next=/auth/reset-password on the PKCE code flow', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    vi.mocked(getVerifiedUser).mockResolvedValue(STAFF_USER);
    const res = await authCallbackGet(
      callbackRequest(`code=xyz&next=${encodeURIComponent(ROUTES.resetPassword)}`),
    );
    expect(new URL(res.headers.get('location')!).pathname).toBe(ROUTES.resetPassword);
  });
});

describe('password recovery: email template', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('links straight to the callback with a token hash and the reset-password destination', () => {
    const html = read('supabase/templates/recovery.html');
    expect(html).toContain('{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}');
    expect(html).toContain('type=recovery');
    expect(html).toContain(`next=${encodeURIComponent(ROUTES.resetPassword)}`);
    // Must not fall back to the legacy GoTrue verify URL, which lands on the site root.
    expect(html).not.toContain('{{ .ConfirmationURL }}');
  });

  it.each(['magic_link', 'confirmation', 'email_change'])(
    '%s template joins token_hash onto a redirect that already has a query string',
    (name) => {
      const html = read(`supabase/templates/${name}.html`);
      expect(html).toContain('{{ .RedirectTo }}&{{ else }}{{ .SiteURL }}/auth/callback?{{ end }}token_hash=');
      expect(html).not.toContain('{{ end }}?token_hash=');
    },
  );

  it('is registered in supabase/config.toml', () => {
    const toml = read('supabase/config.toml');
    expect(toml).toContain('[auth.email.template.recovery]');
    expect(toml).toContain('./supabase/templates/recovery.html');
  });
});
