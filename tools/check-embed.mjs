/**
 * Check the manifest's `embed` flags against the dashboards themselves.
 *
 *   node tools/check-embed.mjs
 *
 * Whether a dashboard can be shown in a frame is decided by that dashboard, not
 * by us: `X-Frame-Options: DENY`, or a `frame-ancestors` that does not name us,
 * makes the frame impossible. Each entry declares the answer in the manifest so
 * its row can explain that instead of showing a browser error page — and this is
 * what keeps the declaration honest. A dashboard that starts refusing frames
 * would otherwise break its own preview silently.
 *
 * Read-only, no dependencies. Exits non-zero when a declaration disagrees with
 * the live headers. A dashboard that cannot be reached is reported as unchecked
 * rather than as a failure: not being able to ask is not an answer.
 *
 * A URL that answers with an error is in the same class as one that does not
 * answer at all, and that is not a detail: a retired host (the Netlify sites
 * this manifest used to list) replies to a HEAD with a 404 error page, which
 * carries no framing headers whatsoever. Read as a policy that would report
 * "no framing restriction" — the opposite of `embed: false` — so a dead entry
 * became a MISMATCH, the scheduled job went red and the only artefact anyone
 * got was a failure e-mail. It also let a dead `embed: true` entry pass in
 * silence, which is worse. Both are why a non-2xx/3xx status is now reported as
 * unchecked, alongside what the status was.
 */

import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../data/dashboards.js', import.meta.url), 'utf8');

// The manifest is a browser file that assigns one global, so it can be run
// as-is against a stand-in for `window` — no parsing, no drift.
const sandbox = {};
new Function('window', source)(sandbox);
const dashboards = sandbox.DASHBOARDS || [];

const TIMEOUT = 20000;

// The portal's own deployed origin. A dashboard whose frame-ancestors names
// this origin (or `*`) is frameable here, so its `embed: true` declaration
// agrees with the live headers.
//
// This is the Cloudflare Worker host, not the Netlify one the portal used to be
// served from: the dashboards name the origin they allow, and they were updated
// with the move, so the old value made every frameable dashboard look blocked.
const PORTAL_ORIGIN = 'https://dashboards-home-portal.pages.dev';

async function inspect(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'dashboard-portal-embed-check' }
    });
    // An error status is not this dashboard's framing policy. Following
    // redirects (`follow`, above) means a moved-but-live dashboard still
    // answers here; what lands in this branch is a URL nobody serves any more.
    if (res.status >= 400) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status, headers: res.headers };
  } catch (error) {
    return { ok: false, error: String((error && error.name) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Would a browser here be allowed to frame this response? */
function verdict(headers) {
  const xfo = (headers.get('x-frame-options') || '').trim().toLowerCase();
  if (xfo === 'deny') return { blocked: true, why: 'X-Frame-Options: DENY' };
  if (xfo === 'sameorigin') return { blocked: true, why: 'X-Frame-Options: SAMEORIGIN' };

  // A list naming the portal's own origin (or `*`) passes; anything else still
  // reports blocked. Staying conservative remains the safe direction for a flag
  // that only changes row wording.
  const csp = headers.get('content-security-policy') || '';
  const ancestors = csp.match(/frame-ancestors([^;]*)/i);
  if (ancestors) {
    const list = ancestors[1].trim();
    if (!list.includes('*') && !list.includes(PORTAL_ORIGIN)) {
      return { blocked: true, why: `frame-ancestors ${list}` };
    }
  }

  return { blocked: false, why: xfo ? `X-Frame-Options: ${xfo}` : 'no framing restriction' };
}

function usable(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

let mismatches = 0;
let unchecked = 0;
// Set when a disagreement is about WHICH origin is named rather than whether
// framing is allowed at all — the shape a portal move produces, and the reason
// the summary says how to tell the two apart.
let originDrift = null;

console.log(`check-embed: ${dashboards.length} dashboard(s)\n`);

for (const item of dashboards) {
  const label = String(item.id || item.name || '?').padEnd(22);
  const declared = item.embed !== false;
  const prefix = `  ${label} embed ${String(declared).padEnd(5)}  `;

  if (!usable(item.url)) {
    console.log(`${prefix}no url to check`);
    continue;
  }

  const result = await inspect(item.url);
  if (!result.ok) {
    unchecked++;
    console.log(`${prefix}unchecked  (${result.error})`);
    continue;
  }

  const found = verdict(result.headers);
  const agrees = declared !== found.blocked;

  if (!agrees) mismatches++;
  console.log(`${prefix}${agrees ? 'ok       ' : 'MISMATCH '} ${found.why}`);

  // The one disagreement that is not really about framing: the dashboard names
  // an origin of its own, and it is not the origin this file carries. Either the
  // portal moved (update the constant) or that dashboard allows somebody else's
  // host (fix the dashboard) — naming both origins says which, in one line.
  const named = !agrees && (found.why.match(/https?:\/\/[^\s'"]+/) || [])[0];
  if (named && named !== PORTAL_ORIGIN) {
    originDrift = named;
    console.log(`${' '.repeat(prefix.length)}↳ names ${named}, but this file expects ${PORTAL_ORIGIN}`);
  }
}

console.log('');

if (mismatches) {
  console.log(`${mismatches} declaration(s) disagree with the live headers.`);
  console.log('Set `embed: false` on the entry that is blocked, so its row explains');
  console.log('itself instead of showing the browser\'s error page.');
  // The other way to get here, and the one that is not a dashboard's fault:
  // the portal is served from somewhere else now, and this file still carries
  // the origin it used to be at. Saying so is the difference between a
  // five-second fix and a red job nobody can explain.
  if (originDrift) {
    console.log('');
    console.log(`A dashboard naming ${originDrift} is usually the portal having moved:`);
    console.log(`if the portal is no longer served from ${PORTAL_ORIGIN}, update`);
    console.log('PORTAL_ORIGIN at the top of this file and run it again.');
  }
  process.exit(1);
}

console.log(`${dashboards.length - unchecked} declaration(s) match the live headers.`);
if (unchecked) console.log(`${unchecked} could not be reached and were not checked.`);
