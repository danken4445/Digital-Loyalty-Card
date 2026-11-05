import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Oswald } from 'next/font/google';
import { PLATFORM_CONFIG } from '@/lib/config';
import { AuthHashHandler } from '@/components/auth/AuthHashHandler';
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
    default: PLATFORM_CONFIG.name,
    template: `%s | ${PLATFORM_CONFIG.name}`,
  },
  description: PLATFORM_CONFIG.tagline,
  applicationName: PLATFORM_CONFIG.name,
  icons: {
    icon: PLATFORM_CONFIG.assets.icon,
    apple: PLATFORM_CONFIG.assets.icon,
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
        <AuthHashHandler />
        {children}
      </body>
    </html>
  );
}
