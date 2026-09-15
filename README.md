# Dashboard Portal

One page that links every deployed dashboard and previews each one live inside
its own row. Static HTML, CSS and JavaScript with no build step, matching the
other dashboards — the one piece that needs a server (reading the Content
Tracker's figures) is a single Netlify Function, because that dashboard's data
endpoint cannot be read from a browser on this origin.

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
  tags: ['Scrapers', 'World Bank']       // the filter box also matches these
}
```

`tone` is optional; omit it and the numeral falls back to the interface ink,
which is what the whole interface is drawn in.

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
which resolves against this page instead of against the dashboard, so it looks
like it works while going somewhere entirely wrong. An unusable value is
refused: the row shows no link and no ↗, and prints the offending value where
the hostname goes so the typo is visible on the page rather than buried in the
file.

A `null` URL is a real state, not a bug. The row dims, shows "No deploy URL
recorded" where the hostname would be, and offers only the repository link, so
there is never a call to action that leads nowhere.

## Libraries

Everything is vendored, so the page keeps working under `script-src 'self'`
with no build step and nothing to install:

| Library | Version | Role |
|---|---|---|
| [Open Props](https://open-props.style) (MIT) | 1.7.17 | Scale tokens: spacing, type ramp, easings |
| [modern-normalize](https://github.com/sindresorhus/modern-normalize) (MIT) | 3.0.1 | Cross-browser baseline |
| [Lucide](https://lucide.dev) (ISC) | 0.462.0 | Icons, tree-shaken to the 8 glyphs the page renders |
| Inter, Geist, Geist Mono | variable | Self-hosted type, same files the sibling dashboards use |

**Why Open Props and not Tailwind or Shoelace.** Tailwind produces great results
but needs a build step and a `node_modules` tree, which would make this the only
repo in the set that cannot be drag-dropped onto Netlify. Shoelace / Web Awesome
would supply accessible components, but its default language is a generic
web-component look that fights the house style, and four rows do not need a
component runtime. Open Props supplies the part that actually improves a design
at this size — a proven spacing and type scale — with zero runtime. If you
would rather have the utility-class workflow, it can be swapped in; nothing else
depends on this choice.

The two token layers are kept deliberately separate:

- **Scale** comes from Open Props (`--size-*`, `--font-size-*`, `--ease-*`). Do
  not hand-roll replacements. Note its spacing ramp skips 12px: 4 / 8 / 16 / 20 /
  24 / 28 / 32 / 48 / 64. Where another value is genuinely needed — the 3px
  optical nudge on the host line, the 12px hover bleed — it is a literal,
  called out at the rule that needs it.
- **Colour** is hand-tuned and contrast-verified, because it has to match the
  sibling dashboards exactly. Do not take colour from Open Props. Two things are
  no longer borrowed from it: the `--shadow-*` ramp (this design has no
  elevation) and the `--radius-*` ramp (its 1rem step is not this project's
  container radius).

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
| Module Picker's stated language: "neutral zinc, one disciplined blue accent, restrained motion" | The direction of the whole page, accent included — the accent is ink (below) |
| `--r-container: 14px` / `--r-control: 6px` (Irish Visa, RBI) | The radius pair, verbatim — and the reason there is no invented radius scale |
| Module Picker's `--bg #f4f5f7 / #101216` — the most neutral of the five | The ground, with its blue cast dropped |
| Each project's own brand token, light + dark | The per-row tone system (below) |
| RBI's `--bg-tint-1` / `--bg-tint-2` radial gradients | **Not used.** See "What the redesign removed" |

### What the redesign removed

The first version of this page was assembled from the scrape above and still
read as generated. The tells were measurable, and each went for a reason:

| Removed | Why |
|---|---|
| A 14px-radius card around the whole list, with a drop shadow | The single most recognisable template shape there is, grouping four rows that four hairlines group more honestly |
| `--ambient-1` / `--ambient-2` radial gradients behind the page | Decoration that carried no information, and a flat ground reads as a document |
| A backdrop-blurred sticky bar | A compositor layer bought to say "app" |
| A tinted rounded-square `DP` monogram, in the bar and in the favicon | Initials in a rounded tinted square is the default mark of every generated project |
| A coloured interface accent | Every candidate collided with a row's own identity colour. Ink cannot. See below |
| Three uniform bordered icon buttons per row | Borderless until hovered, so the index is text and rules rather than 12 little boxes |

### Why the accent is ink

The page has no accent colour, which is the one deviation from Module Picker's
"one disciplined blue accent". A blue would have been read as Module Picker and
a green as Irish Visa — the accent would have said "this row is special" when it
meant "this control is clickable". So links, focus rings, selection and the open
state are all ink on ground, and the four tones are the only colour on the page.

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
its fill token: `#059669` and `#e9b949` are fills, and fail as small text.

There is one `--tone` per row, not the `--tone` / `--tone-ink` pair the first
version carried. That pair existed because a tone had to serve as both a fill
and as small text, and the two values diverged. Colour now lands on exactly two
things — the index numeral, and the icon on a preview that cannot be framed — so
only the text-safe variant is ever needed. That deletes a whole class of bug
where the fill leaks into text, and the numerals measure **7.1:1 to 9.4:1**
against the ground in both themes.

## No status indicator, deliberately

There is no per-row badge reading Reachable / Offline / Could not verify, and no
summary counting how many links answered. Both are gone, and so is the link
check that fed them.

The check was never trustworthy enough to wear a colour. A `HEAD` request with
`mode: 'no-cors'` is the only cross-origin check a page may make, and it reports
that *this browser* could not complete a request — which is not the same as the
dashboard being down. A host shipping `Cross-Origin-Resource-Policy: same-origin`
refuses every such request by design while being perfectly healthy, and a typo'd
relative URL resolves against this page's own origin and reads as green. That
left a badge with states that were guesses, displayed with the same confidence
as the one state that was not.

Two things replaced it, and both are better evidence than a probe ever was:

- **The preview.** It loads the real dashboard, in the row, on demand — so "is
  this up?" is answered by showing you the thing itself.
- **The link.** Clicking it is the only test that actually settles the question.

What went with the badge: the probe, the five-minute `sessionStorage` cache, the
refresh button in the bar, the footnote under the list, the `--ok` / `--warn-soft`
status tokens, the `pulse` keyframe, and the `connect-src https://*.netlify.app`
those probes needed. A check with nothing to display is four requests per visit
for no reader.

The search box stays, because finding a dashboard by name is a different job
from filtering by state — and it searches the tags and the live figures too.

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

This is also why `_headers` needs a `frame-src`. Without one our own CSP blocks
every preview, and it would look like the other dashboard's fault. It names the
three framable origins individually rather than `https://*.netlify.app`: a
wildcard let every subdomain on the platform be framed by this page to serve
three known hosts, which is the same reasoning that closed `connect-src` down to
`'self'`. Irish Visa Tracker is absent on purpose — it can never be framed.
`tools/audit.mjs` fails if an embeddable entry's origin is missing from
`frame-src`, if `frame-src` allows an origin nothing uses, or if it is a
wildcard, so the manifest and the policy cannot drift apart.

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

`publish = "."` is what lets this deploy with no build step, and it has a cost
worth naming: **everything in the repository is uploaded, so every tracked file
is a public URL.** Shipping the audit, this README, the manifest's worked
examples and the function's own source does not leak a secret, but it is not
something to discover later either. `_redirects` answers those paths with a 404,
and `tools/audit.mjs` keeps the two lists honest — it fails when a file is added
that is neither public on purpose nor blocked, so the next development file
cannot quietly start shipping.

`_redirects` is also where one Netlify behaviour has to be known or the whole
thing silently does nothing: **redirects shadow a URL that resolves to a file
the site actually has, and that applies to custom 404s too.** Every path blocked
there is listed precisely *because* a file sits at it, so each rule carries a
`!` after the status — `404!` — which is Netlify's "even though the file
exists". Without it the rule reads as a block and serves the file with a 200.
The audit fails on a 404 rule missing its `!`, and `tools/dev-server.mjs` models
the shadowing, so a rule that cannot fire 404s locally *and* reports itself
rather than looking fixed until someone visits the deployed site.

Everything the page needs still resolves: `/tools/…`, `/README.md`,
`/.gitignore`, `/netlify/…`, `/netlify.toml`, `_headers`, `_redirects` and
`/.git/…` return 404, while every asset returns 200 and the function still
answers at `/api/watchlist`.

`/.git` is the one that was actually reachable, and it is worth knowing why it
went unnoticed. The audit's "nothing is published by accident" check walks the
*tracked* files and skips `.git` while doing it, so the directory was covered by
no check at all — `tools/dev-server.mjs` served `/.git/config` with a 200, and
that file names the remote while the objects behind it are every blob ever
committed, including anything added and later removed. There is now a rule for
it, and a check that looks at the publish root rather than at the file list, so
the next dot-directory is caught on the way in. `/.netlify` is the deliberate
exception: that is where the function is served from, so a 404 rule over it
would break `/api/watchlist`.

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
- a file that would be published but is neither declared public nor blocked in
  `_redirects` — the check that stops a development file from going live
- a `_redirects` 404 rule with no `!`, which Netlify would shadow: the file it
  names stays public while the rule reads as a block
- a dot-entry at the publish root that is not blocked — the gap above, which the
  tracked-file check structurally cannot see
- an `'unsafe-inline'` or `'unsafe-eval'` in the CSP, a `frame-src` wildcard, an
  embeddable entry whose origin is missing from `frame-src`, or an origin there
  that nothing frames
- a `tools/dev-server.mjs` that does not apply `_headers`, because then the CSP
  cannot be exercised locally and a regression reaches production untested
- a theme without `color-scheme`, which leaves scrollbars and form controls
  following the operating system instead of the page
- an `app.js` that keeps no state in the URL, or an `innerHTML` assignment that
  a URL-supplied query could reach (that would be reflected XSS)
- a `transition` on `top`, `width`, `margin` or any other layout property —
  layout on every frame, invisible in a screenshot and obvious on a slow phone

Run it after touching `styles.css`, `icons.js` or `data/dashboards.js`. It is
worth proving that a new check can fail before trusting it: each of the checks
above was confirmed by breaking the thing it guards and watching it report.

## Files

```
index.html                    Page shell: bar, masthead, column header, footer
styles.css                    Colour tokens, layout, every rule
app.js                        Rendering, search, URL state, live figures,
                              previews, theme handling
theme-init.js                 Pre-paint theme bootstrap (external, keeps CSP strict)
icons.js                      Tree-shaken Lucide 0.462.0 paths
data/dashboards.js            The dashboard manifest
vendor/open-props.min.css     Open Props 1.7.17 (MIT)
vendor/modern-normalize.css   modern-normalize 3.0.1 (MIT)
fonts/                        Inter, Geist Sans and Geist Mono (variable)
netlify/functions/            watchlist-count.js — the only server-side piece
favicon.svg                   Index-numeral mark (ink stamp, no tint)

_headers                      CSP, caching, security headers (all deploy modes)
_redirects                    404s that keep development files off the site
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
- **Both pieces of state are in the URL.** `?q=` is the search and
  `#preview-<id>` is the open preview, written with `replaceState` so typing six
  characters does not leave six history entries. A row is then something that can
  be sent to someone — "look at the RBI one" becomes a link — and a reload or a
  link followed from elsewhere arrives in the state it describes, because
  `popstate` and `hashchange` are both applied. The id is matched against the
  manifest rather than used to build a selector, so `#preview-<img src=x
  onerror=…>` is dropped instead of trusted, and `?q=` is capped at 80 characters
  and echoed through `textContent`. The audit fails on an `innerHTML` assignment
  the query could reach.
- **Escape undoes one thing per press, preview first.** The ordering is forced
  rather than chosen: clearing the search re-renders the rows, and the open
  preview lives inside a row, so clearing it while a preview is open would close
  both at once — which is exactly what the page did. Now the first press closes
  the preview and the search text survives; the next clears the field.

- **A specification index, not a card list.** Column labels, hairline rules
  between entries, and no container around them. The list is flush with the page
  because that is what an index is, and the labels are the same grid as a row —
  measured at 1280px, the header cells and the row cells begin at identical x
  (124 / 176 / 844 / 1068). Two grids that must line up but are defined in two
  places is how a table drifts, so both consume one `--grid-cols`.
- **One band of chrome.** A 52px sticky bar carrying the wordmark, the filter
  and the theme control — solid, not blurred. The document heading lives in the
  page below it rather than in the bar, so two titles never compete in the first
  100px.
- **The whole set fits one screen.** The first row starts 215px down at 1280px,
  each row measures 131px, and the index is 527px tall — so the content is under
  one viewport high and the page needs no scrolling at desktop heights.
- **Shape is locked.** Controls 6px, the preview frame 4px. There is no
  container radius left to spend the family's 14px on.
- **Touch and type are declared, not inherited.** `touch-action: manipulation`
  on every control removes the double-tap wait — without it a tap on a row
  stalls for roughly 300ms while the browser waits for a second tap, which is
  the difference between feeling native and feeling laggy. The platform's grey
  tap flash is replaced rather than merely kept: each control draws its own
  pressed state, and two flashes for one tap is worse than one. Headings use
  `text-wrap: balance`, running text `text-wrap: pretty`, and every figure
  `tabular-nums` so a changing number cannot shift its neighbours. `color-scheme`
  follows the *chosen* theme rather than the operating system's, or a visitor
  who picks the theme opposite to their OS gets a white scrollbar down the side
  of a black page.
- **Boundary rule.** Hairline `--line` for structure, stronger `--line-strong`
  for controls you operate.
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
- **Accessibility:** the filter has a real label (visually hidden), the result
  count announces through `aria-live`, the row focus ring is inset
  (`:focus-within` on the row, since the anchor is a stretched-link overlay and
  an outline on it would trace the wrong box), and `/` focuses the filter from
  anywhere.
- **Long tokens wrap, they do not vanish.** `.row-title`, `.row-desc`,
  `.row-tags`, `.preview-note` and `.empty-body` set `overflow-wrap: anywhere`,
  because the manifest is hand-written and a description can hold a long
  unbroken URL. The host column is the one exception: it truncates with an
  ellipsis, because wrapping there would change a row's height. `anywhere`
  rather than `break-word` so the grid track's min-content size shrinks too,
  which is what lets the column actually narrow.
- **Contrast:** measured, not eyeballed. A sweep of every text-bearing element
  in both themes — 34 of them — finds **zero** below AA. The tightest pair is
  the `/` key hint: 5.00:1 light, 4.76:1 dark. The tone numerals run 7.1:1 to
  9.4:1. The sweep was verified by painting a label nearly invisible and
  confirming it reports 1.14:1, because a contrast check that cannot fail is
  not evidence.
- **Icons** come from Lucide and are inlined by glyph. Do not hand-draw
  replacements.
- **The bar can never be wider than the viewport.** The wordmark does not
  shrink; the filter field gives up its width first, down to a 4rem floor. The
  first version of this bar overflowed a 323px screen by 1px — enough to give
  the entire page a horizontal scrollbar — because the old bar wrapped instead.

### Responsive

Two layouts, both declared in the same component:

- **≥760px:** four columns — a 28px numeral, the subject, a 200px host column
  and an 88px actions column, under a header row that labels the first three.
- **<760px:** three columns and three bands:
  `num+title+actions / description / tags+host`. The header band is dropped
  (there are no columns left for it to label), `.row-main` dissolves with
  `display: contents` so its children land on the row grid directly, and the
  hostname is hidden as redundant with the row being a link — except on a row
  that is *not* a link, where it is the only thing explaining why.

**The numeral stays at every width.** It is the only colour on the page, so
dropping it on mobile would have left the whole small-screen layout monochrome
for the sake of one 11px column.

## Local preview

```bash
node tools/dev-server.mjs        # http://127.0.0.1:4180/
node tools/dev-server.mjs 4181   # if that port is taken
```

It serves the static files and the functions behind exactly the routes
`netlify.toml` rewrites to, reading that file rather than repeating the list, so
local routing cannot drift from production. It also reads `_redirects` and
applies the same 404s, **including the shadowing rule** — an unforced rule only
fires for a path that genuinely does not exist. That detail is what makes the
server worth having: a rule that forgot its `!` serves the file here exactly as
Netlify would, instead of 404ing locally and lulling you into thinking the path
is blocked. Everything is sent `no-store`.

It reads `_headers` too, and applies it. That was the half it did not model, and
the cost was real: production ships `script-src 'self'` while locally an inline
`<script>`, an `onclick=` attribute or a CDN script all worked perfectly and
failed only after deploying — a policy that cannot be exercised where the code
is written is a policy that regresses. Headers from every matching block are
merged in file order, so `/fonts/*` keeps its 30-day cache while `/*` supplies
the security headers, exactly as it does on Netlify. **Function responses are
deliberately not touched**, because Netlify does not apply `_headers` to them
either: a function owns its own headers.

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
