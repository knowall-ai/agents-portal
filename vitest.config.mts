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
      exclude: [
        'src/lib/brain-fixture.ts',
        // Test data (JSON/YAML samples of what upstream publishes), not source
        'src/lib/__fixtures__/**',
        '**/*.test.ts',
        '**/*.d.ts',
      ],
      reporter: ['text-summary', 'text'],
      thresholds: {
        // Ratchet: raised automatically as coverage rises, never lowered by hand.
        autoUpdate: true,
        lines: 54.94,
        statements: 55.39,
        functions: 58.18,
        branches: 55.23,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
});
