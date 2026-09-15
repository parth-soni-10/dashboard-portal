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
 */

import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../data/dashboards.js', import.meta.url), 'utf8');

// The manifest is a browser file that assigns one global, so it can be run
// as-is against a stand-in for `window` — no parsing, no drift.
const sandbox = {};
new Function('window', source)(sandbox);
const dashboards = sandbox.DASHBOARDS || [];

const TIMEOUT = 20000;

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

  // Only `*` is accepted, because the portal's own final origin is not known
  // here — being conservative reports a dashboard as unembeddable when it might
  // not be, which is the safe direction for a flag that only changes wording.
  const csp = headers.get('content-security-policy') || '';
  const ancestors = csp.match(/frame-ancestors([^;]*)/i);
  if (ancestors) {
    const list = ancestors[1].trim();
    if (!list.includes('*')) return { blocked: true, why: `frame-ancestors ${list}` };
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

console.log(`check-embed: ${dashboards.length} dashboard(s)\n`);

for (const item of dashboards) {
  const label = String(item.id || item.name || '?').padEnd(22);
  const declared = item.embed !== false;

  if (!usable(item.url)) {
    console.log(`  ${label} embed ${String(declared).padEnd(5)}  no url to check`);
    continue;
  }

  const result = await inspect(item.url);
  if (!result.ok) {
    unchecked++;
    console.log(`  ${label} embed ${String(declared).padEnd(5)}  unchecked  (${result.error})`);
    continue;
  }

  const found = verdict(result.headers);
  const agrees = declared !== found.blocked;

  if (!agrees) mismatches++;
  console.log(
    `  ${label} embed ${String(declared).padEnd(5)}  ${agrees ? 'ok       ' : 'MISMATCH '} ${found.why}`
  );
}

console.log('');

if (mismatches) {
  console.log(`${mismatches} declaration(s) disagree with the live headers.`);
  console.log('Set `embed: false` on the entry that is blocked, so its row explains');
  console.log('itself instead of showing the browser\'s error page.');
  process.exit(1);
}

console.log(`${dashboards.length - unchecked} declaration(s) match the live headers.`);
if (unchecked) console.log(`${unchecked} could not be reached and were not checked.`);
