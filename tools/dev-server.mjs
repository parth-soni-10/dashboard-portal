/**
 * Local preview server.
 *
 *   node tools/dev-server.mjs [port]
 *
 * Serves the site the way Netlify will: static files from the repo root, the
 * functions behind exactly the routes netlify.toml rewrites to them, the 404s
 * declared in `_redirects`, and the response headers declared in `_headers`.
 * All three files are read rather than restated here, so local behaviour cannot
 * drift away from production — including the rules that keep development files
 * off the published site, which would otherwise look fine locally and be
 * blocked in production.
 *
 * Headers matter as much as routing, which is why they are applied here and not
 * left to Netlify. Until they were, this server sent no Content-Security-Policy
 * at all: production ships `script-src 'self'` with no unsafe-inline, and the
 * theme bootstrap was pulled out into theme-init.js to keep it that way, but
 * locally an inline <script>, an onclick= attribute or a CDN script all worked
 * perfectly and failed only after deploying. A policy that cannot be exercised
 * where the code is written is a policy that regresses.
 *
 * Function responses do NOT get `_headers` applied, because Netlify does not
 * apply it to them either: a function owns its own headers.
 *
 * Netlify's shadowing is modelled too, because it decides whether those rules
 * do anything at all. A `_redirects` rule does not fire for a URL that resolves
 * to a file the site has — which is exactly what every rule in that file is
 * aimed at — unless the status carries a `!`. So this server only applies an
 * unforced 404 rule to a path that is genuinely missing. Without that, a rule
 * missing its `!` would 404 here and serve the file in production, and the
 * difference would only show up after deploying.
 *
 * Everything is served `no-store`, on purpose. `python -m http.server` sends no
 * cache headers at all, and Chrome's heuristic cache then hands back a stale
 * styles.css or data/dashboards.js for minutes without revalidating — which
 * makes a change that works look like a change that did nothing. That cost real
 * debugging time here more than once; this server does not allow it.
 *
 * Functions are re-read from disk on every request. Node caches a required
 * module for the life of the process, so without dropping it an edited function
 * would keep serving the old code until the server was restarted — which made a
 * correct edit look broken once, when a renamed file kept answering at its old
 * URL.
 *
 * Not part of the deploy, and not referenced by the page.
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 4180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.toml': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

const require = createRequire(import.meta.url);

const reply = (res, status, type, body, extra) => {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(extra || {})
  });
  res.end(body);
};

/** The rewrites netlify.toml declares. */
async function readRoutes() {
  const toml = await readFile(join(root, 'netlify.toml'), 'utf8');
  const routes = new Map();
  for (const block of toml.split('[[redirects]]').slice(1)) {
    const from = block.match(/from\s*=\s*"([^"]+)"/);
    const to = block.match(/to\s*=\s*"([^"]+)"/);
    if (from && to) routes.set(from[1], to[1]);
  }
  return routes;
}

/**
 * The rules `_headers` declares, in file order.
 *
 * A path pattern starts a block; every indented `Name: value` line after it
 * belongs to that block. An indented line with no pattern above it is a
 * malformed file rather than a header, so it is dropped rather than attributed
 * to whichever block happens to be last.
 */
async function readHeaderRules() {
  const file = await readFile(join(root, '_headers'), 'utf8').catch(() => '');
  const rules = [];
  for (const raw of file.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const current = rules[rules.length - 1];
      const at = line.indexOf(':');
      if (current && at > 0) {
        current.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
      }
      continue;
    }
    rules.push({ pattern: line, headers: [] });
  }
  return rules;
}

/** Netlify's path matching: an exact path, or `/prefix/*` for everything under it. */
function headerRuleMatches(pattern, pathname) {
  if (pattern.endsWith('/*')) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

/** Every header declared for this path. Later blocks win, as they do on Netlify. */
function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules) {
    if (!headerRuleMatches(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) out[name] = value;
  }
  return out;
}

/** The rules `_redirects` declares: { from, to, status, force }, in file order. */
async function readRedirectRules() {
  const file = await readFile(join(root, '_redirects'), 'utf8').catch(() => '');
  return file
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      // `404!` — the bang is Netlify's "even though the file exists".
      const force = Boolean(status && status.endsWith('!'));
      return { from, to, status: Number(force ? status.slice(0, -1) : status) || 301, force };
    });
}

/** Whether the publish directory really holds this path. A rule without `!`
    only fires when it does not. */
async function staticExists(pathname) {
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (file !== root && !file.startsWith(root + sep)) return false;
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** The first rule matching a path, or null. `*` is treated as a prefix. */
function matchRedirect(pathname, rules) {
  for (const rule of rules) {
    if (rule.from.endsWith('*')) {
      if (pathname.startsWith(rule.from.slice(0, -1))) return rule;
    } else if (pathname === rule.from) {
      return rule;
    }
  }
  return null;
}

/** Which function, if any, serves this path. */
function functionFor(pathname, routes) {
  const target = routes.has(pathname) ? routes.get(pathname) : pathname;
  const match = target.match(/^\/\.netlify\/functions\/([\w-]+)$/);
  return match ? match[1] : null;
}

async function serveStatic(pathname, res) {
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const declared = headersFor(pathname);

  // Nothing outside the repo root, whatever the request says.
  if (file !== root && !file.startsWith(root + sep)) {
    reply(res, 403, 'text/plain; charset=utf-8', 'Forbidden\n', declared);
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      reply(res, 404, 'text/plain; charset=utf-8', 'Not found\n', declared);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      // `no-store` first, so a declared Cache-Control in _headers overrides it
      // exactly as it would on Netlify, where no default is sent at all.
      'Cache-Control': 'no-store',
      ...declared
    });
    res.end(body);
  } catch {
    reply(res, 404, 'text/plain; charset=utf-8', 'Not found\n', declared);
  }
}

const routes = await readRoutes();
const redirectRules = await readRedirectRules();
const headerRules = await readHeaderRules();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  // Declared 404s come first, as they do in production: these are the rules
  // that keep development files off the site.
  const rule = matchRedirect(pathname, redirectRules);
  if (rule && rule.status === 404 && (rule.force || !(await staticExists(pathname)))) {
    const body = await readFile(join(root, 'index.html')).catch(() => '');
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      ...headersFor(pathname)
    });
    res.end(body);
    return;
  }

  const name = functionFor(pathname, routes);
  if (!name) {
    await serveStatic(pathname, res);
    return;
  }

  let handler;
  try {
    const file = join(root, 'netlify', 'functions', `${name}.js`);
    delete require.cache[require.resolve(file)]; // edited functions take effect at once
    ({ handler } = require(file));
  } catch (error) {
    reply(res, 500, 'text/plain; charset=utf-8', `Cannot load function ${name}: ${error.message}\n`);
    return;
  }

  try {
    const result = await handler({
      httpMethod: req.method,
      path: pathname,
      rawUrl: url.href,
      headers: req.headers,
      queryStringParameters: Object.fromEntries(url.searchParams)
    });
    const headers = Object.assign({ 'Cache-Control': 'no-store' }, result.headers || {});
    const body = result.body || '';
    res.writeHead(result.statusCode || 200, headers);
    res.end(body);
  } catch (error) {
    reply(res, 502, 'text/plain; charset=utf-8', String((error && error.stack) || error));
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${port} is already in use — another preview server is running.`);
    console.error(`pick another one:  node tools/dev-server.mjs ${port + 1}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', async () => {
  console.log(`serving http://127.0.0.1:${port}/  (no-store, no build step)`);
  const functions = await readdir(join(root, 'netlify', 'functions')).catch(() => []);
  for (const [from, to] of routes) console.log(`  ${from}  ->  ${to}`);
  console.log(`  ${functions.filter((f) => f.endsWith('.js')).length} function file(s) in netlify/functions`);
  for (const rule of redirectRules) {
    console.log(`  ${rule.from}  ->  ${rule.to}  ${rule.status}${rule.force ? '!' : ''}`);
  }
  for (const rule of headerRules) {
    console.log(`  headers ${rule.pattern}  (${rule.headers.length})`);
  }
});
