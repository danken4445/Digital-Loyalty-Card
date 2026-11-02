import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        plug: {
          black: '#0A0A0A',
          white: '#FFFFFF',
          surface: '#121214',
          surfaceDark: '#121214',
          elevated: '#1C1C1F',
          surfaceElevated: '#1C1C1F',
          border: '#27272A',
          contourLine: '#27272A',
          muted: '#A1A1AA',
          mutedText: '#A1A1AA',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Impact', 'Arial Black', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
