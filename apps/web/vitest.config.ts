import { defineConfig } from 'vitest/config';
import path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    /*
     * DB specs run against the shared MariaDB test bed and their fixtures do
     * many sequential writes on a possibly-cold connection. A tripped hook
     * timeout does NOT cancel the hook's side effects, so a beforeEach that
     * snapshotted shared config could time out with restoreMappings never
     * running — which is how real JournalAccountMapping rows on :3308 were
     * once left pointing at orphaned test accounts. These ceilings are set
     * high deliberately: a slow fixture should finish, not abort halfway
     * through mutating shared state.
     */
    hookTimeout: 60_000,
    testTimeout: 30_000,
    include: [
      'lib/**/*.test.ts',
      'app/**/*.spec.ts',
      '../../scripts/legacy-master/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
