// ==UserScript==
// @name         CRM Loader: Кнопка партнера или листовки
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Загрузчик: тянет актуальный код кнопки источника с GitHub при каждой загрузке страницы. Правится только payload на GitHub, loader не меняется.
// @author       Razetka228
// @match        https://kp-lead-centre.ru/admin/domain/customer/update?id*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const PAYLOAD_URL = 'https://raw.githubusercontent.com/Razetka228/crm-updates/main/partner-leaflet-button.payload.js';

    function runPayload(code) {
        try {
            // GM_setClipboard передаём в payload параметром — new Function не видит замыкание loader-а.
            const factory = new Function('GM_setClipboard', code);
            factory.call(window, (typeof GM_setClipboard !== 'undefined') ? GM_setClipboard : null);
        } catch (error) {
            console.error('[CRM Loader] Ошибка выполнения кода payload:', error);
        }
    }

    GM_xmlhttpRequest({
        method: 'GET',
        // Метка времени сбивает CDN-кэш GitHub, чтобы код был всегда свежий.
        url: PAYLOAD_URL + '?_=' + Date.now(),
        headers: { 'Cache-Control': 'no-cache' },
        onload: function(res) {
            if (res.status >= 200 && res.status < 300 && res.responseText) {
                runPayload(res.responseText);
            } else {
                console.error('[CRM Loader] Не удалось загрузить payload, HTTP', res.status);
            }
        },
        onerror: function(err) {
            console.error('[CRM Loader] Сеть недоступна при загрузке payload:', err);
        }
    });
})();
