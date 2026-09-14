/* ---------------------------------------------------------------------------
 * The dashboard manifest. This is the only file you edit to change the portal.
 *
 * Add an entry, commit, and Netlify redeploys it. Nothing else needs touching.
 *
 *   id          stable slug, used as the card's data-id in the DOM
 *   name        display name
 *   tone        identity colour, drawn from THAT project's own palette.
 *               One of: forest, emerald, amber, cobalt (see styles.css).
 *               Optional; omit it and the row falls back to the house accent.
 *   description one sentence, plain language. Aim for under 130 characters:
 *               it is clamped to two lines in the row.
 *   url         live Netlify URL, or null when it has not been deployed yet
 *   repo        GitHub repository URL, or null
 *   tags        short labels; also what the filter box matches against
 *   verified    ISO date the URL was last confirmed reachable by hand
 *
 * Deliberately absent: a monogram and a one-line tagline. The row already
 * leads with an index numeral, and a tagline restated the description.
 * ------------------------------------------------------------------------ */

window.DASHBOARDS = [
  {
    id: 'content-tracker',
    name: 'Content Tracker',
    tone: 'forest',
    description:
      '342+ titles logged in a Google Sheet, turned into yearly comparisons, genre breakdowns and recommendations.',
    url: 'https://contenttrackerdashboard.netlify.app/',
    repo: 'https://github.com/parth-soni-10/ContentTrackerDashboard',
    tags: ['Analytics', 'Google Sheets', 'Chart.js'],
    verified: '2026-09-14'
  },
  {
    id: 'irish-visa-tracker',
    name: 'Irish Visa Tracker',
    tone: 'emerald',
    description:
      'Daily Embassy of Ireland decision and approval counts, plus the community wait times still being reported.',
    url: 'https://irishvisaupdatetracker.netlify.app/',
    repo: 'https://github.com/parth-soni-10/Irish-Visa-Tracker',
    tags: ['Python', 'GitHub Actions', 'Scraping'],
    verified: '2026-09-14'
  },
  {
    id: 'rbi-weekly',
    name: 'RBI Weekly Dashboard',
    tone: 'amber',
    description:
      'Weekly Statistical Supplement figures with crude estimates, FII flows and external-debt rankings.',
    url: 'https://rbiweeklydashboard.netlify.app/',
    repo: 'https://github.com/parth-soni-10/RBI-Weekly-Data-Dashboard',
    tags: ['Scrapers', 'World Bank', 'Functions'],
    verified: '2026-09-14'
  },
  {
    id: 'csnl-module-picker',
    name: 'CSNL Module Picker',
    tone: 'cobalt',
    description:
      "Builds a clash-free timetable from UCD's live module data, with assessment weights and exam options.",
    url: 'https://ucdcsnlmodulepicker.netlify.app/',
    repo: 'https://github.com/parth-soni-10/UCD-CSNL-Module_Picker',
    tags: ['UCD', 'Timetabling', 'Live data'],
    verified: '2026-09-14'
  }
];
