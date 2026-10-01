(function () {
  'use strict';

  var CONSENT_KEY = 'albion_analytics_consent';
  var consent = 'undecided';
  var previousFocus = null;

  function validChoice(choice) {
    return choice === 'accepted' || choice === 'refused';
  }

  function readConsent() {
    try {
      var choice = localStorage.getItem(CONSENT_KEY);
      return validChoice(choice) ? choice : 'undecided';
    } catch (_) {
      return 'undecided';
    }
  }

  function bounded(value, max) {
    return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
  }

  function cleanMetadata(metadata) {
    var allowed = ['model', 'item', 'city', 'version', 'platform'];
    var clean = { platform: 'web' };
    Object.keys(metadata || {}).forEach(function (key) {
      var value = bounded(metadata[key], 80);
      if (allowed.indexOf(key) !== -1 && value !== undefined) clean[key] = value;
    });
    return clean;
  }

  function send(path, payload) {
    if (consent !== 'accepted') return;
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  }

  function trackPageView(page) {
    send('/api/track/pageview', { page: page });
  }

  function trackEvent(name, category, metadata) {
    send('/api/track/event', {
      name: name,
      category: category || 'website',
      metadata: cleanMetadata(metadata)
    });
  }

  function setConsent(choice) {
    if (!validChoice(choice)) return false;
    var previous = consent;
    consent = choice;
    try {
      localStorage.setItem(CONSENT_KEY, choice);
    } catch (_) {
      if (choice === 'refused') {
        try {
          // A missing value reloads as undecided and cannot revive stale acceptance.
          localStorage.removeItem(CONSENT_KEY);
        } catch (_) {
          consent = 'undecided';
          showPersistenceError();
          return false;
        }
      } else {
        consent = 'undecided';
        showPersistenceError();
        return false;
      }
    }
    var dialog = document.getElementById('analyticsConsent');
    if (dialog) dialog.hidden = true;
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    if (previous !== 'accepted' && choice === 'accepted') trackPageView(window.location.pathname);
    return true;
  }

  function showSettings() {
    var dialog = document.getElementById('analyticsConsent');
    var accept = document.getElementById('analyticsAccept');
    previousFocus = document.activeElement;
    if (dialog) dialog.hidden = false;
    if (accept) accept.focus();
  }

  function showPersistenceError() {
    var language = (document.documentElement.lang || 'en').slice(0, 2);
    var messages = {
      fr: "Impossible d'enregistrer ce choix. L'analytique est désactivée pour cette session; réessayez avant de fermer la page.",
      en: 'Unable to save this choice. Analytics is disabled for this session; retry before closing the page.',
      es: 'No se pudo guardar esta opción. Las analíticas están desactivadas durante esta sesión; inténtalo de nuevo antes de cerrar la página.'
    };
    showSettings();
    window.alert(messages[language] || messages.en);
  }

  function trapDialogFocus(event) {
    if (event.key !== 'Tab') return;
    var dialog = document.getElementById('analyticsConsent');
    if (!dialog || dialog.hidden) return;
    var focusable = dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  consent = readConsent();
  window.addEventListener('storage', function (event) {
    if (event.key !== CONSENT_KEY) return;
    // Re-read authoritative storage; queued events may carry stale newValue data.
    consent = readConsent();
  });

  window.AlbionAnalytics = Object.freeze({
    trackPageView: trackPageView,
    trackEvent: trackEvent,
    trackToolUse: function (name) { trackEvent(name, 'tool_use'); },
    setConsent: setConsent,
    getConsent: function () { return consent; }
  });

  document.addEventListener('DOMContentLoaded', function () {
    var dialog = document.getElementById('analyticsConsent');
    var accept = document.getElementById('analyticsAccept');
    var refuse = document.getElementById('analyticsRefuse');
    var settings = document.getElementById('analyticsSettings');

    if (dialog) dialog.hidden = validChoice(consent);
    if (accept) accept.addEventListener('click', function () { setConsent('accepted'); });
    if (refuse) refuse.addEventListener('click', function () { setConsent('refused'); });
    if (settings) settings.addEventListener('click', showSettings);
    if (dialog) dialog.addEventListener('keydown', trapDialogFocus);

    if (!validChoice(consent)) showSettings();
    if (consent === 'accepted') trackPageView(window.location.pathname);
    document.querySelectorAll('a[href$=".apk"]').forEach(function (link) {
      link.addEventListener('click', function () { trackEvent('apk_download', 'download', { platform: 'android' }); });
    });
  });
})();
