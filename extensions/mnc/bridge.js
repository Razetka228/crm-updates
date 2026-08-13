"use strict";

// Ранняя тема на document_start (isolated-world, идёт вместе с boot.css). Читаем cookie tmcrmtheme
// (её пишет v8 на странице списка) и красим корневой фон/color-scheme ДО первой отрисовки, чтобы
// загрузочный экран сразу был в цвет темы скрипта, а не в цвет темы браузера.
(function tmEarlyThemeBoot() {
  try {
    var m = document.cookie.match(/(?:^|;\s*)tmcrmtheme=(dark|light)/);
    var dark = !!(m && m[1] === "dark");
    var de = document.documentElement;
    if (!de) return;
    var col = dark ? "#141413" : "#ECEBE7";
    var scheme = dark ? "dark" : "light";
    try { de.style.colorScheme = scheme; } catch (_cs) {}
    try { de.style.background = col; } catch (_bg) {}
    if (dark) { try { de.classList.add("tm-v11-dark"); } catch (_cl) {} }
    if (!document.getElementById("tmEarlyThemeBootBg")) {
      var st = document.createElement("style");
      st.id = "tmEarlyThemeBootBg";
      // Красим прямо загрузочный overlay boot.css (::before) резолвнутым цветом темы — без зависимости
      // от тайминга класса tm-v11-dark, чтобы светлое не мелькало ни на кадр.
      st.textContent =
        "html{color-scheme:" + scheme + ";background:" + col + " !important;}" +
        "html body{background:" + col + " !important;}" +
        "html:not([data-crm-v11-boot-released=\"1\"])::before{background:" + col + " !important;}";
      de.appendChild(st);
    }
  } catch (_e) {}
})();

const MAIN_SOURCE = "crm-v11-main";
const BRIDGE_SOURCE = "crm-v11-bridge";

function postRuntimeResponse(id, response, error) {
  window.postMessage({
    source: BRIDGE_SOURCE,
    type: "runtime-send-message-response",
    id,
    response,
    error: error || ""
  }, "*");
}

function writeClipboard(text) {
  text = String(text == null ? "" : text);

  function fallbackCopy() {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.documentElement.appendChild(textarea);
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

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
  } catch (_error) {
    fallbackCopy();
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data || {};
  if (!data || data.source !== MAIN_SOURCE) {
    return;
  }

  if (data.type === "runtime-send-message") {
    chrome.runtime.sendMessage(data.message || {}, (response) => {
      if (chrome.runtime.lastError) {
        postRuntimeResponse(data.id, undefined, chrome.runtime.lastError.message);
        return;
      }
      postRuntimeResponse(data.id, response, "");
    });
    return;
  }

  if (data.type === "set-clipboard") {
    writeClipboard(data.text);
    return;
  }
});
