/* ---------------------------------------------------------------------------
 * The dashboard manifest. This is the only file you edit to change the portal.
 *
 * Add an entry, commit, and Netlify redeploys it. Nothing else needs touching.
 *
 *   id          stable slug, used for the anchor and localStorage keys
 *   name        display name
 *   mark        one or two characters shown in the card monogram
 *   tone        identity colour, drawn from that project's own palette.
 *               One of: gold, emerald, slate, blue (see styles.css)
 *   tagline     short line under the name (aim for under 45 characters)
 *   description one sentence, plain language, under 130 characters
 *   url         live Netlify URL, or null when it has not been deployed yet
 *   repo        GitHub repository URL, or null
 *   tags        short labels; also what the search box matches against
 *   verified    ISO date the URL was last confirmed reachable by hand
 *   note        optional line shown when url is null (pending state)
 * ------------------------------------------------------------------------ */

window.DASHBOARDS = [
  {
    id: 'content-tracker',
    name: 'Content Tracker',
    mark: 'CT',
    tone: 'gold',
    tagline: 'Media and viewing analytics',
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
    mark: 'IV',
    tone: 'emerald',
    tagline: 'Embassy of Ireland, New Delhi decisions',
    description:
      'Daily decision and approval counts, plus community wait times reported by the people still waiting.',
    url: 'https://irishvisaupdatetracker.netlify.app/',
    repo: 'https://github.com/parth-soni-10/Irish-Visa-Tracker',
    tags: ['Python', 'GitHub Actions', 'Scraping'],
    verified: '2026-09-14'
  },
  {
    id: 'rbi-weekly',
    name: 'RBI Weekly Dashboard',
    mark: 'RB',
    tone: 'slate',
    tagline: "India's weekly macro and forex data",
    description:
      'RBI Weekly Statistical Supplement figures with crude estimates, FII flows and external-debt rankings.',
    url: 'https://rbiweeklydashboard.netlify.app/',
    repo: 'https://github.com/parth-soni-10/RBI-Weekly-Data-Dashboard',
    tags: ['Scrapers', 'World Bank', 'Functions'],
    verified: '2026-09-14'
  },
  {
    id: 'csnl-module-picker',
    name: 'CSNL Module Picker',
    mark: 'MP',
    tone: 'blue',
    tagline: 'Clash-free UCD timetables',
    description:
      "Builds a clash-free timetable from UCD's live module timetables, with assessment weights and exam options.",
    url: 'https://ucdcsnlmodulepicker.netlify.app/',
    repo: 'https://github.com/parth-soni-10/UCD-CSNL-Module_Picker',
    tags: ['UCD', 'Timetabling', 'Live data'],
    verified: '2026-09-14'
  }
];
