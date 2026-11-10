import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  issueMemberStampToken,
  verifyMemberStampToken,
} from '@/lib/security/memberStampToken';
import { redactSensitiveValue } from '@/lib/security/logger';

const SECRET = 's'.repeat(32);
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '7c1f0000-0000-4000-8000-000000000001';

describe('Member Stamp Token (tcpm1) & Log Redaction', () => {
  it('issues a tcpm1 signed token with SVG QR and verifies it round-trip', async () => {
    const issued = await issueMemberStampToken(CUSTOMER_ID, TENANT_ID, {
      nowMs: 1_700_000_000_000,
      secretOverride: SECRET,
    });

    expect(issued.token.startsWith('tcpm1.')).toBe(true);
    expect(issued.displayCode).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(issued.qrSvg).toContain('<svg');
    expect(issued.payload).toEqual({
      customerId: CUSTOMER_ID,
      tenantId: TENANT_ID,
      iat: 1_700_000_000,
    });

    const verified = verifyMemberStampToken(issued.token, {
      nowMs: 1_700_500_000_000, // 5+ days later still valid for offline cached QR
      secretOverride: SECRET,
    });

    expect(verified).toEqual({
      valid: true,
      payload: issued.payload,
      displayCode: issued.displayCode,
    });
  });

  it('rejects_tampered_malformed_or_wrong_prefix_member_tokens', async () => {
    const issued = await issueMemberStampToken(CUSTOMER_ID, TENANT_ID, {
      nowMs: 1_700_000_000_000,
      secretOverride: SECRET,
    });

    // Tampered signature
    const parts = issued.token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAA${parts[2]!.slice(4)}`;
    expect(verifyMemberStampToken(tampered, { secretOverride: SECRET })).toEqual({
      valid: false,
      reason: 'invalid-token',
    });

    // Reward prefix tcp2 must be rejected
    const wrongPrefix = `tcp2.${parts[1]}.${parts[2]}`;
    expect(verifyMemberStampToken(wrongPrefix, { secretOverride: SECRET })).toEqual({
      valid: false,
      reason: 'invalid-token',
    });

    // Future iat beyond clock skew
    expect(
      verifyMemberStampToken(issued.token, {
        nowMs: (1_700_000_000 - 120) * 1000,
        secretOverride: SECRET,
      }),
    ).toEqual({
      valid: false,
      reason: 'invalid-token',
    });
  });

  it('redacts tcpm1 tokens in security logger strings', async () => {
    const issued = await issueMemberStampToken(CUSTOMER_ID, TENANT_ID, {
      secretOverride: SECRET,
    });
    const logLine = `Scanned member QR ${issued.token} at counter`;
    expect(redactSensitiveValue(logLine, 'detail')).toBe(
      'Scanned member QR [REDACTED_TOKEN] at counter',
    );
  });
});

