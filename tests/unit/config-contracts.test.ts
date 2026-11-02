import { describe, expect, it } from 'vitest';
import {
  BRAND_THEME,
  getPublicEnv,
  getServerEnv,
  SECURITY_CONFIG,
  SHOP_CONFIG,
  STAMP_RULES,
} from '@/lib/config';
import { isStampResultCode, ROUTES, STAMP_RESULT_CODES } from '@/lib/contracts';

describe('Phase 0 Configuration & Contracts', () => {
  it('exposes immutable shop and stamp rule defaults matching locked spec', () => {
    expect(SHOP_CONFIG.name).toBe('The Caffeine Plug');
    expect(SHOP_CONFIG.currency).toBe('PHP');
    expect(SHOP_CONFIG.timezone).toBe('Asia/Manila');

    expect(STAMP_RULES.rewardThreshold).toBe(10);
    expect(STAMP_RULES.cooldownMinutes).toBe(30);
    expect(STAMP_RULES.dailyCap).toBe(2);
    expect(STAMP_RULES.tagThrottleSeconds).toBe(5);

    expect(SECURITY_CONFIG.redeemTokenTtlSeconds).toBe(300);
    expect(BRAND_THEME.palette.black).toBe('#0A0A0A');
    expect(BRAND_THEME.palette.white).toBe('#FFFFFF');
  });

  it('validates stamp result codes accurately', () => {
    for (const code of STAMP_RESULT_CODES) {
      expect(isStampResultCode(code)).toBe(true);
    }
    expect(isStampResultCode('unknown-code')).toBe(false);
    expect(isStampResultCode(null)).toBe(false);
  });

  it('builds canonical route URLs with safe URI encoding', () => {
    expect(ROUTES.card).toBe('/card');
    expect(ROUTES.cardWithResult('stamped')).toBe('/card?r=stamped');
    expect(ROUTES.startWithTag('tag_123')).toBe('/start?t=tag_123');
    expect(ROUTES.tap('tag_123')).toBe('/t/tag_123');
  });

  it('validates public and server environment variables with Zod', () => {
    const validPublic = getPublicEnv({
      NEXT_PUBLIC_SITE_URL: 'https://card.thecaffeineplug.ph',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-placeholder',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    });

    expect(validPublic.NEXT_PUBLIC_SITE_URL).toBe('https://card.thecaffeineplug.ph');

    expect(() =>
      getServerEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-placeholder',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        REDEEM_TOKEN_SECRET: 'too-short',
        TURNSTILE_SECRET_KEY: 'turnstile-secret',
      }),
    ).toThrow();
  });
});
