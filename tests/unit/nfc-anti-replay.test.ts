import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
import { verifyTap } from '@/lib/nfc/verifyTap';
import { scrubUrlSearchParams } from '@/lib/nfc/scrubUrl';
import { GET } from '@/app/t/[tagId]/route';
import { POST as claimPost } from '@/app/api/claim/route';
import { POST as cardsPost } from '@/app/api/cards/route';
import { resetMemoryRateLimitStore } from '@/lib/security/ratelimit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getVerifiedUser } from '@/lib/supabase/server';
import { getTenantBySlug } from '@/lib/tenants/context';
import type { User } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock('@/lib/tenants/context', () => ({
  getTenantBySlug: vi.fn(),
}));

describe('NFC Anti-Replay & Mirror Parsing Test Suite', () => {
  const mockAdminRpc = vi.fn();
  const mockAdminClient = {
    rpc: mockAdminRpc,
  };

  const authenticatedCustomer: User = {
    id: '11111111-1111-1111-1111-111111111111',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    is_anonymous: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetMemoryRateLimitStore();

    mockAdminRpc.mockResolvedValue({
      data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
      error: null,
    });
    vi.mocked(createSupabaseAdminClient).mockReturnValue(mockAdminClient as any);
  });

  describe('1. verifyTap NTAG215 Mirror Parsing', () => {
    it('handles static tag without query params (static mode)', () => {
      const res = verifyTap({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' });
      expect(res).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
      });
    });

    it('parses valid 6-hex-digit counter mirror (?c=000013 -> decimal 19)', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { c: '000013' },
      });
      expect(res).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
        tapCounter: 19,
      });
    });

    it('parses counter mirror with hex A-F (?c=00001F -> decimal 31)', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { c: '00001F' },
      });
      expect(res).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
        tapCounter: 31,
      });
    });

    it('parses combined UID + Counter mirror (?m=04930D01590F13x000013)', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { m: '04930D01590F13x000013' },
      });
      expect(res).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
        tapCounter: 19,
        hardwareUid: '04930D01590F13',
      });
    });

    it('normalizes lowercase UID in mirror to uppercase', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { m: '04930d01590f13X000014' },
      });
      expect(res).toEqual({
        valid: true,
        normalizedTagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        mode: 'ntag215-static',
        tapCounter: 20,
        hardwareUid: '04930D01590F13',
      });
    });

    it('rejects malformed counter mirror (?c=xyz)', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { c: 'xyz' },
      });
      expect(res).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });

    it('rejects malformed counter mirror of wrong length (?c=00013)', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { c: '00013' },
      });
      expect(res).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });

    it('rejects malformed combined mirror with invalid delimiter (?m=04930D01590F13y000013)', () => {
      const res = verifyTap({
        tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
        query: { m: '04930D01590F13y000013' },
      });
      expect(res).toEqual({
        valid: false,
        reason: 'malformed-tag-id',
      });
    });
  });

  describe('2. HTTP Redirect Hardening & Header Verification (/t/[tagId])', () => {
    it('sets Cache-Control: no-store and Referrer-Policy: no-referrer on 303 redirects', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('forwards ?c= mirror query param across redirect to /start when unauthenticated', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w?c=000013');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      const loc = response.headers.get('location');
      expect(loc).toBe('http://localhost:3000/start?t=tcp_tag_demo_9x8k2m4p7q1w&c=000013');
    });

    it('forwards ?m= mirror query param across redirect to /start when unauthenticated', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(null);

      const request = new NextRequest(
        'http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w?m=04930D01590F13x000013',
      );
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      const loc = response.headers.get('location');
      expect(loc).toBe(
        'http://localhost:3000/start?t=tcp_tag_demo_9x8k2m4p7q1w&m=04930D01590F13x000013',
      );
    });

    it('forwards ?c= across redirect to /s/[slug] when authenticated customer has no card (no-card)', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: { result: 'no-card', tenant_slug: 'the-caffeine-plug' },
        error: null,
      });

      const request = new NextRequest('http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w?c=000013');
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      const loc = response.headers.get('location');
      expect(loc).toBe('http://localhost:3000/s/the-caffeine-plug?t=tcp_tag_demo_9x8k2m4p7q1w&c=000013');
    });

    it('passes tapCounter and hardwareUid to stamp_card_nfc when stamping immediately', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
        error: null,
      });

      const request = new NextRequest(
        'http://localhost:3000/t/tcp_tag_demo_9x8k2m4p7q1w?m=04930D01590F13x000013',
      );
      const response = await GET(request, {
        params: Promise.resolve({ tagId: 'tcp_tag_demo_9x8k2m4p7q1w' }),
      });

      expect(response.status).toBe(303);
      expect(mockAdminRpc).toHaveBeenCalledWith('stamp_card_nfc', {
        p_customer: authenticatedCustomer.id,
        p_tag: 'tcp_tag_demo_9x8k2m4p7q1w',
        p_tap_counter: 19,
        p_hardware_uid: '04930D01590F13',
      });
    });
  });

  describe('3. Browser History Scrubbing Helper', () => {
    it('removes t, c, and m from window.location via window.history.replaceState', () => {
      const replaceStateMock = vi.fn();
      const mockLocation = {
        href: 'http://localhost:3000/start?t=mytag&c=000013&other=kept',
        pathname: '/start',
        search: '?t=mytag&c=000013&other=kept',
        hash: '',
      };

      vi.stubGlobal('window', {
        location: mockLocation,
        history: { replaceState: replaceStateMock },
      });

      scrubUrlSearchParams(['t', 'c', 'm']);

      expect(replaceStateMock).toHaveBeenCalledWith(null, '', '/start?other=kept');
      vi.unstubAllGlobals();
    });
  });

  describe('4. API Routes Mirror Forwarding (/api/claim & /api/cards)', () => {
    it('/api/claim forwards tapCounter and hardwareUid to stamp_card_nfc', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      mockAdminRpc.mockResolvedValueOnce({
        data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
        error: null,
      });

      const request = new Request('http://localhost:3000/api/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
          m: '04930D01590F13x000014',
        }),
      });

      const res = await claimPost(request);
      expect(res.status).toBe(200);
      expect(mockAdminRpc).toHaveBeenCalledWith('stamp_card_nfc', {
        p_customer: authenticatedCustomer.id,
        p_tag: 'tcp_tag_demo_9x8k2m4p7q1w',
        p_tap_counter: 20,
        p_hardware_uid: '04930D01590F13',
      });
    });

    it('/api/cards forwards tapCounter and hardwareUid to stamp_card_nfc when tagId is present', async () => {
      vi.mocked(getVerifiedUser).mockResolvedValueOnce(authenticatedCustomer);
      vi.mocked(getTenantBySlug).mockResolvedValueOnce({
        id: '7c1f0000-0000-4000-8000-000000000001',
        slug: 'the-caffeine-plug',
        name: 'The Caffeine Plug',
        status: 'active',
        settings: {} as any,
      });

      mockAdminRpc.mockImplementation((fn: string) => {
        if (fn === 'add_card') {
          return Promise.resolve({ data: 'added', error: null });
        }
        if (fn === 'stamp_card_nfc') {
          return Promise.resolve({
            data: { result: 'stamped', tenant_slug: 'the-caffeine-plug' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const request = new Request('http://localhost:3000/api/cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          tenantSlug: 'the-caffeine-plug',
          tagId: 'tcp_tag_demo_9x8k2m4p7q1w',
          c: '000014',
        }),
      });

      const res = await cardsPost(request);
      expect(res.status).toBe(200);
      expect(mockAdminRpc).toHaveBeenCalledWith('stamp_card_nfc', {
        p_customer: authenticatedCustomer.id,
        p_tag: 'tcp_tag_demo_9x8k2m4p7q1w',
        p_tap_counter: 20,
      });
    });
  });
});
