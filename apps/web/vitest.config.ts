import { defineConfig } from 'vitest/config';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
