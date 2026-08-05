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
     * timeout does NOT cancel the hook's side effects, so a beforeEach/beforeAll
     * that snapshotted shared config could time out with restoreMappings never
     * running — which is how real JournalAccountMapping rows on :3308 were
     * once left pointing at orphaned test accounts. Scoped to hooks only
     * (not testTimeout): hooks are where shared-state mutation happens, and
     * raising this ceiling does not slow down detecting a genuinely hung test
     * body across the other ~450 specs in this suite. Individual DB-spec
     * fixtures that need even more headroom pass their own explicit per-hook
     * timeout (e.g. `beforeAll(async () => { ... }, 60_000)`).
     */
    hookTimeout: 60_000,
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
