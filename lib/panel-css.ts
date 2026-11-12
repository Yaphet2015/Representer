// The panel's stylesheet as a string bundled into the content script. WXT's own `cssInjectionMode: 'ui'` instead
// fetch()es content.css (a web-accessible resource, dynamic-URL) when the panel first mounts, and on any failure
// logs a warning and mounts an unstyled panel; a bundled string has no runtime step that can fail.
import css from '@/assets/tailwind.css?inline';

/** `:root` rules (theme variables) must target the shadow host inside a shadow root. */
export const PANEL_CSS: string = css.replaceAll(':root', ':host');

/** Shadow-root options of the panel (the entry adds onMount). `anchor: 'html'`: outside <body>, so body-level zoom/transform on the host page can't affect us. */
export const PANEL_SHADOW = { name: 'representer-overlay', position: 'overlay', zIndex: 2147483647, anchor: 'html', css: PANEL_CSS } as const;
