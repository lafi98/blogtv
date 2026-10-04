/*
 * Cookie consent controller.
 * - Optional technologies (analytics, ads) are injected ONLY by this script, and only
 *   after the consent state allows it. Without JavaScript nothing optional loads.
 * - Google Consent Mode v2 default signals are sent before any Google tag loads.
 * - Choices are stored in a first-party cookie for 180 days; re-asked when the policy version changes.
 */
(function () {
  var el = document.getElementById('consent-config');
  if (!el) return;
  var cfg;
  try { cfg = JSON.parse(el.textContent); } catch (e) { return; }

  var COOKIE = 'hh_consent';
  var banner = document.getElementById('consent-banner');
  var dialog = document.getElementById('consent-dialog');
  var optional = cfg.categories.filter(function (c) { return !c.required; }).map(function (c) { return c.key; });
  var gpc = cfg.respectGpc && navigator.globalPrivacyControl === true;
  var loaded = {};

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  if (!window.gtag) window.gtag = gtag;

  function readState() {
    var m = document.cookie.match(/(?:^|;\s*)hh_consent=([^;]+)/);
    if (!m) return null;
    try {
      var s = JSON.parse(decodeURIComponent(m[1]));
      return s && s.v === cfg.version ? s : null;
    } catch (e) { return null; }
  }
  function writeState(s) {
    s.v = cfg.version;
    s.t = Date.now();
    document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(s)) + '; Max-Age=' + 180 * 86400 +
      '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function defaults() {
    var on = cfg.mode !== 'opt-in';
    return { analytics: on, advertising: on && !gpc };
  }
  function signals(s) {
    var ad = s.advertising ? 'granted' : 'denied';
    return { ad_storage: ad, ad_user_data: ad, ad_personalization: ad, analytics_storage: s.analytics ? 'granted' : 'denied' };
  }
  function addScript(src, attrs) {
    var sc = document.createElement('script');
    sc.src = src;
    sc.async = true;
    if (attrs) for (var k in attrs) sc.setAttribute(k, attrs[k]);
    document.head.appendChild(sc);
  }
  function clearCookies(prefixes) {
    var host = location.hostname.split('.');
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!prefixes.some(function (p) { return name.indexOf(p) === 0; })) return;
      for (var i = 0; i < host.length - 1; i++) {
        var domain = host.slice(i).join('.');
        document.cookie = name + '=; Max-Age=0; Path=/; Domain=' + domain;
      }
      document.cookie = name + '=; Max-Age=0; Path=/';
    });
  }

  function apply(s) {
    var a = cfg.analytics;
    if (a && !loaded.analytics) {
      if (a.provider === 'ga4' && s.analytics) {
        loaded.analytics = true;
        addScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(a.id));
        window.gtag('js', new Date());
        window.gtag('config', a.id);
      } else if (a.provider === 'plausible' && (s.analytics || !a.requireConsent)) {
        loaded.analytics = true;
        addScript(a.src, { 'data-domain': a.domain });
      }
    }
    if (cfg.ads && !loaded.ads && (cfg.cmp === 'external' || s.advertising)) {
      loaded.ads = true;
      addScript('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.ads.clientId), { crossorigin: 'anonymous' });
      document.querySelectorAll('ins.adsbygoogle').forEach(function () {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      });
    }
  }

  var stored = readState();
  var state = stored || defaults();
  if (cfg.googleConsentMode) {
    var d = signals(state);
    d.wait_for_update = 500;
    window.gtag('consent', 'default', d);
  }
  apply(state);

  function save(next) {
    var withdrew = (state.analytics && !next.analytics && loaded.analytics) || (state.advertising && !next.advertising && loaded.ads);
    writeState(next);
    if (cfg.googleConsentMode) window.gtag('consent', 'update', signals(next));
    if (!next.analytics) clearCookies(['_ga', '_gid', '_gat']);
    if (!next.advertising) clearCookies(['__gads', '__gpi', '__eoi', '_gcl']);
    state = next;
    if (banner) banner.hidden = true;
    // Scripts that already ran can't be unloaded; a reload guarantees they stop.
    if (withdrew) location.reload();
    else apply(next);
  }

  function syncDialog() {
    if (!dialog) return;
    optional.forEach(function (key) {
      var cb = dialog.querySelector('input[name="' + key + '"]');
      if (cb) cb.checked = !!state[key];
    });
  }

  if (banner && optional.length && !stored) banner.hidden = false;

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-consent]');
    if (!t) return;
    var action = t.getAttribute('data-consent');
    if (action === 'accept') save({ analytics: true, advertising: true, explicit: true });
    else if (action === 'reject') save({ analytics: false, advertising: false, explicit: true });
    else if (action === 'ok') save(defaults());
    else if (action === 'manage' || action === 'open') {
      if (dialog && dialog.showModal) {
        syncDialog();
        dialog.showModal();
      }
    } else if (action === 'save' && dialog) {
      e.preventDefault();
      var next = { analytics: false, advertising: false, explicit: true };
      optional.forEach(function (key) {
        var cb = dialog.querySelector('input[name="' + key + '"]');
        next[key] = !!(cb && cb.checked);
      });
      dialog.close();
      save(next);
    } else if (action === 'close' && dialog) {
      dialog.close();
    }
  });
})();
