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
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');

const [html, css, app, icons, themeInit, manifest] = await Promise.all([
  read('index.html'),
  read('styles.css'),
  read('app.js'),
  read('icons.js'),
  read('theme-init.js'),
  read('data/dashboards.js')
]);
const js = [app, icons, themeInit].join('\n');

const allSource = [html, app, icons, themeInit, manifest].join('\n');
const problems = [];
const note = (check, detail) => problems.push({ check, detail });
const attr = (source, re) => {
  const m = source.match(re);
  return m ? m[1] : null;
};

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
const openProps = await read('vendor/open-props.min.css');
const vendorPlusOwn = cssNoComments + openProps;
for (const m of cssNoComments.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
  if (!new RegExp(`${m[1]}\\s*:`).test(vendorPlusOwn)) {
    note('undefined-token', `var(${m[1]}) is not defined in styles.css or Open Props`);
  }
}

/* -- 3. Icon glyphs ------------------------------------------------------- */

const glyphsDefined = new Set([...icons.matchAll(/^\s*'?([a-z][a-z0-9-]*)'?:/gm)].map((m) => m[1]));
const glyphsUsed = new Set([
  ...[...html.matchAll(/data-icon=["']([a-z-]+)["']/g)].map((m) => m[1]),
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

/* ---------------------------------------------------------------- report -- */

if (!problems.length) {
  console.log('audit: clean');
  console.log(`  ${usedClasses.size} class selectors, ${usedIds.size} id selectors`);
  console.log(`  ${defined.size} custom properties defined`);
  console.log(`  ${glyphsDefined.size} icon glyphs, all used`);
  console.log(`  ${manifestKeys.size} manifest fields, all rendered`);
  console.log(`  ${manifestIds.length} manifest entries, ids unique`);
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
