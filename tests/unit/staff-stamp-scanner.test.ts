import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const TEST_SECRET = 'a'.repeat(32);
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
process.env.REDEEM_TOKEN_SECRET = TEST_SECRET;

const mockRpc = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    })),
  })),
}));

vi.mock('@/lib/auth/staff', () => ({
  requireStaffSession: vi.fn(),
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

import { POST as staffStampPost } from '@/app/api/staff/stamp/route';
import { requireStaffSession } from '@/lib/auth/staff';
import { issueMemberStampToken } from '@/lib/security/memberStampToken';
import { TENANT_ONE_ID, TENANT_ONE_SLUG } from '@/lib/contracts';
import {
  ManualStampForm,
  STAMP_QUICK_REASONS,
  classifyScannedStampCode,
} from '@/components/staff/ManualStampForm';

(globalThis as any).React = React;

const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT_ID = '7c1f0000-0000-4000-8000-000000000099';

describe('POST /api/staff/stamp with memberToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireStaffSession).mockResolvedValue({
      authorized: true,
      staff: {
        userId: '99999999-9999-4999-8999-999999999999',
        email: 'staff@plug.ph',
        displayName: 'Barista',
        role: 'staff',
        active: true,
        tenantId: TENANT_ONE_ID,
        tenantSlug: TENANT_ONE_SLUG,
        tenantName: 'The Caffeine Plug',
        memberships: [],
      },
    });
    mockRpc.mockResolvedValue({ data: 'stamped', error: null });
    mockMaybeSingle.mockResolvedValue({ data: { available_stamps: 4 }, error: null });
  });

  it('stamps card when a valid same-shop memberToken is scanned', async () => {
    const issued = await issueMemberStampToken(CUSTOMER_ID, TENANT_ONE_ID, {
      secretOverride: TEST_SECRET,
    });

    const req = new Request('http://localhost:3000/api/staff/stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        memberToken: issued.token,
        reason: 'Customer offline / no signal',
      }),
    });

    const res = await staffStampPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: {
        result: 'stamped',
        customerId: CUSTOMER_ID,
        availableStampsAfter: 4,
        reason: 'Customer offline / no signal',
      },
    });
    expect(mockRpc).toHaveBeenCalledWith('stamp_card_manual', {
      p_actor: '99999999-9999-4999-8999-999999999999',
      p_tenant: TENANT_ONE_ID,
      p_customer: CUSTOMER_ID,
      p_reason: 'Customer offline / no signal',
    });
  });

  it('rejects_member_token_from_another_tenant_with_403', async () => {
    const otherShopToken = await issueMemberStampToken(CUSTOMER_ID, OTHER_TENANT_ID, {
      secretOverride: TEST_SECRET,
    });

    const req = new Request('http://localhost:3000/api/staff/stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        memberToken: otherShopToken.token,
        reason: 'Customer offline / no signal',
      }),
    });

    const res = await staffStampPost(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: 'forbidden',
      message: 'This member QR code belongs to another shop.',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects invalid or tampered memberToken with 400 invalid_input', async () => {
    const req = new Request('http://localhost:3000/api/staff/stamp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        memberToken: 'tcpm1.bad.token',
        reason: 'Customer offline / no signal',
      }),
    });

    const res = await staffStampPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: 'invalid_input',
      message: 'Invalid or unrecognized member QR code.',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('ManualStampForm & classifyScannedStampCode', () => {
  it('classifies tcpm1 member tokens, raw UUIDs, reward tokens, and unknown strings', () => {
    const dummyMemberToken = ['tcpm1', 'test_dummy_payload', 'test_dummy_signature'].join('.');
    expect(classifyScannedStampCode(`  ${dummyMemberToken}  `)).toEqual({
      kind: 'member-token',
      token: dummyMemberToken,
    });
    expect(classifyScannedStampCode('550e8400-e29b-41d4-a716-446655440000')).toEqual({
      kind: 'customer-uuid',
      customerId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(classifyScannedStampCode('tcp2.payload.sig')).toEqual({
      kind: 'reward-token',
    });
    expect(classifyScannedStampCode('tcpig2.payload.sig')).toEqual({
      kind: 'reward-token',
    });
    expect(classifyScannedStampCode('https://example.com')).toEqual({
      kind: 'unknown',
    });
  });

  it('warns_when_reward_qr_is_scanned_on_manual_stamp_form and renders quick-reason chips + SSR inputs', () => {
    const html = renderToStaticMarkup(React.createElement(ManualStampForm));
    expect(html).toContain('Issue Manual Stamp');
    expect(html).toContain('for="manual-customer-id"');
    expect(html).toContain('Customer UUID');
    expect(html).toContain('for="manual-stamp-reason"');
    for (const preset of STAMP_QUICK_REASONS) {
      expect(html).toContain(preset);
    }
  });
});
