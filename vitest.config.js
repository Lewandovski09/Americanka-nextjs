import { defineConfig } from 'vitest/config';
import path from 'path';

// Pure-logic unit tests only (lib/**) — no React Testing Library, no
// jsdom environment. Pages and components stay untested here; the
// highest-risk code in this app is the tournament math (brackets,
// standings, Elo categories), which is plain, side-effect-free JS and
// cheap to cover thoroughly.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
