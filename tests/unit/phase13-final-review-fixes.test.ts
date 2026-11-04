import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_URL, resolveCardTheme } from '@/lib/brand/contrast';
import type { TenantBrand } from '@/lib/contracts';

const root = path.resolve(__dirname, '../..');
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf-8');

describe('Phase 13 final review: tenant image URLs', () => {
  it('keeps https and root-relative image URLs', () => {
    const theme = resolveCardTheme({
      logoUrl: 'https://cdn.example.com/logo.png',
      cardArtUrl: '/brand/art.png',
    } as TenantBrand);

    expect(theme.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(theme.cardArtUrl).toBe('/brand/art.png');
  });

  it.each([
    ['http://cdn.example.com/logo.png'],
    ['javascript:alert(1)'],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['//evil.example.com/logo.png'],
    ['/\\evil.example.com/logo.png'],
    ['ftp://example.com/logo.png'],
    ['logo.png'],
  ])('falls back for unsafe or unsupported image URL %s', (url) => {
    const theme = resolveCardTheme({ logoUrl: url, cardArtUrl: url } as TenantBrand);

    expect(theme.logoUrl).toBe(DEFAULT_LOGO_URL);
    expect(theme.cardArtUrl).toBeNull();
  });
});

describe('Phase 13 final review: flat styling on Phase 13 surfaces', () => {
  const files = [
    'app/wallet/page.tsx',
    'components/wallet/WalletCardStack.tsx',
    'components/wallet/WalletBackupModal.tsx',
    'components/card/AddCardCelebrationBanner.tsx',
  ];

  it.each(files)('%s has no shadows, backdrop blur or 2px borders', (file) => {
    const source = read(file);

    expect(source).not.toMatch(/\bshadow(-|\b)/);
    expect(source).not.toContain('backdrop-blur');
    expect(source).not.toContain('border-2');
  });
});
