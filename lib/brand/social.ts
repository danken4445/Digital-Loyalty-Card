import type { TenantBrand } from '@/lib/contracts';

export type SocialPlatform = 'instagram' | 'facebook' | 'tiktok';

export interface SocialLinkItem {
  platform: SocialPlatform;
  url: string;
  displayLabel: string;
}

/**
 * Normalizes user input into a canonical https URL for the target platform.
 * Handles @handles, usernames, and full URLs.
 */
export function formatSocialUrl(
  platform: SocialPlatform,
  input: string | null | undefined,
): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const cleanHandle = trimmed.replace(/^@/, '');

  switch (platform) {
    case 'instagram':
      return `https://www.instagram.com/${cleanHandle}/`;
    case 'facebook':
      if (trimmed.startsWith('facebook.com/') || trimmed.startsWith('fb.com/')) {
        return `https://${trimmed}`;
      }
      return `https://www.facebook.com/${cleanHandle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${cleanHandle}`;
    default:
      return `https://${trimmed}`;
  }
}

/**
 * Formats a clean human-readable handle or display name for button/link text.
 */
export function formatSocialDisplayHandle(
  platform: SocialPlatform,
  input: string | null | undefined,
): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  // If full URL was provided, attempt to extract username or page name
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        const firstSegment = pathParts[0];
        if (firstSegment) {
          if (platform === 'instagram' || platform === 'tiktok') {
            return firstSegment.startsWith('@') ? firstSegment : `@${firstSegment}`;
          }
          return firstSegment;
        }
      }
      return platform === 'facebook' ? 'Facebook' : `@${url.hostname}`;
    } catch {
      // Fall through to standard cleanup
    }
  }

  const clean = trimmed.replace(/^@/, '');
  if (platform === 'instagram' || platform === 'tiktok') {
    return `@${clean}`;
  }
  return clean;
}

/**
 * Resolves active, displayable social media links from brand configuration,
 * preserving legacy Instagram handle fallback when brand settings are not yet set.
 */
export function resolveActiveSocialLinks(
  brand?: TenantBrand | null,
  legacyHandle?: string | null,
): SocialLinkItem[] {
  const links: SocialLinkItem[] = [];
  const socialLinks = brand?.socialLinks;

  // 1. Instagram
  const igConfig = socialLinks?.instagram;
  const hasConfiguredIg = igConfig !== undefined;
  const igUrlOrHandle =
    igConfig?.url?.trim() || (!hasConfiguredIg && legacyHandle ? legacyHandle : '');
  const igEnabled = igConfig?.enabled ?? (!hasConfiguredIg && Boolean(legacyHandle));

  if (igEnabled && igUrlOrHandle) {
    links.push({
      platform: 'instagram',
      url: formatSocialUrl('instagram', igUrlOrHandle),
      displayLabel: formatSocialDisplayHandle('instagram', igUrlOrHandle),
    });
  }

  // 2. Facebook
  const fbConfig = socialLinks?.facebook;
  if (fbConfig?.enabled && fbConfig.url?.trim()) {
    links.push({
      platform: 'facebook',
      url: formatSocialUrl('facebook', fbConfig.url),
      displayLabel: formatSocialDisplayHandle('facebook', fbConfig.url),
    });
  }

  // 3. TikTok
  const ttConfig = socialLinks?.tiktok;
  if (ttConfig?.enabled && ttConfig.url?.trim()) {
    links.push({
      platform: 'tiktok',
      url: formatSocialUrl('tiktok', ttConfig.url),
      displayLabel: formatSocialDisplayHandle('tiktok', ttConfig.url),
    });
  }

  return links;
}
