// Content-script моста для очистки поиска при уходе с заявки/закрытии вкладки.
// Работает в ИЗОЛИРОВАННОМ мире (нужен chrome.runtime). Читает активный поиск,
// который Фикс+ахк (>=26.25) кладёт в DOM-атрибут data-crm-clear-active (фолбэк localStorage),
// и передаёт фону. Фон (background.js) чистит при уходе/закрытии.

(function () {
    "use strict";

    var DOM_ATTR = "data-crm-clear-active";
    var LS_KEY = "crm_clear_active_v1";
    var MSG = "crm-clear-active";
    var last = undefined;

    function readActive() {
        var raw = null;
        try { raw = document.documentElement.getAttribute(DOM_ATTR); } catch (e) {}
        if (!raw) { try { raw = localStorage.getItem(LS_KEY); } catch (e) {} }
        if (!raw) return null;
        try {
            var o = JSON.parse(raw);
            if (!o || !o.city) return null;
            return { requestId: String(o.requestId || ""), city: String(o.city || ""), global: !!o.global };
        } catch (e) {
            return null;
        }
    }

    function push() {
        var cur = readActive();
        var key = cur ? JSON.stringify(cur) : null;
        if (key === last) return;
        // На старте/перезагрузке не снимаем регистрацию (она переживает reload в фоне).
        if (key === null && last === undefined) return;
        last = key;
        try { chrome.runtime.sendMessage({ type: MSG, data: cur }); } catch (e) {}
    }

    push();
    setInterval(push, 700);
    window.addEventListener("pagehide", push);
})();
