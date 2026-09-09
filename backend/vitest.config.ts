import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Entitlement resolution is pure, so the suite runs without a database.
    // Integration tests that need one live in `npm run smoke`.
    globals: false,
  },
});
