/**
 * Live check against a deployed host.
 *
 *   node tools/check-live.mjs https://dashboards-home-portal.pages.dev
 *
 * Reads this repository's own rules — `_redirects`, `_headers`, the manifest
 * and `functions/_router.js` — and asserts that the deployed site obeys them, instead of
 * restating the expectations here. A second copy of the list is a copy that
 * drifts, which is the same reason `tools/dev-server.mjs` reads those files.
 *
 * Why it exists: every check in `tools/audit.mjs` inspects the *files*, and
 * `tools/dev-server.mjs` models what a host *should* do with them. Neither can
 * tell you what the deployed host actually does, and the failure this is really
 * watching for is specific — a path a rule was meant to block served by the host
 * with a 200, while the rule sits in the repository looking correct. That is not
 * hypothetical: under Netlify, `_redirects` blocked every development file
 * except `.git/` for a while, and `/.git/config` was reachable the whole time.
 * Nothing in the repository could have shown that. This can.
 *
 * So the blocked paths are fetched and their *bodies* are compared against the
 * real files. A 404 status alone is not enough: a rule could answer 404 while
 * still returning the contents, which leaks exactly as much.
 *
 * Exits non-zero on a failure, so it can run by hand after a deploy or in CI.
 * The host is required — there is no sensible default, because guessing which
 * site this repository deploys to is how you check somebody else's site.
 * (`dashboard-portal.netlify.app` belongs to a stranger and serves every path
 * with a 200, including `/.git/config`. Do not use it.)
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(join(root, p), 'utf8');

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error('usage: node tools/check-live.mjs https://dashboards-home-portal.pages.dev');
  process.exit(2);
}

const problems = [];
const notes = [];
const fail = (check, detail) => problems.push({ check, detail });

// A refused connection, a DNS failure or a timeout is an ordinary outcome for
// this tool — the whole point is to ask a host that may not be there — and it
// should read as a sentence, not as a stack trace from inside fetch(). Real
// bugs keep their stack: only an error marked `expected` is printed plainly.
process.on('uncaughtException', (error) => {
  console.error(error && error.expected ? `check-live: ${error.message}` : error);
  process.exit(2);
});

const TIMEOUT = 20000;

/** One request. Returns { status, headers, body }; a network fault is `expected`. */
async function get(path, method = 'GET') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(base + path, { method, redirect: 'follow', signal: controller.signal });
    const body = method === 'HEAD' ? '' : await res.text();
    return { status: res.status, headers: res.headers, body };
  } catch (error) {
    const reason =
      error.name === 'AbortError'
        ? `no answer within ${TIMEOUT / 1000}s`
        : (error.cause && error.cause.code) || error.message;
    const failure = new Error(`cannot reach ${base}${path} — ${reason}`);
    failure.expected = true;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

// `_redirects` is deliberately not read: there is no such file at the publish
// root any more. What keeps a development file off the site now is
// `.assetsignore` — a file that is never uploaded cannot be served, which is
// stronger than a rule answering 404 — and *which* files are supposed to be
// public is read out of `tools/audit.mjs` (its check 16) rather than restated
// here. It used to be a list here as well, and it drifted exactly as a second
// copy does: the audit had long allowed LICENSE, robots.txt and
// apple-touch-icon.png as deliberately public while this check called all three
// blocked, so a correct deploy failed the check three times over.
const [html, headerRules, manifest, router, auditSource] = await Promise.all([
  read('index.html'),
  read('_headers'),
  read('data/dashboards.js'),
  read('functions/_router.js'),
  read('tools/audit.mjs')
]);

/** The names inside a `const <name> = [ … ]` (or `= new Set([ … ])`) declaration. */
function declaredList(source, name) {
  const block = source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`));
  return block ? [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]) : null;
}

const publicFiles = declaredList(auditSource, 'publicFiles') || [];
const publicDirs = declaredList(auditSource, 'publicDirs') || [];
if (!publicFiles.length || !publicDirs.length) {
  fail(
    'no-public-list',
    'tools/audit.mjs declares no public file list, so what is meant to be public cannot be told from what must be blocked'
  );
}

/* ------------------------------------------------- the site is this site -- */

// Before anything else: is the host even running this codebase? Every other
// result below is meaningless if it is not, and "the checks passed" against a
// stranger's site is worse than an error. `og:type` arrived in the same commit
// as the rest of this work, so its presence is a usable "is this build current"
// signal rather than a guess.
const home = await get('/');
let currentBuild = false;
if (home.status !== 200) {
  fail('home', `${base}/ returned ${home.status}`);
} else {
  if (!/<title>\s*(?:Dashboard Portal|Data Analytics Dashboards Portal \| Parth Soni)\s*<\/title>/i.test(home.body)) {
    fail('wrong-site', `${base}/ is not this project — its <title> does not identify the Dashboard Portal`);
  } else if (!/<link\s+rel="canonical"\s+href="https:\/\/dashboards-home-portal\.pages\.dev\/"\s*\/>/i.test(home.body)) {
    notes.push(`${base}/ is still on the previous build; the new metadata and pre-rendered index are not published yet`);
  }
  currentBuild = home.status === 200 && /<link\s+rel="canonical"\s+href="https:\/\/dashboards-home-portal\.pages\.dev\/"\s*\/>/i.test(home.body);
  if (currentBuild) {
    const socialImage = await get('/portal-social.png', 'HEAD');
    if (socialImage.status !== 200) {
      fail('social-image-missing', `/portal-social.png returned ${socialImage.status}, but the current page links to it`);
    } else if (socialImage.headers.get('content-type') !== 'image/png') {
      fail('social-image-type', `/portal-social.png is ${socialImage.headers.get('content-type') || 'missing Content-Type'}, expected image/png`);
    }
  }
  if (!/property="og:type"/.test(home.body)) {
    notes.push(`${base}/ lacks og:type, so it was built from a commit before this one`);
  }
}

/* ------------------------------------- nothing extra is running the page -- */

// A host that injects its own script into the HTML it serves is worth naming
// rather than assuming it away, since being same-origin `script-src 'self'`
// permits it. The comparison is against this repository's own <script src>
// list, so the check does not need a list of what is allowed; anything extra is
// extra.
//
// This is what surfaced Netlify's own badge without anyone diffing the served
// HTML by hand: its inline styles were refused by style-src, so the badge never
// painted, but it still left two console errors on every load. Nothing injects
// anything now, so the check should find nothing — which is the point of keeping
// it rather than deleting it with the host that made it necessary.
const localScripts = new Set(
  [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1])
);
for (const m of home.body.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
  if (localScripts.has(m[1])) continue;
  notes.push(
    m[1].startsWith('/.netlify/')
      ? `the host injects ${m[1]} — same-origin, so the CSP permits it; its inline styles are refused, which is where the page's console errors come from`
      : `the host injects ${m[1]}, which is not a script this repository ships`
  );
}

/* ---------------------------------------------------------- _headers live -- */

const expectedPolicy = (headerRules.match(/Content-Security-Policy:\s*([^\n]+)/i) || [])[1] || '';

const wanted = [
  ['Content-Security-Policy', expectedPolicy, (v) => v.includes("script-src 'self'") && !/unsafe-inline|unsafe-eval/.test(v)],
  ['X-Frame-Options', 'DENY', (v) => v.toUpperCase() === 'DENY'],
  ['X-Content-Type-Options', 'nosniff', (v) => v.toLowerCase() === 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin', (v) => v.length > 0],
  ['Cross-Origin-Opener-Policy', 'same-origin', (v) => v.toLowerCase() === 'same-origin']
];

for (const [name, expected, ok] of wanted) {
  const actual = home.headers.get(name);
  if (!actual) {
    fail('missing-header', `${name} is absent from the deployed response for /`);
  } else if (!ok(actual)) {
    fail('bad-header', `${name} is ${actual}, which is not what _headers declares (${expected})`);
  }
}

// Frame-ancestors is inside the policy and is the half that stops the portal
// itself being framed, so it is checked rather than assumed.
const livePolicy = home.headers.get('Content-Security-Policy') || '';
if (livePolicy && !/frame-ancestors 'none'/.test(livePolicy)) {
  fail('no-frame-ancestors', "the deployed CSP has no frame-ancestors 'none'");
}

/* --------------------------------------------- every public file resolves -- */

const allFiles = await walk(root);

// A directory is probed with a real file found inside it, so a renamed asset is
// what gets checked rather than a path written down when it was named the old
// way.
let publicChecked = 0;
for (const file of publicFiles) {
  if (!currentBuild && file === 'portal-social.png') continue;
  const path = file === 'index.html' ? '/' : '/' + file;
  const res = await get(path, 'HEAD');
  publicChecked++;
  if (res.status !== 200) fail('public-404', `${path} returned ${res.status}, but the page needs it`);
}
for (const dir of publicDirs) {
  const sample = allFiles.find((file) => file.startsWith(dir));
  if (!sample) continue;
  const res = await get('/' + sample, 'HEAD');
  publicChecked++;
  if (res.status !== 200) fail('public-404', `/${sample} returned ${res.status}, but the page needs it`);
}

// Everything on disk that is not deliberately public must be blocked live.
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

/** Distinctive text from a local file, to prove the live body is not it. */
function fingerprint(source) {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 40 && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('*'));
  return lines.length ? lines[0].slice(0, 60) : null;
}

const targets = [
  ...allFiles.filter(
    (file) =>
      !publicFiles.includes(file) && !publicDirs.some((dir) => file.startsWith(dir))
  ),
  '.git/config',
  '.git/HEAD'
].filter((file) => !file.startsWith('.pages-dist/'));

let blockedChecked = 0;
for (const file of targets) {
  const path = '/' + file;
  const res = await get(path);
  blockedChecked++;

  if (res.status !== 404) {
    fail(
      'blocked-but-served',
      `${path} returned ${res.status}, so it is public — .assetsignore is meant to keep it off the upload`
    );
    continue;
  }

  // Status is right. Now the part that a status cannot prove.
  const local = await readFile(join(root, file))
    .then((buf) => buf.toString('utf8'))
    .catch(() => '');
  const mark = fingerprint(local);
  if (mark && res.body.includes(mark)) {
    fail('leaked-body', `${path} answers 404 but returns the file's contents`);
  }
}

/* --------------------------------------------------------- the function -- */

// The route is read from the router rather than written out here, so a changed
// path is checked rather than an old one. It used to be a netlify.toml
// [[redirects]] entry pointing at netlify/functions/watchlist-count.js; the
// function owns the path now, and both of those files are gone.
const apiFrom = (router.match(/url\.pathname\s*===\s*'(\/api\/[^']+)'/) || [])[1];

let figures = null;
if (!apiFrom) {
  fail('no-api-route', 'functions/_router.js answers no /api route, so the live figures have no endpoint');
} else {
  const res = await get(apiFrom);
  if (res.status === 502) {
    // By design: the page falls back to the figures recorded in the manifest.
    let body = null;
    try {
      body = JSON.parse(res.body);
    } catch (e) {
      fail('bad-error-body', `${apiFrom} answered 502 with a body that is not JSON`);
    }
    if (body && 'detail' in body) {
      fail('error-leak', `${apiFrom} leaks upstream detail to callers`);
    }
    notes.push(
      `${apiFrom} answered 502 — the upstream reading failed, so the row is showing its recorded figures`
    );
  } else if (res.status !== 200) {
    fail('api-status', `${apiFrom} returned ${res.status}, which is neither a reading nor a declared 502`);
  } else {
    try {
      const data = JSON.parse(res.body);
      const numbers = ['titles', 'shows', 'movies'].filter((k) => Number.isInteger(data[k]));
      if (numbers.length !== 3) {
        fail('api-shape', `${apiFrom} returned ${res.body.slice(0, 80)} — expected three integers`);
      } else {
        figures = data;
        if (!data.fetched) {
          fail('api-no-timestamp', `${apiFrom} returned figures with no fetched timestamp`);
        }
      }
    } catch (e) {
      fail('api-not-json', `${apiFrom} did not return JSON`);
    }
  }
}

/* --------------------------------------------------- the frames are framed -- */

// The CSP's frame-src has to name every embeddable dashboard, or the preview is
// blocked by this site's own policy — which looks like the other dashboard's
// fault. The local audit asserts the same thing about the file; this asserts it
// about the header the host is actually sending.
const entries = manifest
  .split(/\n  \{/)
  .slice(1)
  .map((chunk) => ({
    id: (chunk.match(/\bid:\s*'([^']+)'/) || [])[1],
    url: (chunk.match(/\burl:\s*'([^']+)'/) || [])[1],
    embed: !/\bembed:\s*false\b/.test(chunk)
  }));

for (const entry of entries) {
  if (!entry.url || !entry.embed) continue;
  const origin = new URL(entry.url).origin;
  if (!livePolicy.includes(origin)) {
    fail('frame-src-missing', `${entry.id} is embeddable but ${origin} is not in the deployed frame-src`);
  }
}

/* ------------------------------------------------------------- the report -- */

console.log(`check-live: ${base}`);
console.log(`  ${publicChecked} public files reachable`);
console.log(`  ${blockedChecked} blocked paths answer 404, with no contents leaked`);
if (apiFrom) console.log(`  ${apiFrom} is answered by the Worker`);
if (figures) console.log(`  live figures: ${figures.titles} titles, ${figures.shows} shows, ${figures.movies} movies`);
for (const note of notes) console.log(`  note: ${note}`);

if (!problems.length) {
  console.log('\ncheck-live: clean');
  process.exit(0);
}

const grouped = new Map();
for (const p of problems) {
  if (!grouped.has(p.check)) grouped.set(p.check, []);
  grouped.get(p.check).push(p.detail);
}
console.log(`\ncheck-live: ${problems.length} problem(s)\n`);
for (const [check, details] of [...grouped].sort()) {
  console.log(`${check} (${details.length})`);
  for (const d of details) console.log(`  - ${d}`);
  console.log('');
}
process.exit(1);
