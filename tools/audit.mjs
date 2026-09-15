/**
 * Static hygiene audit for the portal. Zero dependencies, no build step.
 *
 *   node tools/audit.mjs
 *
 * Exits non-zero when it finds something, so it can be wired into CI.
 *
 * What it checks, and why each one is a real failure mode rather than a style
 * preference:
 *
 *   1. Every CSS class / id selector is actually produced by the markup or by
 *      app.js. A selector nothing matches is dead weight that silently rots.
 *   2. Every custom property is both defined and consumed. A token defined but
 *      never read is a lie about the design system.
 *   3. Every `data-icon` / `icon('x')` name exists in icons.js. A missing glyph
 *      renders an empty box and only logs a console warning, which is easy to
 *      ship by accident.
 *   4. Every @keyframes block is referenced by an animation declaration.
 *   5. Elements in index.html are balanced, and every element id referenced by
 *      app.js exists in the markup.
 *   6. No inline <script> or style="" attribute, because the CSP is
 *      script-src 'self' / style-src 'self' with no hashes.
 *   7. No data-* attribute is written by JS and then never read by anything —
 *      write-only state is invisible dead code.
 *   8. Every field in the manifest is actually rendered. A documented field
 *      nothing consumes is worse than no field: it looks supported.
 *   9. Every colour literal in JS exists in styles.css. This is what catches a
 *      hardcoded theme-color drifting away from the real token.
 *  10. No duplicate element ids, and no duplicate manifest ids (a duplicate id
 *      makes the status lookup and the filter silently wrong).
 *  11. Every target="_blank" carries rel="noopener", every form control has a
 *      label, and every <a> has an href.
 *  12. A manifest entry can never inject markup: every field app.js renders is
 *      passed through esc(), and esc() is present at all.
 *  13. Every {placeholder} in a description has a figure to fill it, every
 *      recorded figure is printed somewhere, and a count block has both an
 *      endpoint and fallbacks. A mismatch here prints a literal "{shows}" on
 *      the page, which no other check would catch.
 *  14. Every live endpoint is routed by netlify.toml, and the function it is
 *      routed to exists. An unrouted endpoint works locally and 404s in
 *      production, which is the worst possible place to find out.
 *  15. Frames are declared deliberately: a title, a sandbox that cannot
 *      navigate this page away, and a frame-src in our own CSP. Without the
 *      last one the preview is blocked by this site's policy and looks like
 *      the other dashboard's fault.
 *  16. Every file in the repository is either intentionally public or blocked
 *      in `_redirects`, and every blocking rule actually fires. The site is
 *      published from the repo root, so an undeclared file is a live URL: this
 *      is what stops a development file from quietly shipping the next time one
 *      is added, and what stops a rule that Netlify would shadow from passing
 *      as a block.
 *  17. The stylesheet's braces balance, so its nesting matches what it reads
 *      as. An extra `}` is skipped by the browser and renders fine, which is
 *      precisely why nothing else catches it.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');

const [html, css, app, icons, themeInit, manifest, headerRules, toml, redirectRules] =
  await Promise.all([
    read('index.html'),
    read('styles.css'),
    read('app.js'),
    read('icons.js'),
    read('theme-init.js'),
    read('data/dashboards.js'),
    read('_headers'),
    read('netlify.toml'),
    read('_redirects').catch(() => '')
  ]);
const functionFiles = await readdir(join(root, 'netlify/functions')).catch(() => []);
const js = [app, icons, themeInit].join('\n');

const allSource = [html, app, icons, themeInit, manifest].join('\n');

// `_headers` without its prose. The CSP is read out of this, not out of the raw
// file, because the comments there necessarily *talk about* directives — an
// early version of these checks read a comment that mentioned frame-src and
// reported on that instead of on the policy, which is the same failure mode that
// made the frame-sandbox check match its own explanatory note.
const headerCode = headerRules
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .join('\n');

const problems = [];
const note = (check, detail) => problems.push({ check, detail });
const attr = (source, re) => {
  const m = source.match(re);
  return m ? m[1] : null;
};

/* The manifest, split into its entries once, so more than one check can read
   per-entry values. Entries are separated by the two-space object indent the
   file is written with. */
const entries = manifest
  .split(/\n  \{/)
  .slice(1)
  .map((chunk) => {
    const described = chunk.match(/description:\s*(?:'([^']*)'|"([^"]*)")/);
    const count = chunk.match(/count:\s*\{([\s\S]*?)\n\s*\}/);
    return {
      id: attr(chunk, /\bid:\s*'([^']+)'/),
      text: described ? (described[1] ?? described[2] ?? '') : '',
      count: count ? count[1] : null,
      url: attr(chunk, /\burl:\s*'([^']+)'/),
      // `embed` defaults to true, so only an explicit false is meaningful.
      embedFalse: /\bembed:\s*false\b/.test(chunk)
    };
  });

/** The figure names a `count` block records as its fallbacks. */
function recordedFigures(countBlock) {
  const fallback = countBlock ? attr(countBlock, /fallback:\s*\{([^}]*)\}/) : null;
  return [...(fallback || '').matchAll(/([a-z][a-zA-Z0-9]*)\s*:/g)].map((m) => m[1]);
}

const fallbackKeys = new Set(entries.flatMap((entry) => recordedFigures(entry.count)));

/* -- 1. Dead CSS selectors ------------------------------------------------- */

// Strip comments and at-rule preludes so only real selector text is scanned.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectorText = [];
for (const block of cssNoComments.matchAll(/(^|[};])\s*([^{}@;]+)\{/g)) {
  const sel = block[2].trim();
  if (!sel || sel.startsWith('@')) continue;
  selectorText.push(sel);
}

const usedClasses = new Set();
const usedIds = new Set();
for (const sel of selectorText) {
  for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) usedClasses.add(m[1]);
  for (const m of sel.matchAll(/#(-?[A-Za-z_][\w-]*)/g)) usedIds.add(m[1]);
}

for (const cls of [...usedClasses].sort()) {
  // The token-name match above also picks up things inside :not(.x) etc, which
  // is fine — this only ever reports a class nothing in the source mentions.
  const referenced = new RegExp(`(class=["'][^"']*\\b${cls}\\b|["'\`]\\s*${cls}\\s*["'\`]|\\.${cls}\\b)`);
  if (!referenced.test(allSource) && !new RegExp(`\\.${cls}\\b`).test(allSource)) {
    note('dead-css-class', `.${cls} is not produced by the markup or by app.js`);
  }
}

for (const id of [...usedIds].sort()) {
  if (!new RegExp(`id=["']${id}["']`).test(html)) {
    note('dead-css-id', `#${id} has no matching id="" in index.html`);
  }
}

/* -- 2. Dead custom properties -------------------------------------------- */

const defined = new Map();
for (const m of cssNoComments.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)) {
  if (!defined.has(m[1])) defined.set(m[1], m[2].trim());
}
for (const [name, value] of defined) {
  const consumedInCss = new RegExp(`var\\(\\s*${name}\\b`).test(cssNoComments);
  const consumedInJs = allSource.includes(name);
  if (!consumedInCss && !consumedInJs) {
    // Report once per theme value, so a token declared in both blocks is not
    // counted twice.
    if (!problems.some((p) => p.check === 'unused-token' && p.detail.startsWith(name))) {
      note('unused-token', `${name}: ${value} is declared but never read`);
    }
  }
}

// Every var(--x) that is never defined anywhere is a silent fallback failure.
// A var() carrying a fallback cannot resolve to nothing, and neither can one
// that app.js sets at runtime with setProperty — both are deliberate, so they
// are not findings.
const openProps = await read('vendor/open-props.min.css');
const vendorPlusOwn = cssNoComments + openProps;
for (const m of cssNoComments.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
  const [name, fallback] = [m[1], m[2]];
  if (fallback) continue;
  if (new RegExp(`setProperty\\(\\s*'${name}'`).test(js)) continue;
  if (!new RegExp(`${name}\\s*:`).test(vendorPlusOwn)) {
    note('undefined-token', `var(${name}) is not defined in styles.css or Open Props`);
  }
}

/* -- 3. Icon glyphs ------------------------------------------------------- */

const glyphsDefined = new Set([...icons.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:/gm)].map((m) => m[1]));
// app.js writes markup too, so a glyph it names in a data-icon attribute is
// just as used as one written by hand in index.html.
const glyphsUsed = new Set([
  ...[...html.matchAll(/data-icon=["']([a-z-]+)["']/g)].map((m) => m[1]),
  ...[...app.matchAll(/data-icon=["']([a-z-]+)["']/g)].map((m) => m[1]),
  ...[...app.matchAll(/icon\(\s*'([a-z-]+)'/g)].map((m) => m[1])
]);
for (const g of glyphsUsed) {
  if (!glyphsDefined.has(g)) note('missing-glyph', `"${g}" is used but not defined in icons.js`);
}
for (const g of glyphsDefined) {
  if (!glyphsUsed.has(g)) note('unused-glyph', `"${g}" is defined in icons.js but never used`);
}

/* -- 4. Keyframes --------------------------------------------------------- */

for (const m of cssNoComments.matchAll(/@keyframes\s+([\w-]+)/g)) {
  const name = m[1];
  const referenced = new RegExp(`animation[^;]*\\b${name}\\b`).test(cssNoComments);
  if (!referenced) note('unused-keyframes', `@keyframes ${name} is never animated`);
}

/* -- 5. Markup integrity -------------------------------------------------- */

const idsInHtml = new Set([...html.matchAll(/\sid=["']([\w-]+)["']/g)].map((m) => m[1]));
for (const m of app.matchAll(/getElementById\(\s*'([\w-]+)'\s*\)/g)) {
  if (!idsInHtml.has(m[1])) note('missing-id', `app.js getElementById('${m[1]}') has no match`);
}
for (const m of html.matchAll(/href=["']#([\w-]+)["']/g)) {
  if (!idsInHtml.has(m[1])) note('broken-anchor', `href="#${m[1]}" has no target`);
}

// Every data-icon must live inside an element, and every <li> inside a <ul>.
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'polyline', 'line', 'text', 'use']);
const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
const stack = [];
for (const m of htmlNoComments.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
  const [, close, rawTag, attrs, selfClose] = m;
  const tag = rawTag.toLowerCase();
  if (voidTags.has(tag) || selfClose || /^(doctype|!)/i.test(rawTag)) continue;
  if (close) {
    const last = stack.pop();
    if (last !== tag) note('unbalanced-html', `</${tag}> closes <${last ?? 'nothing'}>`);
  } else {
    stack.push(tag);
  }
}
if (stack.length) note('unbalanced-html', `unclosed: ${stack.join(', ')}`);

/* -- 10. Duplicate ids ---------------------------------------------------- */

const idList = [...html.matchAll(/\sid=["']([\w-]+)["']/g)].map((m) => m[1]);
const idCounts = new Map();
for (const id of idList) idCounts.set(id, (idCounts.get(id) || 0) + 1);
for (const [id, n] of idCounts) {
  if (n > 1) note('duplicate-id', `id="${id}" appears ${n} times in index.html`);
}

const manifestIds = [...manifest.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]);
const manifestIdCounts = new Map();
for (const id of manifestIds) manifestIdCounts.set(id, (manifestIdCounts.get(id) || 0) + 1);
for (const [id, n] of manifestIdCounts) {
  if (n > 1) note('duplicate-manifest-id', `'${id}' is used by ${n} entries`);
}

/* -- 11. Link and control hygiene ----------------------------------------- */

for (const tag of htmlNoComments.matchAll(/<a\b[^>]*>/gi)) {
  const t = tag[0];
  const href = attr(t, /\shref=["']([^"']*)["']/i);
  if (!href || href === '#') note('dead-link', `anchor without a usable href: ${t.slice(0, 70)}`);
  if (/\starget=["']_blank["']/i.test(t) && !/\srel=["'][^"']*noopener/i.test(t)) {
    note('unsafe-blank', `target="_blank" without rel="noopener": ${t.slice(0, 70)}`);
  }
}
const labelFor = new Set([...htmlNoComments.matchAll(/<label\b[^>]*\sfor=["']([\w-]+)["']/gi)].map((m) => m[1]));
for (const tag of htmlNoComments.matchAll(/<input\b[^>]*>/gi)) {
  const t = tag[0];
  if (/\stype=["'](hidden|submit|button)["']/i.test(t)) continue;
  const id = attr(t, /\sid=["']([\w-]+)["']/i);
  const hasAria = /\saria-label(ledby)?=/i.test(t);
  if (!hasAria && (!id || !labelFor.has(id))) {
    note('unlabelled-control', `input has no label or aria-label: ${t.slice(0, 70)}`);
  }
}
if (!/\slang=["'][a-z-]+["']/i.test(htmlNoComments)) note('no-lang', '<html> has no lang attribute');

/* -- 12. Escaping --------------------------------------------------------- */

if (!/function esc\(/.test(app)) note('no-esc', 'app.js has no esc() helper, so manifest text is not sanitised');
// Every field interpolated into markup must go through esc(). This checks the
// ones that are: a bare `item.name` inside a string concatenation would not be.
for (const field of ['name', 'description', 'id', 'tone', 'url', 'repo']) {
  const bare = new RegExp(`\\+\\s*item\\.${field}\\s*\\+`);
  if (bare.test(app)) note('unescaped-field', `item.${field} is concatenated without esc()`);
}

/* -- 6. CSP safety -------------------------------------------------------- */

if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(htmlNoComments)) {
  note('csp', 'index.html has an inline <script>, which script-src \'self\' blocks');
}
if (/\sstyle=["']/i.test(htmlNoComments)) {
  note('csp', 'index.html has an inline style="" attribute, which style-src \'self\' blocks');
}

/* -- 7. Write-only data-* attributes ------------------------------------- */

// A comparison (`dataset.theme === 'dark'`) is a read, not a write, so a plain
// assignment has to be distinguished from `==` / `===`. Counting total uses
// against writes is more robust than a lookahead.
const attrUses = new Map();
for (const m of js.matchAll(/dataset\.([A-Za-z]\w*)/g)) {
  const camel = m[1];
  const rec = attrUses.get(camel) || { total: 0, writes: 0 };
  rec.total++;
  if (/^\s*=(?!=)/.test(js.slice(m.index + m[0].length))) rec.writes++;
  attrUses.set(camel, rec);
}
for (const [camel, rec] of attrUses) {
  const kebab = camel.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const readInJs = rec.total > rec.writes;
  const readInCss =
    new RegExp(`\\[data-${kebab}\\]`).test(cssNoComments) ||
    new RegExp(`\\[data-${kebab}[~^$*|=]`).test(cssNoComments);
  const readInHtml = new RegExp(`data-${kebab}[=\\s>]`).test(html);
  if (!readInJs && !readInCss && !readInHtml) {
    note('write-only-attr', `dataset.${camel} is assigned ${rec.writes}x but never read`);
  }
}

/* -- 8. Manifest fields actually rendered --------------------------------- */

const manifestKeys = new Set(
  [...manifest.matchAll(/^\s*([a-z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1])
);
for (const key of [...manifestKeys].sort()) {
  // A fallback's own keys are not fields: they are the names a description
  // prints, and check 13 proves each of those is used.
  if (fallbackKeys.has(key)) continue;
  if (!new RegExp(`\\.${key}\\b`).test(app)) {
    note('unused-manifest-field', `'${key}' is never read by app.js`);
  }
}

/* -- 9. Colour literals in JS must exist in the stylesheet ---------------- */

for (const m of js.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
  if (!css.toUpperCase().includes(m[0].toUpperCase())) {
    note('stale-colour', `${m[0]} in JS does not appear anywhere in styles.css`);
  }
}

/* -- 13. Live figures ---------------------------------------------------- */

const endpoints = [];

for (const entry of entries) {
  const placeholders = [...new Set([...entry.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
  const figures = recordedFigures(entry.count);

  if (entry.count) {
    const endpoint = attr(entry.count, /endpoint:\s*'([^']+)'/);
    if (!endpoint) {
      note(
        'count-without-endpoint',
        `'${entry.id}' has a count block with no endpoint, so its placeholders would print literally`
      );
    } else {
      endpoints.push(endpoint);
    }
    if (!figures.length) {
      note(
        'count-without-fallback',
        `'${entry.id}' has a count block with no fallback figures, so nothing can paint before the answer arrives`
      );
    }
  }

  for (const name of placeholders) {
    if (!entry.count) {
      note('placeholder-without-count', `'${entry.id}' prints {${name}} but has no count block to fill it`);
    } else if (!figures.includes(name)) {
      note('missing-figure', `'${entry.id}' prints {${name}} but its fallback records no such figure`);
    }
  }

  for (const name of figures) {
    if (!placeholders.includes(name)) {
      note('unused-figure', `'${entry.id}' records a '${name}' figure the description never prints`);
    }
  }
}

/* -- 14. Endpoints routed to functions that exist ------------------------ */

const redirects = new Map();
for (const block of toml.split('[[redirects]]').slice(1)) {
  const from = attr(block, /from\s*=\s*"([^"]+)"/);
  const to = attr(block, /to\s*=\s*"([^"]+)"/);
  if (from && to) redirects.set(from, to);
}

for (const endpoint of endpoints) {
  if (!redirects.has(endpoint)) {
    note('unrouted-endpoint', `${endpoint} is not routed in netlify.toml, so it would 404 in production`);
    continue;
  }
  const target = redirects.get(endpoint);
  const name = target.match(/^\/\.netlify\/functions\/([\w-]+)$/);
  if (!name) {
    note('odd-route-target', `${endpoint} points at ${target}, which is not a function path`);
  } else if (!functionFiles.includes(`${name[1]}.js`)) {
    note('missing-function', `${endpoint} points at netlify/functions/${name[1]}.js, which does not exist`);
  }
}

/* -- 15. Frames ---------------------------------------------------------- */

if (/<iframe\b/.test(app)) {
  // Comments are stripped first: an explanatory note *about* a sandbox
  // permission would otherwise read as the sandbox asking for it, which is
  // exactly what happened the first time this check ran.
  const code = app.replace(/^[ \t]*\/\/.*$/gm, '');
  for (const tag of code.matchAll(/<iframe\b[^>]*>/g)) {
    const t = tag[0];
    if (!/\stitle=/.test(t)) {
      note('frame-no-title', 'an <iframe> has no title, so a screen reader announces it as an unnamed frame');
    }
    if (!/\ssandbox=/.test(t)) {
      note('frame-unsandboxed', 'an <iframe> has no sandbox attribute');
    }
    if (/allow-top-navigation/.test(t)) {
      note('frame-top-navigation', 'a sandbox lets the framed page navigate this page away');
    }
  }

  const policy = attr(headerCode, /Content-Security-Policy:\s*([^\n]+)/i) || '';
  if (!/\bframe-src\b/.test(policy)) {
    note(
      'csp-frame-src',
      'the page frames dashboards but _headers sets no frame-src, so default-src blocks every one of them'
    );
  }
}

/* -- 16. Nothing undeclared is published -------------------------------- */

// `netlify.toml` sets `publish = "."`, so every tracked file is a public URL
// unless `_redirects` answers it with a 404. That pair is the whole contract: a
// file that is in neither is published by accident, and this check names it
// rather than letting it go live unnoticed. `_headers`, `_redirects` and
// `netlify.toml` are deliberately *absent* from the list, because a rule exists
// for each — relying on Netlify to withhold its own control files is the kind
// of assumption that holds right up until it does not.
const publicFiles = new Set([
  'index.html',
  'styles.css',
  'app.js',
  'icons.js',
  'theme-init.js',
  'favicon.svg',
  'data/dashboards.js'
]);
const publicDirs = ['fonts/', 'vendor/'];

const parsedRules = redirectRules
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean)
  .map((line) => {
    const [from, to, status] = line.split(/\s+/);
    const force = Boolean(status && status.endsWith('!'));
    return { from, to, status: Number(force ? status.slice(0, -1) : status) || 301, force };
  });

const blocked = parsedRules.filter((rule) => rule.status === 404).map((rule) => rule.from);

// The `!` is load-bearing, and it is the one part of this that a reader would
// reasonably assume was optional. Netlify's redirects shadow a URL that
// resolves to a file the site actually has, custom 404s included — and every
// path blocked here is listed *because* a file sits at it. Without the `!` the
// rule looks correct and serves the file anyway, which is worse than no rule:
// it is a blocked path that reads as handled.
for (const rule of parsedRules) {
  if (rule.status === 404 && !rule.force) {
    note(
      'shadowed-404-rule',
      `${rule.from} -> ${rule.to} 404 does not fire: append ! to the status or the files it names stay public`
    );
  }
}

const isBlocked = (path) =>
  blocked.some((rule) => (rule.endsWith('*') ? path.startsWith(rule.slice(0, -1)) : path === rule));

async function walk(dir, prefix = '') {
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === 'node_modules') continue;
    const rel = prefix + item.name;
    if (item.isDirectory()) found.push(...(await walk(join(dir, item.name), rel + '/')));
    else found.push(rel);
  }
  return found;
}

for (const file of await walk(root)) {
  if (publicFiles.has(file)) continue;
  if (publicDirs.some((dir) => file.startsWith(dir))) continue;
  if (isBlocked('/' + file)) continue;
  note(
    'published-dev-file',
    `${file} is published at /${file} — allow it in the audit or block it in _redirects`
  );
}

/* -- 17. The stylesheet's nesting is what it reads as --------------------- */

// A stray `}` does not break rendering: a CSS parser skips the token and
// carries on, so every rule around it still applies and the page looks
// perfect. That is exactly why one survives: this file carried a spare `}` for
// a while, left behind by deleting a keyframes block, and twelve other checks
// plus a browser ran over it without a murmur. It matters because the file's
// nesting is then not what it reads as, and any minifier, linter or editor
// folding that trusts structure will disagree with the browser.
//
// Comments and strings are stripped first: both may legitimately contain
// braces that are not syntax.
function braceDepth(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  let depth = 0;
  let lowest = 0;
  let line = 1;
  let lowestLine = 1;
  for (const char of stripped) {
    if (char === '\n') line++;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth < lowest) {
        lowest = depth;
        lowestLine = line;
      }
    }
  }
  return { depth, lowest, lowestLine };
}

const cssDepth = braceDepth(css);
if (cssDepth.lowest < 0) {
  note(
    'stray-brace',
    `styles.css closes a block that was never opened, around line ${cssDepth.lowestLine}`
  );
} else if (cssDepth.depth !== 0) {
  note(
    'unbalanced-css',
    `styles.css ends ${cssDepth.depth > 0 ? 'inside' : 'outside'} a block (depth ${cssDepth.depth})`
  );
}

/* -- 18. Nothing at all is published by accident ------------------------- */

// Check 16 walks the *tracked* files, and deliberately skips .git and
// node_modules while doing it — which left .git covered by nothing at all, and
// it was reachable: `node tools/dev-server.mjs` served /.git/config with a 200,
// naming the remote, and the objects behind it are every blob ever committed.
// So this check looks at the publish root itself, dot-entries included, rather
// than at the file list.
//
// `.netlify` is the one deliberate exception, and it is not an oversight: that
// is where a deployed function is served from, so a 404 rule over it would
// break /api/watchlist. If a local `netlify dev` ever creates one, exclude it
// from the deploy instead of blocking the path the function answers on.
const ALLOWED_DOT_ENTRIES = new Set(['.netlify']);

for (const item of await readdir(root, { withFileTypes: true })) {
  if (!item.name.startsWith('.')) continue;
  if (ALLOWED_DOT_ENTRIES.has(item.name)) continue;
  const path = '/' + item.name;
  if (!isBlocked(path)) {
    note('published-dotfile', `${item.name} is published at ${path} — block it in _redirects`);
  }
  // A directory also needs its contents blocked: `/.git` and `/.git/*` are
  // different rules, and only the second one stops /.git/config.
  if (item.isDirectory() && !blocked.includes(path + '/*')) {
    note('published-dotdir', `${path}/* is not blocked in _redirects, so its contents stay public`);
  }
}

/* -- 19. The CSP is what it claims to be -------------------------------- */

const policy = attr(headerCode, /Content-Security-Policy:\s*([^\n]+)/i) || '';

// script-src 'self' is the whole reason theme-init.js exists as a file. A
// single 'unsafe-inline' would silently undo that, and nothing about the page
// would look different.
if (/unsafe-inline|unsafe-eval/.test(policy)) {
  note('csp-unsafe', "the CSP allows 'unsafe-inline' or 'unsafe-eval'");
}

// frame-src must name the dashboards this page actually frames. A wildcard is
// how the directive quietly became permission for all of *.netlify.app to serve
// three known hosts, and a missing origin blocks a preview with this site's own
// policy — which looks exactly like the other dashboard being broken.
const frameSrc = attr(policy, /frame-src\s+([^;]+)/) || '';
if (!frameSrc) {
  note('csp-no-frame-src', 'the page frames dashboards but the CSP has no frame-src');
} else {
  if (frameSrc.includes('*')) {
    note('csp-frame-wildcard', `frame-src is a wildcard (${frameSrc.trim()}), so any host on that domain may be framed`);
  }
  for (const entry of entries) {
    if (!entry.url || entry.embedFalse) continue;
    let origin = null;
    try {
      origin = new URL(entry.url).origin;
    } catch {
      note('bad-manifest-url', `${entry.id} has a url that is not absolute: ${entry.url}`);
      continue;
    }
    if (!frameSrc.includes(origin)) {
      note(
        'csp-frame-missing',
        `${entry.id} is declared embeddable but ${origin} is not in frame-src, so its preview is blocked by our own policy`
      );
    }
  }
  for (const origin of frameSrc.trim().split(/\s+/)) {
    if (!entries.some((e) => e.url && !e.embedFalse && new URL(e.url).origin === origin)) {
      note('csp-frame-extra', `frame-src allows ${origin}, which no embeddable entry uses`);
    }
  }
}

/* -- 20. The dev server enforces the headers it claims to ----------------- */

// The server exists so local behaviour cannot drift from production. Headers
// were the half it did not model, and it served the site with no CSP at all:
// an inline <script> or an onclick= attribute worked locally and failed only
// after deploying. Reading `_headers` is the fix, and this is what keeps it.
const devServer = await read('tools/dev-server.mjs');
if (!/readHeaderRules\s*\(/.test(devServer) || !/headersFor\s*\(/.test(devServer)) {
  note(
    'dev-server-no-headers',
    'tools/dev-server.mjs does not apply _headers, so the CSP cannot be exercised locally'
  );
}

/* -- 21. color-scheme follows the chosen theme --------------------------- */

// The meta tag only says both are supported, which leaves scrollbars and form
// controls following the operating system rather than the page: pick the theme
// opposite to your OS and you get a white scrollbar on a black page.
for (const theme of ['light', 'dark']) {
  const block = new RegExp(`:root\\[data-theme='${theme}'\\][^{]*\\{([^}]*)\\}`).exec(cssNoComments);
  if (!block || !/color-scheme/.test(block[1])) {
    note('no-color-scheme', `:root[data-theme='${theme}'] does not declare color-scheme`);
  }
}

/* -- 22. The URL carries the state, and its input is not trusted --------- */

// The filter and the open preview live in the URL so a row can be linked to.
// That makes `?q=` attacker-supplyable, so the sink matters: it is echoed
// through textContent, never innerHTML. This check is a tripwire for the day
// someone moves the empty state to innerHTML and turns a link into XSS.
if (!/history\.replaceState/.test(app) || !/URLSearchParams/.test(app)) {
  note('no-url-state', 'app.js does not read or write the URL, so no row can be linked to');
}
if (/innerHTML\s*=\s*[^;]*\bquery\b/.test(app)) {
  note('query-into-innerhtml', 'the URL-supplied query reaches innerHTML — that is reflected XSS');
}

/* -- 23. Transitions animate what they claim to -------------------------- */

// `transition: top` and friends run layout on every frame. The skip link used
// to animate `top`, which is invisible in a screenshot and obvious on a slow
// phone. transform/opacity/colour are fine; these are not.
const LAYOUT_PROPS = new Set([
  'all',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'padding',
  'gap',
  'font-size',
  'line-height',
  'flex-basis'
]);
for (const m of cssNoComments.matchAll(/transition:\s*([^;]+);/g)) {
  for (const part of m[1].split(',')) {
    const prop = part.trim().split(/\s+/)[0];
    if (LAYOUT_PROPS.has(prop)) {
      note(
        'transition-layout',
        `transition animates \u2018${prop}\u2019, which triggers layout every frame — use transform or opacity`
      );
    }
  }
}

/* ---------------------------------------------------------------- report -- */

if (!problems.length) {
  console.log('audit: clean');
  console.log(`  ${usedClasses.size} class selectors, ${usedIds.size} id selectors`);
  console.log(`  ${defined.size} custom properties defined`);
  console.log(`  ${glyphsDefined.size} icon glyphs, all used`);
  console.log(`  ${manifestKeys.size} manifest fields, all rendered`);
  console.log(`  ${manifestIds.length} manifest entries, ids unique`);
  console.log(`  ${(await walk(root)).length} files, none published by accident`);
  process.exit(0);
}

const grouped = new Map();
for (const p of problems) {
  if (!grouped.has(p.check)) grouped.set(p.check, []);
  grouped.get(p.check).push(p.detail);
}

console.log(`audit: ${problems.length} problem(s)\n`);
for (const [check, details] of [...grouped].sort()) {
  console.log(`${check} (${details.length})`);
  for (const d of details) console.log(`  - ${d}`);
  console.log('');
}
process.exit(1);
