// Clean the service bridge parameter if it reaches the visible tab.
(function cleanCrmCreateV11BridgeUrl() {
  "use strict";

  try {
    if (document && document.documentElement) {
      document.documentElement.setAttribute("data-crm-create-v11-extension", "1");
    }
  } catch (_markerError) {}

  if (window.top === window && String(location.search || "").indexOf("crm_source_bridge=1") !== -1) {
    try {
      var cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("crm_source_bridge");
      history.replaceState(history.state, document.title, cleanUrl.href);
    } catch (_error) {}
  }
})();

(function installCrmCreateV11BootReleaseWatcher() {
  "use strict";

  var released = false;
  var observer = null;
  var overlayHost = null;
  var overlayBody = null;
  var overlayRenderTimer = 0;
  var overlayHeartbeatTimer = 0;
  var state = {
    startedAt: Date.now(),
    route: "",
    stage: "shim-watch",
    readyState: document.readyState || "loading",
    maxWaitMs: 15000,
    releaseReason: "",
    message: "",
    lastError: ""
  };
  var diagEnabled = false;

  function isCreateRoute() {
    try {
      var path = String(location.pathname || "");
      return path.indexOf("/customer-request/create") !== -1 && path.indexOf("/customer-request/create-claim") === -1;
    } catch (_error) {}
    return false;
  }

  function formatMs(ms) {
    var safeMs = Number(ms || 0);
    if (!isFinite(safeMs) || safeMs < 0) {
      safeMs = 0;
    }
    return (safeMs / 1000).toFixed(safeMs >= 10000 ? 0 : 1) + "s";
  }

  function formatFlag(value) {
    if (value === true) {
      return "yes";
    }
    if (value === false) {
      return "no";
    }
    return "?";
  }

  function formatCount(value) {
    if (value === null || typeof value === "undefined" || value === "") {
      return "?";
    }
    return String(value);
  }

  function copyFingerprint(fp) {
    if (!fp || typeof fp !== "object") {
      return null;
    }
    return {
      score: Number(fp.score || 0),
      signals: Array.isArray(fp.signals) ? fp.signals.map(function (item) {
        return {
          name: String(item && item.name || ""),
          weight: Number(item && item.weight || 0)
        };
      }) : [],
      blockers: Array.isArray(fp.blockers) ? fp.blockers.map(function (item) {
        return String(item);
      }) : []
    };
  }

  function removeOverlay() {
    try {
      if (overlayHost && overlayHost.parentNode) {
        overlayHost.parentNode.removeChild(overlayHost);
      }
    } catch (_error) {}
    overlayHost = null;
    overlayBody = null;
  }

  function ensureOverlay() {
    if (!diagEnabled) {
      return null;
    }
    if (overlayHost && overlayHost.isConnected) {
      return overlayHost;
    }
    var root = document.documentElement;
    if (!root) {
      return null;
    }

    var host = document.createElement("div");
    host.setAttribute("data-crm-v11-boot-diag", "1");
    host.style.cssText = [
      "position:fixed",
      "top:12px",
      "right:12px",
      "width:460px",
      "max-width:calc(100vw - 24px)",
      "max-height:calc(100vh - 24px)",
      "z-index:2147483647",
      "box-sizing:border-box",
      "background:rgba(27,24,21,.97)",
      "color:#F5F1EA",
      "border:1px solid rgba(214,198,174,.28)",
      "border-radius:8px",
      "box-shadow:0 16px 40px rgba(0,0,0,.42)",
      "padding:10px 12px 12px",
      "font:12px/1.45 Consolas, 'Courier New', monospace",
      "pointer-events:auto"
    ].join(";");

    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px";

    var title = document.createElement("div");
    title.textContent = "CRM v11 boot diagnostic";
    title.style.cssText = "font-weight:700;font-size:12px;letter-spacing:0";
    head.appendChild(title);

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "x";
    close.style.cssText = [
      "border:0",
      "background:transparent",
      "color:#D8C9B4",
      "cursor:pointer",
      "font:inherit",
      "padding:0",
      "width:18px",
      "height:18px",
      "line-height:18px",
      "text-align:center"
    ].join(";");
    close.addEventListener("click", function () {
      state.dismissed = true;
      removeOverlay();
    });
    head.appendChild(close);

    var body = document.createElement("pre");
    body.style.cssText = [
      "margin:0",
      "white-space:pre-wrap",
      "word-break:break-word",
      "overflow:auto",
      "max-height:calc(100vh - 84px)",
      "color:inherit"
    ].join(";");

    host.appendChild(head);
    host.appendChild(body);
    root.appendChild(host);

    overlayHost = host;
    overlayBody = body;
    return host;
  }

  function shouldShowOverlay(force) {
    if (!diagEnabled || state.dismissed) {
      return false;
    }
    if (force) {
      return true;
    }
    if (state.lastError) {
      return true;
    }
    if (state.releaseReason === "timeout") {
      return true;
    }
    if (state.stage === "timeout-fallback" || state.stage === "abort-no-create-form") {
      return true;
    }
    return !released && Date.now() - Number(state.startedAt || 0) >= 4000;
  }

  function renderOverlay(force) {
    if (!shouldShowOverlay(force)) {
      if (released && state.releaseReason === "custom-ui") {
        removeOverlay();
      }
      return;
    }
    if (!ensureOverlay() || !overlayBody) {
      return;
    }

    var elapsedMs = Date.now() - Number(state.startedAt || Date.now());
    var fp = state.fingerprint;
    var signalText = fp && fp.signals && fp.signals.length ? fp.signals.map(function (item) {
      var name = String(item && item.name || "");
      var weight = Number(item && item.weight || 0);
      return weight > 1 ? name + "(" + weight + ")" : name;
    }).join(", ") : "-";
    var blockerText = fp && fp.blockers && fp.blockers.length ? fp.blockers.join(", ") : "-";
    var lines = [
      "stage: " + String(state.stage || "unknown"),
      "elapsed: " + formatMs(elapsedMs) + (state.maxWaitMs ? " / " + formatMs(state.maxWaitMs) : ""),
      "route: " + String(state.route || ""),
      "readyState: " + String(state.readyState || document.readyState || "unknown") + " | pageReady: " + formatFlag(state.pageReady),
      "nativeForm: " + formatFlag(state.hasNativeForm) + " | fields: " + formatCount(state.nativeFieldCount),
      "cityField: " + formatFlag(state.hasCityField) + " | phoneField: " + formatFlag(state.hasPhoneField),
      "fingerprint: " + (fp ? "score " + formatCount(fp.score) : "-"),
      "signals: " + signalText,
      "blockers: " + blockerText
    ];

    if (state.reason) {
      lines.push("reason: " + String(state.reason));
    }
    if (state.message) {
      lines.push("message: " + String(state.message));
    }
    if (state.releaseReason) {
      lines.push("release: " + String(state.releaseReason));
    }
    if (state.lastError) {
      lines.push("error: " + String(state.lastError));
    }

    overlayBody.textContent = lines.join("\n");
  }

  function scheduleOverlay(force) {
    if (!diagEnabled) {
      return;
    }
    if (force) {
      renderOverlay(true);
      return;
    }
    if (overlayRenderTimer) {
      return;
    }
    overlayRenderTimer = setTimeout(function () {
      overlayRenderTimer = 0;
      renderOverlay(false);
    }, 0);
  }

  function updateDiag(patch) {
    if (!diagEnabled || !patch || typeof patch !== "object") {
      return;
    }
    [
      "stage",
      "reason",
      "message",
      "readyState",
      "pageReady",
      "timedOut",
      "maxWaitMs",
      "hasNativeForm",
      "nativeFieldCount",
      "hasPhoneField",
      "hasCityField",
      "bootDone",
      "releaseReason"
    ].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        state[key] = patch[key];
      }
    });
    if (Object.prototype.hasOwnProperty.call(patch, "fingerprint")) {
      state.fingerprint = copyFingerprint(patch.fingerprint);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "lastError") && patch.lastError !== null && typeof patch.lastError !== "undefined") {
      state.lastError = String(patch.lastError);
    }
    state.updatedAt = Date.now();
    state.readyState = String(state.readyState || document.readyState || "loading");
    scheduleOverlay(false);
  }

  function registerBootError(text) {
    if (!diagEnabled) {
      return;
    }
    updateDiag({
      message: "Page error while create boot was running",
      lastError: text
    });
    renderOverlay(true);
  }

  try {
    state.route = String(location.pathname || location.href || "");
  } catch (_error) {}
  // Диагностический оверлей "CRM v11 boot diagnostic" отключён.
  // Логика сторожа/релиза загрузки ниже продолжает работать.
  diagEnabled = false;

  function release(reason) {
    if (diagEnabled) {
      updateDiag({
        bootDone: true,
        releaseReason: String(reason || state.releaseReason || "manual"),
        readyState: document.readyState || state.readyState || "loading"
      });
    }
    if (released) {
      return;
    }
    released = true;
    try {
      if (document.documentElement) {
        document.documentElement.setAttribute("data-crm-v11-boot-released", "1");
      }
    } catch (_error) {}
    try {
      if (observer) {
        observer.disconnect();
      }
    } catch (_error) {}
    try {
      if (overlayHeartbeatTimer) {
        clearInterval(overlayHeartbeatTimer);
      }
    } catch (_error) {}
    overlayHeartbeatTimer = 0;
    if (reason === "custom-ui") {
      removeOverlay();
    } else {
      renderOverlay(true);
    }
  }

  function hasCustomUi() {
    try {
      if (document.documentElement && document.documentElement.classList.contains("tm-cu-v11-html")) {
        return true;
      }
      if (document.body && document.body.classList.contains("tm-cu-v11")) {
        return true;
      }
      if (document.getElementById("nameInput")) {
        return true;
      }
      if (document.getElementById("uiToast")) {
        return true;
      }
      if (document.getElementById("dvQuickTimeInput")) {
        return true;
      }
      if (document.getElementById("tmInWorkStateCard")) {
        return true;
      }
      if (document.querySelector(".shell .topbar .btn-save, .shell .work-card, .tm-cu-topbar, .tm-cu-main")) {
        return true;
      }
    } catch (_error) {}
    return false;
  }

  function tick() {
    if (hasCustomUi()) {
      release("custom-ui");
    }
  }

  try {
    Object.defineProperty(globalThis, "__crmCreateReleaseBootPrehide", {
      configurable: true,
      writable: true,
      value: release
    });
  } catch (_error) {
    try {
      globalThis.__crmCreateReleaseBootPrehide = release;
    } catch (_assignError) {}
  }

  if (diagEnabled) {
    try {
      Object.defineProperty(globalThis, "__crmCreateBootDiagUpdate", {
        configurable: true,
        writable: true,
        value: updateDiag
      });
    } catch (_error) {
      try {
        globalThis.__crmCreateBootDiagUpdate = updateDiag;
      } catch (_assignError) {}
    }
    try {
      Object.defineProperty(globalThis, "__crmCreateBootDiagShow", {
        configurable: true,
        writable: true,
        value: function showCrmCreateBootDiag() {
          state.dismissed = false;
          renderOverlay(true);
        }
      });
    } catch (_error) {
      try {
        globalThis.__crmCreateBootDiagShow = function showCrmCreateBootDiag() {
          state.dismissed = false;
          renderOverlay(true);
        };
      } catch (_assignError) {}
    }
    try {
      window.addEventListener("error", function (event) {
        var text = "";
        try {
          text = String(event && (event.message || (event.error && event.error.message)) || "Unknown window error");
        } catch (_formatError) {
          text = "Unknown window error";
        }
        try {
          if (event && event.filename) {
            var parts = String(event.filename).split(/[\\/]/);
            var tail = parts[parts.length - 1] || String(event.filename);
            text += " @" + tail + ":" + Number(event.lineno || 0);
            if (event.colno) {
              text += ":" + Number(event.colno);
            }
          }
        } catch (_locationError) {}
        registerBootError(text);
      }, true);
    } catch (_error) {}
    try {
      window.addEventListener("unhandledrejection", function (event) {
        var reason = event ? event.reason : "";
        var text = "";
        try {
          text = reason && reason.message ? String(reason.message) : String(reason || "Unhandled promise rejection");
        } catch (_formatError) {
          text = "Unhandled promise rejection";
        }
        registerBootError(text);
      }, true);
    } catch (_error) {}
    try {
      overlayHeartbeatTimer = setInterval(function () {
        if (released) {
          clearInterval(overlayHeartbeatTimer);
          overlayHeartbeatTimer = 0;
          return;
        }
        state.readyState = document.readyState || state.readyState || "loading";
        renderOverlay(false);
      }, 1000);
    } catch (_error) {}
  }

  try {
    observer = new MutationObserver(function () {
      tick();
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id"]
    });
  } catch (_error) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else {
    tick();
  }

  [0, 50, 150, 400, 1000, 2500, 5000].forEach(function (ms) {
    setTimeout(tick, ms);
  });

  setTimeout(function () {
    if (released) {
      return;
    }
    if (diagEnabled) {
      updateDiag({
        message: "Boot prehide auto-released before the custom UI appeared",
        releaseReason: "timeout",
        readyState: document.readyState || state.readyState || "loading"
      });
      renderOverlay(true);
    }
    release("timeout");
  }, 15000);
})();

// Mirror Tampermonkey's page handle in MAIN world.
(function installUnsafeWindowAlias() {
  "use strict";

  try {
    Object.defineProperty(globalThis, "unsafeWindow", {
      configurable: true,
      writable: true,
      value: globalThis
    });
  } catch (_error) {
    try {
      globalThis.unsafeWindow = globalThis;
    } catch (_assignError) {}
  }
})();

// MAIN-world runtime shim: page code cannot use extension APIs directly.
(function installCrmCreateV11RuntimeShim() {
  "use strict";

  try {
    var MAIN_SOURCE = "crm-v11-main";
    var BRIDGE_SOURCE = "crm-v11-bridge";
    var nextMessageId = 1;
    var pending = Object.create(null);
    var baseChrome = globalThis.chrome && typeof globalThis.chrome === "object" ? globalThis.chrome : {};
    var baseRuntime = baseChrome.runtime && typeof baseChrome.runtime === "object" ? baseChrome.runtime : {};
    var runtime = {};

    Object.keys(baseRuntime).forEach(function (key) {
      try {
        runtime[key] = baseRuntime[key];
      } catch (_error) {}
    });

    runtime.lastError = null;
    runtime.sendMessage = function sendMessage(message, callback) {
      var id = "runtime-" + Date.now() + "-" + nextMessageId++;
      var done = false;
      var timer = setTimeout(function () {
        if (done) {
          return;
        }
        done = true;
        delete pending[id];
        runtime.lastError = { message: "CRM extension bridge timeout" };
        try {
          if (typeof callback === "function") {
            callback(undefined);
          }
        } finally {
          runtime.lastError = null;
        }
      }, 20000);

      pending[id] = {
        callback: callback,
        timer: timer
      };

      window.postMessage({
        source: MAIN_SOURCE,
        type: "runtime-send-message",
        id: id,
        message: message
      }, "*");
    };

    window.addEventListener("message", function (event) {
      if (event.source !== window) {
        return;
      }
      var data = event.data || {};
      if (!data || data.source !== BRIDGE_SOURCE || data.type !== "runtime-send-message-response") {
        return;
      }
      var record = pending[data.id];
      if (!record) {
        return;
      }
      delete pending[data.id];
      clearTimeout(record.timer);
      runtime.lastError = data.error ? { message: String(data.error) } : null;
      try {
        if (typeof record.callback === "function") {
          record.callback(data.response);
        }
      } finally {
        runtime.lastError = null;
      }
    });

    try {
      baseChrome.runtime = runtime;
    } catch (_error) {}
    try {
      Object.defineProperty(baseChrome, "runtime", {
        configurable: true,
        writable: true,
        value: runtime
      });
    } catch (_error) {}
    try {
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        writable: true,
        value: Object.assign({}, baseChrome, { runtime: runtime })
      });
    } catch (_error) {
      try {
        globalThis.chrome = Object.assign({}, baseChrome, { runtime: runtime });
      } catch (_assignError) {}
    }
  } catch (error) {
    try {
      console.error("[CRM v11 extension] runtime shim failed:", error);
    } catch (_error) {}
  }
})();

// Chrome extension compatibility layer for the original Tampermonkey script.
(function installCrmCreateV11TampermonkeyBridge() {
  "use strict";

  var MESSAGE_TYPE = "crm-v11-gm-xml-http-request";

  function deferThrow(error) {
    setTimeout(function () {
      throw error;
    }, 0);
  }

  function callCallback(callback, payload) {
    if (typeof callback !== "function") {
      return;
    }
    try {
      callback(payload);
    } catch (error) {
      deferThrow(error);
    }
  }

  function headersToObject(headers) {
    if (!headers || typeof headers !== "object") {
      return undefined;
    }
    var out = {};
    Object.keys(headers).forEach(function (key) {
      out[key] = String(headers[key]);
    });
    return out;
  }

  function headersToString(headers) {
    var lines = [];
    try {
      headers.forEach(function (value, key) {
        lines.push(key + ": " + value);
      });
    } catch (_error) {}
    return lines.join("\r\n");
  }

  function fallbackFetch(details, abortedRef) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timedOut = false;
    var timer = null;
    var timeout = Number(details.timeout || 0);
    if (controller && timeout > 0) {
      timer = setTimeout(function () {
        timedOut = true;
        controller.abort();
      }, timeout);
    }

    var method = String(details.method || "GET").toUpperCase();
    var init = {
      method: method,
      headers: headersToObject(details.headers),
      credentials: details.anonymous ? "omit" : "include",
      redirect: "follow"
    };
    if (controller) {
      init.signal = controller.signal;
    }
    if (method !== "GET" && method !== "HEAD" && details.data != null) {
      init.body = details.data;
    }

    fetch(details.url, init)
      .then(function (response) {
        return response.text().then(function (responseText) {
          return {
            status: response.status,
            statusText: response.statusText,
            responseText: responseText,
            response: responseText,
            finalUrl: response.url,
            responseHeaders: headersToString(response.headers),
            readyState: 4
          };
        });
      })
      .then(function (payload) {
        if (abortedRef.aborted) {
          return;
        }
        callCallback(details.onload, payload);
        callCallback(details.onloadend, payload);
      })
      .catch(function (error) {
        if (abortedRef.aborted) {
          return;
        }
        var payload = {
          status: 0,
          statusText: "",
          responseText: "",
          response: "",
          finalUrl: details.url,
          responseHeaders: "",
          readyState: 4,
          error: error && error.message ? error.message : String(error || "")
        };
        callCallback(timedOut ? details.ontimeout : details.onerror, payload);
        callCallback(details.onloadend, payload);
      })
      .finally(function () {
        if (timer) {
          clearTimeout(timer);
        }
      });
  }

  Object.defineProperty(globalThis, "GM_xmlhttpRequest", {
    configurable: true,
    writable: true,
    value: function GM_xmlhttpRequest(details) {
      details = details || {};
      if (!details.url) {
        throw new Error("GM_xmlhttpRequest: missing URL");
      }

      var abortedRef = { aborted: false };
      var requestDetails = {
        method: details.method || "GET",
        url: details.url,
        headers: headersToObject(details.headers),
        data: typeof details.data === "string" ? details.data : details.data == null ? null : String(details.data),
        timeout: details.timeout || 0,
        anonymous: Boolean(details.anonymous)
      };

      try {
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: MESSAGE_TYPE, details: requestDetails }, function (result) {
            if (abortedRef.aborted) {
              return;
            }
            if (chrome.runtime.lastError) {
              fallbackFetch(details, abortedRef);
              return;
            }
            if (!result) {
              callCallback(details.onerror, {
                status: 0,
                statusText: "",
                responseText: "",
                response: "",
                finalUrl: details.url,
                responseHeaders: "",
                readyState: 4,
                error: "No response from extension background"
              });
              return;
            }
            if (result.ok) {
              callCallback(details.onload, result.response);
              callCallback(details.onloadend, result.response);
              return;
            }
            callCallback(result.timeout ? details.ontimeout : details.onerror, result.response || {
              status: 0,
              statusText: "",
              responseText: "",
              response: "",
              finalUrl: details.url,
              responseHeaders: "",
              readyState: 4,
              error: result.error || "Request failed"
            });
            callCallback(details.onloadend, result.response);
          });
        } else {
          fallbackFetch(details, abortedRef);
        }
      } catch (_error) {
        fallbackFetch(details, abortedRef);
      }

      return {
        abort: function abort() {
          abortedRef.aborted = true;
        }
      };
    }
  });

  Object.defineProperty(globalThis, "GM_setClipboard", {
    configurable: true,
    writable: true,
    value: function GM_setClipboard(text) {
      text = String(text == null ? "" : text);
      try {
        window.postMessage({
          source: "crm-v11-main",
          type: "set-clipboard",
          text: text
        }, "*");
      } catch (_error) {}

      function fallbackCopy() {
        var textarea = document.createElement("textarea");
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
  });
})();
