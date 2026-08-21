document.addEventListener('DOMContentLoaded', () => {
  // Signing key warning — dismissable, persists via localStorage keyed on the
  // warning version so future banners (e.g. 2.0.5+) can be shown again.
  const warningKey = 'signing_warning_dismissed_v2.0.4';
  const warning = document.getElementById('signingWarning');
  if (warning) {
    if (localStorage.getItem(warningKey) === '1') {
      warning.classList.add('hidden');
    }
    const close = document.getElementById('signingWarningClose');
    if (close) {
      close.addEventListener('click', () => {
        warning.classList.add('hidden');
        localStorage.setItem(warningKey, '1');
      });
    }
  }

  // Scroll reveal
  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('visible'), i * 120);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  reveals.forEach(el => observer.observe(el));

  // Animated counter
  function animateCounter(el, target) {
    const duration = 2000;
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(from + (target - from) * ease);
      el.textContent = current.toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Fetch live stats and animate
  let statsAnimated = false;
  function loadStats() {
    fetch('/api/stats/public')
      .then(r => r.json())
      .then(data => {
        const map = {
          ai_prompts: data.ai_prompts || 0,
          flip_calculations: data.flip_calculations || 0,
          page_views: data.page_views || 0,
          unique_visitors: data.unique_visitors || 0,
          ai_model_downloads: data.ai_model_downloads || 0,
        };

        document.querySelectorAll('.counter').forEach(el => {
          const key = el.dataset.target;
          const value = map[key] || 0;
          if (!statsAnimated) {
            animateCounter(el, value);
          } else {
            el.textContent = value.toLocaleString();
          }
        });
        statsAnimated = true;
      })
      .catch(() => {
        // Fallback: show static values
        document.querySelectorAll('.counter').forEach(el => {
          if (el.textContent === '0') el.textContent = '--';
        });
      });
  }

  // Load stats when section is visible
  const statsSection = document.getElementById('stats');
  if (statsSection) {
    const statsObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadStats();
        // Refresh every 30s, store ref for cleanup
        var statsInterval = setInterval(loadStats, 30000);
        // Stop polling when page is hidden to save resources
        document.addEventListener('visibilitychange', function() {
          if (document.hidden) {
            clearInterval(statsInterval);
          } else {
            loadStats();
            statsInterval = setInterval(loadStats, 30000);
          }
        });
        statsObserver.disconnect();
      }
    }, { threshold: 0.1 });
    statsObserver.observe(statsSection);
  }
  // Hamburger menu
  const hamburger = document.querySelector('.hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileOverlay = document.getElementById('mobileOverlay');

  function toggleMobileMenu() {
    const isOpen = mobileMenu.classList.toggle('open');
    mobileOverlay.classList.toggle('open', isOpen);
    hamburger.classList.toggle('active', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  function closeMobileMenu() {
    mobileMenu.classList.remove('open');
    mobileOverlay.classList.remove('open');
    hamburger.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (hamburger) {
    hamburger.addEventListener('click', toggleMobileMenu);
    mobileOverlay.addEventListener('click', closeMobileMenu);
    mobileMenu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', closeMobileMenu);
    });
  }
});
