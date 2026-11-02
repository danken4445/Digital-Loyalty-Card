import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Oswald } from 'next/font/google';
import { SHOP_CONFIG } from '@/lib/config';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const oswald = Oswald({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  fallback: ['Impact', 'Arial Black', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: `${SHOP_CONFIG.name} — Loyalty Card`,
    template: `%s | ${SHOP_CONFIG.name}`,
  },
  description: SHOP_CONFIG.tagline,
  applicationName: SHOP_CONFIG.name,
  icons: {
    icon: '/brand/logo-circle-dark.png',
    apple: '/brand/logo-circle-dark.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${oswald.variable}`}>
      <body className="bg-[#0A0A0A] text-white antialiased min-h-dvh font-sans selection:bg-white selection:text-black">
        {children}
      </body>
    </html>
  );
}
