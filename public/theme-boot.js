// Runs before the options page paints: apply the cached theme (written by the page on load/change) to avoid a light flash.
(function () {
  try {
    var p = localStorage.getItem('rp-theme') || 'system';
    var dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    var el = document.documentElement;
    el.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (dark) el.classList.add('dark');
  } catch (e) {}
})();
