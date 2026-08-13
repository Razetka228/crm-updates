// ==UserScript==
// @name         Фикс базы + ахк (loader КП)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Loader «Фикс базы + ахк» (КП): мгновенно из локального кэша + фон-обновление с GitHub (условный запрос по ETag, троттлинг 5 мин). Правится только payload на GitHub, loader почти не меняется.
// @author       Razetka228
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/update*
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/create*
// @match        https://kp-lead-centre.ru/admin/domain/customer/update*
// @match        https://kp-lead-centre.ru/admin/domain*
// @match        https://yandex.ru/maps/*
// @include      /^https:\/\/([a-z0-9-]+\.)*yandex\.[a-z.]+\/maps/
// @match        https://kp-lead-centre.ru/admin/domain/request-audit/update*
// @match        https://kp-lead-centre.ru/admin/domain/request-audit/index*
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/index*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      nominatim.openstreetmap.org
// @connect      num.voxlink.ru
// @connect      htmlweb.ru
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Razetka228/crm-updates/main/fix-ahk-kp.loader.user.js
// @downloadURL  https://raw.githubusercontent.com/Razetka228/crm-updates/main/fix-ahk-kp.loader.user.js
// ==/UserScript==

(function() {
    'use strict';

    var PAYLOAD_URL = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/fix-ahk-kp.payload.js';
    var K_CODE = 'crm_fix_ahk_kp_code_v1';
    var K_ETAG = 'crm_fix_ahk_kp_etag_v1';
    var K_TS   = 'crm_fix_ahk_kp_ts_v1';
    var MIN_INTERVAL_MS = 5 * 60 * 1000; // GitHub всё равно кэширует 5 мин — чаще дёргать смысла нет

    function nowMs() { try { return Date.now(); } catch (e) { return 0; } }

    // Запуск payload: все GM-функции + unsafeWindow пробрасываем параметрами,
    // т.к. new Function не видит замыкание loader-а.
    function runPayload(code) {
        try {
            var factory = new Function(
                'GM_addStyle', 'GM_setClipboard', 'GM_setValue', 'GM_getValue',
                'GM_addValueChangeListener', 'GM_xmlhttpRequest', 'GM_openInTab',
                'GM_info', 'unsafeWindow',
                code
            );
            factory(
                GM_addStyle, GM_setClipboard, GM_setValue, GM_getValue,
                GM_addValueChangeListener, GM_xmlhttpRequest, GM_openInTab,
                (typeof GM_info !== 'undefined' ? GM_info : undefined),
                (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window)
            );
        } catch (e) {
            console.error('[Фикс loader КП] Ошибка выполнения payload:', e);
        }
    }

    // 1) МГНОВЕННО: последняя сохранённая версия из локального кэша (синхронно, на document-start).
    var cached = '';
    try { cached = GM_getValue(K_CODE, ''); } catch (e) {}
    var ranFromCache = false;
    if (cached) {
        runPayload(cached);
        ranFromCache = true;
    }

    // 2) Троттлинг: если кэш есть и недавно проверяли — сеть вообще не трогаем.
    var lastTs = 0;
    try { lastTs = Number(GM_getValue(K_TS, 0)) || 0; } catch (e) {}
    var t = nowMs();
    if (ranFromCache && t && (t - lastTs) < MIN_INTERVAL_MS) {
        return;
    }

    // 3) ФОН: условный запрос по ETag — если payload не менялся, придёт 304 без тела (трафик не тратим).
    var etag = '';
    try { etag = GM_getValue(K_ETAG, ''); } catch (e) {}

    var headers = {};
    if (etag && cached) {
        headers['If-None-Match'] = etag;
    }

    GM_xmlhttpRequest({
        method: 'GET',
        url: PAYLOAD_URL,
        headers: headers,
        onload: function(res) {
            try { GM_setValue(K_TS, nowMs()); } catch (e) {}

            if (res.status === 304) {
                return; // не изменилось
            }

            if (res.status >= 200 && res.status < 300 && res.responseText) {
                var fresh = res.responseText;
                try { GM_setValue(K_CODE, fresh); } catch (e) {}

                var newEtag = '';
                try {
                    var m = (res.responseHeaders || '').match(/etag:\s*(.+)/i);
                    if (m) newEtag = m[1].trim();
                } catch (e) {}
                if (newEtag) { try { GM_setValue(K_ETAG, newEtag); } catch (e) {} }

                // Если кэша не было (первый запуск) — запускаем сразу.
                if (!ranFromCache) {
                    runPayload(fresh);
                }
            } else if (!ranFromCache) {
                console.error('[Фикс loader КП] Не удалось загрузить payload, HTTP', res.status);
            }
        },
        onerror: function(err) {
            if (!ranFromCache) {
                console.error('[Фикс loader КП] Сеть недоступна и кэша нет:', err);
            }
        }
    });
})();
