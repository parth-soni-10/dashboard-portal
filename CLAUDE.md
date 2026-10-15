# Dashboard Portal

Keep `data/dashboards.js` as the sole dashboard manifest. Preserve the query search, `/` shortcut, live count announcement, `#preview-<id>` deep links, escaped manifest content, iframe sandbox, and the Content Tracker same-origin watchlist function. Do not place inline scripts, styles, or style attributes in served HTML. Keep the CSP restrictive and all external links `noopener`.

Portal controls use native labelled elements and same-origin APIs. Feedback is only stored through `SITE_FEEDBACK` under `fb:portal:` keys with a 90-day TTL; do not log user messages. Sample analytics and activity are visibly labelled and must never be described as live. Preserve the theme key `hub-theme` and existing URL behavior. Run `node tools/audit.mjs` and `node tools/deploy-pages.mjs --assets . --out .pages-dist` before a deploy review.
