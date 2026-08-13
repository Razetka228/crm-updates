"use strict";

const MESSAGE_TYPE = "crm-v11-gm-xml-http-request";

function headersToString(headers) {
  const lines = [];
  headers.forEach((value, key) => {
    lines.push(`${key}: ${value}`);
  });
  return lines.join("\r\n");
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  return headers;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPE) {
    return false;
  }

  const details = message.details || {};
  if (!details.url) {
    sendResponse({
      ok: false,
      timeout: false,
      error: "Missing request URL",
      response: {
        status: 0,
        statusText: "",
        responseText: "",
        response: "",
        finalUrl: "",
        responseHeaders: "",
        readyState: 4
      }
    });
    return false;
  }

  const controller = new AbortController();
  const timeout = Number(details.timeout || 0);
  let timedOut = false;
  const timer = timeout > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout)
    : null;

  const method = String(details.method || "GET").toUpperCase();
  const init = {
    method,
    headers: normalizeHeaders(details.headers),
    credentials: details.anonymous ? "omit" : "include",
    redirect: "follow",
    signal: controller.signal
  };

  if (method !== "GET" && method !== "HEAD" && details.data != null) {
    init.body = details.data;
  }

  fetch(details.url, init)
    .then(async (response) => {
      const responseText = await response.text();
      sendResponse({
        ok: true,
        response: {
          status: response.status,
          statusText: response.statusText,
          responseText,
          response: responseText,
          finalUrl: response.url,
          responseHeaders: headersToString(response.headers),
          readyState: 4
        }
      });
    })
    .catch((error) => {
      const messageText = error && error.message ? error.message : String(error || "");
      sendResponse({
        ok: false,
        timeout: timedOut,
        error: messageText,
        response: {
          status: 0,
          statusText: "",
          responseText: "",
          response: "",
          finalUrl: details.url,
          responseHeaders: "",
          readyState: 4,
          error: messageText
        }
      });
    })
    .finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });

  return true;
});

/* ============================================================
 * Буфер заявки (Копировать/Вставить) — кросс-вкладочное хранилище через chrome.storage.local,
 * т.к. на странице заявки localStorage заблокирован. MAIN-мир шлёт через мост (main-shim → bridge).
 * ============================================================ */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "crm-v11-clip") {
    return false;
  }
  const KEY = (message && typeof message.key === "string" && message.key) ? message.key : "tmReqClipboard";
  try {
    if (message.action === "set") {
      chrome.storage.local.set({ [KEY]: String(message.value == null ? "" : message.value) }, () => sendResponse({ ok: true }));
      return true;
    }
    if (message.action === "get") {
      chrome.storage.local.get(KEY, (r) => sendResponse({ ok: true, value: (r && r[KEY]) || "" }));
      return true;
    }
    if (message.action === "del") {
      chrome.storage.local.remove(KEY, () => sendResponse({ ok: true }));
      return true;
    }
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
    return true;
  }
  return false;
});

/* ============================================================
 * CRM clear-search on close (встроено из clear-search-reload-guard)
 * Чистит __CLEAR_SEARCH__ в AHK при уходе со страницы заявки (навигация в той же вкладке)
 * или закрытии вкладки. Перезагрузку (transitionType==='reload') не трогает.
 * Активный поиск присылает content-script clear-on-close.js (из DOM-атрибута/localStorage,
 * который пишет Фикс+ахк >=26.25). Состояние — в chrome.storage.session.
 * ============================================================ */
(() => {
  "use strict";

  const AHK_BASE = "http://127.0.0.1:12348/";
  const MSG = "crm-clear-active";
  const keyFor = (tabId) => "clr_tab_" + tabId;
  const RE_REQUEST = /\/admin\/domain\/customer-request\/update/i;

  function normUrl(u) {
    try { const x = new URL(u); return x.origin + x.pathname + x.search; }
    catch (e) { return String(u || "").split("#")[0]; }
  }
  const getRec = async (id) => { const k = keyFor(id); const g = await chrome.storage.session.get(k); return g ? g[k] : null; };
  const setRec = (id, rec) => chrome.storage.session.set({ [keyFor(id)]: rec });
  const delRec = (id) => chrome.storage.session.remove(keyFor(id));

  async function sendClear(city, requestId, reason) {
    const url = AHK_BASE +
      "?city=" + encodeURIComponent(city) +
      "&message=" + encodeURIComponent("__CLEAR_SEARCH__") +
      "&_t=" + Date.now();
    try {
      const r = await fetch(url, { method: "GET", keepalive: true });
      console.log("[clear-on-close] sent", reason, city, requestId, r.status);
    } catch (e) {
      console.warn("[clear-on-close] error", reason, city, requestId, String(e));
    }
  }

  // Регистрация активного поиска от content-script
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.type !== MSG || !sender || !sender.tab) return;
    const tabId = sender.tab.id;
    if (msg.data && msg.data.city) {
      setRec(tabId, {
        requestId: String(msg.data.requestId || ""),
        city: String(msg.data.city || ""),
        global: !!msg.data.global,
        url: normUrl((sender.tab && sender.tab.url) || "")
      });
    } else {
      delRec(tabId);
    }
  });

  // Уход со страницы заявки в той же вкладке
  chrome.webNavigation.onCommitted.addListener(async (d) => {
    if (d.frameId !== 0) return;
    const rec = await getRec(d.tabId);
    if (!rec) return;
    if (rec.global) return;                                           // глоб. поиск ссылки — на навигации НЕ чистим (только на закрытии вкладки)
    if (d.transitionType === "reload") return;                        // перезагрузка — не чистим
    if (normUrl(d.url) === rec.url && RE_REQUEST.test(d.url)) return; // та же заявка — не чистим
    await delRec(d.tabId);
    await sendClear(rec.city, rec.requestId, "navigate");
  });

  // Физическое закрытие вкладки
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const rec = await getRec(tabId);
    if (!rec) return;
    await delRec(tabId);
    if (rec.city) await sendClear(rec.city, rec.requestId, "close");
  });
})();

/* ============================================================
 * АВТО-ОБНОВЛЕНИЕ РАСШИРЕНИЯ С GITHUB (self-reload)
 * Фоновая PowerShell-задача обновляет ФАЙЛЫ расширения на диске с GitHub.
 * Этот код в service worker периодически смотрит версию manifest на GitHub и,
 * когда она новее текущей, зовёт chrome.runtime.reload() — браузер перечитывает
 * обновлённые файлы с диска. Работает одинаково на Chrome/Яндекс/Edge/Opera.
 * ============================================================ */
(() => {
  "use strict";
  const MANIFEST_URL = "https://raw.githubusercontent.com/Razetka228/crm-updates/main/extensions/kp/manifest.json";
  const ALARM = "crmExtUpdateCheck";
  const PERIOD_MIN = 3;
  const GUARD_MS = 6 * 60 * 1000; // не перезагружаться повторно на ту же версию чаще, чем раз в 6 мин

  function cmpVer(a, b) {
    const pa = String(a).split("."), pb = String(b).split(".");
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const x = parseInt(pa[i] || "0", 10), y = parseInt(pb[i] || "0", 10);
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  async function checkForUpdate() {
    try {
      const running = chrome.runtime.getManifest().version;
      const res = await fetch(MANIFEST_URL + "?_=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const remote = await res.json();
      if (!remote || !remote.version) return;
      if (cmpVer(remote.version, running) <= 0) return; // не новее — нечего делать

      // защита от цикла: не перезагружаться повторно на ту же версию, пока не истёк GUARD
      const st = await chrome.storage.local.get(["__ext_upd_v", "__ext_upd_t"]);
      const now = Date.now();
      if (st.__ext_upd_v === remote.version && st.__ext_upd_t && (now - st.__ext_upd_t) < GUARD_MS) return;
      await chrome.storage.local.set({ __ext_upd_v: remote.version, __ext_upd_t: now });

      console.log("[ext-updater] новая версия " + remote.version + " (текущая " + running + ") -> chrome.runtime.reload()");
      chrome.runtime.reload();
    } catch (e) { /* нет сети / GitHub недоступен — тихо ждём следующего раза */ }
  }

  try {
    chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
    chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) checkForUpdate(); });
    chrome.runtime.onStartup.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN }); checkForUpdate(); });
    chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN }); checkForUpdate(); });
    checkForUpdate();
  } catch (e) { console.warn("[ext-updater] init error", e); }
})();

console.log("[CRM ext] service worker versiya " + chrome.runtime.getManifest().version + " zapushchen (auto-update OK)");
