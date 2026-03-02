import { defineConfig } from 'vite';
import { resolve } from 'path';

// Resolve workspace SDK packages to their pre-built dist/ outputs.
// Run `pnpm build:sdk` from the monorepo root before starting this dev server.
const root = resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@alife-sdk/core',
        replacement: resolve(root, 'packages/alife-core/dist/index.js'),
      },
      {
        find: '@alife-sdk/simulation',
        replacement: resolve(root, 'packages/alife-simulation/dist/index.js'),
      },
      {
        find: '@alife-sdk/ai',
        replacement: resolve(root, 'packages/alife-ai/dist/index.js'),
      },
      {
        find: '@alife-sdk/social',
        replacement: resolve(root, 'packages/alife-social/dist/index.js'),
      },
      {
        find: '@alife-sdk/phaser',
        replacement: resolve(root, 'packages/alife-phaser/dist/index.js'),
      },
    ],
  },
});
