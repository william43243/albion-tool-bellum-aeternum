(function() {
  'use strict';

  var currentDays = 30;
  var pvChart = null;
  var toolChart = null;
  var currentLang = localStorage.getItem('admin_lang') || 'fr';

  var i18n = {
    fr: {
      title: 'Centre de Commande',
      subtitle: 'Albion Market Analytics',
      login: 'Connexion',
      refresh: 'Rafraichir',
      page_views: 'Pages Vues',
      unique_visitors: 'Visiteurs Uniques',
      apk_downloads: 'Telechargements APK',
      total_events: 'Total Evenements',
      all_time: 'Depuis toujours',
      period: 'Periode',
      interactions_tracked: 'Interactions enregistrees',
      daily_traffic: 'Trafic Journalier',
      tool_usage: 'Utilisation des Outils \u2014 Total',
      pages: 'Pages',
      events: 'Evenements',
      back: '\u2190 Retour a Albion Market',
      loading: 'Chargement...',
      no_page_data: 'Aucune donnee de page',
      no_events: 'Aucun evenement enregistre',
      failed_load: 'Erreur de chargement',
      page_col: 'Page',
      views_col: 'Vues',
      event_col: 'Evenement',
      category_col: 'Categorie',
      total_col: 'Total',
      chart_pageviews: 'Pages Vues',
      chart_visitors: 'Visiteurs Uniques',
      chart_total_uses: 'Utilisations',
      days_suffix: 'jours',
      downloads_note: '* Site web uniquement, hors GitHub'
    },
    en: {
      title: 'Command Center',
      subtitle: 'Albion Market Analytics',
      login: 'Login',
      refresh: 'Refresh',
      page_views: 'Page Views',
      unique_visitors: 'Unique Visitors',
      apk_downloads: 'APK Downloads',
      total_events: 'Total Events',
      all_time: 'All time',
      period: 'Period',
      interactions_tracked: 'Interactions tracked',
      daily_traffic: 'Daily Traffic',
      tool_usage: 'Tool Usage \u2014 All Time',
      pages: 'Pages',
      events: 'Events',
      back: '\u2190 Back to Albion Market',
      loading: 'Loading...',
      no_page_data: 'No page view data yet',
      no_events: 'No events recorded yet',
      failed_load: 'Failed to load data',
      page_col: 'Page',
      views_col: 'Views',
      event_col: 'Event',
      category_col: 'Category',
      total_col: 'Total',
      chart_pageviews: 'Page Views',
      chart_visitors: 'Unique Visitors',
      chart_total_uses: 'Total Uses',
      days_suffix: 'days',
      downloads_note: '* Website only, excludes GitHub'
    },
    es: {
      title: 'Centro de Mando',
      subtitle: 'Albion Market Analytics',
      login: 'Conectar',
      refresh: 'Actualizar',
      page_views: 'Paginas Vistas',
      unique_visitors: 'Visitantes Unicos',
      apk_downloads: 'Descargas APK',
      total_events: 'Total Eventos',
      all_time: 'Desde siempre',
      period: 'Periodo',
      interactions_tracked: 'Interacciones registradas',
      daily_traffic: 'Trafico Diario',
      tool_usage: 'Uso de Herramientas \u2014 Total',
      pages: 'Paginas',
      events: 'Eventos',
      back: '\u2190 Volver a Albion Market',
      loading: 'Cargando...',
      no_page_data: 'Sin datos de paginas',
      no_events: 'Sin eventos registrados',
      failed_load: 'Error al cargar datos',
      page_col: 'Pagina',
      views_col: 'Vistas',
      event_col: 'Evento',
      category_col: 'Categoria',
      total_col: 'Total',
      chart_pageviews: 'Paginas Vistas',
      chart_visitors: 'Visitantes Unicos',
      chart_total_uses: 'Usos totales',
      days_suffix: 'dias',
      downloads_note: '* Solo sitio web, sin GitHub'
    }
  };

  function t(key) { return (i18n[currentLang] || i18n.en)[key] || key; }

  function applyLang() {
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('.lang-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
  }

  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }
  function fmt(n) { return n == null ? '\u2014' : Number(n).toLocaleString(); }

  // Safe text setter — avoids innerHTML for untrusted data
  function setText(id, text) {
    var el = typeof id === 'string' ? $(id) : id;
    if (el) el.textContent = text;
  }

  var tokenInput = $('#token-input');
  var statusDot = $('#status-dot');

  var authBtn = $('#auth-btn');

  function submitToken() {
    loadAll();
  }

  authBtn.addEventListener('click', submitToken);

  tokenInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitToken();
  });

  // Language switcher
  $$('.lang-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      currentLang = btn.dataset.lang;
      localStorage.setItem('admin_lang', currentLang);
      applyLang();
      loadAll();
    });
  });

  applyLang();

  function getToken() { return tokenInput.value.trim(); }

  function apiUrl(path) {
    var params = new URLSearchParams({ days: currentDays });
    return path + '?' + params.toString();
  }

  function apiFetch(path) {
    var token = getToken();
    var headers = token ? { Authorization: 'Bearer ' + token } : {};
    return fetch(apiUrl(path), { headers: headers, cache: 'no-store' }).then(function(res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    });
  }

  // Period buttons
  $$('.controls button[data-days]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      $$('.controls button[data-days]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentDays = parseInt(btn.dataset.days);
      loadAll();
    });
  });

  $('#refresh-btn').addEventListener('click', loadAll);

  // Chart.js defaults
  Chart.defaults.color = '#8b949e';
  Chart.defaults.borderColor = 'rgba(48,54,61,0.5)';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 11;

  function loadOverview() {
    apiFetch('/api/stats/overview').then(function(data) {
      setText('#stat-views', fmt(data.page_views));
      setText('#stat-visitors', fmt(data.unique_visitors));
      setText('#stat-downloads', fmt(data.downloads));
      setText('#stat-events', fmt(data.total_events));
      setText('#stat-views-all', fmt(data.all_time.page_views));
      setText('#stat-downloads-all', fmt(data.all_time.downloads));
      setText('#stat-period-label', data.period_days + ' ' + t('days_suffix'));
      statusDot.classList.add('live');
    }).catch(function() {
      statusDot.classList.remove('live');
    });
  }

  function loadPageviewsChart() {
    apiFetch('/api/stats/pageviews').then(function(data) {
      var labels = data.daily.map(function(d) { return d.date.slice(5); });
      var views = data.daily.map(function(d) { return d.views; });
      var uniques = data.daily.map(function(d) { return d.unique_visitors; });

      if (pvChart) pvChart.destroy();

      var ctx = $('#chart-pageviews').getContext('2d');

      var gradientGold = ctx.createLinearGradient(0, 0, 0, 260);
      gradientGold.addColorStop(0, 'rgba(200, 168, 78, 0.3)');
      gradientGold.addColorStop(1, 'rgba(200, 168, 78, 0.0)');

      var gradientBlue = ctx.createLinearGradient(0, 0, 0, 260);
      gradientBlue.addColorStop(0, 'rgba(88, 166, 255, 0.15)');
      gradientBlue.addColorStop(1, 'rgba(88, 166, 255, 0.0)');

      pvChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: t('chart_pageviews'),
              data: views,
              borderColor: '#c8a84e',
              backgroundColor: gradientGold,
              fill: true,
              tension: 0.35,
              pointRadius: 2,
              pointHoverRadius: 5,
              pointBackgroundColor: '#c8a84e',
              borderWidth: 2,
            },
            {
              label: t('chart_visitors'),
              data: uniques,
              borderColor: '#58a6ff',
              backgroundColor: gradientBlue,
              fill: true,
              tension: 0.35,
              pointRadius: 2,
              pointHoverRadius: 5,
              pointBackgroundColor: '#58a6ff',
              borderWidth: 1.5,
              borderDash: [4, 3],
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 16, usePointStyle: true } },
            tooltip: {
              backgroundColor: '#161b22',
              borderColor: '#30363d',
              borderWidth: 1,
              titleColor: '#c8a84e',
              bodyColor: '#e6edf3',
              padding: 12,
              cornerRadius: 6,
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
            y: { beginAtZero: true, grid: { color: 'rgba(48,54,61,0.3)' } }
          }
        }
      });

      renderPageTable(data.by_page);

    }).catch(function() {
      setText('#table-pages', t('failed_load'));
    });
  }

  function loadToolsChart() {
    apiFetch('/api/stats/tools').then(function(data) {
      var tools = data.all_time;

      var toolLabels = {
        marketplace: 'Marketplace',
        crafting: 'Crafting',
        flipping: 'Flipping',
        history: 'History'
      };

      var toolColors = {
        marketplace: '#c8a84e',
        crafting: '#58a6ff',
        flipping: '#4CAF50',
        history: '#bc8cff'
      };

      var labels = tools.map(function(t) { return toolLabels[t.name] || t.name; });
      var values = tools.map(function(t) { return t.count; });
      var colors = tools.map(function(t) { return toolColors[t.name] || '#8b949e'; });

      if (toolChart) toolChart.destroy();

      var ctx = $('#chart-tools').getContext('2d');

      toolChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: t('chart_total_uses'),
            data: values,
            backgroundColor: colors.map(function(c) { return c + '55'; }),
            borderColor: colors,
            borderWidth: 1.5,
            borderRadius: 4,
            barPercentage: 0.6,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#161b22',
              borderColor: '#30363d',
              borderWidth: 1,
              titleColor: '#c8a84e',
              bodyColor: '#e6edf3',
              padding: 12,
              cornerRadius: 6,
            }
          },
          scales: {
            x: { beginAtZero: true, grid: { color: 'rgba(48,54,61,0.3)' } },
            y: { grid: { display: false } }
          }
        }
      });

    }).catch(function() {
      // silent
    });
  }

  function loadEvents() {
    apiFetch('/api/stats/events').then(function(data) {
      renderEventsTable(data.all_time, data.period);
    }).catch(function() {
      setText('#table-events', t('failed_load'));
    });
  }

  // Safe table renderers using DOM APIs
  function renderPageTable(pages) {
    var container = $('#table-pages');
    container.textContent = '';

    if (!pages || pages.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t('no_page_data');
      container.appendChild(empty);
      return;
    }

    var maxViews = Math.max.apply(null, pages.map(function(p) { return p.views; }));
    var table = document.createElement('table');
    table.className = 'data-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var th1 = document.createElement('th');
    th1.textContent = t('page_col');
    var th2 = document.createElement('th');
    th2.textContent = t('views_col');
    headRow.appendChild(th1);
    headRow.appendChild(th2);
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    pages.forEach(function(p) {
      var tr = document.createElement('tr');

      var td1 = document.createElement('td');
      var barCell = document.createElement('div');
      barCell.className = 'bar-cell';
      var miniBar = document.createElement('div');
      miniBar.className = 'mini-bar';
      miniBar.style.width = Math.max(4, (p.views / maxViews) * 100) + '%';
      var nameSpan = document.createElement('span');
      nameSpan.textContent = p.page;
      barCell.appendChild(miniBar);
      barCell.appendChild(nameSpan);
      td1.appendChild(barCell);

      var td2 = document.createElement('td');
      td2.textContent = fmt(p.views);

      tr.appendChild(td1);
      tr.appendChild(td2);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function renderEventsTable(allTime, period) {
    var container = $('#table-events');
    container.textContent = '';

    var events = allTime && allTime.length > 0 ? allTime : period;
    if (!events || events.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t('no_events');
      container.appendChild(empty);
      return;
    }

    var table = document.createElement('table');
    table.className = 'data-table';

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    [t('event_col'), t('category_col'), t('total_col')].forEach(function(text) {
      var th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var badgeMap = {
      tool_use: 'badge-tool',
      download: 'badge-download',
      engagement: 'badge-engagement'
    };

    var tbody = document.createElement('tbody');
    events.forEach(function(e) {
      var tr = document.createElement('tr');

      var td1 = document.createElement('td');
      td1.textContent = e.name;

      var td2 = document.createElement('td');
      var badge = document.createElement('span');
      var cat = e.category || 'other';
      badge.className = 'badge ' + (badgeMap[cat] || 'badge-other');
      badge.textContent = cat;
      td2.appendChild(badge);

      var td3 = document.createElement('td');
      td3.textContent = fmt(e.count);

      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function loadAll() {
    loadOverview();
    loadPageviewsChart();
    loadToolsChart();
    loadEvents();
  }

  loadAll();
  setInterval(loadAll, 60000);

})();
