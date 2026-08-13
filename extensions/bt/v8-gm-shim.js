// MAIN-world shim for the CRM v8 userscript converted to an extension.
// The original Tampermonkey grant @grant GM_setClipboard is the only GM API
// this script uses, so we just provide a self-contained implementation here.
// Runs BEFORE content.js (see manifest content_scripts order).
(function installCrmV8GmShim() {
  "use strict";

  // Mirror Tampermonkey's page handle (harmless even though v8 doesn't use it).
  try {
    if (typeof globalThis.unsafeWindow === "undefined") {
      Object.defineProperty(globalThis, "unsafeWindow", {
        configurable: true,
        writable: true,
        value: globalThis
      });
    }
  } catch (_error) {
    try { globalThis.unsafeWindow = globalThis; } catch (_assignError) {}
  }

  if (typeof globalThis.GM_setClipboard === "function") {
    return;
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    (document.body || document.documentElement).appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      if (textarea.parentNode) {
        textarea.parentNode.removeChild(textarea);
      }
    }
  }

  Object.defineProperty(globalThis, "GM_setClipboard", {
    configurable: true,
    writable: true,
    value: function GM_setClipboard(text) {
      text = String(text == null ? "" : text);
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
        } else {
          fallbackCopy(text);
        }
      } catch (_error) {
        try { fallbackCopy(text); } catch (_fallbackError) {}
      }
    }
  });
})();
