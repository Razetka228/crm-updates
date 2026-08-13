// Boot-screen controller for the CRM v8 redesign (index page).
// Picks up the saved theme so the cover matches, then releases the boot screen
// (html[data-tm-v8-ready="1"]) once the v8 host is built — or after a safety
// timeout so the page is never stuck hidden.
(function crmV8Boot() {
  "use strict";

  // Only the index page gets the v8 redesign.
  try {
    if (location.pathname.indexOf("/customer-request/index") === -1) {
      return;
    }
  } catch (_error) {
    return;
  }

  var root = document.documentElement;
  if (!root) return;

  // Theme-aware cover (avoids a light flash for dark-theme users).
  try {
    var theme = localStorage.getItem("tm-crm-theme-v1")
      || localStorage.getItem("tm-crm-v8-theme-v1");
    root.setAttribute("data-tm-v8-boot-theme", theme === "dark" ? "dark" : "light");
  } catch (_error) {}

  // Иконка вкладки главной страницы — буквы направления (host-based: КП/БТ/МНЧ).
  try {
    var _host = String(location.hostname || "");
    var _dir = /bt-lead-centre\.ru$/i.test(_host) ? { t: "БТ", dot: "#4884D0", fs: 19, tl: 27 }
      : /mnc-lead-centre\.ru$/i.test(_host) ? { t: "МНЧ", dot: "#4884D0", fs: 17, tl: 30 }
      : /kp-lead-centre\.ru$/i.test(_host) ? { t: "КП", dot: "#4884D0", fs: 19, tl: 27 }
      : null;
    if (_dir) {
      // Адаптив под тему браузера: тёмная панель — светлые буквы, светлая — тёмные.
      var _mq = null;
      try { _mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null; } catch (_e0) {}
      var _buildHref = function () {
        var dark = _mq ? _mq.matches : true;
        var letter = "#ffffff";
        var halo = "rgba(0,0,0,0.68)";
        var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
          + "<text x='16' y='15.5' text-anchor='middle' "
          + "textLength='" + _dir.tl + "' lengthAdjust='spacingAndGlyphs' "
          + "font-family='Segoe UI,Arial,sans-serif' font-weight='800' font-size='" + _dir.fs + "' "
          + "fill='" + letter + "' stroke='" + halo + "' stroke-width='1.35' stroke-linejoin='round' paint-order='stroke'>" + _dir.t + "</text>"
          + "<circle cx='16' cy='25.5' r='4.2' fill='" + _dir.dot + "'/></svg>";
        return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
      };
      var _setFav = function () {
        var head = document.head || document.getElementsByTagName("head")[0];
        if (!head) return;
        try {
          var links = document.querySelectorAll('link[rel~="icon"]');
          for (var i = 0; i < links.length; i++) {
            var l = links[i];
            if (!l.dataset || l.dataset.tmV8MainIcon !== "1") {
              if (l.parentNode) l.parentNode.removeChild(l);
            }
          }
          var icon = document.querySelector('link[data-tm-v8-main-icon="1"]') || document.createElement("link");
          icon.rel = "icon";
          icon.type = "image/svg+xml";
          icon.href = _buildHref();
          icon.setAttribute("data-tm-v8-main-icon", "1");
          if (!icon.parentNode) head.appendChild(icon);
        } catch (_e) {}
      };
      _setFav();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _setFav, { once: true });
      }
      [100, 300, 700, 1500, 3000].forEach(function (ms) { setTimeout(_setFav, ms); });
      try {
        if (_mq && _mq.addEventListener) _mq.addEventListener("change", _setFav);
        else if (_mq && _mq.addListener) _mq.addListener(_setFav);
      } catch (_e1) {}
    }
  } catch (_error) {}

  var released = false;
  function release() {
    if (released) return;
    released = true;
    try { root.setAttribute("data-tm-v8-ready", "1"); } catch (_error) {}
    try { if (observer) observer.disconnect(); } catch (_error) {}
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = 0; }
  }

  function v8Ready() {
    var host = document.getElementById("tm-crm-v8-live-host");
    return !!(host && host.childElementCount > 0);
  }

  function check() {
    if (v8Ready()) {
      // one frame so v8's own styles are applied before the reveal animation
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(release);
      } else {
        release();
      }
      return true;
    }
    return false;
  }

  var observer = null;
  try {
    observer = new MutationObserver(function () { check(); });
    observer.observe(root, { childList: true, subtree: true });
  } catch (_error) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check, { once: true });
  } else {
    check();
  }
  [100, 300, 700, 1500, 3000, 6000].forEach(function (ms) {
    setTimeout(check, ms);
  });

  // Safety: never leave the page hidden if v8 fails to build.
  var safetyTimer = setTimeout(release, 12000);
})();
