import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

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
    coverage: {
      // The v8 provider crashes under Bun (ast-v8-to-istanbul); istanbul works.
      provider: 'istanbul',
      // Server logic only: pages, components and the demo fixture are not measured.
      include: ['src/lib/**', 'src/app/api/**'],
      exclude: ['src/lib/brain-fixture.ts', '**/*.test.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        // Ratchet: raised automatically as coverage rises, never lowered by hand.
        autoUpdate: true,
        lines: 43.6,
        statements: 44.07,
        functions: 47.35,
        branches: 42.49,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
});
