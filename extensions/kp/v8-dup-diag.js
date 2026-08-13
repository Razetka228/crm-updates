// v8 card-duplication diagnostic (index page). Watches the cards area and
// reports WHAT duplicates on page navigation:
//   - LIVE duplicates: same data-id present >1 as real (non-ghost) cards -> render bug
//   - GHOST overlap: .card-ghost-leave clones sitting over a live card -> animation not cleaned
// Runs in MAIN world; observes the shared DOM (no internal hooks needed).
(function v8DupDiag() {
  "use strict";
  if (window.__v8DupDiag) return;

  var HOST_ID = "tm-crm-v8-live-host";
  var t0 = Date.now();
  function ts() { return ((Date.now() - t0) / 1000).toFixed(2) + "s"; }

  var events = [];           // rolling log
  var maxLiveDup = 0;
  var maxGhost = 0;
  var lastSig = "";
  var lastActivityAt = 0;    // время последней мутации (окно семплинга порядка)
  var lastViolSig = "";      // дедуп ORDER_VIOLATION
  var lastLeftSeq = "";      // последний зафиксированный визуальный порядок левой колонки

  function log(kind, data) {
    var rec = { t: ts(), kind: kind, data: data || {} };
    events.push(rec);
    if (events.length > 120) events.shift();
    try {
      console.log("[V8-DUP] " + rec.t + " " + kind + " " + JSON.stringify(rec.data));
    } catch (_) {}
    render();
  }

  function getArea() {
    return document.querySelector("#" + HOST_ID + " .cards-area")
      || document.querySelector(".cards-area");
  }

  function scan() {
    var area = getArea();
    if (!area) return null;
    var host = document.getElementById(HOST_ID) || document;

    var liveCards = Array.prototype.slice.call(
      area.querySelectorAll(".card[data-id]:not(.card-ghost-leave)")
    );
    var liveById = {};
    liveCards.forEach(function (c) {
      var id = String(c.getAttribute("data-id") || "");
      if (!id) return;
      (liveById[id] = liveById[id] || []).push(c);
    });
    var liveDupes = [];
    Object.keys(liveById).forEach(function (id) {
      if (liveById[id].length > 1) liveDupes.push({ id: id, n: liveById[id].length });
    });

    var ghosts = Array.prototype.slice.call(host.querySelectorAll(".card-ghost-leave"));
    var ghostOverlap = [];
    var now = Date.now();
    var ghostActive = 0, frozen = [];
    ghosts.forEach(function (g) {
      var id = String(g.getAttribute("data-id") || "");
      if (id && liveById[id]) ghostOverlap.push(id);
      var active = g.classList.contains("card-ghost-leave-active");
      if (active) ghostActive++;
      var created = Number(g.getAttribute("data-tm-ghost-created-at") || "0");
      var age = created ? (now - created) : 0;
      // Здоровый призрак уходит за ~620мс. Если висит дольше — застрял.
      if (age > 600) {
        var op = "";
        try { op = (((g.ownerDocument && g.ownerDocument.defaultView) || window).getComputedStyle(g).opacity); } catch (_e) {}
        frozen.push({
          id: id, age: age, active: active ? 1 : 0, opacity: op,
          cls: String(g.className || "").replace(/card-ghost-leave(-active)?\b/g, "").replace(/\s+/g, " ").trim(),
          par: (g.parentElement && String(g.parentElement.className || "").split(" ")[0]) || ""
        });
      }
    });

    return {
      key: String(area.getAttribute("data-content-key") || ""),
      seq: String(area.getAttribute("data-content-seq") || ""),
      mode: (String(area.className || "").match(/(cards-grid-mode|main-split-mode|moderation-split-mode|bulk-phone-split-mode)/) || ["?"])[0],
      areaCls: String(area.className || "").replace("cards-area", "").replace(/\s+/g, " ").trim(),
      liveTotal: liveCards.length,
      liveUnique: Object.keys(liveById).length,
      liveDupes: liveDupes,
      ghostTotal: ghosts.length,
      ghostActive: ghostActive,
      ghostOverlap: ghostOverlap,
      frozen: frozen
    };
  }

  // Ранг карточки левой колонки по тексту статуса: mod=0, соглас/?=1, обычное уточнение=2.
  function classifyLeftRank(card) {
    var sp = card.querySelector && card.querySelector(".spill");
    var s = (sp ? sp.textContent : "").toLowerCase();
    if (s.indexOf("модерац") !== -1) return { r: 0, t: "mod" };
    if (s.indexOf("уточн") !== -1) {
      if (s.indexOf("соглас") !== -1) return { r: 1, t: "согл" };
      if (s.indexOf("?") !== -1) return { r: 1, t: "?" };
      return { r: 2, t: "уточн" };
    }
    return { r: 9, t: "-" };
  }

  // Визуальный порядок левой колонки по экранным координатам (учитывает transform во время FLIP).
  // Нарушение = карточка меньшего ранга (выше по приоритету) визуально НИЖЕ карточки большего ранга,
  // т.е. обычное «На уточнении» залезло выше «соглас»/«?».
  function computeLeftOrder() {
    var area = getArea();
    if (!area) return null;
    var leftFlow = area.querySelector('[data-main-col="left"] .main-split-col-flow')
      || area.querySelector('[data-main-col="left"]');
    if (!leftFlow) return null;
    var cards = Array.prototype.slice.call(leftFlow.querySelectorAll('.card[data-id]:not(.card-ghost-leave)'));
    var items = [];
    cards.forEach(function (c) {
      var cls = classifyLeftRank(c);
      if (cls.r === 9) return;
      var rect = c.getBoundingClientRect();
      if (rect.height < 2) return;
      items.push({
        id: String(c.getAttribute("data-id") || ""),
        r: cls.r, t: cls.t, top: rect.top,
        moving: c.classList.contains("card-move") || c.classList.contains("card-enter") || c.classList.contains("card-enter-active")
      });
    });
    items.sort(function (a, b) { return a.top - b.top; });
    var viol = [], maxR = -1, prev = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].r < maxR) {
        viol.push({
          card: items[i].t + ":" + items[i].id + (items[i].moving ? "*" : ""),
          under: prev ? (prev.t + ":" + prev.id + (prev.moving ? "*" : "")) : "-",
          y: Math.round(items[i].top)
        });
      }
      if (items[i].r > maxR) maxR = items[i].r;
      prev = items[i];
    }
    return {
      seq: items.map(function (it) { return it.t + (it.moving ? "*" : ""); }).join(">"),
      viol: viol,
      anyMoving: items.some(function (it) { return it.moving; })
    };
  }

  // Кадр-семплер: ~1.6с после каждой мутации проверяем визуальный порядок каждую рамку,
  // ловим транзиентное нарушение во время анимации ухода/переезда.
  function orderWatch() {
    try {
      if (Date.now() - lastActivityAt < 1600) {
        var lo = computeLeftOrder();
        if (lo) {
          lastLeftSeq = lo.seq;
          if (lo.viol.length) {
            var sig = lo.seq + "|" + lo.viol.map(function (v) { return v.card + "^" + v.under; }).join(",");
            if (sig !== lastViolSig) {
              lastViolSig = sig;
              log("ORDER_VIOLATION", { seq: lo.seq, moving: lo.anyMoving ? 1 : 0, viol: lo.viol.slice(0, 6) });
            }
          }
        }
      }
    } catch (_) {}
    (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(orderWatch);
  }
  orderWatch();

  function evaluate() {
    var s = scan();
    if (!s) return;
    var liveDupN = s.liveDupes.reduce(function (a, d) { return a + (d.n - 1); }, 0);
    if (liveDupN > maxLiveDup) maxLiveDup = liveDupN;
    if (s.ghostTotal > maxGhost) maxGhost = s.ghostTotal;

    // Log only when the interesting signature changes (avoid spam).
    var sig = s.mode + "|" + s.areaCls + "|dup:" + liveDupN + "|ovl:" + s.ghostOverlap.length + "|gh:" + s.ghostTotal + "|act:" + s.ghostActive + "|frz:" + s.frozen.length + "|live:" + s.liveTotal;
    if (sig !== lastSig) {
      lastSig = sig;
      if (liveDupN > 0 || s.ghostOverlap.length > 0) {
        log("DUP", {
          mode: s.mode, key: s.key, seq: s.seq,
          liveTotal: s.liveTotal, liveUnique: s.liveUnique,
          liveDupes: s.liveDupes.slice(0, 12),
          ghostTotal: s.ghostTotal,
          ghostOverlapIds: s.ghostOverlap.slice(0, 12)
        });
      }
      if (s.frozen.length > 0) {
        log("FROZEN", {
          count: s.frozen.length, ghostsActive: s.ghostActive, ghostsTotal: s.ghostTotal,
          areaCls: s.areaCls,
          items: s.frozen.slice(0, 8)
        });
      }
    }
    render(s);
  }

  // ---- navigation click correlation ----
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest(
      "#tmFilterPagePrev,#tmFilterPageNext,#tmFilterPageGo"
    );
    if (!t) return;
    var input = document.getElementById("tmFilterPageInput");
    log("NAV", { btn: t.id, inputVal: (input && input.value) || "" });
  }, true);

  // ---- observers ----
  var pending = false;
  function schedule() {
    lastActivityAt = Date.now();
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () { pending = false; evaluate(); }, 16);
  }
  var mo = new MutationObserver(schedule);
  function bind() {
    var area = getArea();
    if (area && area !== mo.__area) {
      try { mo.disconnect(); } catch (_) {}
      mo.observe(area, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-content-key", "data-content-seq"] });
      mo.__area = area;
      log("BIND", { found: true });
    }
    // also observe host for ghost layer
  }
  setInterval(function () { bind(); evaluate(); }, 500);

  // ---- panel ----
  var box = null, body = null;
  function buildText(s) {
    s = s || scan() || {};
    var lines = [];
    lines.push("mode=" + (s.mode || "?") + "  key=" + (s.key || "?") + "  seq=" + (s.seq || "?"));
    lines.push("live cards=" + (s.liveTotal || 0) + "  unique=" + (s.liveUnique || 0));
    lines.push("LIVE DUP (real dom)=" + ((s.liveDupes || []).reduce(function (a, d) { return a + (d.n - 1); }, 0)) +
      (s.liveDupes && s.liveDupes.length ? "  " + s.liveDupes.map(function (d) { return d.id + "x" + d.n; }).join(", ") : ""));
    lines.push("ghosts=" + (s.ghostTotal || 0) + "  active(animating)=" + (s.ghostActive || 0) + "  overlap-live=" + ((s.ghostOverlap || []).length));
    lines.push("STUCK ghosts (age>600ms)=" + ((s.frozen || []).length) +
      ((s.frozen && s.frozen.length) ? "  " + s.frozen.map(function (f) { return f.id + "[" + f.age + "ms act:" + f.active + " op:" + (f.opacity || "?") + " cls:" + (f.cls || "-") + " par:" + (f.par || "-") + "]"; }).join("  ") : ""));
    lines.push("areaCls=" + (s.areaCls || "-"));
    var loNow = null; try { loNow = computeLeftOrder(); } catch (_lo) {}
    if (loNow) {
      lines.push("LEFT order (visual): " + loNow.seq + (loNow.viol.length ? "  !!! ВЫШЕ соглас: " + loNow.viol.map(function (v) { return v.card + "^" + v.under + "@" + v.y; }).join(", ") : "  ok"));
    }
    lines.push("max seen: liveDup=" + maxLiveDup + " ghosts=" + maxGhost);
    lines.push("");
    lines.push("--- events (last " + Math.min(events.length, 40) + ") ---");
    events.slice(-40).forEach(function (r) {
      lines.push(r.t + " " + r.kind + " " + JSON.stringify(r.data));
    });
    return lines.join("\n");
  }
  function render(s) {
    try {
      if (box && !box.isConnected) {
        try { (document.documentElement || document.body).appendChild(box); } catch (_e) {}
      }
      if (!box) {
        var __mount = document.documentElement || document.body;
        if (!__mount) return;
        box = document.createElement("div");
        box.style.cssText = "position:fixed;bottom:8px;right:8px;z-index:2147483647;width:520px;max-width:calc(100vw - 16px);max-height:60vh;overflow:auto;background:#0f1620;color:#d6e2ee;border:1px solid #2b3a4a;border-radius:8px;box-shadow:0 10px 34px rgba(0,0,0,.55);padding:8px 10px;font:11px/1.4 Consolas,monospace;white-space:pre-wrap;word-break:break-word";
        var head = document.createElement("div");
        head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;gap:8px";
        var ttl = document.createElement("b");
        ttl.textContent = "V8-DUP-DIAG";
        ttl.style.cssText = "color:#7ee787;font-size:12px";
        var btns = document.createElement("div");
        var copy = document.createElement("button");
        copy.textContent = "Copy";
        copy.style.cssText = "cursor:pointer;background:#238636;color:#fff;border:0;border-radius:5px;padding:2px 9px;margin-left:6px;font:inherit";
        copy.onclick = function () {
          var txt = buildText();
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(fb); else fb();
          } catch (_) { fb(); }
          function fb() { var ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (_) {} ta.remove(); }
          copy.textContent = "Copied!"; setTimeout(function () { copy.textContent = "Copy"; }, 1000);
        };
        var hide = document.createElement("button");
        hide.textContent = "×";
        hide.style.cssText = "cursor:pointer;background:#30363d;color:#fff;border:0;border-radius:5px;padding:2px 9px;margin-left:6px;font:inherit";
        hide.onclick = function () { box.style.display = "none"; };
        btns.appendChild(copy); btns.appendChild(hide);
        head.appendChild(ttl); head.appendChild(btns);
        body = document.createElement("div");
        box.appendChild(head); box.appendChild(body);
        __mount.appendChild(box);
      }
      var snap = s || scan() || {};
      var dupNow = (snap.liveDupes || []).reduce(function (a, d) { return a + (d.n - 1); }, 0);
      box.style.borderColor = (dupNow > 0 || (snap.ghostOverlap || []).length > 0 || (snap.frozen || []).length > 0) ? "#f85149" : "#2b3a4a";
      body.textContent = buildText(snap);
    } catch (_) {}
  }

  window.__v8DupDiag = { scan: scan, dump: buildText, events: events };
  log("START", { href: location.pathname });
})();
