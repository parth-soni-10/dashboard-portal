/* ---------------------------------------------------------------------------
 * Dashboard portal - the routing half of this site's function.
 *
 * Pages compiles this repository's `functions/` directory, and its entry -
 * `functions/[[path]].js` - hands every request here, so the paths this file
 * does not answer fall through to `env.ASSETS` below. It used to run as a
 * Worker with `run_worker_first = ["/api/*"]`, which is why the fall-through is
 * spelled out rather than assumed: the same handler now sees the whole site.
 *
 * The `_` prefix is deliberate: Pages treats a file named this way as private,
 * so it is compiled into the deployment without becoming a route of its own.
 * The routing table is therefore the single catch-all beside it.
 *
 * One job: answer `/api/watchlist`, the live figures under the Content
 * Tracker row. This is where the Netlify function that used to answer it
 * (netlify/functions/watchlist-count.js, deleted with the rest of that
 * configuration) was ported to; the counting rules below are copied verbatim
 * from the dashboard's own app.js, so the two can never disagree about what a
 * "show" is.
 *
 * Why a server-side read exists: the dashboard's endpoint sends no
 * Access-Control-Allow-Origin and answers OPTIONS with 405, so a browser
 * sitting on this origin can only fail. A server-side fetch has no such
 * restriction. The document never leaves this function - the page wants three
 * integers out of an 84 KB payload.
 *
 * Response headers keep the original caching promise: visitors are served
 * instantly, and the sheet is read at most once every fifteen minutes.
 * Failures are never cached - a transient upstream failure would otherwise
 * pin a wrong answer at the edge for the whole TTL.
 * ------------------------------------------------------------------------ */

/* Nine seconds. The ceiling used to be Netlify's ten-second synchronous
   function limit; it is kept because the floor is measured, not guessed - the
   dashboard's own endpoint has been seen taking 8.0s just to connect during a
   cold spell, so anything tighter would abort a request that was about to
   succeed. On timeout the reading is reported as unavailable and the page
   keeps its recorded figures. */
const TIMEOUT_MS = 9000;

const OK_CACHE = 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400';
const FEEDBACK_TTL = 60 * 60 * 24 * 90;

const reply = (status, body, cacheControl) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff'
    }
  });

/** Mirror of ContentTrackerDashboard/app.js, definitions included. */
function count(rows) {
  const text = (row, key) => String(row[key] || row[key.toLowerCase()] || '');
  const kept = rows.filter(
    (row) => text(row, 'Name').trim() !== '' && (parseInt(row.Year || row.year, 10) || 0) > 0
  );

  let shows = 0;
  let movies = 0;
  for (const row of kept) {
    const type = text(row, 'Type');
    if (type.includes('Show') || type.includes('Series')) shows++;
    if (type.toLowerCase() === 'movie') movies++;
  }

  return { titles: kept.length, shows, movies, months: watchMonths(kept) };
}

/* Titles logged per month, from the same rows. Additive: the endpoint's shape
   only grows, so a page that knew three fields still reads three fields. */
const MONTH_ORDER = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function watchMonths(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const month = String(row.Month || row.month || '').trim();
    const year = parseInt(row.Year || row.year, 10) || 0;
    if (!year || MONTH_ORDER.indexOf(month) === -1) continue;
    const key = year * 12 + MONTH_ORDER.indexOf(month);
    byKey.set(key, (byKey.get(key) || 0) + 1);
  }
  return [...byKey.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-12)
    .map(([key, value]) => ({
      label: MONTH_ORDER[key % 12].slice(0, 3) + ' ' + String(Math.floor(key / 12)).slice(2),
      value
    }));
}

async function watchlist(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return reply(405, { error: 'Method not allowed' }, 'no-store');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // One read, to the dashboard's own site: the WATCHLIST_URL var in
    // wrangler.toml. This was a service binding while the dashboard ran as a
    // Worker too; now that both are Pages projects there is nothing to bind to,
    // and the endpoint is fetched the ordinary way.
    const upstream = await fetch(env.WATCHLIST_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);

    const rows = await upstream.json();
    if (!Array.isArray(rows)) throw new Error('upstream did not return rows');

    // The read time travels with the figures. If the edge serves a cached copy
    // the tooltip still tells the truth about when they were read, and a
    // timestamp generated in the browser would quietly claim they were live.
    return reply(200, { ...count(rows), fetched: new Date().toISOString() }, OK_CACHE);
  } catch (error) {
    // The reason goes to the Worker log, not to the caller. Echoing it put the
    // upstream's status and host into a public JSON body, which tells a visitor
    // about infrastructure they have no reason to see and does not help the
    // page: it only ever renders its own recorded figures.
    console.error('watchlist-count: read failed -', (error && error.message) || error);
    return reply(502, { error: 'Unable to read the watchlist' }, 'no-store');
  } finally {
    clearTimeout(timer);
  }
}

async function feedback(request, env) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  if (!env.SITE_FEEDBACK || !env.SITE_FEEDBACK.put) return new Response(JSON.stringify({ error: 'Feedback is not configured' }), { status: 503, headers });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 4096) return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return new Response(JSON.stringify({ error: 'Payload too large' }), { status: 413, headers });
    const body = JSON.parse(raw);
    if (body && typeof body.website === 'string' && body.website) return new Response(JSON.stringify({ ok: true }), { status: 202, headers });
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 2000) return new Response(JSON.stringify({ error: 'Invalid feedback' }), { status: 400, headers });
    const id = crypto.randomUUID();
    await env.SITE_FEEDBACK.put('fb:portal:' + id, JSON.stringify({ message, source: 'portal', createdAt: new Date().toISOString() }), { expirationTtl: FEEDBACK_TTL });
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers });
  } catch (_) { return new Response(JSON.stringify({ error: 'Invalid feedback' }), { status: 400, headers }); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/watchlist') return watchlist(request, env);
    if (url.pathname === '/api/feedback') return feedback(request, env);
    // Everything else is the site: every request arrives here in advanced mode,
    // so this line is what serves the page, the styles, the data and the icons.
    return env.ASSETS.fetch(request);
  }
};
