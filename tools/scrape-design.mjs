/**
 * Scrape the deployed dashboards and extract the design tokens they actually
 * ship, so the portal's look can be derived from evidence instead of taste.
 *
 *   node tools/scrape-design.mjs            -> prints a report
 *   node tools/scrape-design.mjs --json     -> also writes tools/design-report.json
 *
 * For each site it pulls the HTML, every linked and inline stylesheet, and
 * reports: custom properties, font families and their weights, the radius and
 * shadow scales, the dominant accent hue, and any social/preview imagery that
 * could be reused as a card thumbnail.
 *
 * Read-only. Nothing here is imported by the page at runtime.
 */

import { writeFile } from 'node:fs/promises';

const SITES = [
  { id: 'content-tracker', url: 'https://contenttrackerdashboard.netlify.app/' },
  { id: 'irish-visa-tracker', url: 'https://irishvisaupdatetracker.netlify.app/' },
  { id: 'rbi-weekly', url: 'https://rbiweeklydashboard.netlify.app/' },
  { id: 'csnl-module-picker', url: 'https://ucdcsnlmodulepicker.netlify.app/' },
  { id: 'portfolio', url: 'https://parth-portfolio-wb.netlify.app/' }
];

const TIMEOUT = 25000;

async function get(url, asText = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'dashboard-portal-design-scraper' }
    });
    return {
      ok: res.ok,
      status: res.status,
      body: asText ? await res.text() : null,
      type: res.headers.get('content-type') || '',
      bytes: Number(res.headers.get('content-length') || 0)
    };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: String(err.name || err) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- parsing -- */

const attr = (html, re) => {
  const m = html.match(re);
  return m ? m[1] : null;
};

function metaImage(html) {
  const candidates = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const re of candidates) {
    const hit = attr(html, re);
    if (hit) return hit;
  }
  return null;
}

function stylesheetUrls(html, base) {
  const urls = new Set();
  const re = /<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi;
  let tag;
  while ((tag = re.exec(html))) {
    const href = attr(tag[0], /href=["']([^"']+)["']/i);
    if (!href) continue;
    try {
      urls.add(new URL(href, base).href);
    } catch {
      /* skip malformed */
    }
  }
  return [...urls];
}

function inlineStyles(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let block;
  while ((block = re.exec(html))) out.push(block[1]);
  return out;
}

/** Pull every `--custom-prop: value` declaration out of a chunk of CSS. */
function customProps(css) {
  const vars = new Map();
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(css))) {
    const name = m[1].trim();
    const value = m[2].trim();
    if (!vars.has(name)) vars.set(name, new Set());
    vars.get(name).add(value);
  }
  return vars;
}

function collect(css, re, limit = 80) {
  const seen = new Map();
  let m;
  while ((m = re.exec(css)) && seen.size < limit) {
    const v = m[1].trim();
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  return seen;
}

/** Normalise a CSS colour to a hue bucket so accents can be compared. */
function hueOf(value) {
  const hex = value.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  let r, g, b;
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const rgb = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!rgb) return null;
    [, r, g, b] = rgb.map(Number);
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.18) return null; // greys carry no brand signal
  let hue;
  if (max === min) hue = 0;
  else if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = (2 + (b - r) / (max - min)) * 60;
  else hue = (4 + (r - g) / (max - min)) * 60;
  if (hue < 0) hue += 360;
  return { hue: Math.round(hue), saturation: Math.round(sat * 100), rgb: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` };
}

function hueName(hue) {
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange / amber';
  if (hue < 70) return 'yellow';
  if (hue < 95) return 'lime';
  if (hue < 165) return 'green';
  if (hue < 200) return 'teal / cyan';
  if (hue < 250) return 'blue';
  if (hue < 290) return 'violet';
  return 'magenta / pink';
}

/* ------------------------------------------------------------------ per site -- */

async function scrape(site) {
  const page = await get(site.url);
  if (!page.ok || !page.body) {
    return { id: site.id, url: site.url, error: page.error || `HTTP ${page.status}` };
  }

  const html = page.body;
  const cssUrls = stylesheetUrls(html, site.url);
  const external = [];
  for (const href of cssUrls.slice(0, 6)) {
    const res = await get(href);
    if (res.ok && res.body) external.push({ href, css: res.body });
  }

  const inline = inlineStyles(html);
  const allCss = [...inline, ...external.map((e) => e.css)].join('\n');

  const vars = customProps(allCss);

  const fonts = collect(allCss, /font-family\s*:\s*([^;{}]+);/gi, 60);
  const weights = collect(allCss, /font-weight\s*:\s*([0-9]{3})\b/gi, 40);
  const radii = collect(allCss, /border-radius\s*:\s*([^;{}]+);/gi, 60);
  const shadows = collect(allCss, /box-shadow\s*:\s*([^;{}]+);/gi, 40);

  // Accent: the most repeated saturated colour, weighted by how often it
  // appears, which reliably surfaces a project's brand colour over its greys.
  const colourCounts = new Map();
  const colourRe = /(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]+\))/gi;
  let cm;
  while ((cm = colourRe.exec(allCss))) {
    const raw = cm[1];
    const h = hueOf(raw);
    if (!h) continue;
    const key = h.hue + '|' + h.rgb;
    colourCounts.set(key, (colourCounts.get(key) || 0) + 1);
  }
  const accents = [...colourCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([key, count]) => {
      const [hue, rgb] = key.split('|');
      return { rgb, hue: Number(hue), family: hueName(Number(hue)), uses: count };
    });

  const fontFaces = [...allCss.matchAll(/@font-face\s*{([^}]*)}/gi)].map((m) => {
    const block = m[1];
    return {
      family: attr(block, /font-family\s*:\s*['"]?([^;'"}]+)/i),
      weight: attr(block, /font-weight\s*:\s*([^;]+)/i),
      src: (attr(block, /src\s*:\s*([^;]+)/i) || '').slice(0, 120)
    };
  });

  return {
    id: site.id,
    url: site.url,
    bytes: html.length,
    stylesheets: { linked: cssUrls, inline: inline.length, externalBytes: external.reduce((n, e) => n + e.css.length, 0) },
    title: attr(html, /<title[^>]*>([^<]*)<\/title>/i),
    theme: {
      storesTheme: /data-theme|prefers-color-scheme|localStorage\.setItem\(['"][a-zA-Z-]*theme/.test(html + allCss)
    },
    previewImage: metaImage(html) ? new URL(metaImage(html), site.url).href : null,
    socialImageRaw: metaImage(html),
    icons: [...html.matchAll(/<link[^>]+rel=["']?[^"']*icon[^"']*["']?[^>]*>/gi)].map((m) => m[0].slice(0, 160)),
    fontFaces,
    fonts: [...fonts.keys()].slice(0, 12),
    fontWeights: [...weights.keys()].sort(),
    radii: [...radii.keys()].slice(0, 18),
    shadows: [...shadows.keys()].slice(0, 6),
    accents,
    customPropCount: vars.size,
    customPropsSample: [...vars.entries()].slice(0, 40).map(([k, v]) => [k, [...v].slice(0, 3)]),
    hasHeader: /<header\b|class=["'][^"']*(topbar|navbar|nav-|nav\b)/i.test(html)
  };
}

/* ------------------------------------------------------------------- report -- */

function tally(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const results = [];
for (const site of SITES) {
  process.stdout.write(`scraping ${site.id} ... `);
  const r = await scrape(site);
  results.push(r);
  console.log(r.error ? `FAILED (${r.error})` : `ok (${r.bytes} bytes html)`);
}

/* Stacked font stacks: split on commas so families can be tallied properly. */
const fontFamilies = [];
for (const r of results) {
  for (const stack of r.fonts || []) {
    for (const family of stack.split(',')) {
      const clean = family.trim().replace(/^["']|["']$/g, '');
      if (!clean || /^(sans-serif|serif|monospace|system-ui|ui-|inherit|-apple-system|BlinkMacSystemFont|Segoe UI|Roboto|Arial|Helvetica|Helvetica Neue|Menlo|Consolas|SFMono-Regular|monospace)/i.test(clean)) continue;
      fontFamilies.push(clean);
    }
  }
}

console.log('\n================ HOUSE DESIGN DNA ================\n');

console.log('FONT FAMILIES (by how many sites use them)');
for (const [family, n] of tally(fontFamilies)) console.log(`  ${n}x  ${family}`);

console.log('\nFONT-FACE SOURCES (self-hosted = same family of stack)');
for (const r of results) {
  if (r.error) continue;
  const faces = (r.fontFaces || []).map((f) => `${f.family}${f.weight ? ' ' + f.weight : ''}`);
  console.log(`  ${r.id.padEnd(20)} ${faces.length ? [...new Set(faces)].join(', ') : '(none)'}`);
}

console.log('\nACCENT COLOUR PER SITE');
for (const r of results) {
  if (r.error) continue;
  const a = (r.accents || [])[0];
  const list = (r.accents || []).slice(0, 3).map((x) => `${x.rgb} ${x.family}`).join('  |  ');
  console.log(`  ${r.id.padEnd(20)} ${a ? list : '(none found)'}`);
}

console.log('\nRADIUS SCALE (union, most common first)');
for (const [v, n] of tally(results.flatMap((r) => r.radii || []))) console.log(`  ${n}x  ${v}`);

console.log('\nSHADOWS (sample)');
for (const [v, n] of tally(results.flatMap((r) => r.shadows || [])).slice(0, 8)) console.log(`  ${n}x  ${v}`);

console.log('\nFONT WEIGHTS IN USE');
console.log('  ' + [...new Set(results.flatMap((r) => r.fontWeights || []))].sort().join(', '));

console.log('\nDARK MODE + HEADER SUPPORT');
for (const r of results) {
  if (r.error) continue;
  console.log(`  ${r.id.padEnd(20)} theme-aware: ${r.theme?.storesTheme ? 'yes' : 'no '}   header: ${r.hasHeader ? 'yes' : 'no'}`);
}

console.log('\nPREVIEW IMAGERY FOUND');
for (const r of results) {
  if (r.error) continue;
  console.log(`  ${r.id.padEnd(20)} ${r.previewImage || '(none)'}`);
}

console.log('\nCUSTOM PROPERTIES (count per site)');
for (const r of results) {
  if (r.error) continue;
  console.log(`  ${r.id.padEnd(20)} ${r.customPropCount} custom props`);
}

if (process.argv.includes('--json')) {
  await writeFile(new URL('./design-report.json', import.meta.url), JSON.stringify(results, null, 2));
  console.log('\nwrote tools/design-report.json');
}
