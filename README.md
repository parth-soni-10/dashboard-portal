# Dashboard Portal

One page that links every deployed dashboard, checks whether each one still
answers, and keeps the whole set searchable. Static HTML, CSS and JavaScript
with no build step, matching the other dashboards.

## Adding or changing a dashboard

Everything on screen comes from `data/dashboards.js`. Edit that file, commit,
and Netlify redeploys it. Nothing else needs touching.

```js
{
  id: 'rbi-weekly',            // stable slug, also the sessionStorage key
  name: 'RBI Weekly Dashboard',
  mark: 'RB',                  // one or two characters for the card monogram
  tone: 'slate',               // identity colour: gold, emerald, slate, blue
  tagline: "India's weekly macro and forex data",
  description: 'One sentence, plain language, under 130 characters.',
  url: 'https://example.netlify.app/',   // null until it is deployed
  repo: 'https://github.com/parth-soni-10/RBI-Weekly-Data-Dashboard',
  tags: ['Scrapers', 'World Bank'],      // search also matches these
  verified: '2026-09-14'                 // ISO date you last opened it by hand
}
```

A `null` URL is a real state, not a bug. The card renders dashed with a
"Not deployed" badge, shows "No deploy URL recorded" where the hostname would
be, and offers only the repository link, so there is never a call to action
that leads nowhere.

## Libraries

Three, all vendored, so the page keeps working with `script-src 'self'` and
needs no build step:

| Library | Version | Role |
|---|---|---|
| [Open Props](https://open-props.style) (MIT) | 1.7.17 | Scale tokens: spacing, radii, shadows, type sizes, easings |
| [Lucide](https://lucide.dev) (ISC) | 0.462.0 | Icons, tree-shaken to the 15 glyphs actually used |
| Geist / Geist Mono | variable | Self-hosted type, same as the sibling dashboards |

**Why Open Props and not Tailwind or Shoelace.** Tailwind produces great
results but needs a build step and a `node_modules` tree, which would make this
the only repo in the set that cannot be drag-dropped onto Netlify. Shoelace /
Web Awesome would supply accessible components, but its default language is a
generic web-component look that would fight the house style, and five cards do
not need a component runtime. Open Props gives the part that actually improves
a design at this size — a proven spacing, type and shadow scale — with zero
runtime and no build. If you would rather have the utility-class workflow, say
so and it can be swapped in; nothing else in the page depends on this choice.

The two token layers are kept deliberately separate:

- **Scale** comes from Open Props (`--size-*`, `--radius-*`, `--shadow-*`,
  `--font-size-*`, `--ease-*`). Do not hand-roll replacements for these.
- **Colour** is hand-tuned in `styles.css` and contrast-verified, because the
  house palette has to match the sibling dashboards exactly.

## The link check, and what its badges mean

Each card carries one of these states:

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
opaque, but the promise still resolves when the host answers. A dashboard that
ships `Cross-Origin-Resource-Policy: same-origin` in its own `netlify.toml`
refuses cross-site checks outright, so its card would sit on "Could not
verify" while the site is perfectly healthy. Calling that "Unreachable" would
be a lie, hence the softer wording, and a footnote under the grid names the
offending dashboard instead of leaving you guessing. No dashboard listed today
triggers it, but the Expense Tracker repo sets that header, so a future entry
can.

Results are cached in `sessionStorage` for five minutes so the page never
hammers five hosts on every keystroke. The refresh button in the header clears
the cache and probes everything again. Transient states are never cached.

If a dashboard ever moves to a custom domain, add that origin to `connect-src`
in `netlify.toml` or its badge will read "Could not verify" for the wrong
reason.

## Deploying to Netlify

Pure static, `publish = "."`, no build command. Either connect the repository
or drag the folder onto Netlify Drop.

`netlify.toml` pins a strict CSP. Because it is `script-src 'self'` and
`style-src 'self'` with no hashes, there is no inline script or `style`
attribute anywhere in the page. The theme bootstrap that runs before first
paint lives in `theme-init.js` precisely so it can stay an external file.
**If you ever add an inline `<script>` or `style` attribute, the CSP will block
it.** That also blocks Netlify's injected free-plan badge, which is intended.

## Files

```
index.html                  Page shell: topbar, toolbar, grid, footnote, footer
styles.css                  Semantic colour tokens, layout, every rule
app.js                      Rendering, filtering, link checks, theme handling
theme-init.js               Pre-paint theme bootstrap (external, keeps CSP strict)
icons.js                    Tree-shaken Lucide 0.462.0 paths
data/dashboards.js          The dashboard manifest
vendor/open-props.min.css   Open Props 1.7.17 (MIT)
fonts/                      Geist Sans and Geist Mono (variable)
favicon.svg                 Monogram mark
netlify.toml                Publish config, cache headers, CSP
```

## Design decisions

The house style across the sibling dashboards is self-hosted Geist, a single
green accent, and tabular numerals on figures. This portal follows that, but
deliberately spends far less space on chrome than a dashboard would.

- **One line of chrome.** The page used to open with a four-stat summary block
  and a paragraph of explanation, which pushed all five dashboards below the
  fold — the whole point of the page was invisible on arrival. There is now a
  single quiet meta line that shows either the filter count or the health
  summary, never both.
- **Cards are the content.** No oversized primary button per card: the whole
  card is the link (a stretched link on the title, so the repo button stays
  independently clickable and focus order stays sane). That alone cut card
  height by roughly a third.
- **Shape:** cards 16px, controls 8px, only status pills fully round.
- **Colour:** one accent for every interactive element — buttons, links, focus
  rings, the active chip. Each card additionally carries its own identity tone
  on its monogram tile and hover border only. Those tones are real values from
  each project's own palette (Content Tracker's gold, Irish Visa's emerald,
  RBI's slate, Module Picker's blue), so a card's colour matches the product it
  opens rather than being decoration.
- **Contrast:** every text element clears WCAG AA 4.5:1 in both themes,
  including the monogram tiles on their tinted backgrounds. Verified by
  compositing the translucent tints, not by eyeballing. Do not lighten the
  light-mode `--text-soft`.
- **Motion:** transform and opacity only, all of it switched off under
  `prefers-reduced-motion`.
- **Accessibility:** the search box has a real label (visually hidden), status
  changes announce through `aria-live`, focus rings are visible on both themes,
  and `/` focuses the filter from anywhere.
- **Icons** come from Lucide and are inlined by glyph. Do not hand-draw
  replacements.

## Local preview

Any static server works, since there is no build step:

```bash
python -m http.server 8000
```
