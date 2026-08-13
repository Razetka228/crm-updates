// Error attributor for the bundled extension. Runs FIRST in the MAIN world so it
// catches document_start errors from any of the three scripts (v11 / v8 / Фикс).
// Stays silent while everything is fine; shows a compact panel ONLY on error,
// labelling each error with the script it came from.
(function crmBundleDiag() {
  "use strict";
  if (window.__crmDiag && window.__crmDiag.__installed) return;

  var errors = [];
  var t0 = Date.now();
  function now() { return Date.now() - t0; }

  function classify(s) {
    s = String(s || "");
    if (/userscript-main\.js|main-shim\.js|\bbridge\.js/.test(s) && !/fix-bridge\.js/.test(s)) return "v11";
    if (/v8-content\.js|v8-gm-shim\.js/.test(s)) return "v8";
    if (/fix-content\.js|fix-shim\.js|fix-bridge\.js/.test(s)) return "Фикс";
    if (/background\.js/.test(s)) return "v11/background";
    if (/diag\.js/.test(s)) return "diag";
    if (/userscript\.html|\.user\.js/.test(s)) return "Tampermonkey (внешний скрипт!)";
    return "неизвестно";
  }

  function shortFile(f) {
    if (!f) return "(no file)";
    var m = String(f).match(/[^/\\]+\.(js|html)(\?[^#]*)?/);
    return m ? m[0].split("?")[0] : String(f);
  }

  function push(rec) {
    rec.t = now();
    rec.who = classify((rec.file || "") + " " + (rec.stack || ""));
    errors.push(rec);
    try {
      console.error("[CRM-DIAG] " + rec.who + ": " + rec.msg + " — " + shortFile(rec.file) + ":" + rec.line);
      if (rec.stack) console.error("[CRM-DIAG] stack:\n" + rec.stack);
    } catch (_) {}
    render();
  }

  window.addEventListener("error", function (e) {
    push({
      msg: (e && e.message) || "(no message)",
      file: e && e.filename,
      line: e && e.lineno,
      col: e && e.colno,
      stack: (e && e.error && e.error.stack) ? String(e.error.stack) : ""
    });
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    push({
      msg: "[promise] " + ((r && (r.message || r)) ? String(r.message || r) : "(rejection)"),
      file: (r && r.fileName) || "",
      line: (r && r.lineNumber) || "",
      col: "",
      stack: (r && r.stack) ? String(r.stack) : ""
    });
  }, true);

  var box = null, body = null;
  function build() {
    var txt = ["route: " + location.pathname, "errors: " + errors.length];
    var byWho = {};
    errors.forEach(function (er) { byWho[er.who] = (byWho[er.who] || 0) + 1; });
    txt.push("по скриптам: " + Object.keys(byWho).map(function (k) { return k + "=" + byWho[k]; }).join(", "));
    errors.forEach(function (er, i) {
      txt.push("");
      txt.push("#" + (i + 1) + " [" + er.who + "] @" + er.t + "ms");
      txt.push("  " + er.msg);
      txt.push("  " + shortFile(er.file) + ":" + er.line + (er.col ? ":" + er.col : ""));
      if (er.stack) txt.push("  " + er.stack.split("\n").slice(0, 4).join("\n  "));
    });
    return txt.join("\n");
  }

  function render() {
    if (!errors.length) return; // молчим пока нет ошибок
    try {
      if (!box) {
        box = document.createElement("div");
        box.style.cssText = "position:fixed;top:10px;right:10px;z-index:2147483647;width:440px;max-width:calc(100vw - 20px);max-height:70vh;overflow:auto;background:#1a0f0f;color:#ffd9d9;border:2px solid #f85149;border-radius:8px;box-shadow:0 10px 34px rgba(0,0,0,.55);padding:10px 12px;font:12px/1.45 Consolas,monospace;white-space:pre-wrap;word-break:break-word";
        var head = document.createElement("div");
        head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px";
        var ttl = document.createElement("b");
        ttl.textContent = "⚠ CRM-DIAG — есть ошибки";
        ttl.style.cssText = "color:#ff7b72;font-size:13px";
        var btns = document.createElement("div");
        var copy = document.createElement("button");
        copy.textContent = "Copy";
        copy.style.cssText = "cursor:pointer;background:#238636;color:#fff;border:0;border-radius:5px;padding:3px 9px;margin-left:6px;font:inherit";
        copy.onclick = function () {
          var t = build();
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb);
            else fb();
          } catch (_) { fb(); }
          function fb() { var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (_) {} ta.remove(); }
          copy.textContent = "Copied!"; setTimeout(function () { copy.textContent = "Copy"; }, 1200);
        };
        var hide = document.createElement("button");
        hide.textContent = "×";
        hide.style.cssText = "cursor:pointer;background:#30363d;color:#fff;border:0;border-radius:5px;padding:3px 9px;margin-left:6px;font:inherit";
        hide.onclick = function () { box.style.display = "none"; };
        btns.appendChild(copy); btns.appendChild(hide);
        head.appendChild(ttl); head.appendChild(btns);
        body = document.createElement("div");
        box.appendChild(head); box.appendChild(body);
        (document.body || document.documentElement).appendChild(box);
      }
      box.style.display = "block";
      body.textContent = build();
    } catch (_) {}
  }

  window.__crmDiag = { __installed: true, errors: errors, dump: build };
})();
