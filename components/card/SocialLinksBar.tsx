import React from 'react';
import { InstagramGlyph, FacebookGlyph, TikTokGlyph } from '@/components/card/SocialGlyphs';
import type { SocialLinkItem } from '@/lib/brand/social';

export interface SocialLinksBarProps {
  links: readonly SocialLinkItem[];
  className?: string;
}

export function SocialLinksBar({ links, className = 'mt-5' }: SocialLinksBarProps) {
  if (!links || links.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Shop social media channels"
      className={`${className} flex flex-wrap items-center justify-center gap-2.5`}
    >
      {links.map((item) => (
        <a
          key={item.platform}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Visit our ${item.platform} page ${item.displayLabel}`}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-plug-border bg-plug-surface/90 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:border-neutral-500 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {item.platform === 'instagram' && <InstagramGlyph className="h-4 w-4 text-pink-400" />}
          {item.platform === 'facebook' && <FacebookGlyph className="h-4 w-4 text-blue-400" />}
          {item.platform === 'tiktok' && <TikTokGlyph className="h-4 w-4 text-cyan-400" />}
          <span className="font-display tracking-wide">{item.displayLabel}</span>
        </a>
      ))}
    </nav>
  );
}

export default SocialLinksBar;
