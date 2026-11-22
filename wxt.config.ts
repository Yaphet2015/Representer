import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'wxt';

// VITE_RP_DIAG=1 builds the dev diagnostics page (entrypoints/diag) and stamps a unique version_name;
// a normal build leaves both out.
const DIAG = process.env.VITE_RP_DIAG === '1';
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'nogit'; } })();
const BUILD = DIAG ? `diag-${sha}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}` : `release-${version}`;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: { 'build:publicAssets': (_wxt, files) => {
    files.push({ absoluteSrc: new URL('./node_modules/pdfjs-dist/LICENSE', import.meta.url).pathname, relativeDest: 'pdf-assets/LICENSE' });
    for (const dir of ['cmaps', 'standard_fonts']) {
      const base = new URL(`./node_modules/pdfjs-dist/${dir}/`, import.meta.url);
      for (const name of readdirSync(base)) files.push({ absoluteSrc: new URL(name, base).pathname, relativeDest: `pdf-assets/${dir}/${name}` });
    }
  } },
  filterEntrypoints: ['background', 'content', 'options', ...(DIAG ? ['diag'] : []), 'pdf-panel'],
  vite: () => ({ define: { __RP_BUILD__: JSON.stringify(BUILD) } }),
  manifest: {
    name: '__MSG_extName__',
    minimum_chrome_version: '119',
    side_panel: { default_path: 'pdf-panel.html' },
    short_name: '__MSG_extShortName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    ...(DIAG ? { version_name: `${version} ${BUILD}` } : {}),
    permissions: ['storage', 'sidePanel', 'scripting'],
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
