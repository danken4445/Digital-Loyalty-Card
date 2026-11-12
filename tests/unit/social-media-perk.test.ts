import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatSocialUrl,
  formatSocialDisplayHandle,
  resolveActiveSocialLinks,
} from '@/lib/brand/social';
import { resolveCardTheme } from '@/lib/brand/contrast';
import {
  SocialGlyphs,
  InstagramGlyph,
  FacebookGlyph,
  TikTokGlyph,
} from '@/components/card/SocialGlyphs';
import { SocialLinksBar } from '@/components/card/SocialLinksBar';
import {
  InstagramUpsizePanel,
  SocialFollowPerkPanel,
} from '@/components/card/InstagramUpsizePanel';
import type { TenantBrand } from '@/lib/contracts';

(globalThis as any).React = React;

describe('Social Media Utilities (lib/brand/social)', () => {
  describe('formatSocialUrl', () => {
    it('normalizes Instagram handles and URLs', () => {
      expect(formatSocialUrl('instagram', 'mycafe')).toBe('https://www.instagram.com/mycafe/');
      expect(formatSocialUrl('instagram', '@mycafe')).toBe('https://www.instagram.com/mycafe/');
      expect(formatSocialUrl('instagram', 'https://instagram.com/mycafe/')).toBe(
        'https://instagram.com/mycafe/',
      );
      expect(formatSocialUrl('instagram', '')).toBe('');
      expect(formatSocialUrl('instagram', null)).toBe('');
    });

    it('normalizes Facebook links and handles', () => {
      expect(formatSocialUrl('facebook', 'mycafepage')).toBe('https://www.facebook.com/mycafepage');
      expect(formatSocialUrl('facebook', '@mycafepage')).toBe(
        'https://www.facebook.com/mycafepage',
      );
      expect(formatSocialUrl('facebook', 'facebook.com/mycafepage')).toBe(
        'https://facebook.com/mycafepage',
      );
      expect(formatSocialUrl('facebook', 'https://www.facebook.com/mycafepage')).toBe(
        'https://www.facebook.com/mycafepage',
      );
    });

    it('normalizes TikTok usernames and URLs', () => {
      expect(formatSocialUrl('tiktok', 'mycafe')).toBe('https://www.tiktok.com/@mycafe');
      expect(formatSocialUrl('tiktok', '@mycafe')).toBe('https://www.tiktok.com/@mycafe');
      expect(formatSocialUrl('tiktok', 'https://www.tiktok.com/@mycafe')).toBe(
        'https://www.tiktok.com/@mycafe',
      );
    });
  });

  describe('formatSocialDisplayHandle', () => {
    it('formats Instagram and TikTok handles with @ prefix', () => {
      expect(formatSocialDisplayHandle('instagram', 'mycafe')).toBe('@mycafe');
      expect(formatSocialDisplayHandle('instagram', '@mycafe')).toBe('@mycafe');
      expect(formatSocialDisplayHandle('instagram', 'https://instagram.com/mycafe')).toBe(
        '@mycafe',
      );

      expect(formatSocialDisplayHandle('tiktok', 'mycafe')).toBe('@mycafe');
      expect(formatSocialDisplayHandle('tiktok', '@mycafe')).toBe('@mycafe');
      expect(formatSocialDisplayHandle('tiktok', 'https://tiktok.com/@mycafe')).toBe('@mycafe');
    });

    it('formats Facebook page cleanly', () => {
      expect(formatSocialDisplayHandle('facebook', 'mycafepage')).toBe('mycafepage');
      expect(formatSocialDisplayHandle('facebook', '@mycafepage')).toBe('mycafepage');
      expect(formatSocialDisplayHandle('facebook', 'https://facebook.com/mycafepage')).toBe(
        'mycafepage',
      );
    });

    it('handles empty or blank values safely', () => {
      expect(formatSocialDisplayHandle('instagram', '')).toBe('');
      expect(formatSocialDisplayHandle('facebook', '   ')).toBe('');
      expect(formatSocialDisplayHandle('tiktok', undefined)).toBe('');
    });
  });

  describe('resolveActiveSocialLinks', () => {
    it('resolves active enabled social media channels', () => {
      const brand: TenantBrand = {
        socialLinks: {
          instagram: { enabled: true, url: '@mycafe' },
          facebook: { enabled: true, url: 'mycafepage' },
          tiktok: { enabled: false, url: '@mycafe' },
        },
      };

      const active = resolveActiveSocialLinks(brand);
      expect(active).toHaveLength(2);
      expect(active[0]).toEqual({
        platform: 'instagram',
        url: 'https://www.instagram.com/mycafe/',
        displayLabel: '@mycafe',
      });
      expect(active[1]).toEqual({
        platform: 'facebook',
        url: 'https://www.facebook.com/mycafepage',
        displayLabel: 'mycafepage',
      });
    });

    it('ignores enabled links with blank or whitespace url', () => {
      const brand: TenantBrand = {
        socialLinks: {
          instagram: { enabled: true, url: '   ' },
          facebook: { enabled: true, url: 'mycafepage' },
        },
      };

      const active = resolveActiveSocialLinks(brand);
      expect(active).toHaveLength(1);
      expect(active[0]?.platform).toBe('facebook');
    });

    it('falls back to legacy Instagram handle when socialLinks is undefined', () => {
      const brand: TenantBrand = {};
      const active = resolveActiveSocialLinks(brand, 'legacy_cafe');
      expect(active).toHaveLength(1);
      expect(active[0]).toEqual({
        platform: 'instagram',
        url: 'https://www.instagram.com/legacy_cafe/',
        displayLabel: '@legacy_cafe',
      });
    });

    it('does not fall back if owner explicitly disabled instagram', () => {
      const brand: TenantBrand = {
        socialLinks: {
          instagram: { enabled: false, url: '' },
        },
      };
      const active = resolveActiveSocialLinks(brand, 'legacy_cafe');
      expect(active).toHaveLength(0);
    });
  });
});

describe('Theme Resolution with Social Settings (lib/brand/contrast)', () => {
  it('passes socialReward, socialRewardEnabled, and socialLinks to resolved theme', () => {
    const brand: TenantBrand = {
      socialReward: '10% off entire order',
      socialRewardEnabled: true,
      socialLinks: {
        instagram: { enabled: true, url: 'mycafe' },
        facebook: { enabled: true, url: 'mycafefb' },
        tiktok: { enabled: true, url: 'mycafett' },
      },
    };

    const theme = resolveCardTheme(brand);
    expect(theme.socialReward).toBe('10% off entire order');
    expect(theme.socialRewardEnabled).toBe(true);
    expect(theme.socialLinks).toEqual(brand.socialLinks);
  });
});

describe('Social UI Components', () => {
  describe('SocialGlyphs', () => {
    it('renders SVGs for instagram, facebook, and tiktok via both dictionary and direct components', () => {
      const igMarkup = renderToStaticMarkup(
        React.createElement(SocialGlyphs.instagram, { className: 'w-5 h-5' }),
      );
      expect(igMarkup).toContain('<svg');
      expect(igMarkup).toContain('w-5 h-5');

      const fbMarkup = renderToStaticMarkup(
        React.createElement(FacebookGlyph, { className: 'w-5 h-5' }),
      );
      expect(fbMarkup).toContain('<svg');

      const ttMarkup = renderToStaticMarkup(
        React.createElement(TikTokGlyph, { className: 'w-5 h-5' }),
      );
      expect(ttMarkup).toContain('<svg');
    });
  });

  describe('SocialLinksBar', () => {
    it('returns null when no links are active', () => {
      const markup = renderToStaticMarkup(React.createElement(SocialLinksBar, { links: [] }));
      expect(markup).toBe('');
    });

    it('renders accessible links for active channels', () => {
      const links = [
        {
          platform: 'instagram' as const,
          url: 'https://www.instagram.com/mycafe/',
          displayLabel: '@mycafe',
        },
        {
          platform: 'facebook' as const,
          url: 'https://www.facebook.com/mycafepage',
          displayLabel: 'mycafepage',
        },
      ];

      const markup = renderToStaticMarkup(React.createElement(SocialLinksBar, { links }));
      expect(markup).toContain('aria-label="Visit our instagram page @mycafe"');
      expect(markup).toContain('aria-label="Visit our facebook page mycafepage"');
      expect(markup).toContain('@mycafe');
      expect(markup).toContain('mycafepage');
      expect(markup).toContain('target="_blank"');
      expect(markup).toContain('rel="noopener noreferrer"');
    });
  });

  describe('InstagramUpsizePanel / SocialFollowPerkPanel', () => {
    it('renders custom perkLabel and multi-channel follow links', () => {
      const links = [
        {
          platform: 'instagram' as const,
          url: 'https://www.instagram.com/mycafe/',
          displayLabel: '@mycafe',
        },
        {
          platform: 'facebook' as const,
          url: 'https://www.facebook.com/mycafepage',
          displayLabel: 'mycafepage',
        },
      ];

      const markup = renderToStaticMarkup(
        React.createElement(InstagramUpsizePanel, {
          tenantSlug: 'test-shop',
          perkLabel: 'Free donut on follow',
          socialLinks: links,
          claimed: false,
        }),
      );

      expect(markup).toContain('FREE DONUT ON FOLLOW • ONE TIME');
      expect(markup).toContain('Follow us, get free donut on follow');
      expect(markup).toContain('FOLLOW ON INSTAGRAM');
      expect(markup).toContain('FOLLOW ON FACEBOOK');
      expect(markup).toContain('ALREADY FOLLOWING? CLAIM');
    });

    it('renders claimed state with SocialFollowPerkPanel alias', () => {
      const links = [
        {
          platform: 'instagram' as const,
          url: 'https://www.instagram.com/mycafe/',
          displayLabel: '@mycafe',
        },
        {
          platform: 'facebook' as const,
          url: 'https://www.facebook.com/mycafepage',
          displayLabel: 'mycafepage',
        },
      ];

      const markup = renderToStaticMarkup(
        React.createElement(SocialFollowPerkPanel, {
          tenantSlug: 'test-shop',
          perkLabel: '10% off bill',
          socialLinks: links,
          claimed: true,
        }),
      );

      expect(markup).toContain('SOCIAL PERK • CLAIMED');
      expect(markup).toContain('Thanks for following us');
    });
  });
});
