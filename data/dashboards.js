/* ---------------------------------------------------------------------------
 * The dashboard manifest. This is the only file you edit to change the portal.
 *
 * Add an entry, commit, and Netlify redeploys it. Nothing else needs touching.
 *
 *   id          stable slug, used as the row's data-id in the DOM
 *   name        display name
 *   tone        identity colour, drawn from THAT project's own palette.
 *               One of: forest, emerald, amber, cobalt (see styles.css).
 *               Optional; omit it and the row falls back to the house accent.
 *   description one sentence, plain language. Aim for under 130 characters:
 *               it is clamped to two lines in the row.
 *   url         live Netlify URL, or null when it has not been deployed yet
 *   repo        GitHub repository URL, or null
 *   tags        short labels; also what the filter box matches against
 *   embed       whether the dashboard can be shown in a frame. Defaults to
 *               true; set false for a site that ships X-Frame-Options: DENY or
 *               frame-ancestors 'none'. `node tools/check-embed.mjs` checks
 *               these flags against the live headers.
 *   count       optional live figures, see below.
 *
 * Deliberately absent: a monogram and a one-line tagline. The row already
 * leads with an index numeral, and a tagline restated the description.
 * ------------------------------------------------------------------------ */

window.DASHBOARDS = [
  {
    id: 'content-tracker',
    name: 'Content Tracker',
    tone: 'forest',
    /* {placeholders} are filled with the live figures from `count` below.
       Never write one of these numbers into the text by hand: a literal is
       what silently went stale before, and the whole point of this row is that
       it tracks the sheet. */
    description:
      '{titles} titles logged — {shows} shows and {movies} movies — turned into yearly comparisons, genre breakdowns and recommendations.',
    /* Read server-side by netlify/functions/watchlist-count.js, because that
       dashboard's endpoint sends no CORS headers. `fallback` is what the row
       shows until the live answer arrives, and what it keeps showing if the
       check never completes — so it must stay plausible, and `recorded` says
       when it was true. Both are reported in the figures' own hover text, so a
       visitor is never told a recorded number is a live one. */
    count: {
      endpoint: '/api/watchlist',
      source: 'the watchlist Google Sheet',
      recorded: '2026-09-15',
      fallback: { titles: 363, shows: 277, movies: 86 }
    },
    embed: true,
    url: 'https://contenttrackerdashboard.netlify.app/',
    repo: 'https://github.com/parth-soni-10/ContentTrackerDashboard',
    tags: ['Analytics', 'Google Sheets', 'Chart.js']
  },
  {
    id: 'irish-visa-tracker',
    name: 'Irish Visa Tracker',
    tone: 'emerald',
    description:
      'Daily Embassy of Ireland decision and approval counts, plus the community wait times still being reported.',
    /* The only dashboard that cannot be framed: it sends both
       `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Declared here so
       the row explains that instead of showing an empty box, and asserted
       against the live headers by tools/check-embed.mjs. */
    embed: false,
    url: 'https://irishvisaupdatetracker.netlify.app/',
    repo: 'https://github.com/parth-soni-10/Irish-Visa-Tracker',
    tags: ['Python', 'GitHub Actions', 'Scraping']
  },
  {
    id: 'rbi-weekly',
    name: 'RBI Weekly Dashboard',
    tone: 'amber',
    description:
      'Weekly Statistical Supplement figures with crude estimates, FII flows and external-debt rankings.',
    embed: true,
    url: 'https://rbiweeklydashboard.netlify.app/',
    repo: 'https://github.com/parth-soni-10/RBI-Weekly-Data-Dashboard',
    tags: ['Scrapers', 'World Bank', 'Functions']
  },
  {
    id: 'csnl-module-picker',
    name: 'CSNL Module Picker',
    tone: 'cobalt',
    description:
      "Builds a clash-free timetable from UCD's live module data, with assessment weights and exam options.",
    embed: true,
    url: 'https://ucdcsnlmodulepicker.netlify.app/',
    repo: 'https://github.com/parth-soni-10/UCD-CSNL-Module_Picker',
    tags: ['UCD', 'Timetabling', 'Live data']
  }
];
