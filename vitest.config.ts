import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } }, // same `@/` as the extension code
  // the panel stylesheet (`?inline`, lib/panel-css.ts) is processed for real, so tests see the CSS the content script bundles
  test: { server: { deps: { inline: [/node_modules\/wxt\//] } }, css: { include: [/assets\/.*\.css/] }, environment: 'node', setupFiles: ['tests/setup.ts'], testTimeout: 15000 },
});
