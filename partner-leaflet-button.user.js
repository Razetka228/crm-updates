// ==UserScript==
// @name         Кнопка партнера или листовки
// @namespace    http://tampermonkey.net/
// @version      1.0.4
// @description  Добавляет на странице клиента кнопку рядом с "Добавить заявку" и показывает партнера или листовку по параметрам ссылки
// @author       GPT-5.4
// @match        https://kp-lead-centre.ru/admin/domain/customer/update?id*
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Razetka228/crm-updates/main/partner-leaflet-button.user.js
// @downloadURL  https://raw.githubusercontent.com/Razetka228/crm-updates/main/partner-leaflet-button.user.js
// ==/UserScript==

(function() {
    'use strict';

    const BUTTON_ID = 'tm-customer-source-button';
    const WRAPPER_ID = 'tm-customer-source-button-wrap';
    const STYLE_ID = 'tm-customer-source-button-style';
    const CACHE_KEY = 'tm-customer-source-reference-v1';
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    const CREATE_URL = '/admin/domain/customer-request/create';

    function normalize(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function shorten(text, maxLength) {
        const value = normalize(text);
        if (value.length <= maxLength) return value;
        return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BUTTON_ID},
            #${BUTTON_ID}:hover,
            #${BUTTON_ID}:active,
            #${BUTTON_ID}:focus {
                transform: none !important;
                transition: none !important;
                animation: none !important;
                box-shadow: none !important;
                filter: none !important;
                text-shadow: none !important;
                outline: none !important;
                background-image: none !important;
                background-repeat: no-repeat !important;
            }
        `;

        document.head.appendChild(style);
    }

    function lockVisualState(button, sourceButton) {
        if (!button || button.dataset.tmVisualLocked === '1') return;

        const sourceStyles = window.getComputedStyle(sourceButton);
        const baseline = {
            background: sourceStyles.background,
            backgroundColor: sourceStyles.backgroundColor,
            border: sourceStyles.border,
            borderColor: sourceStyles.borderColor,
            color: sourceStyles.color,
            boxShadow: 'none',
            textShadow: 'none',
            outline: 'none',
            filter: 'none',
            transform: 'none',
            transition: 'none',
            animation: 'none'
        };

        const applyBaseline = function() {
            Object.assign(button.style, baseline);
        };

        applyBaseline();
        button.dataset.tmVisualLocked = '1';

        ['mouseenter', 'mouseleave', 'mousedown', 'mouseup', 'focus', 'blur'].forEach(function(eventName) {
            button.addEventListener(eventName, applyBaseline);
        });
    }

    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.savedAt || !parsed.data) return null;
            if ((Date.now() - parsed.savedAt) > CACHE_TTL) return null;

            return parsed.data;
        } catch (error) {
            return null;
        }
    }

    function writeCache(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                data
            }));
        } catch (error) {}
    }

    function mapOptions(select) {
        const result = {};

        if (!select) {
            return result;
        }

        Array.from(select.options).forEach(function(option) {
            const value = normalize(option.value);
            const text = normalize(option.text);
            if (!value || !text) return;
            result[value] = text;
        });

        return result;
    }

    async function fetchReferenceData() {
        const cached = readCache();
        if (cached) {
            return cached;
        }

        const response = await fetch(CREATE_URL, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Не удалось открыть ${CREATE_URL}: ${response.status}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const data = {
            partners: mapOptions(doc.querySelector('select[name="CustomerRequest[partner_id]"]')),
            adverts: mapOptions(doc.querySelector('select[name="CustomerRequest[advert_id]"]'))
        };

        writeCache(data);
        return data;
    }

    function getSourceParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            partnerId: normalize(params.get('partner_id')),
            advertId: normalize(params.get('advert_id'))
        };
    }

    function buildSourceInfo(referenceData) {
        const params = getSourceParams();

        if (params.partnerId) {
            const partnerNumber = referenceData.partners[params.partnerId] || '';
            return {
                kind: 'partner',
                text: partnerNumber ? `Партнер: ${partnerNumber}` : `Партнер ID: ${params.partnerId}`,
                fullText: partnerNumber ? `Партнер: ${partnerNumber}` : `Партнер не найден, partner_id=${params.partnerId}`,
                copyText: partnerNumber || params.partnerId
            };
        }

        if (params.advertId) {
            const advertName = referenceData.adverts[params.advertId] || '';
            return {
                kind: 'advert',
                text: advertName ? `Листовка: ${shorten(advertName, 34)}` : `Листовка ID: ${params.advertId}`,
                fullText: advertName ? `Листовка: ${advertName}` : `Листовка не найдена, advert_id=${params.advertId}`,
                copyText: advertName || params.advertId
            };
        }

        return null;
    }

    function copyText(text) {
        if (!text) return;

        try {
            GM_setClipboard(text);
            return;
        } catch (error) {}

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function() {});
        }
    }

    function findAddRequestButton() {
        const candidates = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));

        let best = null;
        let bestScore = -1;

        candidates.forEach(function(element) {
            const text = normalize(element.textContent || element.value || '');
            const href = normalize(element.getAttribute('href') || '');
            let score = 0;

            if (text.includes('Добавить заявку')) score += 10;
            if (href.includes('/customer-request/create')) score += 8;
            if (href.includes('customer_id=')) score += 4;
            if (element.className && String(element.className).includes('btn')) score += 2;

            if (score > bestScore) {
                best = element;
                bestScore = score;
            }
        });

        return bestScore > 0 ? best : null;
    }

    function createSourceButton(sourceButton) {
        if (document.getElementById(BUTTON_ID)) {
            return document.getElementById(BUTTON_ID);
        }

        let wrapper = document.getElementById(WRAPPER_ID);
        if (!wrapper) {
            wrapper = document.createElement('span');
            wrapper.id = WRAPPER_ID;
            wrapper.style.display = 'inline-flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '8px';
            wrapper.style.flexWrap = 'nowrap';

            sourceButton.parentNode.insertBefore(wrapper, sourceButton);
            wrapper.appendChild(sourceButton);
        }

        const tagName = sourceButton.tagName.toLowerCase() === 'a' ? 'a' : 'button';
        const button = document.createElement(tagName);
        button.id = BUTTON_ID;
        button.className = sourceButton.className;
        button.style.marginRight = '0';
        button.style.whiteSpace = 'nowrap';
        button.style.maxWidth = '360px';
        button.style.overflow = 'hidden';
        button.style.textOverflow = 'ellipsis';

        if (tagName === 'a') {
            button.href = 'javascript:void(0)';
        } else {
            button.type = 'button';
        }

        wrapper.insertBefore(button, sourceButton);
        lockVisualState(button, sourceButton);
        return button;
    }

    function setButtonState(button, text, title) {
        button.textContent = text;
        button.title = title || text;
    }

    async function renderButton() {
        const sourceButton = findAddRequestButton();
        if (!sourceButton || !sourceButton.parentNode) {
            return false;
        }

        const params = getSourceParams();
        if (!params.partnerId && !params.advertId) {
            return true;
        }

        const button = createSourceButton(sourceButton);
        setButtonState(button, 'Определяю источник...', 'Определяю источник заявки');

        try {
            const referenceData = await fetchReferenceData();
            const info = buildSourceInfo(referenceData);

            if (!info) {
                button.remove();
                return true;
            }

            setButtonState(button, info.text, info.fullText);
            button.onclick = function(event) {
                event.preventDefault();
                copyText(info.copyText);
            };
        } catch (error) {
            setButtonState(button, 'Источник не найден', String(error && error.message ? error.message : error));
            button.onclick = function(event) {
                event.preventDefault();
            };
            console.error('[TM] Ошибка определения источника:', error);
        }

        return true;
    }

    function init() {
        ensureStyles();

        let isRendering = false;

        const tryRender = function() {
            if (isRendering) return;
            isRendering = true;

            Promise.resolve(renderButton()).finally(function() {
                isRendering = false;
            });
        };

        tryRender();

        const observer = new MutationObserver(function() {
            tryRender();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
