/**
 * Local preview server.
 *
 *   node tools/dev-server.mjs [port]
 *
 * Serves the site the way Cloudflare Workers will: static files from the repo
 * root minus everything `.assetsignore` excludes, `/api/*` answered by the same
 * worker.js the deploy uploads, and the response headers declared in
 * `_headers`. All of those are read rather than restated here, so local
 * behaviour cannot drift away from production — including the rules that keep
 * development files off the published site, which would otherwise look fine
 * locally and be missing in production.
 *
 * Headers matter as much as routing, which is why they are applied here and not
 * left to the host. Until they were, this server sent no Content-Security-Policy
 * at all: production ships `script-src 'self'` with no unsafe-inline, and the
 * theme bootstrap was pulled out into theme-init.js to keep it that way, but
 * locally an inline <script>, an onclick= attribute or a CDN script all worked
 * perfectly and failed only after deploying. A policy that cannot be exercised
 * where the code is written is a policy that regresses.
 *
 * Worker responses do NOT get `_headers` applied, because Cloudflare does not
 * apply it to them either: rule headers cover static-asset responses only, and
 * the Worker owns its own headers.
 *
 * The blocking model is `.assetsignore` itself rather than a restatement of
 * it: a path it lists is answered 404 here exactly as it is in production,
 * where the file is never uploaded in the first place. That is what keeps
 * tools/ and the README off the site locally, before a deploy finds out for
 * you.
 *
 * Everything is served `no-store`, on purpose. `python -m http.server` sends no
 * cache headers at all, and Chrome's heuristic cache then hands back a stale
 * styles.css or data/dashboards.js for minutes without revalidating — which
 * makes a change that works look like a change that did nothing. That cost real
 * debugging time here more than once; this server does not allow it.
 *
 * worker.js is re-imported with a cache-busting query on every request. Node
 * caches a module for the life of the process, so without it an edited Worker
 * would keep serving the old code until the server was restarted — which made
 * a correct edit look broken once, when a renamed file kept answering at its
 * old URL.
 *
 * Not part of the deploy, and not referenced by the page.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const reply = (res, status, type, body, extra) => {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...(extra || {})
  });
  res.end(body);
};

/** The `run_worker_first` patterns wrangler.toml declares. */
async function readWorkerFirst() {
  const toml = await readFile(join(root, 'wrangler.toml'), 'utf8').catch(() => '');
  return [...toml.matchAll(/run_worker_first\s*=\s*\[([^\]]*)\]/g)]
    .flatMap((match) => match[1].split(','))
    .map((pattern) => pattern.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** The `[vars]` wrangler.toml declares — the Worker's plain environment. The
    pattern only matches ALL_CAPS keys, which in that file is exactly [vars]. */
async function readVars() {
  const toml = await readFile(join(root, 'wrangler.toml'), 'utf8').catch(() => '');
  const vars = {};
  for (const match of toml.matchAll(/^([A-Z][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) vars[match[1]] = match[2];
  return vars;
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

/** `_headers` path matching: an exact path, or `/prefix/*` for everything under it. */
function headerRuleMatches(pattern, pathname) {
  if (pattern.endsWith('/*')) return pathname.startsWith(pattern.slice(0, -1));
  return pathname === pattern;
}

/** Every header declared for this path. Later blocks win, as the convention says. */
function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules) {
    if (!headerRuleMatches(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) out[name] = value;
  }
  return out;
}

/** The paths `.assetsignore` blocks, with its trailing slashes normalised
    away so one entry covers a file or a whole directory. */
async function readIgnorePatterns() {
  const file = await readFile(join(root, '.assetsignore'), 'utf8').catch(() => '');
  return file
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((pattern) => pattern.replace(/\/$/, ''));
}

/** Whether production would have this path at all — a pathname either is an
    ignored file, or sits under an ignored directory. */
function isIgnored(patterns, pathname) {
  const path = pathname.replace(/^\//, '');
  return patterns.some((pattern) => path === pattern || path.startsWith(pattern + '/'));
}

/** Whether wrangler.toml would run the Worker first for this pathname. */
function runsWorkerFirst(patterns, pathname) {
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern
  );
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
      // exactly as it does in production, where no default is sent at all.
      'Cache-Control': 'no-store',
      ...declared
    });
    res.end(body);
  } catch {
    reply(res, 404, 'text/plain; charset=utf-8', 'Not found\n', declared);
  }
}

const workerFirst = await readWorkerFirst();
const vars = await readVars();
const ignorePatterns = await readIgnorePatterns();
const headerRules = await readHeaderRules();
const workerUrl = pathToFileURL(join(root, 'worker.js')).href;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  // `.assetsignore` comes first, as it does in production: these are the files
  // that are never uploaded, so a request for one is answered 404 here too.
  if (isIgnored(ignorePatterns, pathname)) {
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

  if (runsWorkerFirst(workerFirst, pathname)) {
    try {
      // Re-imported with a cache-busting query so an edited worker.js takes
      // effect at once, the way the function loader used to.
      const worker = (await import(`${workerUrl}?t=${Date.now()}`)).default;
      const result = await worker.fetch(
        new Request(url.href, { method: req.method, headers: req.headers }),
        { ...vars, ASSETS: { fetch: () => new Response('Not found\n', { status: 404 }) } }
      );
      const body = Buffer.from(await result.arrayBuffer());
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(body);
    } catch (error) {
      reply(res, 502, 'text/plain; charset=utf-8', String((error && error.stack) || error));
    }
    return;
  }

  await serveStatic(pathname, res);
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
  for (const pattern of workerFirst) console.log(`  worker first  ${pattern}`);
  console.log(`  ${ignorePatterns.length} path(s) blocked by .assetsignore`);
  for (const rule of headerRules) {
    console.log(`  headers ${rule.pattern}  (${rule.headers.length})`);
  }
});
