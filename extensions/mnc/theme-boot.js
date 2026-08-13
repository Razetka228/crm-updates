// Тема на загрузке ВСЕХ admin-страниц + пред-покраска новых вкладок (window.open И ссылки target=_blank).
// Цель: загрузочный экран любой страницы/новой вкладки нашего домена шёл в цвет темы, а не белый браузерный.
// ВРЕМЕННО/навсегда: читает тему из cookie tmcrmtheme (её пишет v8 на странице списка).
(function tmThemeBoot() {
  'use strict';

  function readTheme() {
    // localStorage читается (блокируется только запись на заявке) — как в userscript-main. Приоритетно.
    var v = '';
    try { v = String(localStorage.getItem('tm-crm-theme-v1') || localStorage.getItem('tm-crm-v8-theme-v1') || '').toLowerCase(); } catch (_) {}
    if (v === 'dark' || v === 'light') {
      try { document.cookie = 'tmcrmtheme=' + v + ';path=/;max-age=31536000;samesite=lax'; } catch (_) {}
      return v;
    }
    try { var m = document.cookie.match(/(?:^|;\s*)tmcrmtheme=(dark|light)/); if (m) return m[1]; } catch (_) {}
    return 'light';
  }
  function col() { return readTheme() === 'dark' ? '#141413' : '#ECEBE7'; }
  function scheme() { return readTheme() === 'dark' ? 'dark' : 'light'; }

  // 1) Фон текущей страницы на загрузке.
  try {
    var de = document.documentElement;
    if (de) { de.style.colorScheme = scheme(); de.style.background = col(); }
  } catch (_) {}
  try {
    if (!document.getElementById('__tmThemeBootStyle')) {
      var st = document.createElement('style');
      st.id = '__tmThemeBootStyle';
      st.textContent = 'html{color-scheme:' + scheme() + ';background:' + col() + ' !important;}html body{background:' + col() + ' !important;}';
      (document.head || document.documentElement).appendChild(st);
    }
  } catch (_) {}

  // ── Пред-покраска новой вкладки: пустая вкладка с заглушкой в цвет темы → навигация. ──
  var _open = window.open;
  function tmOpenThemedTab(url) {
    var w = null;
    try { w = _open.call(window, '', '_blank'); } catch (_e) { w = null; }
    if (!w) { try { return _open.call(window, url, '_blank'); } catch (_e2) { return null; } }
    try {
      var c = col(), s = scheme();
      w.document.open();
      w.document.write(
        '<!doctype html><html style="background:' + c + ';color-scheme:' + s + '">'
        + '<head><meta charset="utf-8"><meta name="color-scheme" content="' + s + '"><title>Загрузка…</title></head>'
        + '<body style="margin:0;background:' + c + '"></body></html>'
      );
      w.document.close();
    } catch (_w) {}
    // Навигацию откладываем на 2 кадра (double-rAF), чтобы заглушка ГАРАНТИРОВАННО
    // отрисовалась и держалась (paint-holding) — иначе гонка «write vs navigate» иногда
    // не успевала покрасить и вылезал белый браузерный about:blank. setTimeout — фолбэк
    // для фоновых/троттлящихся вкладок (там rAF не тикает); guard от двойного перехода.
    var _navDone = false;
    var _nav = function () { if (_navDone) return; _navDone = true; try { w.location.href = url; } catch (_l) { try { w.location = url; } catch (_l2) {} } };
    try { w.requestAnimationFrame(function () { w.requestAnimationFrame(_nav); }); } catch (_r) {}
    setTimeout(_nav, 120);
    return w;
  }

  function sameOriginNonCreate(url) {
    var abs = String(url || '');
    try { abs = new URL(String(url), location.href).href; } catch (_u) {}
    if (abs.indexOf(location.origin) !== 0) return null;      // чужой домен — не трогаем
    if (/\/customer-request\/create/.test(abs)) return null;  // create — нужен referrer, не трогаем
    return abs;
  }

  // 2) Перехват window.open (авто-открытия из кода: софтфон при звонке и пр.).
  try {
    if (!window.__tmThemeOpenPatched) {
      window.__tmThemeOpenPatched = true;
      window.open = function (url, target, features) {
        try {
          var t = String(target == null ? '' : target);
          // PERF-FIX: явный noopener (открытие заявки с карточки) НЕ оборачиваем — пускаем нативно,
          // чтобы вкладка ушла в ОТДЕЛЬНЫЙ процесс (быстро). Заглушку/opener оставляем ТОЛЬКО остальным
          // (софтфон, Фикс+ахк) — им нужна ссылка на окно (window.opener).
          if (/noopener/i.test(String(features == null ? '' : features))) return _open.apply(window, arguments);
          if (url && (t === '_blank' || t === '')) {
            var abs = sameOriginNonCreate(url);
            if (abs) return tmOpenThemedTab(abs);
          }
        } catch (_e) {}
        return _open.apply(window, arguments);
      };
      try { window.open.toString = function () { return 'function open() { [native code] }'; }; } catch (_ts) {}
    }
  } catch (_) {}

  // 3) Перехват кликов по ссылкам target=_blank нашего домена (напр. заявка с карточки клиента).
  try {
    document.addEventListener('click', function (e) {
      try {
        if (e.button !== 0 || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        if (String(a.getAttribute('target') || '') !== '_blank') return;
        var abs = sameOriginNonCreate(a.href);
        if (!abs) return;
        e.preventDefault();
        tmOpenThemedTab(abs);
      } catch (_c) {}
    }, true);
  } catch (_) {}
})();
