import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

// VITE_RP_DIAG=1 builds the dev diagnostics page (entrypoints/diag) and stamps a unique version_name;
// a normal build leaves both out.
const DIAG = process.env.VITE_RP_DIAG === '1';
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'nogit'; } })();
const BUILD = DIAG ? `diag-${sha}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}` : `release-${version}`;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  filterEntrypoints: ['background', 'content', 'options', ...(DIAG ? ['diag'] : [])],
  vite: () => ({ define: { __RP_BUILD__: JSON.stringify(BUILD) } }),
  manifest: {
    name: '__MSG_extName__',
    short_name: '__MSG_extShortName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    ...(DIAG ? { version_name: `${version} ${BUILD}` } : {}),
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-overlay': {
        suggested_key: { default: 'Ctrl+E', mac: 'Command+E' },
        description: '__MSG_cmdToggle__',
      },
    },
    action: { default_title: 'Representer', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' } },
  },
});
