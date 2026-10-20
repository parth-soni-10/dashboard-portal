/* ---------------------------------------------------------------------------
 * Runs before first paint, synchronously, so the correct theme is applied
 * without a flash. Kept as its own file (rather than an inline <script>) so
 * the Content-Security-Policy can stay at script-src 'self' with no hashes.
 *
 * A stored choice wins; otherwise the site opens light. The operating system
 * is deliberately not consulted: `:root` in styles.css is the light token set
 * and the design is drawn for it first, so a visitor on a dark-mode machine
 * gets the light page and the toggle is the only route to the dark one.
 * ------------------------------------------------------------------------ */
(function () {
  var THEME_KEY = 'hub-theme';
  var stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch (e) {
    /* private mode: fall through to the default */
  }
  var theme = stored === 'light' || stored === 'dark' ? stored : 'light';
  document.documentElement.dataset.theme = theme;
})();
