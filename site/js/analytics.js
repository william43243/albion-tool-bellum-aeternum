// Albion Market - Lightweight Analytics Tracker
(function() {
  'use strict';

  var API_BASE = '/api/track';

  function send(endpoint, data) {
    try {
      var payload = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_BASE + endpoint, new Blob([payload], { type: 'application/json' }));
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_BASE + endpoint, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      }
    } catch (e) {
      // Silent fail - analytics should never break the site
    }
  }

  // Track page view on load
  send('/pageview', {
    page: window.location.pathname,
    referrer: document.referrer || ''
  });

  // Track APK download clicks
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href*="/downloads/"]');
    if (link) {
      send('/event', {
        name: 'apk_download',
        category: 'download',
        metadata: { file: link.getAttribute('href') }
      });
    }
  });

  // Track outbound link clicks
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href^="http"]');
    if (link && link.hostname !== window.location.hostname) {
      send('/event', {
        name: 'outbound_click',
        category: 'engagement',
        metadata: { url: link.href }
      });
    }
  });

  // Expose global tracker for Expo web app
  window.AlbionAnalytics = {
    trackPageView: function(page) {
      send('/pageview', { page: page, referrer: document.referrer || '' });
    },
    trackEvent: function(name, category, metadata) {
      send('/event', { name: name, category: category || null, metadata: metadata || null });
    },
    trackToolUse: function(toolName) {
      send('/event', { name: toolName, category: 'tool_use' });
    }
  };
})();
