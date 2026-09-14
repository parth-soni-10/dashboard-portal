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
    }
  };

  function statusOf(item) {
    if (!item.url) return 'pending';
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
    var seen = item && item.url && item.verified ? formatVerified(item.verified) : '';
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

  /* ------------------------------------------------------------- rendering -- */

  function rowMarkup(item, index) {
    var state = statusOf(item);
    var live = !!item.url;
    var host = hostOf(item.url);
    var tagList = item.tags || [];

    var name = live
      ? '<a href="' +
        esc(item.url) +
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
      esc(item.description) +
      '</p>' +
      '</div>' +
      '<div class="row-meta">' +
      statusMarkup(state, item) +
      '<div class="row-foot">' +
      // The tooltip holds the full host, which is the only reason to have one:
      // the visible text has had the netlify.app suffix stripped.
      '<span class="row-host"' +
      (host ? ' title="' + esc(host) + '"' : '') +
      '>' +
      esc(host ? shortHost(host) : 'No deploy URL recorded') +
      '</span>' +
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
    if (scope === 'live' && !item.url) return false;
    if (scope === 'pending' && item.url) return false;

    if (!query) return true;
    var haystack = [item.name, item.description, (item.tags || []).join(' ')]
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

  function withUrl() {
    return dashboards.filter(function (d) {
      return !!d.url;
    });
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
        return state === 'live' || state === 'unverified' || state === 'offline';
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
    if (scope === 'pending') {
      return {
        title: 'Everything is deployed',
        body:
          'All ' +
          dashboards.length +
          ' dashboards have a live link. Switch back to All to browse them.'
      };
    }
    if (scope === 'live') {
      return {
        title: 'No dashboard is confirmed reachable',
        body: 'The checks did not complete. Try re-checking the links, or browse All.'
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
      el.meta.innerHTML = '<strong>' + total + '</strong> dashboards, none deployed yet';
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

    el.footnote.hidden = unverified.length === 0 && offline.length === 0;

    if (!unverified.length && !offline.length) {
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

  // Keep the summary honest when the tab is left open for a long time: an
  // expired cache is discarded rather than reused with a fresh timestamp.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (readCache()) return;
    probeState = {};
    checkAll(true);
  });
})();
