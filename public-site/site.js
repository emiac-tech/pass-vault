// Progressive enhancement for the E-Vault public landing page.
(function () {
  // ---- Theme (light by default; user choice persisted) ----
  var THEME_KEY = 'evault-site-theme';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function getTheme() {
    try { var s = localStorage.getItem(THEME_KEY); if (s === 'light' || s === 'dark') return s; } catch (e) {}
    return 'light'; // default
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = t === 'light' ? MOON : SUN; // icon shows what you'll switch TO
  }
  applyTheme(getTheme());
  var toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.addEventListener('click', function () {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  // Footer year.
  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  // "Open App" target. In production this points at the app domain; viewed
  // locally it points at the local app (Docker on :4000) so the flow is testable.
  var APP_URL_PROD = 'https://e-vault-app.emiactech.com';
  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  var appUrl = isLocal ? 'http://localhost:4000' : APP_URL_PROD;
  ['open-app-top', 'open-app-hero', 'open-app-ext', 'open-app-cta'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.setAttribute('href', appUrl);
  });

  // Reveal sections on scroll.
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  els.forEach(function (el) { io.observe(el); });
})();
