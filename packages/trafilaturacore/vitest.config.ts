import { defineConfig } from 'vitest/config';

// Unit + golden-fixture tests run headless in a Node environment, fully offline.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
