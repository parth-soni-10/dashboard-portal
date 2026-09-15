# Dashboard Portal

One page that links every deployed dashboard, previews each one live inside its
own row, and checks whether it still answers. Static
HTML, CSS and JavaScript with no build step, matching the other dashboards —
the one piece that needs a server (reading the Content Tracker's figures) is a
single Netlify Function, because that dashboard's data endpoint cannot be read
from a browser on this origin.

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

`verified` surfaces in the status pill's tooltip. It exists because a probe is
not sufficient evidence on its own: a dashboard that blocks cross-site checks
can never confirm itself, so the date the link was last opened by hand is the
honest fallback. It is only shown for entries that actually have a `url` — a
deployment that does not exist cannot have been checked.

`tone` is optional; omit it and the row falls back to the house accent.

`embed` declares whether the dashboard can be shown in a frame. It defaults to
true; set it to `false` for a site that ships `X-Frame-Options: DENY` or a
`frame-ancestors` policy that excludes this page. The row then explains that
instead of showing a browser error page. `node tools/check-embed.mjs` asserts
these flags against the live response headers, so a dashboard that changes its
policy is caught rather than silently breaking its preview.

`count` makes parts of a description live, and is optional:

```js
  description: '{titles} titles logged — {shows} shows — and yearly comparisons.',
  count: {
    endpoint: '/api/watchlist',        // same-origin route, proxied server-side
    source: 'the watchlist Google Sheet',   // named in the hover text
    recorded: '2026-09-15',            // when the fallbacks below were true
    fallback: { titles: 363, shows: 277 }
  }
```

Each `{placeholder}` is filled from the endpoint, so **never write one of those
numbers into the sentence by hand** — a hand-written literal is exactly how this
number went stale in the first place. The `fallback` values paint immediately
and stand in if the reading never completes, and the figures carry hover text
saying which of the two you are looking at: "Live from … , read at 09:41" or
"Last recorded figures, from 15 Sept 2026. The live reading did not complete."
A recorded number is never presented as a live one.

`url` must be an **absolute** `http://` or `https://` address, and it is
enforced rather than assumed. A typo like `example.com` is a *relative* URL,
which would render as a link to nowhere and — far worse — would be probed
against this page's own origin, come back successful, and paint the row green.
An unusable value is therefore refused: the row shows no link, reports
"Bad link", prints the offending value where the hostname goes so the typo is
visible, and the footnote names the entry to fix.

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
| `amber` | RBI Weekly | `#8a5205` | `#e9b949` | `--brand` (RBI declares dark first) |
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
| Bad link | Amber | The `url` is not an absolute http(s) address. Neither linked nor checked. |
| Offline | Grey | The device reports no network connection. |
| Not deployed | Grey | No `url` recorded yet. |
| Checking | Grey | A check is in flight. |

**There are no status chips, deliberately.** A row's own pill already says what
that row is, so a filter that hides rows by status mostly managed to hide the
answer — the state is visible in place, one line per dashboard. The search box
stays, because finding a dashboard by name is a different job from filtering by
state, and it searches the tags and the live figures as well as the name.

That is also why the link check never says "down": a cross-origin check cannot
tell a dead host from a host that refuses to be checked.

The check is a `HEAD` request with `mode: 'no-cors'`. The response is opaque, so
its body can never be read: a `GET` would invite a transfer of the whole page of
every dashboard (one of them is 212 KB) for information that gets discarded
regardless. `HEAD` asks the only question being asked — did the host answer?

Either verb leaves a companion `net::ERR_ABORTED` in devtools. That is Chrome
discarding the opaque response, not a failed check: the 200 arrives first and
the pill still resolves to Reachable. Do not chase it.

A dashboard that
ships `Cross-Origin-Resource-Policy: same-origin` in its own `netlify.toml`
refuses cross-site checks outright, so its row would sit on "Could not verify"
while the site is perfectly healthy. Calling that "Unreachable" would be a lie,
hence the softer wording, and a footnote under the list names the offending
dashboard instead of leaving you guessing. No dashboard listed today triggers
it, but the Expense Tracker repo sets that header, so a future entry can.

Results are cached in `sessionStorage` for five minutes so the page never
hammers four hosts on every keystroke. The refresh button in the bar clears the
cache and probes everything again. Transient states are never cached — and a
cache holding no durable results at all is treated as a miss rather than a hit,
so badges cannot be stranded on a stale state for the rest of the window.

Being offline is a settled state, not a pending one. Every pill reads "Offline
", the summary reports 0 reachable, and the footnote explains that no link could
be checked and that they may be perfectly healthy. The alternative — reporting
"checking links" indefinitely while every badge already says otherwise — is a
lie the first version told.

If a dashboard ever moves to a custom domain, add that origin to `connect-src`
in `_headers` or its pill will read "Could not verify" for the wrong reason.

## Live figures

The Content Tracker row prints figures read from that dashboard's own data. It
cannot be read from here directly: its endpoint sends no
`Access-Control-Allow-Origin` and answers `OPTIONS` with 405, so a browser on
this origin is not allowed to see the response. `netlify/functions/watchlist-count.js`
therefore does the reading server-side and returns three integers —
the upstream document is 84 KB and the page wants three numbers out of it, so
the document never leaves the function. Netlify caches the response for fifteen
minutes, so the sheet is read at most once per quarter hour however many people
visit.

The counting rules are copied verbatim from `ContentTrackerDashboard/app.js`,
including its own row filter (a row counts only when it has a name and a year
above zero). They have to match, because a "shows" figure that disagrees with
the dashboard it describes is worse than no figure at all.

Two things it does deliberately:

- **A failure is never cached.** The response carries `no-store` on error, so a
transient upstream problem cannot pin a wrong answer at the edge for the whole
  TTL. The page falls back to the recorded figures with an honest tooltip.
- **The read time travels with the figures.** If the edge serves a cached copy,
  the tooltip says when they were read rather than implying they are live. A
  timestamp generated in the browser would quietly claim the opposite.

The function's fetch is capped at nine seconds: Netlify kills a synchronous
function at ten, and the upstream has been measured taking eight seconds just to
connect during a cold spell. The page waits twelve, so it always receives the
function's answer instead of cutting it off first.

## Previews

Each row can open a live, scaled view of the dashboard itself, inside its own
row rather than in a floating overlay — so it cannot cover another row, needs no
scroll or resize anchoring, and behaves the same for a mouse, a keyboard and a
thumb. Only one is ever open, and closing it empties the box, which is what
unloads the frame; leaving four detached iframes behind would keep four
dashboards running.

The frame is `1280 x 800`, laid out as it would be on a desktop and then scaled
to fit, which is what makes it read as a miniature of the real page rather than
as a reflowed mobile column. It is sandboxed without `allow-top-navigation`, so
the framed dashboard cannot navigate this page away, and it sends no referrer.

The frame is covered while it loads, and for a beat after `load` fires. That
second part is not padding: these dashboards paint their figures only once they
have fetched their own data, and `load` arrives when the document and its
subresources are done but well before that. Dropping the cover on `load`
therefore revealed a blank box. Measured on RBI Weekly: `load` at 345ms, cover
gone at 1259ms.

Two states have no frame at all, and both say so plainly:

- an entry with `embed: false`
- a frame that never settles, replaced after ten seconds

**The honest limitation:** if a dashboard is down, the browser's own error page
renders inside the frame. From this side that is indistinguishable from a real
page, and no client-side check can tell the difference — so the preview cannot
report it. `embed` plus `tools/check-embed.mjs` is what covers the case that can
be detected: a dashboard starting to refuse frames.

This is also why `_headers` needs `frame-src https://*.netlify.app`. Without it
our own CSP blocks every preview, and it would look like the other dashboard's
fault. `tools/audit.mjs` fails the build if the two ever disagree.

## Verifying the embeds

```bash
node tools/check-embed.mjs
```

Read-only. Runs the manifest against a stand-in for `window`, asks each
dashboard for its headers, and reports whether every `embed` flag matches
reality. Exits non-zero on a disagreement. A dashboard that cannot be reached is
reported as unchecked rather than as a failure — not being able to ask is not an
answer.

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

One thing does need a deploy that processes functions — a repository-connected
deploy, or `netlify deploy` — and that is the Content Tracker's live figures.
`netlify.toml` rewrites `/api/watchlist` to
`/.netlify/functions/watchlist-count`. An exact rewrite, not a wildcard: a
greedy one is how an asset ends up served as `index.html` with a status of 200.
If the function is missing, the row still works and shows its recorded figures.

## Static audit

```bash
tools/audit.mjs
```

Zero-dependency checker that exits non-zero on a finding, so it can be wired
into CI. It catches the failure modes that a read-through misses:

- a CSS class or id selector nothing in the markup or `app.js` produces
- a custom property declared but never read, or read but never defined
- a glyph used but missing from `icons.js`, or defined but never used
- an `@keyframes` block nothing animates
- unbalanced markup, a `getElementById` with no matching id, a dead `#anchor`
- an inline `<script>` or `style=""`, which the CSP would block
- a `dataset.*` attribute assigned but never read
- a manifest field that `app.js` never renders
- a duplicate element id, or a duplicate manifest id
- `target="_blank"` without `rel="noopener"`, a form control with no label, an
  anchor with no href, a missing `lang`
- a manifest field interpolated into markup without going through `esc()`
- a colour literal in JS that appears nowhere in `styles.css` (this is what
  caught the `theme-color` meta drifting away from the real token)
- a `{placeholder}` in a description with no figure to fill it, a recorded
  figure the description never prints, or a `count` block with no endpoint or no
  fallbacks — any of which would print a literal `{shows}` on the page
- a live endpoint with no `[[redirects]]` entry in `netlify.toml`, or one
  pointing at a function file that does not exist — which works locally and
  404s in production
- an `<iframe>` with no `title`, no `sandbox`, or a sandbox permitting
  `allow-top-navigation`, and a page that frames dashboards without a `frame-src`
  in its own CSP

Run it after touching `styles.css`, `icons.js` or `data/dashboards.js`. It is
worth proving that a new check can fail before trusting it: each of the checks
above was confirmed by breaking the thing it guards and watching it report.

## Files

```
index.html                    Page shell: bar, index header, registry, footer
styles.css                    Colour tokens, layout, every rule
app.js                        Rendering, search, link checks, live figures,
                              previews, theme handling
theme-init.js                 Pre-paint theme bootstrap (external, keeps CSP strict)
icons.js                      Tree-shaken Lucide 0.462.0 paths
data/dashboards.js            The dashboard manifest
vendor/open-props.min.css     Open Props 1.7.17 (MIT)
vendor/modern-normalize.css   modern-normalize 3.0.1 (MIT)
fonts/                        Inter, Geist Sans and Geist Mono (variable)
netlify/functions/            watchlist-count.js — the only server-side piece
favicon.svg                   Monogram mark

_headers                      CSP, caching, security headers (all deploy modes)
netlify.toml                  Publish config plus the /api rewrites

tools/dev-server.mjs          Static files + functions, no-store (see below)
tools/audit.mjs               Static hygiene audit (dead CSS, tokens, fields)
tools/check-embed.mjs         Asserts the embed flags against live headers
tools/scrape-design.mjs       Re-runnable evidence collector
tools/design-report.json      What it found, per dashboard
```

## Design decisions

- **The preview opens inside its own row.** Not a floating card and not a
  modal. It cannot cover another row, it needs no scroll or resize anchoring,
  and it works identically for a mouse, a keyboard and a thumb — which a
  hover-card does not. It is also the only arrangement in which the preview
  cannot be confused with the page's own chrome.
- **A figure says where it came from.** Live counts are not just printed; they
  carry the source and the time they were read, and a recorded value is visibly
  different from a live one. A number whose provenance is invisible is a number
  nobody can trust.

- **A registry, not a card grid.** Four links to internal tools belong in a
  list. One bordered container with hairline row dividers does the grouping
  that four elevated cards were doing, so nothing reads as a template tile.
- **One band of chrome.** The page opens with a single sticky bar (brand,
  search, refresh, theme) and one line carrying the count or the health
  summary. At 1080px the first row starts 130px down the page; the version this
  replaced started it at 359px, below the fold.
- **The whole set fits one screen.** Four rows measure 117px each, so the
  registry is 467px and the page needs no scrolling at desktop heights.
- **Shape is locked.** Containers 14px, controls 6px, status pills fully round.
- **Boundary rule.** Hairline `--border` for surfaces you read, stronger
  `--border-strong` for controls you operate.
- **Fonts:** Inter and Geist are preloaded; Geist Mono deliberately is not.
  Resource Timing confirms each face is fetched exactly once per load, with
  `initiatorType: "link"` for the two preloaded ones — so the preload is what
  fetches them and the stylesheet reuses the same bytes. Geist Mono is only used
  for numerals and the host line, so letting CSS pull it on demand keeps it off
  the critical path.

  Chrome may still log *"inter.woff2 was preloaded but not used within a few
  seconds"*. That is a false positive for CSS-initiated font loads and the
  Resource Timing entries above are the evidence: one request, not two. Do not
  "fix" it by deleting `crossorigin` — that causes a genuinely duplicated fetch.

- **Motion:** transform and opacity only, all of it switched off under
  `prefers-reduced-motion`. The entrance stagger is gated on a class applied to
  the first render only, so searching does not replay it on every keystroke.
- **Accessibility:** the filter has a real label (visually hidden), status
  changes announce through `aria-live`, the row focus ring is inset (`:focus-within`
  on the row, since the anchor is a stretched-link overlay and an outline on it
  would trace the wrong box), and `/` focuses the filter from anywhere.
- **Long tokens wrap, they do not vanish.** `.row-title`, `.row-desc`,
  `.footnote` and `.empty-body` set `overflow-wrap: anywhere`, because the
  manifest is hand-written and a description can hold a long unbroken URL. The
  registry's `overflow: hidden` would otherwise clip it silently — no scrollbar,
  no ellipsis, content just gone. `anywhere` rather than `break-word` so the
  grid track's min-content size shrinks too, which is what lets the column
  actually narrow.
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

```bash
node tools/dev-server.mjs        # http://127.0.0.1:4180/
node tools/dev-server.mjs 4181   # if that port is taken
```

It serves the static files and the functions behind exactly the routes
`netlify.toml` rewrites to, reading that file rather than repeating the list, so
local routing cannot drift from production. Everything is sent `no-store`.

That last part matters. `python -m http.server` sends no `Cache-Control` at all,
so Chrome applies heuristic caching to every subresource and will happily keep
serving a `styles.css` or `data/dashboards.js` you have already changed — even
after a touch and a reload, and even after confirming the file on disk is
correct. It is not theoretical: it masked a CSS fix here and made a working rule
look broken, and a later fix looked like it had not applied when it had. If a
change does not appear, check `getComputedStyle` before assuming the rule is
wrong. Any static server still works for the shell alone; this one exists so the
figures can be tested locally too.

There is also a `<noscript>` block. The list is built in the browser, so with
scripting off the page would otherwise be blank with no explanation.
