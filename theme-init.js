/* ---------------------------------------------------------------------------
 * Runs before first paint, synchronously, so the correct theme is applied
 * without a flash. Kept as its own file (rather than an inline <script>) so
 * the Content-Security-Policy can stay at script-src 'self' with no hashes.
 *
 * A stored choice wins; otherwise the operating system preference decides.
 * ------------------------------------------------------------------------ */
(function () {
  var THEME_KEY = 'hub-theme';
  var stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch (e) {
    /* private mode: fall through to the system preference */
  }
  var prefersLight =
    window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  var theme = stored === 'light' || stored === 'dark' ? stored : prefersLight ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeSource = stored ? 'stored' : 'system';
})();
