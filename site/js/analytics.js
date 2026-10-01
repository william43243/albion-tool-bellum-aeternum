// Product analytics are intentionally disabled.
// This compatibility object keeps older site integrations inert while cached
// pages expire. It performs no network request and stores no identifier.
(function () {
  'use strict';

  function noOp() {}

  window.AlbionAnalytics = Object.freeze({
    trackPageView: noOp,
    trackEvent: noOp,
    trackToolUse: noOp,
  });
})();
