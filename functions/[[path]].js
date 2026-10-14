/* ---------------------------------------------------------------------------
 * The Pages Function this site is served by.
 *
 * Pages is this site's only host: there is no Worker beside it, and no second
 * config that could build one. `functions/[[path]].js` is the catch-all route,
 * so every request to the site arrives here, and the handler it imports -
 * `_router.js`, the file that used to be `worker.js` - does the work: it
 * answers `/api/watchlist` and hands everything else to `env.ASSETS.fetch()`.
 *
 * Why two files rather than one: Pages compiles every file in this directory
 * as a route, and only the entry needs to be one. `_router.js` carries the
 * underscore prefix Pages treats as private - a module, never a path of its own
 * - so the site's routing is exactly the one catch-all below, and there is no
 * per-endpoint file to keep in step with the endpoint list in `app.js`.
 *
 * This is what replaced the Workers deployment. The handler was bundled,
 * uploaded and run as a Worker, then staged as the project's `_worker.js` in
 * advanced mode; it is now compiled by Pages itself, which is the same runtime
 * it was already being served from, minus the build step and the second config.
 * ------------------------------------------------------------------------ */
import router from './_router.js';

export const onRequest = (context) => router.fetch(context.request, context.env, context);
