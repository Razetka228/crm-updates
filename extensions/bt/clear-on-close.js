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

// «Добить» + уход с заявки на уточнении → городу «Клиент возможно свяжется позже» (реплей на ОТВЕТ
// согласования по этой заявке). Триггер — ЗАКРЫТИЕ вкладки / уход со страницы (НЕ смена статуса!),
// поэтому сам запрос шлёт фон (background.js) с keepalive — переживает закрытие. Здесь РЕГИСТРИРУЕМ во
// фоне «взведён/снят»: статус + служебный комментарий + город читаем прямо из DOM (изолир. мир видит DOM).
(function dobitReplyOnClose() {
    "use strict";
    var MSG = "crm-dobit-reply";
    var TEXT = "Клиент возможно свяжется позже";
    var last = undefined;
    function reqId() { try { var q = (new URL(location.href).searchParams.get("id") || ""); return /^\d+$/.test(q) ? q : ""; } catch (e) { return ""; } }
    function statusText() { var s = ""; try { var b = document.querySelector(".crm-status-badge .badge-text, .crm-status-badge"); s = (b && (b.textContent || "")) || ""; } catch (e) {} return String(s).toLowerCase().replace(/\s+/g, " "); }
    function svcComment() { try { var el = document.querySelector('textarea[name="CustomerRequest[comments_service]"], #customerrequest-comments_service, textarea[name*="comments_service"]'); return el ? String(el.value || "") : ""; } catch (e) { return ""; } }
    function reqCity() { try { var el = document.getElementById("select2-customerrequest-city_id-container"); if (el) { var c = String(el.textContent || "").trim(); if (c.indexOf("(") !== -1) c = c.split("(")[0].trim(); if (c && !/^выбер/i.test(c)) return c; } var s = document.querySelector('select[name="CustomerRequest[city_id]"], #customerrequest-city_id'); if (s && s.options && s.options[s.selectedIndex]) { var c2 = String(s.options[s.selectedIndex].text || "").trim(); if (c2.indexOf("(") !== -1) c2 = c2.split("(")[0].trim(); if (c2 && !/^выбер/i.test(c2)) return c2; } } catch (e) {} return ""; }
    function push() {
        var rid = reqId();
        var on = !!rid && statusText().indexOf("уточнен") !== -1 && svcComment().toLowerCase().indexOf("добить") !== -1;
        var data = on ? { requestId: rid, city: reqCity(), text: TEXT } : null;
        var key = data ? JSON.stringify(data) : "OFF";   // "OFF" — снят; шлём И на старте/перезагрузке, чтобы СБРОСИТЬ протухшую регистрацию (создал/неоформлено → статус уже не «уточнение»)
        if (key === last) return;
        last = key;
        try { chrome.runtime.sendMessage({ type: MSG, data: data }); } catch (e) {}
    }
    push();
    setInterval(push, 700);
    window.addEventListener("pagehide", push);
})();
