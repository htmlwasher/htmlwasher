import { defineConfig } from 'vitest/config';

// The corpus test runs htmlwasher (incl. ONNX classification) across every
// fixture x combo, fully offline. Give it a generous timeout — there is one
// long-running E2E test, not many small ones.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: true,
  },
});
