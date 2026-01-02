import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000, // 60 seconds - RPC calls can be slow
    hookTimeout: 30000,
    // Do not retry - we want to see failures from rate limits
    retry: 0,
    // Run tests sequentially to better observe rate limit behavior
    sequence: {
      concurrent: false,
    },
    reporters: ['verbose'],
  },
});
