import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'wxt';

// VITE_RP_DIAG=1 builds the dev diagnostics page (entrypoints/diag) and stamps a unique version_name.
// VITE_RP_CMD_DIAG=1 builds a TEST-ONLY command-trace page (entrypoints/cmd-trace) and stamps
// version_name with TEST-ONLY. Neither flag belongs in a release; a normal build leaves both out.
const DIAG = process.env.VITE_RP_DIAG === '1';
const CMD_DIAG = process.env.VITE_RP_CMD_DIAG === '1';
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'nogit'; } })();
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const BUILD = CMD_DIAG ? `TEST-ONLY-cmd-diag-${sha}-${stamp}` : DIAG ? `diag-${sha}-${stamp}` : `release-${version}`;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: { 'build:publicAssets': (_wxt, files) => {
    files.push({ absoluteSrc: new URL('./node_modules/pdfjs-dist/LICENSE', import.meta.url).pathname, relativeDest: 'pdf-assets/LICENSE' });
    for (const dir of ['cmaps', 'standard_fonts']) {
      const base = new URL(`./node_modules/pdfjs-dist/${dir}/`, import.meta.url);
      for (const name of readdirSync(base)) files.push({ absoluteSrc: new URL(name, base).pathname, relativeDest: `pdf-assets/${dir}/${name}` });
    }
  } },
  filterEntrypoints: ['background', 'content', 'options', ...(DIAG ? ['diag'] : []), ...(CMD_DIAG ? ['cmd-trace'] : []), 'pdf-panel'],
  vite: () => ({ define: { __RP_BUILD__: JSON.stringify(BUILD), 'import.meta.env.VITE_RP_CMD_DIAG': JSON.stringify(CMD_DIAG ? '1' : '') } }),
  manifest: {
    name: '__MSG_extName__',
    minimum_chrome_version: '119',
    side_panel: { default_path: 'pdf-panel.html' },
    short_name: '__MSG_extShortName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    ...(DIAG || CMD_DIAG ? { version_name: `${version} ${BUILD}` } : {}),
    permissions: ['storage', 'sidePanel'],
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
