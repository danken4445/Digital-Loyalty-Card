import type { NextConfig } from 'next';

export interface SecurityHeaderItem {
  key: string;
  value: string;
}

/**
 * Builds the strict Content-Security-Policy header value for The Caffeine Plug.
 * Permits self-hosted assets, inline SVG QR data URIs, Cloudflare Turnstile widget,
 * and Supabase Auth / PostgREST endpoints.
 */
export function buildContentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co https://*.supabase.in http://127.0.0.1:54321 http://localhost:54321 https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];

  return directives.join('; ');
}

/**
 * Returns the full set of HTTP response security headers applied across all routes.
 */
export function buildSecurityHeaders(): SecurityHeaderItem[] {
  return [
    {
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(),
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
