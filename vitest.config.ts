import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    // dailyActivity's DST test needs a UK clock to exercise the transition;
    // pin it so the suite is deterministic on any host/CI timezone.
    env: {
      TZ: 'Europe/London',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
