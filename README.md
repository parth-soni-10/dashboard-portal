# Dashboard Portal

One page that links every deployed dashboard, checks whether each one still
answers, and keeps the set filterable. Static HTML, CSS and JavaScript with no
build step, matching the other dashboards.

## Adding or changing a dashboard

Everything on screen comes from `data/dashboards.js`. Edit that file, commit,
and Netlify redeploys it. Nothing else needs touching.

```js
{
  id: 'rbi-weekly',            // stable slug, used as the row's data-id
  name: 'RBI Weekly Dashboard',
  tone: 'amber',               // identity colour: forest, emerald, amber, cobalt
  description: 'One sentence. Clamped to two lines in the row.',
  url: 'https://example.netlify.app/',   // null until it is deployed
  repo: 'https://github.com/parth-soni-10/RBI-Weekly-Data-Dashboard',
  tags: ['Scrapers', 'World Bank'],      // the filter box also matches these
  verified: '2026-09-14'                 // ISO date you last opened it by hand
}
```

`tone` is optional; omit it and the row falls back to the house accent.

A `null` URL is a real state, not a bug. The row dims, reads "Not deployed",
shows "No deploy URL recorded" where the hostname would be, and offers only the
repository link, so there is never a call to action that leads nowhere.

## Libraries

Everything is vendored, so the page keeps working under `script-src 'self'`
with no build step and nothing to install:

| Library | Version | Role |
|---|---|---|
| [Open Props](https://open-props.style) (MIT) | 1.7.17 | Scale tokens: spacing, type ramp, radii, shadows, easings |
| [modern-normalize](https://github.com/sindresorhus/modern-normalize) (MIT) | 3.0.1 | Cross-browser baseline |
| [Lucide](https://lucide.dev) (ISC) | 0.462.0 | Icons, tree-shaken to the 7 glyphs the page renders |
| Inter, Geist, Geist Mono | variable | Self-hosted type, same files the sibling dashboards use |

**Why Open Props and not Tailwind or Shoelace.** Tailwind produces great results
but needs a build step and a `node_modules` tree, which would make this the only
repo in the set that cannot be drag-dropped onto Netlify. Shoelace / Web Awesome
would supply accessible components, but its default language is a generic
web-component look that fights the house style, and four rows do not need a
component runtime. Open Props supplies the part that actually improves a design
at this size — a proven spacing/type/shadow scale — with zero runtime. If you
would rather have the utility-class workflow, it can be swapped in; nothing else
depends on this choice.

The two token layers are kept deliberately separate:

- **Scale** comes from Open Props (`--size-*`, `--radius-*`, `--shadow-*`,
  `--font-size-*`, `--ease-*`). Do not hand-roll replacements. Note its spacing
  ramp skips 12px: 4 / 8 / 16 / 20 / 24 / 28 / 32 / 48 / 64. Where a 12px
  optical nudge is genuinely needed it is written as a literal in `styles.css`.
- **Colour** is hand-tuned and contrast-verified, because it has to match the
  sibling dashboards exactly. Do not take colour from Open Props.

## Where the design comes from

Not invented. `tools/scrape-design.mjs` fetches each deployed dashboard, pulls
its real custom properties out of its own CSS, and writes the evidence to
`tools/design-report.json`. Run it to regenerate:

```bash
node tools/scrape-design.mjs
```

What it established, and how it shaped `styles.css`:

| Found | Used for |
|---|---|
| Inter in all five frontends; Geist + Geist Mono in the two newest | The three self-hosted faces |
| `--r-container: 14px` / `--r-control: 6px` (Irish Visa, RBI) | The radius pair, verbatim, no invented scale |
| Module Picker's `--bg #f4f5f7 / #101216` — the most neutral of the five | The portal's own ground and surface |
| Content Tracker's shadows tinted `rgba(16,35,26,.05)`, never black | Every shadow here is tinted toward the ink hue |
| RBI's `--bg-tint-1` / `--bg-tint-2` radial gradients | The ambient wash behind the page, in the portal's accent |
| Each project's own brand token, light + dark | The per-row tone system (below) |

### Tones

Each row's identity colour is one dashboard's **own** brand token, including its
own light/dark pair. Nothing here is invented.

| Tone | Dashboard | Light | Dark | Source token |
|---|---|---|---|---|
| `forest` | Content Tracker | `#245c42` | `#7cc4a0` | `--green` |
| `emerald` | Irish Visa Tracker | `#166534` | `#6ee7b7` | `--green-text` |
| `amber` | RBI Weekly | `#8a5205` | `#e9b949` | `--brand` (dark-first in that project) |
| `cobalt` | CSNL Module Picker | `#1d4ed8` | `#60a5fa` | `--accent` |

`emerald` and `amber` deliberately use their project's *text* token rather than
its fill token: `#059669` and `#e9b949` are fills, and fail as small text. The
tone appears only on the row's leading edge key and its index numeral; every
interactive element stays on the single house accent.

## The link check, and what its pills mean

| Pill | Colour | Meaning |
|---|---|---|
| Reachable | Green | This browser completed a request to the dashboard. |
| Could not verify | Amber | The check did not complete. Not a claim that the site is down. |
| Offline | Grey | The device reports no network connection. |
| Not deployed | Grey | No `url` recorded yet. |
| Checking | Grey | A check is in flight. |

The wording is deliberately hedged, because a cross-origin check cannot tell the
difference between a dead host and a host that refuses to be checked.

Reads happen with `fetch(url, { mode: 'no-cors' })`: the response body is
opaque, but the promise still resolves when the host answers. A dashboard that
ships `Cross-Origin-Resource-Policy: same-origin` in its own `netlify.toml`
refuses cross-site checks outright, so its row would sit on "Could not verify"
while the site is perfectly healthy. Calling that "Unreachable" would be a lie,
hence the softer wording, and a footnote under the list names the offending
dashboard instead of leaving you guessing. No dashboard listed today triggers
it, but the Expense Tracker repo sets that header, so a future entry can.

Results are cached in `sessionStorage` for five minutes so the page never
hammers four hosts on every keystroke. The refresh button in the bar clears the
cache and probes everything again. Transient states are never cached.

If a dashboard ever moves to a custom domain, add that origin to `connect-src`
in `_headers` or its pill will read "Could not verify" for the wrong reason.

## Deploying to Netlify

Pure static, `publish = "."`, no build command. Either connect the repository or
drag the folder onto Netlify Drop.

**Response headers live in `_headers`, not `netlify.toml`,** and that is
deliberate. Netlify only reads `netlify.toml` for a repository-connected deploy;
a drag-and-drop or API/zip deploy ignores it completely and would ship the site
with no CSP at all while the repo still looked correct. `_headers` works in
every deploy mode. `netlify.toml` keeps only the build config. Keep it that way.

The CSP is `script-src 'self'` and `style-src 'self'` with no hashes, so there
is no inline script or `style` attribute anywhere in the page. The theme
bootstrap that runs before first paint lives in `theme-init.js` precisely so it
can stay an external file. **If you ever add an inline `<script>` or a `style`
attribute, the CSP will block it.** That also blocks Netlify's injected
free-plan badge, which is intended.

## Files

```
index.html                    Page shell: bar, index header, registry, footer
styles.css                    Colour tokens, layout, every rule
app.js                        Rendering, filtering, link checks, theme handling
theme-init.js                 Pre-paint theme bootstrap (external, keeps CSP strict)
icons.js                      Tree-shaken Lucide 0.462.0 paths
data/dashboards.js            The dashboard manifest
vendor/open-props.min.css     Open Props 1.7.17 (MIT)
vendor/modern-normalize.css   modern-normalize 3.0.1 (MIT)
fonts/                        Inter, Geist Sans and Geist Mono (variable)
tools/scrape-design.mjs       Re-runnable evidence collector
tools/design-report.json      What it found, per dashboard
favicon.svg                   Monogram mark
_headers                      CSP, caching, security headers (all deploy modes)
netlify.toml                  Publish config only
```

## Design decisions

- **A registry, not a card grid.** Four links to internal tools belong in a
  list. One bordered container with hairline row dividers does the grouping
  that four elevated cards were doing, so nothing reads as a template tile.
- **One band of chrome.** The page opens with a single sticky bar (brand,
  filter, refresh, theme) and one line carrying the count or the health
  summary. At 1080px the first row starts 130px down the page; the version this
  replaced started it at 359px, below the fold.
- **The whole set fits one screen.** Four rows measure 117px each, so the
  registry is 467px and the page needs no scrolling at desktop heights.
- **Shape is locked.** Containers 14px, controls 6px, status pills fully round.
- **Boundary rule.** Hairline `--border` for surfaces you read, stronger
  `--border-strong` for controls you operate.
- **Motion:** transform and opacity only, all of it switched off under
  `prefers-reduced-motion`.
- **Accessibility:** the filter has a real label (visually hidden), status
  changes announce through `aria-live`, the row focus ring is inset (`:focus-within`
  on the row, since the anchor is a stretched-link overlay and an outline on it
  would trace the wrong box), and `/` focuses the filter from anywhere.
- **Contrast:** every text element clears WCAG AA 4.5:1 in both themes,
  including the tone numerals and the status pills, verified by compositing the
  translucent tints rather than eyeballing. The tightest pair is the light-mode
  "Reachable" pill at 4.70:1. Text on the accent uses `--on-accent`, which has
  to flip with the theme because the dark accent is a light mint.
- **Icons** come from Lucide and are inlined by glyph. Do not hand-draw
  replacements.

### Responsive

Two layouts, both declared in the same component:

- **≥700px:** a three-column row — 26px index numeral, text column, right rail
  carrying the status pill, host and tags.
- **<700px:** the row re-flows to `title / description / tags / status+actions`.
  The two wrappers dissolve with `display: contents` so their children can be
  placed on the row grid directly, the numeral is dropped, and the hostname is
  hidden as redundant with the row being a link.

Below 700px the filter wraps to a second line inside the sticky bar rather than
disappearing, so it stays reachable on a phone.

## Local preview

Any static server works, since there is no build step:

```bash
python -m http.server 8000
```
