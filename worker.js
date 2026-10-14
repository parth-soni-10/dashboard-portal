/* ---------------------------------------------------------------------------
 * Dashboard portal — the function half of this site.
 *
 * The deploy stages this bundle as the Pages project's `_worker.js` (advanced
 * mode), so every request to the site arrives here and the paths this file does
 * not answer fall through to `env.ASSETS` below. It used to run as a Worker
 * with `run_worker_first = ["/api/*"]`, which is why the fall-through is
 * spelled out rather than assumed: the same bundle now sees the whole site.
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
 * restriction. The document never leaves this function — the page wants three
 * integers out of an 84 KB payload.
 *
 * Response headers keep the original caching promise: visitors are served
 * instantly, and the sheet is read at most once every fifteen minutes.
 * Failures are never cached — a transient upstream failure would otherwise
 * pin a wrong answer at the edge for the whole TTL.
 * ------------------------------------------------------------------------ */

/* Nine seconds. The ceiling used to be Netlify's ten-second synchronous
   function limit; it is kept because the floor is measured, not guessed — the
   dashboard's own endpoint has been seen taking 8.0s just to connect during a
   cold spell, so anything tighter would abort a request that was about to
   succeed. On timeout the reading is reported as unavailable and the page
   keeps its recorded figures. */
const TIMEOUT_MS = 9000;

const OK_CACHE = 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400';

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

  return { titles: kept.length, shows, movies };
}

async function watchlist(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return reply(405, { error: 'Method not allowed' }, 'no-store');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // One read, to the dashboard's own site. This was a service binding while
    // the dashboard ran as a Worker too; now that both are Pages projects
    // there is nothing to bind to, and the endpoint is fetched the ordinary
    // way.
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
    console.error('watchlist-count: read failed —', (error && error.message) || error);
    return reply(502, { error: 'Unable to read the watchlist' }, 'no-store');
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/watchlist') return watchlist(request, env);
    // Everything else is the site: every request arrives here in advanced mode,
    // so this line is what serves the page, the styles, the data and the icons.
    return env.ASSETS.fetch(request);
  }
};
