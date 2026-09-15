/* ---------------------------------------------------------------------------
 * Tree-shaken icon set.
 *
 * Paths are copied verbatim from Lucide v0.462.0 (ISC), the same icon library
 * that Irish-Visa-Tracker vendors as lucide.min.js. The full UMD bundle is
 * ~350 KB; this portal renders nine glyphs, so they are inlined here as a
 * generated module instead of shipping the whole thing.
 *
 * Do not hand-draw replacements. To add a glyph, pull the real Lucide path and
 * add it below — an unused entry is dead weight, so keep this list to what the
 * page actually renders.
 * ------------------------------------------------------------------------ */

const ICON_PATHS = {
  'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  'refresh-cw':
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'triangle-alert':
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
};

/**
 * Build an inline SVG for a named glyph.
 * Decorative by default: the label lives in the surrounding text or the
 * element's aria-label, so the glyph itself is hidden from screen readers.
 */
function icon(name, size = 16, extraClass = '') {
  const paths = ICON_PATHS[name];
  if (!paths) {
    // Fail loudly in the console rather than silently rendering an empty box.
    console.warn('icon: unknown glyph "' + name + '"');
    return '';
  }
  return (
    '<svg class="ico ' +
    extraClass +
    '" viewBox="0 0 24 24" width="' +
    size +
    '" height="' +
    size +
    '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    paths +
    '</svg>'
  );
}
