/**
 * Local preview server.
 *
 *   node tools/dev-server.mjs [port]
 *
 * Serves the site the way Netlify will: static files from the repo root, and
 * the functions behind exactly the routes netlify.toml rewrites to them. Those
 * routes are read out of that file rather than written again here, so the local
 * routing cannot drift away from production.
 *
 * Everything is served `no-store`, on purpose. `python -m http.server` sends no
 * cache headers at all, and Chrome's heuristic cache then hands back a stale
 * styles.css or data/dashboards.js for minutes without revalidating — which
 * makes a change that works look like a change that did nothing. That cost real
 * debugging time here more than once; this server does not allow it.
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

const reply = (res, status, type, body) => {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
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

/** Which function, if any, serves this path. */
function functionFor(pathname, routes) {
  const target = routes.has(pathname) ? routes.get(pathname) : pathname;
  const match = target.match(/^\/\.netlify\/functions\/([\w-]+)$/);
  return match ? match[1] : null;
}

async function serveStatic(pathname, res) {
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));

  // Nothing outside the repo root, whatever the request says.
  if (file !== root && !file.startsWith(root + sep)) {
    reply(res, 403, 'text/plain; charset=utf-8', 'Forbidden\n');
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      reply(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    reply(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
  }
}

const routes = await readRoutes();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  const name = functionFor(pathname, routes);
  if (!name) {
    await serveStatic(pathname, res);
    return;
  }

  let handler;
  try {
    ({ handler } = require(join(root, 'netlify', 'functions', `${name}.js`)));
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
  console.log(`serving http://127.0.0.1:${port}/  (no-store, functions from netlify.toml)`);
  const functions = await readdir(join(root, 'netlify', 'functions')).catch(() => []);
  for (const [from, to] of routes) console.log(`  ${from}  ->  ${to}`);
  console.log(`  ${functions.filter((f) => f.endsWith('.js')).length} function file(s) in netlify/functions`);
});
