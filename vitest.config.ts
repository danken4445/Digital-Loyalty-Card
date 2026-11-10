import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Match Next.js: automatic JSX runtime, so components render in tests without importing React.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
