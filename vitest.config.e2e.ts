import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { readFileSync } from 'node:fs';

const qualifiedNode = readFileSync(new URL('./.node-version', import.meta.url), 'utf8').trim();
if (process.versions.node !== qualifiedNode) {
  throw new Error(`E2E runtime ${process.version} is not qualified. Use Node.js ${qualifiedNode} from .node-version before database-mutating tests. See docs/phase7b-forum-security-hardening.md, Runtime recovery.`);
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    env: {
      NODE_ENV: 'test',
    },
  },
});
