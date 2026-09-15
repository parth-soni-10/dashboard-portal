/* ---------------------------------------------------------------------------
 * Dashboard Portal
 *
 * No framework, no build step, matching the rest of the deployed dashboards.
 * Everything on screen is derived from window.DASHBOARDS, so adding a
 * dashboard means editing data/dashboards.js and nothing else.
 * ------------------------------------------------------------------------ */

(function () {
  'use strict';

  var THEME_KEY = 'hub-theme';
  var PROBE_TTL = 5 * 60 * 1000; // re-probe a link at most every five minutes
  var PROBE_TIMEOUT = 8000;
  // Longer than the function's own 9s budget on purpose: the client must wait
  // for the function's answer, not cut it off and report a failure the server
  // was about to turn into a result.
  var COUNT_TIMEOUT = 12000;
  var PREVIEW_DOC_W = 1280; // logical width a preview is rendered at
  var PREVIEW_TIMEOUT = 10000; // how long a preview may take to appear at all
  var PREVIEW_SETTLE = 900; // how long to hold the cover after `load` fires

  var dashboards = Array.isArray(window.DASHBOARDS) ? window.DASHBOARDS.slice() : [];

  var el = {
    grid: document.getElementById('grid'),
    filter: document.getElementById('filter'),
    empty: document.getElementById('empty'),
    emptyReset: document.getElementById('empty-reset'),
    emptyTitle: document.getElementById('empty-title'),
    emptyBody: document.getElementById('empty-body'),
    meta: document.getElementById('meta'),
    footnote: document.getElementById('footnote'),
    footnoteText: document.getElementById('footnote-text'),
    recheck: document.getElementById('recheck'),
    themeToggle: document.getElementById('theme-toggle')
  };

  /* ------------------------------------------------------------- helpers -- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hostOf(url) {
    if (!url) return '';
    try {
      return new URL(url).host;
    } catch (e) {
      return String(url).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }
  }

  /** Index numerals are a positional device, so they are wide enough to stop
   *  the column shifting once a list passes nine entries. */
  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** Every dashboard here is served from netlify.app, so that suffix is noise
   *  in a 10px mono column. It is stripped for display only: the link and the
   *  tooltip both keep the real host. */
  function shortHost(host) {
    return host.replace(/\.netlify\.app$/, '');
  }

  /**
   * Return the entry's URL only when it is a usable absolute http(s) address.
   *
   * This is not defensive padding. The manifest is edited by hand, and a typo
   * like `example.com` is a *relative* URL: rendered as-is it becomes a link to
   * nowhere, and — far worse — the reachability probe resolves it against this
   * page's own origin, gets a perfectly good response, and paints the row
   * green. A false "Reachable" is the single most misleading thing this page
   * could show, so an unusable URL is refused up front and reported as such.
   */
  function deployUrl(item) {
    if (!item || !item.url) return '';
    try {
      var parsed = new URL(item.url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? item.url : '';
    } catch (e) {
      return '';
    }
  }

  function hasDeploy(item) {
    return !!deployUrl(item);
  }

  /** The manifest entry behind an id, or null. */
  function itemOf(id) {
    for (var i = 0; i < dashboards.length; i++) {
      if (dashboards[i].id === id) return dashboards[i];
    }
    return null;
  }

  /* -- live figures -------------------------------------------------------
   * A description may contain {placeholders} drawn from its own `count` block.
   * The figures come from that dashboard's data, read by a function on our own
   * origin — that dashboard's endpoint sends no CORS headers, so a browser here
   * is not allowed to read it directly.
   *
   * The manifest therefore also carries the last figures known by hand. They
   * paint first and stay if the reading never completes, and the hover text
   * always says which of the two you are looking at: a recorded number must
   * never be presented as a live one, which is precisely how the number went
   * stale in the first place.
   */

  var liveCounts = {}; // id -> { values: {...}, read: Date }

  function countConfig(item) {
    return item && item.count && item.count.endpoint ? item.count : null;
  }

  function figures(item) {
    var cfg = countConfig(item);
    if (!cfg) return null;
    var live = liveCounts[item.id];
    return live ? { values: live.values, live: true } : { values: cfg.fallback || {}, live: false };
  }

  function clockOf(date) {
    try {
      return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function figureHint(item, isLive) {
    var cfg = countConfig(item);
    if (!cfg) return '';
    if (isLive) {
      var read = liveCounts[item.id] && liveCounts[item.id].read;
      return 'Live from ' + cfg.source + (read ? ', read at ' + clockOf(read) : '') + '.';
    }
    var when = formatVerified(cfg.recorded);
    return when
      ? 'Last recorded figures, from ' + when + '. The live reading did not complete.'
      : 'Last recorded figures. The live reading did not complete.';
  }

  /**
   * Substitute the placeholders. Only the numbers themselves become markup,
   * and only so they can carry the hint that says where they came from; the
   * text around them is escaped as usual. A placeholder with no matching figure
   * is left visible rather than swallowed, so a typo in the manifest shows up
   * as a typo instead of as a silently missing number.
   */
  function renderDescription(item) {
    var text = String(item.description || '');
    if (!countConfig(item)) return esc(text);

    var shown = figures(item);
    var hint = esc(figureHint(item, shown.live));
    var out = [];
    var last = 0;

    text.replace(/\{(\w+)\}/g, function (match, key, offset) {
      out.push(esc(text.slice(last, offset)));
      last = offset + match.length;
      var value = shown.values[key];
      out.push(
        typeof value === 'number'
          ? '<span class="fig' +
            (shown.live ? '' : ' fig-stale') +
            '" title="' +
            hint +
            '">' +
            value +
            '</span>'
          : esc(match)
      );
      return match;
    });

    out.push(esc(text.slice(last)));
    return out.join('');
  }

  /** The same sentence as plain text, so the filter can match the figures too. */
  function plainDescription(item) {
    var shown = figures(item);
    if (!shown) return String(item.description || '');
    return String(item.description || '').replace(/\{(\w+)\}/g, function (match, key) {
      return typeof shown.values[key] === 'number' ? String(shown.values[key]) : match;
    });
  }

  /**
   * Read one entry's figures from its own endpoint. Always resolves: a missing
   * function, a cold upstream or no network at all simply leaves the recorded
   * figures in place, which is an honest outcome rather than a broken row.
   */
  function fetchCount(item) {
    var cfg = countConfig(item);
    if (!cfg || !('fetch' in window)) return Promise.resolve();

    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, COUNT_TIMEOUT);

    return fetch(cfg.endpoint, {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        // Take only the fields the description prints, and only when the answer
        // really carried a number: an error page or a changed upstream shape
        // must not reach the page dressed as a figure.
        var values = {};
        Object.keys(cfg.fallback || {}).forEach(function (key) {
          var value = data ? data[key] : null;
          if (typeof value === 'number' && isFinite(value)) values[key] = value;
        });
        if (!Object.keys(values).length) throw new Error('no usable figures');

        var read = data.fetched ? new Date(data.fetched) : new Date();
        liveCounts[item.id] = { values: values, read: isNaN(read.getTime()) ? new Date() : read };
      })
      .catch(function () {
        /* the recorded figures stand */
      })
      .then(function () {
        clearTimeout(timer);
      });
  }

  /** Repaint only the descriptions, leaving the rows (and any open preview) alone. */
  function refreshFigures() {
    dashboards.forEach(function (item) {
      if (!countConfig(item)) return;
      var row = findRow(item.id);
      var desc = row ? row.querySelector('.row-desc') : null;
      if (desc) desc.innerHTML = renderDescription(item);
    });
  }

  /* --------------------------------------------------------------- icons -- */

  function hydrateIcons(scope) {
    var nodes = (scope || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var size = node.classList.contains('empty-ico') ? 17 : 15;
      node.innerHTML = icon(node.dataset.icon, size);
    }
  }

  function fillThemeGlyphs() {
    var sun = document.querySelector('.theme-glyph-sun');
    var moon = document.querySelector('.theme-glyph-moon');
    if (sun) sun.innerHTML = icon('sun', 16);
    if (moon) moon.innerHTML = icon('moon', 16);
  }

  /* ------------------------------------------------------- link checking -- */

  /**
   * Ask whether this browser can reach a deployed dashboard.
   *
   * Cross-origin reads are blocked without CORS headers, so this sends a
   * no-cors request: the body is opaque, but the promise resolves when the
   * host answers. A rejection means this browser could not complete the
   * request, which is NOT the same as the dashboard being down. A host that
   * ships `Cross-Origin-Resource-Policy: same-origin` refuses cross-site
   * checks by design and will always reject, so a rejection must never be
   * reported as an outage.
   *
   * So the failure state is reported as "Could not verify" rather than
   * "Unreachable". Overstating a blocked probe as an outage would be worse
   * than showing no badge at all.
   */
  function probe(url) {
    if (!('fetch' in window) || !url) return Promise.resolve('offline');
    if (navigator.onLine === false) return Promise.resolve('offline');

    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, PROBE_TIMEOUT);

    return fetch(url, {
      // HEAD, not GET. A no-cors response is opaque, so its body can never be
      // read: a GET invites a transfer of the whole page of every dashboard
      // (one of them is 212 KB) for information that is discarded regardless.
      // HEAD asks the only question this check asks — did the host answer?
      //
      // Either verb leaves a companion net::ERR_ABORTED in devtools. That is
      // Chrome discarding the opaque response and is not a failure: the 200
      // arrives first and the badge still resolves to Reachable.
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined
    })
      .then(function () {
        return 'live';
      })
      .catch(function () {
        return navigator.onLine === false ? 'offline' : 'unverified';
      })
      .then(function (result) {
        clearTimeout(timer);
        return result;
      });
  }

  function readCache() {
    try {
      var raw = sessionStorage.getItem('hub-probe');
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.at || Date.now() - parsed.at >= PROBE_TTL) return null;
      var results = parsed.results || {};
      // An empty cache means every probe came back transient, so there is
      // nothing worth reusing. Reporting it as a hit would strand the badges
      // on their stale state for the rest of the TTL.
      if (!Object.keys(results).length) return null;
      return results;
    } catch (e) {
      /* ignore a corrupt cache */
    }
    return null;
  }

  function writeCache(results) {
    // Never cache a transient state: an "offline" result or an interrupted
    // check would otherwise stick for the whole five-minute window.
    var durable = {};
    Object.keys(results).forEach(function (id) {
      if (results[id] === 'live' || results[id] === 'unverified') durable[id] = results[id];
    });
    try {
      sessionStorage.setItem('hub-probe', JSON.stringify({ at: Date.now(), results: durable }));
    } catch (e) {
      /* storage unavailable: probing simply runs again next visit */
    }
  }

  var probeState = readCache() || {};

  /* ------------------------------------------------------ status rendering -- */

  /*
   * One colour, one meaning:
   *   green  confirmed reachable from this browser
   *   amber  could not be confirmed (never a claim that the site is down)
   *   grey   nothing to confirm, or a check in flight
   */
  var STATUS_COPY = {
    live: { cls: 'status-live', text: 'Reachable', hint: 'This browser reached the dashboard.' },
    unverified: {
      cls: 'status-warn',
      text: 'Could not verify',
      hint: 'The check did not complete. Some dashboards block cross-site requests, so this is not evidence the site is down.'
    },
    offline: {
      cls: '',
      text: 'Offline',
      hint: 'This device reports no network connection.'
    },
    checking: { cls: 'status-checking', text: 'Checking', hint: 'Check in progress.' },
    pending: {
      cls: '',
      text: 'Not deployed',
      hint: 'No deploy URL has been recorded for this dashboard yet.'
    },
    broken: {
      cls: 'status-warn',
      text: 'Bad link',
      hint: 'The url in data/dashboards.js is not a valid absolute http(s) address, so it was neither linked nor checked.'
    }
  };

  function statusOf(item) {
    if (!item.url) return 'pending';
    if (!deployUrl(item)) return 'broken';
    return probeState[item.id] || 'checking';
  }

  /** 2026-09-14 -> "14 Sept 2026", so the manifest's provenance line reads. */
  function formatVerified(iso) {
    var when = new Date(String(iso) + 'T00:00:00Z');
    if (isNaN(when.getTime())) return '';
    return when.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  /**
   * The pill's tooltip carries the hand-checked date. An automatic probe cannot
   * be trusted as the only evidence — a dashboard that blocks cross-site
   * checks can never confirm itself — so the date the link was last opened by
   * hand is the honest fallback, and this is where it belongs: available on
   * hover and to a screen reader without adding a line of chrome.
   */
  function statusMarkup(state, item) {
    var copy = STATUS_COPY[state] || STATUS_COPY.checking;
    var hint = copy.hint || '';
    // Only meaningful once there is a URL to have checked. A dashboard with no
    // deploy link cannot have been hand-checked, and claiming otherwise would
    // contradict the "Not deployed" label sitting next to it.
    var seen = item && hasDeploy(item) && item.verified ? formatVerified(item.verified) : '';
    if (seen) hint += ' Last hand-checked ' + seen + '.';
    return (
      '<span class="status ' +
      copy.cls +
      '" title="' +
      esc(hint) +
      '"><span class="status-dot" aria-hidden="true"></span>' +
      esc(copy.text) +
      '</span>'
    );
  }

  /* --------------------------------------------------------------- preview --
   * A live view of the dashboard itself, opened inside its own row rather than
   * in a floating overlay: it can never cover the other rows, it needs no
   * scroll or resize anchoring, and it behaves identically for a mouse, a
   * keyboard and a thumb. Only one is ever open, and closing it empties the
   * box — which is what actually unloads the frame. Leaving four detached
   * iframes behind would keep four dashboards running.
   */

  var previewOpenId = null;
  var previewTimer = null;
  var previewObserver =
    'ResizeObserver' in window
      ? new ResizeObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) fitPreview(entries[i].target);
        })
      : null;

  function previewButton(item) {
    var label = 'Preview ' + item.name;
    return (
      '<button class="icon-btn preview-btn" type="button" data-preview="' +
      esc(item.id) +
      '" aria-expanded="false" aria-controls="preview-' +
      esc(item.id) +
      '" title="' +
      esc(label) +
      '" aria-label="' +
      esc(label) +
      '">' +
      icon('eye', 15) +
      '</button>'
    );
  }

  function openLink(item, label) {
    return (
      '<a class="preview-open" href="' +
      esc(deployUrl(item)) +
      '" target="_blank" rel="noopener">' +
      esc(label) +
      '</a>'
    );
  }

  /** A declared non-embeddable dashboard gets the explanation immediately,
   *  rather than a frame that is guaranteed to render the browser's error page. */
  function previewBlocked(item) {
    return (
      '<p class="preview-note">' +
      '<span class="preview-note-ico" data-icon="ban" aria-hidden="true"></span>' +
      '<span><strong>' +
      esc(item.name) +
      '</strong> refuses to be loaded inside another page, so it cannot be previewed here. ' +
      openLink(item, 'Open it in a new tab') +
      ' instead.</span></p>'
    );
  }

  function previewFailed(item) {
    return (
      '<p class="preview-note">' +
      '<span class="preview-note-ico" data-icon="triangle-alert" aria-hidden="true"></span>' +
      '<span>The live preview did not load. ' +
      esc(item.name) +
      ' may have started refusing to be framed, or the network stalled. ' +
      openLink(item, 'Open it in a new tab') +
      ' instead.</span></p>'
    );
  }

  function previewBody(item) {
    if (item.embed === false) return previewBlocked(item);

    return (
      '<figure class="preview-figure">' +
      '<div class="preview-viewport">' +
      '<iframe class="preview-doc" src="' +
      esc(deployUrl(item)) +
      '" title="' +
      esc('Live preview of ' + item.name) +
      // No allow-top-navigation: the framed dashboard must not be able to
      // navigate this page out from under the visitor.
      '" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"' +
      ' referrerpolicy="no-referrer" loading="eager"></iframe>' +
      '<span class="preview-state">Loading the live dashboard\u2026</span>' +
      '</div>' +
      '<figcaption class="preview-cap">Live preview \u00b7 ' +
      openLink(item, 'Open ' + item.name) +
      '</figcaption></figure>'
    );
  }

  /** Scale the frame to the width available, so a preview is the same shape at
   *  every viewport size and reads as a screenshot rather than a squeezed page. */
  function fitPreview(viewport) {
    var width = viewport.clientWidth;
    if (!width) return;
    viewport.style.setProperty('--preview-scale', String(Math.min(1, width / PREVIEW_DOC_W)));
  }

  /** Compared by walking the buttons, not by building a selector from the id. */
  function previewButtonOf(id) {
    var buttons = el.grid.querySelectorAll('.preview-btn');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].dataset.preview === id) return buttons[i];
    }
    return null;
  }

  function setPreviewButton(id, open) {
    var button = previewButtonOf(id);
    if (!button) return;
    var item = itemOf(id);
    var label = (open ? 'Hide preview of ' : 'Preview ') + (item ? item.name : '');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.classList.toggle('is-open', open);
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function closePreview(refocus) {
    var id = previewOpenId;
    previewOpenId = null;
    clearTimeout(previewTimer);
    previewTimer = null;
    if (previewObserver) previewObserver.disconnect();
    if (!id) return;

    var row = findRow(id);
    var box = row ? row.querySelector('.row-preview') : null;
    if (box) {
      box.innerHTML = '';
      box.hidden = true;
    }

    setPreviewButton(id, false);
    if (refocus) {
      var button = previewButtonOf(id);
      if (button) button.focus();
    }
  }

  function openPreview(id) {
    var item = itemOf(id);
    if (!item || !hasDeploy(item) || id === previewOpenId) return;
    closePreview(false);

    var row = findRow(id);
    var box = row ? row.querySelector('.row-preview') : null;
    if (!box) return;

    box.innerHTML = previewBody(item);
    box.hidden = false;
    hydrateIcons(box);
    previewOpenId = id;
    setPreviewButton(id, true);

    var viewport = box.querySelector('.preview-viewport');
    if (!viewport) return; // the declared-blocked explanation has no frame

    fitPreview(viewport);
    if (previewObserver) previewObserver.observe(viewport);

    var settled = false;
    previewTimer = setTimeout(function () {
      if (settled) return;
      settled = true;
      // Covers the frame that never settles at all — a host that accepts the
      // connection and then stops answering. It cannot cover the other
      // failure: a dashboard that is down renders the browser's own error page
      // inside the frame, and from out here that is indistinguishable from a
      // real page. No client-side check can tell them apart, which is why the
      // manifest declares `embed` and tools/check-embed.mjs asserts it against
      // the live headers.
      viewport.outerHTML = previewFailed(item);
      hydrateIcons(box);
    }, PREVIEW_TIMEOUT);

    var frame = box.querySelector('.preview-doc');
    if (!frame) return;
    frame.addEventListener('load', function () {
      if (settled) return;
      settled = true;
      clearTimeout(previewTimer);
      // `load` fires when the document and its subresources are done, but every
      // dashboard here paints its figures *after* it has fetched its own data —
      // RBI's banner and cards arrive a second or two later. Dropping the cover
      // on `load` therefore revealed a blank box for exactly that gap. Holding
      // it for one more beat covers the gap instead, and after that the frame
      // is showing the dashboard's own progress rather than nothing.
      previewTimer = setTimeout(function () {
        var state = box.querySelector('.preview-state');
        if (state) state.remove();
      }, PREVIEW_SETTLE);
    });
  }

  function togglePreview(id) {
    if (id === previewOpenId) closePreview(true);
    else openPreview(id);
  }

  /* ------------------------------------------------------------- rendering -- */

  function rowMarkup(item, index) {
    var state = statusOf(item);
    var href = deployUrl(item);
    var live = !!href;
    var host = hostOf(href);
    var tagList = item.tags || [];

    // A rejected url is shown raw, so the typo that caused it is visible rather
    // than being reported as "no deploy URL recorded".
    var hostText = href
      ? shortHost(host)
      : item.url
        ? String(item.url)
        : 'No deploy URL recorded';

    var name = live
      ? '<a href="' +
        esc(href) +
        // No title here: it would only repeat the description that is already
        // visible, and some screen readers announce a title in place of the
        // link text.
        '" target="_blank" rel="noopener">' +
        esc(item.name) +
        '</a>'
      : esc(item.name);

    var repo = item.repo
      ? '<a class="icon-btn" href="' +
        esc(item.repo) +
        '" target="_blank" rel="noopener" title="' +
        esc(item.name) +
        ' source on GitHub" aria-label="' +
        esc(item.name) +
        ' source on GitHub">' +
        icon('github', 15) +
        '</a>'
      : '';

    // The eye is offered even for a dashboard that cannot be framed: the row can
    // then explain why there is no preview instead of offering nothing at all.
    var preview = live ? previewButton(item) : '';

    return (
      '<li class="row' +
      (live ? '' : ' is-pending') +
      '" data-id="' +
      esc(item.id) +
      '"' +
      // An entry with no tone falls back to the house accent in CSS.
      (item.tone ? ' data-tone="' + esc(item.tone) + '"' : '') +
      '>' +
      '<span class="row-index" aria-hidden="true">' +
      pad2(index + 1) +
      '</span>' +
      '<div class="row-main">' +
      '<h3 class="row-title">' +
      name +
      '</h3>' +
      '<p class="row-desc">' +
      renderDescription(item) +
      '</p>' +
      '</div>' +
      '<div class="row-meta">' +
      statusMarkup(state, item) +
      '<div class="row-foot">' +
      // The tooltip holds the full host, which is the only reason to have one:
      // the visible text has had the netlify.app suffix stripped.
      '<span class="row-host" title="' +
      esc(host || String(item.url || '')) +
      '">' +
      esc(hostText) +
      '</span>' +
      preview +
      repo +
      (live ? '<span class="row-go" aria-hidden="true">' + icon('arrow-up-right', 15) + '</span>' : '') +
      '</div>' +
      (tagList.length
        ? '<p class="row-tags" title="' +
          esc(tagList.join(', ')) +
          '">' +
          esc(tagList.join(' \u00b7 ')) +
          '</p>'
        : '') +
      '</div>' +
      // Empty until opened. Living inside the row is what keeps the preview
      // from covering anything or needing to be re-anchored on scroll.
      (live ? '<div class="row-preview" id="preview-' + esc(item.id) + '" hidden></div>' : '') +
      '</li>'
    );
  }

  /**
   * Found by walking children rather than by building a selector from the id.
   * An id containing a quote or bracket would make querySelector throw a
   * SyntaxError and take the whole check down with it; comparing dataset.id
   * cannot be broken by the data.
   */
  function findRow(id) {
    var rows = el.grid.children;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.id === id) return rows[i];
    }
    return null;
  }

  function refreshStatus(item, state) {
    var row = findRow(item.id);
    if (!row) return;
    var pill = row.querySelector('.status');
    if (pill) pill.outerHTML = statusMarkup(state, item);
  }

  /* --------------------------------------------------------------- filters -- */

  var scope = 'all';
  var query = '';
  var checkedAt = '';

  function matches(item) {
    if (scope === 'deployed' && !hasDeploy(item)) return false;
    if (scope === 'unlinked' && hasDeploy(item)) return false;

    if (!query) return true;
    var haystack = [item.name, item.description, plainDescription(item), (item.tags || []).join(' ')]
      .join(' ')
      .toLowerCase();
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every(function (term) {
        return haystack.indexOf(term) !== -1;
      });
  }

  function filtering() {
    return !!query || scope !== 'all';
  }

  /** Only entries that actually have a checkable address. */
  function withUrl() {
    return dashboards.filter(hasDeploy);
  }

  /**
   * True once every deployed dashboard has an answer worth acting on. The
   * offline state counts: the device has no connection, so waiting for a better
   * answer would leave the summary claiming to be checking for ever while every
   * badge already says otherwise.
   */
  function settled() {
    var targets = withUrl();
    return (
      targets.length > 0 &&
      targets.every(function (d) {
        var state = statusOf(d);
        return (
          state === 'live' || state === 'unverified' || state === 'offline' || state === 'broken'
        );
      })
    );
  }

  /**
   * Keep each chip's visual state and its announced state in step. Without
   * aria-pressed a screen reader cannot tell which filter is active.
   */
  function setScope(next) {
    scope = next;
    document.querySelectorAll('.chip').forEach(function (chip) {
      var on = chip.dataset.scope === next;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /**
   * Empty-state copy has to explain the right reason. "Nothing matches" is
   * wrong when the cause is a scope filter rather than a search word.
   */
  function emptyCopy() {
    if (query) {
      return {
        title: 'Nothing matches "' + query + '"',
        body: 'Try a different word, or reset the filter to see every dashboard.'
      };
    }
    if (scope === 'unlinked') {
      return {
        title: 'Everything is linked',
        body:
          'All ' +
          dashboards.length +
          ' dashboards have a usable link. Switch back to All to browse them.'
      };
    }
    if (scope === 'deployed') {
      return {
        title: 'Nothing has a usable link',
        body: 'Add a valid url to an entry in data/dashboards.js.'
      };
    }
    return {
      title: 'Nothing to show',
      body: 'No dashboards are configured yet. Add one to data/dashboards.js.'
    };
  }

  /* --------------------------------------------------------------- the meta line
   * One line of chrome that carries either the filter count or the health
   * summary, never both, so it always fits on a single row. */
  function renderMeta() {
    var total = dashboards.length;
    if (!total) {
      el.meta.textContent = 'No dashboards configured yet.';
      return;
    }

    if (filtering()) {
      var shown = dashboards.filter(matches).length;
      el.meta.innerHTML =
        'Showing <strong>' + shown + '</strong> of <strong>' + total + '</strong> dashboards';
      return;
    }

    // A manifest where nothing is deployed yet is a real state: saying
    // "checking links" forever would be a lie, because there is nothing to check.
    var checked = withUrl();
    if (!checked.length) {
      // Covers both "no url recorded" and "every url rejected": neither has
      // anything that could be linked or checked.
      el.meta.innerHTML = '<strong>' + total + '</strong> dashboards, none linked yet';
      return;
    }

    if (!settled()) {
      el.meta.innerHTML = '<strong>' + total + '</strong> dashboards, checking links';
      return;
    }

    var reachable = checked.filter(function (d) {
      return statusOf(d) === 'live';
    }).length;

    el.meta.innerHTML =
      '<strong>' +
      total +
      '</strong> dashboards, <strong>' +
      reachable +
      '</strong> reachable, checked <strong>' +
      esc(checkedAt || 'just now') +
      '</strong>';
  }

  var introPlayed = false;

  function render() {
    // Re-rendering replaces the rows, and with them the element an open preview
    // lives in, so it is closed first rather than left pointing at a detached
    // frame that is still loading in the background.
    closePreview(false);

    // The stagger is an entrance, not a transition. Replaying it on every
    // keystroke made the whole list flicker while filtering, so it is applied
    // to the first paint only. Toggled before the rows are inserted, so the
    // rows created by a later render simply never match the rule.
    el.grid.classList.toggle('is-intro', !introPlayed);
    introPlayed = true;

    var visible = dashboards.filter(matches);
    var total = dashboards.length;

    el.grid.innerHTML = visible.map(rowMarkup).join('');
    hydrateIcons(el.grid);

    el.empty.hidden = visible.length !== 0;
    el.grid.hidden = visible.length === 0;

    if (!visible.length) {
      var copy = emptyCopy();
      el.emptyTitle.textContent = copy.title;
      el.emptyBody.textContent = copy.body;
    }

    renderMeta();
  }

  /* ------------------------------------------------------------ link check -- */

  function updateFootnote() {
    var unverified = withUrl().filter(function (d) {
      return statusOf(d) === 'unverified';
    });
    var offline = withUrl().filter(function (d) {
      return statusOf(d) === 'offline';
    });
    // Broken entries are not in withUrl(), because they are never checked.
    var broken = dashboards.filter(function (d) {
      return statusOf(d) === 'broken';
    });

    el.footnote.hidden = unverified.length === 0 && offline.length === 0 && broken.length === 0;

    if (!unverified.length && !offline.length && !broken.length) {
      el.footnoteText.textContent = '';
      return;
    }

    // Being offline explains every badge at once, so it takes precedence.
    if (offline.length) {
      el.footnoteText.innerHTML =
        'This device reports no network connection, so the links could not be checked. ' +
        'They may be perfectly healthy.';
      return;
    }

    // A rejected url needs a code change, so say exactly which entry is wrong.
    if (broken.length) {
      el.footnoteText.innerHTML =
        'Invalid url in <strong>' +
        broken
          .map(function (d) {
            return esc(d.name);
          })
          .join('</strong>, <strong>') +
        '</strong>. Only absolute http(s) addresses can be linked and checked, so ' +
        (broken.length === 1 ? 'this entry was' : 'these entries were') +
        ' skipped.';
      return;
    }

    var names = unverified.map(function (d) {
      return esc(d.name);
    });

    el.footnoteText.innerHTML =
      (unverified.length === 1
        ? '<strong>' + names[0] + '</strong> blocks'
        : '<strong>' + names.join('</strong>, <strong>') + '</strong> block') +
      ' cross-site checks, so ' +
      (unverified.length === 1 ? 'its' : 'their') +
      ' badge cannot be confirmed from this browser. Open the dashboard to check by hand.';
  }

  function finishCheck() {
    writeCache(probeState);
    checkedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    updateFootnote();
    renderMeta();
  }

  function checkAll(force) {
    var targets = withUrl();
    if (!targets.length) {
      renderMeta();
      return;
    }

    // Only probe what we have no fresh answer for. A cached result is reused,
    // so flicking between filters never re-hammers every host.
    var toProbe = 0;
    targets.forEach(function (item) {
      if (!force && probeState[item.id] && probeState[item.id] !== 'checking') {
        refreshStatus(item, probeState[item.id]);
        return;
      }
      probeState[item.id] = 'checking';
      refreshStatus(item, 'checking');
      toProbe++;
    });

    if (!toProbe) {
      finishCheck();
      return;
    }

    renderMeta();
    var done = 0;
    targets.forEach(function (item) {
      if (probeState[item.id] !== 'checking') return;
      probe(item.url).then(function (state) {
        probeState[item.id] = state;
        refreshStatus(item, state);
        done++;
        if (done === toProbe) finishCheck();
      });
    });
  }

  /* --------------------------------------------------------------- events -- */

  // The debounce means a keystroke can still be in flight when something else
  // clears the filter. Any path that resets the field must cancel the pending
  // write, or the queued keystroke lands afterwards and re-applies a query the
  // input no longer shows.
  var filterTimer = null;

  function cancelPendingFilter() {
    clearTimeout(filterTimer);
    filterTimer = null;
  }

  el.filter.addEventListener('input', function () {
    cancelPendingFilter();
    var value = el.filter.value.trim();
    filterTimer = setTimeout(function () {
      filterTimer = null;
      query = value;
      render();
    }, 110);
  });

  el.filter.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && el.filter.value) {
      event.preventDefault();
      cancelPendingFilter();
      el.filter.value = '';
      query = '';
      render();
    }
  });

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      setScope(chip.dataset.scope);
      render();
    });
  });

  /* Preview buttons are wired by delegation, because the rows are rebuilt on
     every keystroke and would throw a per-button listener away with them. */
  el.grid.addEventListener('click', function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest('.preview-btn') : null;
    if (!button || !el.grid.contains(button)) return;
    event.preventDefault();
    togglePreview(button.dataset.preview);
  });

  /* Escape closes the open preview and hands focus back to the button that
     opened it. Focus inside the frame belongs to the other document and cannot
     reach this handler, which is why the button also toggles and the caption
     links out. */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !previewOpenId) return;
    event.preventDefault();
    closePreview(true);
  });

  // Only needed where there is no ResizeObserver to do it.
  window.addEventListener('resize', function () {
    if (!previewOpenId || previewObserver) return;
    var row = findRow(previewOpenId);
    var viewport = row ? row.querySelector('.preview-viewport') : null;
    if (viewport) fitPreview(viewport);
  });

  el.emptyReset.addEventListener('click', function () {
    cancelPendingFilter();
    query = '';
    el.filter.value = '';
    setScope('all');
    render();
    el.filter.focus();
  });

  el.recheck.addEventListener('click', function () {
    try {
      sessionStorage.removeItem('hub-probe');
    } catch (e) {
      /* nothing to clear */
    }
    probeState = {};
    checkAll(true);
  });

  // "/" focuses the filter from anywhere, unless the user is already typing.
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (event.target.tagName || '').toLowerCase();
    var typing =
      tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable;
    if (typing) return;
    event.preventDefault();
    el.filter.focus();
    el.filter.select();
  });

  window.addEventListener('online', function () {
    probeState = {};
    checkAll(true);
  });

  /* ---------------------------------------------------------------- theme -- */

  var root = document.documentElement;

  function applyTheme(theme, fromUser) {
    root.dataset.theme = theme;
    if (fromUser) {
      root.dataset.themeSource = 'stored';
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (e) {
        /* not persisting is acceptable */
      }
    }

    var goingTo = theme === 'dark' ? 'light' : 'dark';
    el.themeToggle.setAttribute('aria-label', 'Switch to ' + goingTo + ' mode');
    el.themeToggle.title = 'Switch to ' + goingTo + ' mode';
    el.themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');

    // Read the token rather than hardcoding the value here: a literal in JS
    // silently drifts out of step with styles.css and the browser chrome ends
    // up the wrong colour. This runs after the stylesheets are applied, which
    // is why theme-color is handled here and not in the pre-paint bootstrap.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
  }

  el.themeToggle.addEventListener('click', function () {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });

  // Follow the operating system while the visitor has not chosen for themselves.
  if (window.matchMedia) {
    var media = window.matchMedia('(prefers-color-scheme: light)');
    var onSystemChange = function (event) {
      if (root.dataset.themeSource === 'stored') return;
      applyTheme(event.matches ? 'light' : 'dark', false);
    };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  /* ----------------------------------------------------------------- boot -- */

  hydrateIcons(document);
  fillThemeGlyphs();
  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark', false);
  // Derive the chips' pressed state from the variable rather than trusting the
  // markup to agree with it.
  setScope(scope);
  render();
  checkAll(false);

  // The figures are fetched once per load. The descriptions paint from the
  // manifest's recorded numbers first and are repainted in place if an answer
  // arrives, so a slow or absent endpoint never holds up the list.
  Promise.all(dashboards.filter(countConfig).map(fetchCount)).then(refreshFigures);

  // Keep the summary honest when the tab is left open for a long time: an
  // expired cache is discarded rather than reused with a fresh timestamp.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (readCache()) return;
    probeState = {};
    checkAll(true);
  });
})();
