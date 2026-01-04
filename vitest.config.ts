import { defineConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const root = process.cwd();
process.env.HOME = root;
process.env.XDG_CONFIG_HOME = `${root}/.config`;
process.env.WRANGLER_HOME = `${root}/.wrangler`;

const nodeMajor = Number(process.versions.node.split('.')[0]);
const useWorkersPool = process.env.VITEST_POOL
  ? process.env.VITEST_POOL === 'workers'
  : nodeMajor < 24;

const workersConfig = defineWorkersConfig({
  test: {
    env: {
      WRANGLER_HOME: '.wrangler',
      XDG_CONFIG_HOME: '.config',
    },
    poolOptions: {
      workers: {
        main: './src/index.ts',
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});

const nodeConfig = defineConfig({
  test: {
    environment: 'node',
  },
});

export default useWorkersPool ? workersConfig : nodeConfig;
