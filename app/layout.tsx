import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Oswald, Poppins, Inter } from 'next/font/google';
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

// ODYSSEY platform typography (Brand Bible v1.0, page 15): Poppins headings, Inter body.
// Applied only on platform screens through the font-odyssey-* utilities; shop screens keep their own fonts.
const odysseyHeading = Poppins({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-odyssey-heading',
  display: 'swap',
  fallback: ['system-ui', 'Arial', 'sans-serif'],
});

const odysseyBody = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-odyssey-body',
  display: 'swap',
  fallback: ['system-ui', 'Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: PLATFORM_CONFIG.name,
    template: `%s | ${PLATFORM_CONFIG.name}`,
  },
  description: PLATFORM_CONFIG.tagline,
  applicationName: PLATFORM_CONFIG.name,
  icons: {
    icon: [
      { url: PLATFORM_CONFIG.assets.icon, type: 'image/png', sizes: '192x192' },
      { url: PLATFORM_CONFIG.assets.iconLarge, type: 'image/png', sizes: '512x512' },
    ],
    apple: { url: PLATFORM_CONFIG.assets.appleIcon, sizes: '180x180' },
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
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${oswald.variable} ${odysseyHeading.variable} ${odysseyBody.variable}`}
    >
      <body className="bg-[#0A0A0A] text-white antialiased min-h-dvh font-sans selection:bg-white selection:text-black">
        <AuthHashHandler />
        {children}
      </body>
    </html>
  );
}
