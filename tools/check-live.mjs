/**
 * Live check against a deployed host.
 *
 *   node tools/check-live.mjs https://your-site.netlify.app
 *
 * Reads this repository's own rules — `_redirects`, `_headers`, the manifest
 * and `netlify.toml` — and asserts that the deployed site obeys them, instead
 * of restating the expectations here. A second copy of the list is a copy that
 * drifts, which is the same reason `tools/dev-server.mjs` reads those files.
 *
 * Why it exists: every check in `tools/audit.mjs` inspects the *files*, and
 * `tools/dev-server.mjs` models what Netlify *should* do with them. Neither can
 * tell you what Netlify actually does, and the failure this is really watching
 * for is specific — a redirects rule that Netlify shadows serves the file it was
 * meant to block with a 200, while the rule sits in the repository looking
 * correct. That is not hypothetical: `_redirects` blocked every development file
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
  console.error('usage: node tools/check-live.mjs https://your-site.netlify.app');
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

const [html, redirectRules, headerRules, manifest, toml] = await Promise.all([
  read('index.html'),
  read('_redirects'),
  read('_headers'),
  read('data/dashboards.js'),
  read('netlify.toml')
]);

/* ------------------------------------------------- the site is this site -- */

// Before anything else: is the host even running this codebase? Every other
// result below is meaningless if it is not, and "the checks passed" against a
// stranger's site is worse than an error. `og:type` arrived in the same commit
// as the rest of this work, so its presence is a usable "is this build current"
// signal rather than a guess.
const home = await get('/');
if (home.status !== 200) {
  fail('home', `${base}/ returned ${home.status}`);
} else {
  if (!/<title>\s*Dashboard Portal\s*<\/title>/i.test(home.body)) {
    fail('wrong-site', `${base}/ is not this project — its <title> is not "Dashboard Portal"`);
  }
  if (!/property="og:type"/.test(home.body)) {
    notes.push(`${base}/ lacks og:type, so it was built from a commit before this one`);
  }
}

/* ------------------------------------- nothing extra is running the page -- */

// Netlify injects its own HUD into the HTML it serves, and being same-origin
// `script-src 'self'` permits it — so it is worth naming rather than assuming.
// The comparison is against this repository's own <script src> list, so the
// check does not need a list of what is allowed; anything extra is extra.
//
// This is what surfaced the badge without anyone diffing the served HTML by
// hand: the HUD's inline styles are refused by style-src, so the badge never
// paints, but it still leaves two console errors on every load.
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

const publicFiles = [
  'index.html',
  'styles.css',
  'app.js',
  'icons.js',
  'theme-init.js',
  'favicon.svg',
  'data/dashboards.js',
  'vendor/open-props.min.css',
  'vendor/modern-normalize.css',
  'fonts/inter.woff2'
];
const publicDirs = ['fonts/', 'vendor/'];

for (const file of publicFiles) {
  const path = file === 'index.html' ? '/' : '/' + file;
  const res = await get(path, 'HEAD');
  if (res.status !== 200) fail('public-404', `${path} returned ${res.status}, but the page needs it`);
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

const parsed = redirectRules
  .split('\n')
  .map((line) => line.replace(/#.*$/, '').trim())
  .filter(Boolean)
  .map((line) => {
    const [from, to, status] = line.split(/\s+/);
    return { from, to, status: Number((status || '').replace('!', '')) || 301 };
  });

const blockedRules = parsed.filter((rule) => rule.status === 404);

/** Distinctive text from a local file, to prove the live body is not it. */
function fingerprint(source) {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 40 && !l.startsWith('#') && !l.startsWith('//') && !l.startsWith('*'));
  return lines.length ? lines[0].slice(0, 60) : null;
}

const targets = [
  ...(await walk(root)).filter(
    (file) =>
      !publicFiles.includes(file) && !publicDirs.some((dir) => file.startsWith(dir))
  ),
  '.git/config',
  '.git/HEAD'
];

let blockedChecked = 0;
for (const file of targets) {
  const path = '/' + file;
  const res = await get(path);
  blockedChecked++;

  if (res.status !== 404) {
    fail(
      'blocked-but-served',
      `${path} returned ${res.status}, so it is public — _redirects intends 404 (and the ! is what makes it fire)`
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

// The redirect is read from netlify.toml rather than written out here, so a
// changed route is checked rather than an old one.
const apiFrom = (toml.match(/from\s*=\s*"(\/api\/[^"]+)"/) || [])[1];
const apiTo = (toml.match(/to\s*=\s*"([^"]+)"\s*\n\s*status/) || [])[1];

let figures = null;
if (!apiFrom) {
  fail('no-api-route', 'netlify.toml declares no /api route, so the live figures have no endpoint');
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
// about the header Netlify is actually sending.
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
console.log(`  ${publicFiles.length} public files reachable`);
console.log(`  ${blockedChecked} blocked paths answer 404, with no contents leaked`);
if (apiTo) console.log(`  ${apiFrom} -> ${apiTo.replace('/.netlify/functions/', '')}`);
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
