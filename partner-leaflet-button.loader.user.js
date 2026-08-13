// ==UserScript==
// @name         CRM Loader: Кнопка партнера или листовки
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Загрузчик (stale-while-revalidate): мгновенно запускает код из локального кэша, свежий тянет с GitHub в фоне и применяет со следующей загрузки страницы. Правится только payload на GitHub.
// @author       Razetka228
// @match        https://kp-lead-centre.ru/admin/domain/customer/update?id*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const PAYLOAD_URL = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/partner-leaflet-button.payload.js';
    const CACHE_KEY = 'crm_payload_partner_leaflet_v1';

    function runPayload(code) {
        try {
            // GM_setClipboard передаём параметром — new Function не видит замыкание loader-а.
            const factory = new Function('GM_setClipboard', code);
            factory.call(window, (typeof GM_setClipboard !== 'undefined') ? GM_setClipboard : null);
        } catch (error) {
            console.error('[CRM Loader] Ошибка выполнения payload:', error);
        }
    }

    // 1) МГНОВЕННО: запускаем последнюю сохранённую версию из локального кэша, без ожидания сети.
    let cached = '';
    try { cached = GM_getValue(CACHE_KEY, ''); } catch (e) {}

    let ranFromCache = false;
    if (cached) {
        runPayload(cached);
        ranFromCache = true;
    }

    // 2) В ФОНЕ: тянем свежий код с GitHub и сохраняем на следующий раз.
    //    Если кэша ещё не было (первый запуск) — запускаем сразу.
    GM_xmlhttpRequest({
        method: 'GET',
        url: PAYLOAD_URL,
        onload: function(res) {
            if (res.status >= 200 && res.status < 300 && res.responseText) {
                const fresh = res.responseText;
                try { GM_setValue(CACHE_KEY, fresh); } catch (e) {}
                if (!ranFromCache) {
                    runPayload(fresh);
                }
            } else if (!ranFromCache) {
                console.error('[CRM Loader] Не удалось загрузить payload, HTTP', res.status);
            }
        },
        onerror: function(err) {
            if (!ranFromCache) {
                console.error('[CRM Loader] Сеть недоступна и кэша нет:', err);
            }
        }
    });
})();
