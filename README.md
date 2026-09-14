# Dashboard Portal

One page that links every deployed dashboard, checks whether each one still
answers, and keeps the whole set searchable. Static HTML, CSS and JavaScript
with no build step, matching the other dashboards.

## Adding or changing a dashboard

Everything on screen comes from `data/dashboards.js`. Edit that file, commit,
and Netlify redeploys it. Nothing else needs touching.

```js
{
  id: 'rbi-weekly',            // stable slug, also the localStorage key prefix
  name: 'RBI Weekly Dashboard',
  mark: 'RB',                  // one or two characters for the card monogram
  tagline: "India's weekly macro and forex data",
  description: 'One sentence, plain language, under 130 characters.',
  url: 'https://example.netlify.app/',   // null until it is deployed
  repo: 'https://github.com/parth-soni-10/RBI-Weekly-Data-Dashboard',
  tags: ['Scrapers', 'World Bank'],      // search also matches these
  verified: '2026-09-14',                // ISO date you last opened it by hand
  note: 'Optional line shown while url is null.'
}
```

A `null` URL is a real state, not a bug. The card renders with a dashed border,
a "Not deployed" badge and a warning note, and only offers the repository link
so there is never a call to action that leads nowhere.

## The link check, and what its badges mean

Each card carries one of four states:

| Badge | Colour | Meaning |
|---|---|---|
| Reachable | Green | This browser completed a request to the dashboard. |
| Could not verify | Amber | The check did not complete. Not a claim that the site is down. |
| Offline | Grey | The device reports no network connection. |
| Not deployed | Grey | No `url` recorded yet. |
| Checking | Grey | A check is in flight. |

The badge is deliberately hedged, because a cross-origin check cannot tell the
difference between a dead host and a host that refuses to be checked.

Reads happen with `fetch(url, { mode: 'no-cors' })`: the response body is
opaque, but the promise still resolves when the host answers. Expense Tracker
ships `Cross-Origin-Resource-Policy: same-origin` in its own `netlify.toml`,
which blocks the request outright, so its card permanently reads "Could not
verify" while the site is perfectly healthy. Calling that "Unreachable" would
be a lie, hence the softer wording.

Results are cached in `sessionStorage` for five minutes so the page never
hammers five hosts on every keystroke. **Re-check links** clears the cache and
probes everything again. Transient states are never written to the cache.

If a dashboard ever moves to a custom domain, add that origin to `connect-src`
in `netlify.toml` or its badge will read "Could not verify" for the wrong
reason.

## Deploying to Netlify

Pure static, `publish = "."`, no build command. Either connect the repository
or drag the folder onto Netlify Drop.

`netlify.toml` pins a strict CSP. Because it is `script-src 'self'` with no
hashes, there is no inline script anywhere in the page. The theme bootstrap
that runs before first paint lives in `theme-init.js` precisely so it can stay
an external file. **If you ever add an inline `<script>` or `style` attribute,
the CSP will block it.** That also blocks Netlify's injected free-plan badge,
which is intended.

## Files

```
index.html      Page shell: header, summary, toolbar, card grid, footer
styles.css      Design tokens and every rule, light and dark
app.js          Rendering, filtering, link checks, theme handling
theme-init.js   Pre-paint theme bootstrap (external, to keep the CSP strict)
icons.js        Tree-shaken Lucide v0.462.0 paths
data/           The dashboard manifest
fonts/          Self-hosted Geist Sans and Geist Mono (variable)
favicon.svg     Monogram mark
netlify.toml    Publish config, cache headers, CSP
```

## Design decisions

The house style across the sibling dashboards is self-hosted Geist, a single
green accent, hairline borders rather than heavy shadows, and tabular numerals
on figures. This portal follows all four so it reads as part of the same family.

Deliberate constraints, worth keeping if you extend this:

- **Shape:** cards are 12px, controls are 8px, and only status pills are fully
  round. Nothing else gets a radius.
- **Colour:** one accent (emerald) for the entire page. Amber appears only for
  a genuine "could not verify" state. Nothing else is coloured.
- **Motion:** transform and opacity only, under 220ms, and every animation is
  switched off under `prefers-reduced-motion`.
- **Accessibility:** the search box has a real label (visually hidden), status
  changes announce through `aria-live`, focus rings are visible on both themes,
  the full card is clickable through a stretched link without nesting anchors,
  and `/` focuses the filter from anywhere.
- **Contrast:** every text token clears WCAG AA 4.5:1 against every surface it
  is used on, in both themes. The light `--text-soft` is tuned for this; do not
  lighten it back.
- Icons come from Lucide, inlined by glyph. Do not hand-draw replacements.

## Local preview

Any static server works, since there is no build step:

```bash
python -m http.server 8000
```
