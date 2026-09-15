/* ---------------------------------------------------------------------------
 * Live figures for the Content Tracker row.
 *
 * The portal cannot read this data itself. The dashboard's watchlist endpoint
 * sends no Access-Control-Allow-Origin and answers OPTIONS with 405, so a
 * browser sitting on this origin is not allowed to look at the response — a
 * client-side fetch can only fail. A server-side fetch has no such
 * restriction, so this function does the reading and hands the page a
 * three-number answer.
 *
 * It is deliberately small: the upstream endpoint returns the entire sheet
 * (84 KB), and the page wants three integers out of it, so the document never
 * leaves this function. The response is edge-cached, so the sheet is read at
 * most once every fifteen minutes however many people visit.
 *
 * The counting rules are copied verbatim from the dashboard's own app.js, so
 * the two can never disagree about what a "show" is:
 *
 *   rows    only rows with a name and a Year above zero count at all — that is
 *           app.js's own mapRows() filter, and applying a looser rule here
 *           would report numbers the dashboard itself does not show
 *   shows   Type contains 'Show' or 'Series' (case-sensitive, as upstream)
 *   movies  Type lowercased equals 'movie'
 *
 * To point this at a different source, set the WATCHLIST_URL environment
 * variable in the Netlify UI rather than editing the constant.
 * ------------------------------------------------------------------------ */

const UPSTREAM =
  process.env.WATCHLIST_URL ||
  'https://contenttrackerdashboard.netlify.app/.netlify/functions/watchlist';

/* Nine seconds, and the ceiling is not arbitrary: Netlify kills a synchronous
   function at ten. The floor is measured — the dashboard's own endpoint has
   been seen taking 8.0s just to connect during a cold spell, so anything
   tighter would abort a request that was about to succeed. When this does
   time out, the reading is reported as unavailable and the page keeps the
   recorded figures; a failure is never cached. */
const TIMEOUT_MS = 9000;

/* Cached at the edge: visitors are served instantly, and the sheet is read at
   most once every fifteen minutes no matter how many of them arrive. */
const OK_CACHE = 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400';

const reply = (statusCode, body, cacheControl) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  },
  body: JSON.stringify(body)
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return reply(405, { error: 'Method not allowed' }, 'no-store');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(UPSTREAM, { signal: controller.signal });
    if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);

    const rows = await upstream.json();
    if (!Array.isArray(rows)) throw new Error('upstream did not return rows');

    // The read time travels with the figures. If the edge serves a cached copy
    // the tooltip still tells the truth about when they were read, and a
    // timestamp generated in the browser would quietly claim they were live.
    return reply(200, { ...count(rows), fetched: new Date().toISOString() }, OK_CACHE);
  } catch (error) {
    // Never cached. A transient upstream failure would otherwise pin a wrong
    // answer at the edge for the whole TTL; the page falls back to the figures
    // recorded in the manifest instead.
    return reply(
      502,
      { error: 'Unable to read the watchlist', detail: String((error && error.message) || error) },
      'no-store'
    );
  } finally {
    clearTimeout(timer);
  }
};
