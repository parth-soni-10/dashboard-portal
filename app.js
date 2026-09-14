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
    resultCount: document.getElementById('result-count'),
    recheck: document.getElementById('recheck'),
    checkNote: document.getElementById('check-note'),
    themeToggle: document.getElementById('theme-toggle'),
    statTotal: document.getElementById('stat-total'),
    statLive: document.getElementById('stat-live'),
    statPending: document.getElementById('stat-pending'),
    statChecked: document.getElementById('stat-checked'),
    footerCount: document.getElementById('footer-count')
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

  function formatDate(iso) {
    if (!iso) return '';
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    var month = months[parseInt(parts[1], 10) - 1];
    if (!month) return iso;
    return parseInt(parts[2], 10) + ' ' + month + ' ' + parts[0];
  }

  function hostOf(url) {
    if (!url) return '';
    try {
      return new URL(url).host;
    } catch (e) {
      return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    }
  }

  /* --------------------------------------------------------------- icons -- */

  function hydrateIcons(scope) {
    var nodes = (scope || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var size = node.classList.contains('empty-ico') ? 18 : 15;
      node.innerHTML = icon(node.dataset.icon, size);
    }
  }

  function fillThemeGlyphs() {
    var sun = document.querySelector('.theme-glyph-sun');
    var moon = document.querySelector('.theme-glyph-moon');
    if (sun) sun.innerHTML = icon('sun', 17);
    if (moon) moon.innerHTML = icon('moon', 17);
  }

  /* ------------------------------------------------------- link checking -- */

  /**
   * Ask whether this browser can reach a deployed dashboard.
   *
   * Cross-origin reads are blocked without CORS headers, so this sends a
   * no-cors request: the body is opaque, but the promise resolves when the
   * host answers. A rejection means this browser could not complete the
   * request, which is NOT the same as the dashboard being down. Several of
   * these sites ship `Cross-Origin-Resource-Policy: same-origin` (Expense
   * Tracker does), and that blocks cross-site checks by design.
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
      if (parsed && parsed.at && Date.now() - parsed.at < PROBE_TTL) return parsed.results || {};
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
    if (probeState[item.id]) return probeState[item.id];
    return 'checking';
  }

  function statusMarkup(state) {
    var copy = STATUS_COPY[state] || STATUS_COPY.checking;
    return (
      '<span class="status ' +
      copy.cls +
      '" title="' +
      esc(copy.hint || '') +
      '"><span class="status-dot" aria-hidden="true"></span>' +
      esc(copy.text) +
      '</span>'
    );
  }

  /* ------------------------------------------------------------- rendering -- */

  function cardMarkup(item) {
    var state = statusOf(item);
    var pending = !item.url;
    var live = !!item.url;

    var tags = (item.tags || [])
      .map(function (tag) {
        return '<li class="tag">' + esc(tag) + '</li>';
      })
      .join('');

    var name = live
      ? '<a class="card-link" href="' +
        esc(item.url) +
        '" target="_blank" rel="noopener">' +
        esc(item.name) +
        '</a>'
      : esc(item.name);

    var primary = live
      ? '<a class="btn btn-primary" href="' +
        esc(item.url) +
        '" target="_blank" rel="noopener">Open dashboard' +
        icon('arrow-up-right', 15) +
        '</a>'
      : '';

    var secondary = item.repo
      ? '<a class="btn" href="' +
        esc(item.repo) +
        '" target="_blank" rel="noopener" aria-label="' +
        esc(item.name) +
        ' source on GitHub">' +
        icon('github', 15) +
        'Source</a>'
      : '';

    var metaLeft = live
      ? '<span class="card-verified">' +
        icon('calendar-days', 13) +
        'Verified ' +
        esc(formatDate(item.verified) || 'recently') +
        '</span>'
      : '<span class="card-verified">' +
        icon('triangle-alert', 13) +
        'Awaiting deploy URL' +
        '</span>';

    var note = pending && item.note ? '<p class="card-note">' + esc(item.note) + '</p>' : '';

    return (
      '<li class="card' +
      (pending ? ' is-pending' : '') +
      '" data-id="' +
      esc(item.id) +
      '">' +
      '<div class="card-top">' +
      '<span class="card-mark" aria-hidden="true">' +
      esc(item.mark || item.name.slice(0, 2)) +
      '</span>' +
      statusMarkup(state) +
      '</div>' +
      '<div class="card-headline">' +
      '<h3 class="card-name">' +
      name +
      '</h3>' +
      '<p class="card-tagline">' +
      esc(item.tagline) +
      '</p>' +
      '</div>' +
      '<p class="card-desc">' +
      esc(item.description) +
      '</p>' +
      (tags ? '<ul class="card-tags">' + tags + '</ul>' : '') +
      note +
      '<div class="card-foot">' +
      metaLeft +
      '<div class="card-actions">' +
      primary +
      secondary +
      '</div>' +
      '</div>' +
      '</li>'
    );
  }

  function refreshStatus(id, state) {
    var card = el.grid.querySelector('[data-id="' + id + '"]');
    if (!card) return;
    var pill = card.querySelector('.status');
    if (pill) pill.outerHTML = statusMarkup(state);
  }

  /* --------------------------------------------------------------- filters -- */

  var scope = 'all';
  var query = '';

  function matches(item) {
    if (scope === 'live' && !item.url) return false;
    if (scope === 'pending' && item.url) return false;

    if (!query) return true;
    var haystack = [item.name, item.tagline, item.description, (item.tags || []).join(' ')]
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

  function render() {
    var visible = dashboards.filter(matches);
    el.grid.innerHTML = visible.map(cardMarkup).join('');
    hydrateIcons(el.grid);

    var total = dashboards.length;
    el.empty.hidden = visible.length !== 0;
    el.grid.hidden = visible.length === 0;

    if (!total) {
      el.resultCount.textContent = 'No dashboards configured yet.';
    } else if (!visible.length) {
      el.resultCount.textContent = 'Nothing matches the current filter.';
    } else if (visible.length === total) {
      el.resultCount.textContent =
        'Showing all ' + total + ' dashboard' + (total === 1 ? '' : 's');
    } else {
      el.resultCount.textContent =
        'Showing ' + visible.length + ' of ' + total + ' dashboards';
    }
  }

  function updateSummary() {
    var checked = dashboards.filter(function (d) {
      return !!d.url;
    });
    var reachable = checked.filter(function (d) {
      return statusOf(d) === 'live';
    }).length;

    el.statTotal.textContent = dashboards.length;
    el.statPending.textContent = dashboards.length - checked.length;

    // "2 / 3" only once every link has an answer, so the figure is never
    // mid-flight when it is read.
    var settled = checked.every(function (d) {
      var state = statusOf(d);
      return state === 'live' || state === 'unverified';
    });
    el.statLive.textContent = !checked.length
      ? '0'
      : settled
        ? reachable + ' / ' + checked.length
        : '- / ' + checked.length;

    el.footerCount.textContent =
      dashboards.length + ' dashboard' + (dashboards.length === 1 ? '' : 's') + ' tracked';
  }

  /* ------------------------------------------------------------ link check -- */

  function checkAll(force) {
    var targets = dashboards.filter(function (d) {
      return !!d.url;
    });
    if (!targets.length) {
      el.statChecked.textContent = 'Nothing to check';
      return;
    }

    // Only probe what we have no fresh answer for. A cached result is reused,
    // so flicking between filters never re-hammers five hosts.
    var toProbe = 0;
    targets.forEach(function (item) {
      if (!force && probeState[item.id] && probeState[item.id] !== 'checking') {
        refreshStatus(item.id, probeState[item.id]);
        return;
      }
      probeState[item.id] = 'checking';
      refreshStatus(item.id, 'checking');
      toProbe++;
    });
    updateSummary();

    if (!toProbe) {
      finishCheck();
      return;
    }

    el.statChecked.textContent = 'Checking';
    var done = 0;
    targets.forEach(function (item) {
      if (probeState[item.id] !== 'checking') return;
      probe(item.url).then(function (state) {
        probeState[item.id] = state;
        refreshStatus(item.id, state);
        done++;
        updateSummary();
        if (done === toProbe) finishCheck();
      });
    });
  }

  function finishCheck() {
    writeCache(probeState);

    var checked = dashboards.filter(function (d) {
      return !!d.url;
    });
    var reachable = checked.filter(function (d) {
      return statusOf(d) === 'live';
    }).length;
    var unverified = checked.length - reachable;
    var time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    el.statChecked.textContent = checked.length ? time : 'Nothing to check';

    // Surface the caveat only when a check actually came back inconclusive.
    if (el.checkNote) {
      el.checkNote.hidden = !unverified;
      el.checkNote.textContent = unverified
        ? unverified === 1
          ? 'One dashboard blocks cross-site checks, so its badge cannot be confirmed from this browser.'
          : unverified +
            ' dashboards block cross-site checks, so their badges cannot be confirmed from this browser.'
        : '';
    }

    updateSummary();
  }

  /* --------------------------------------------------------------- events -- */

  var filterTimer = null;
  el.filter.addEventListener('input', function () {
    clearTimeout(filterTimer);
    var value = el.filter.value.trim();
    filterTimer = setTimeout(function () {
      query = value;
      render();
    }, 110);
  });

  el.filter.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && el.filter.value) {
      event.preventDefault();
      el.filter.value = '';
      query = '';
      render();
    }
  });

  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      scope = chip.dataset.scope;
      document.querySelectorAll('.chip').forEach(function (other) {
        other.classList.toggle('is-on', other === chip);
      });
      render();
    });
  });

  function resetFilters() {
    scope = 'all';
    query = '';
    el.filter.value = '';
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.classList.toggle('is-on', chip.dataset.scope === 'all');
    });
    render();
    el.filter.focus();
  }

  el.emptyReset.addEventListener('click', resetFilters);

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

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#101216' : '#f4f5f7');
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
  render();
  updateSummary();
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
