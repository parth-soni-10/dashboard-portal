# Dashboard Portal

Keep `data/dashboards.js` as the sole dashboard manifest. Preserve the query search, `/` shortcut, live count announcement, `#preview-<id>` deep links, escaped manifest content, iframe sandbox, and the Content Tracker same-origin watchlist function. Do not place inline scripts, styles, or style attributes in served HTML. Keep the CSP restrictive and all external links `noopener`.

Portal controls use native labelled elements and same-origin APIs. Feedback is only stored through `SITE_FEEDBACK` under `fb:portal:` keys with a 90-day TTL; do not log user messages. Sample analytics and activity are visibly labelled and must never be described as live. Preserve the theme key `hub-theme` and existing URL behavior. Motion timings come from the shared tokens (`--motion-duration-*`, `--motion-ease-*`); do not hard-code a duration in a rule — map it to a tier. `404.html` and `404.css` are required published assets, not build output. At 375 px the row title owns the full width and the actions sit in their own band; keep it that way, because squeezing the title beside five 44 px controls breaks words mid-word. Run `node tools/audit.mjs` and `node tools/deploy-pages.mjs --assets . --out .pages-dist --sw-cache dashboard-portal-v1` before a deploy review (`--sw-cache` is what puts a content hash in the staged `sw.js` cache name; drop it and every deploy keeps the previous offline cache until it expires).
## The design-system component layer

The site is now built on the shared design-system rather than on hand-written
markup, and the change is visible in the source.

- **The 27 components** from `design-system/` are the base for this site's
  controls. Every integrated instance renders `data-component="<slug>"`, and
  that attribute is what the coverage verifier reads - it is the contract, not
  a comment.
- **The component layer** is `components.js`, and it is idempotent: it
  re-runs on a debounced MutationObserver after each route render, and it
  installs each part inside its own try/catch, so a component that cannot
  install logs once and shows up as a missing marker rather than as a broken
  page.
- **The tokens** are the site's own stylesheet, so a spacing, colour or
  motion value is set in one place and read by everything. The motion
  durations are the four tiers (`--motion-duration-micro`, `-standard`,
  `-complex`, `-page`) and the three easing curves; a duration is never
  written into a rule.
- **The strict CSP is not negotiable**: no inline `<script>`, no `<style>`
  element, no `style=""` attribute in served HTML. `tools/check-csp-inline.py`
  (or the shared `verify-csp.ts`) fails the build if one appears.
