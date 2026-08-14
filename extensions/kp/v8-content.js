// ==UserScript==
// @name         KP Lead Centre CRM v8 (Live Redesign) до расширения 12124142
// @namespace    https://kp-lead-centre.ru/
// @version      3.1.108
// @description  Интерфейс crm_v8.html с живыми данными из таблицы #cr-grid-table.
// @author       Codex
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/index*
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/create*
// @match        https://kp-lead-centre.ru/admin/domain/customer-request/update*
// @noframes
// @run-at       document-idle
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';
  try{console.log('[v8 KP type-patch 3.1.104] patchModerationCardInPlace теперь патчит .tag-fixed — тип заявки (Повтор/Гарантия) обновляется на главной in-place без перезагрузки');}catch(_){}
  try{console.log('[v8 KP bulk-source 3.1.105] «Поиск номера»: строки «N партнер» / «Город (описание)» запоминаются по номеру → при Создать/Добавить заявку источник передаётся в новую вкладку');}catch(_){}

  const COPY_FILE_DIAG_BUILD = 'copy-file-2026-06-28-011';
  function markCopyFileDebug(stage, extra = {}) {
    const payload = {
      build: COPY_FILE_DIAG_BUILD,
      stage,
      path: location.pathname,
      search: location.search,
      at: Date.now(),
      ...extra
    };
    try { window.__tmCrmV8CopyFileDebug = payload; } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-build', COPY_FILE_DIAG_BUILD); } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-stage', String(stage || '')); } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-request-id', String(extra.requestId || '')); } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-value', String(extra.value || '')); } catch (_error) {}
    try { localStorage.setItem('tm-crm-v8-copy-build', JSON.stringify(payload)); } catch (_error) {}
  }
  markCopyFileDebug('main-entry');

  // Never run redesign logic inside iframes (prevents recursive self-injection).
  if (window.top !== window.self) return;
  if (!location.pathname.includes('/customer-request/index')) {
    markCopyFileDebug('main-skip-non-index');
    return;
  }

  const HOST_ID = 'tm-crm-v8-live-host';
  const STYLE_ID = 'tm-crm-v8-live-style';
  const ICON_ID = 'tm-crm-v8-icons';
  const GRID_SELECTOR = '#cr-index-grid';
  const TABLE_SELECTOR = '#cr-grid-table, table';
  const HIDDEN_NATIVE_ATTR = 'data-tm-crm-v8-hidden';
  const DISPATCHER_REPORT_URL = '/admin/domain/report-dispatcher/index';
  const CUSTOMER_DIRECTORY_URL = '/admin/domain/customer/index';
  const OPEN_ALL_NUMBERS_MARKER = 'tm_open_all_numbers';
  const V8_TYPE_LOOKUP_MARKER = 'tm_v8_type_lookup';
  const CREATE_PHONE_PENDING_KEY = '__tm_create_phone_pending_v1';
  const BULK_SAVED_NUMBERS_KEY = 'tm_bulk_saved_numbers_v1';
  const BULK_SOURCE_MAP_KEY = 'tm_bulk_phone_src_v1';               // карта номер→источник (партнёр/листовка)
  const BULK_CALL_SIP_KEY = 'tm_bulk_call_sip_v1';                  // KP: карта номер→sip для звонка (по «Источник:»)
  const CREATE_SOURCE_PENDING_KEY = '__tm_create_source_pending_v1'; // передача источника в новую вкладку create
  const THEME_STORAGE_KEY = 'tm-crm-v8-theme-v1';
  const SHARED_THEME_STORAGE_KEY = 'tm-crm-theme-v1';
  const SHARED_THEME_EVENT = 'tm-crm-theme-change';
  const SCRIPT_SETTINGS_AUTO_MENU_DISABLED = 'disabled';
  const SCRIPT_SETTINGS_DEFAULT_AUTO_MENU_DAY = 5;
  const SCHEDULE_MENU_SHOW_HOUR = 8;

  // Троттлинг кнопок звонка: не чаще 1 звонка в секунду, спам-клики глушим (звонки не стакаются).
  (function installCallClickThrottle(){
    try{
      if (window.__tmCallClickThrottleInstalled) return;
      window.__tmCallClickThrottleInstalled = true;
      var THROTTLE_MS = 1000;
      var lastCallAt = 0;
      function isCallTarget(el){
        try{
          if (!el || !el.closest) return null;
          var byClass = el.closest('.tm-cu-phone-call-btn, .tm-mod-phone-call-btn, .bulk-call-btn, .call-btn');
          if (byClass) return byClass;
          var a = el.closest('a[href]');
          if (a){
            var h = String(a.getAttribute('href') || '').trim().toLowerCase();
            if (h.indexOf('callto:') === 0 || h.indexOf('tel:') === 0) return a;
          }
          return null;
        }catch(_){ return null; }
      }
      document.addEventListener('click', function(e){
        try{
          if (!e.isTrusted) return;              // программные клики (сам набор номера) не трогаем
          if (!isCallTarget(e.target instanceof Element ? e.target : null)) return;
          var now = Date.now();
          if (now - lastCallAt < THROTTLE_MS){    // слишком часто — глушим повторный звонок
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            return;
          }
          lastCallAt = now;
        }catch(_){}
      }, true);
    }catch(_){}
  })();
  const MODERATION_NO_ANSWER_CACHE_KEY = 'tm-crm-v8-moderation-no-answer-time-cache-v1';
  const MODERATION_NO_ANSWER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MODERATION_CALL_CHECK_TTL_MS = 30 * 1000;
  const MODERATION_CALL_FETCH_TIMEOUT_MS = 8000;
  const MODERATION_CALL_CHECK_CONCURRENCY = 6;
  const MODERATION_COUNT_CACHE_KEY = 'tm-moderation-count-cache-v1';
  const MODERATION_COUNT_CACHE_TTL_MS = 2 * 60 * 1000;
  const MAIN_MODERATION_ARRIVAL_CACHE_KEY = 'tm-main-moderation-arrival-cache-v6';
  const MAIN_MODERATION_ARRIVAL_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
  const MAIN_MODERATION_ARRIVAL_TOUCH_INTERVAL_MS = 60 * 1000;
  const MAIN_MODERATION_MISSING_GRACE_MS = 0;
  const MODERATION_VIEW_REFRESH_MS = 5000;
  const BULK_PHONES_REFRESH_MS = 60 * 1000;
  const MODERATION_COUNT_REFRESH_MS = 60000;
  const MODERATION_MAX_PAGES = 30;
  const CLARIFY_AWAIT_CACHE_KEY = 'tm-clarify-await-click-time-cache-v1';
  const CLARIFY_AWAIT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const CLARIFY_ROUTE_CACHE_KEY = 'tm-clarify-route-flags-cache-v1';
  const CLARIFY_ROUTE_CACHE_TTL_MS = 60 * 1000;
  const CLARIFY_ROUTE_CHECK_CONCURRENCY = 3;
  const MODERATION_SYNC_CHANNEL_NAME = 'tm-crm-v8-moderation-sync-v1';
  const MODERATION_LIVE_SIGNAL_KEY = 'tm-crm-v8-moderation-live-sync-signal-v1';
  const CLARIFY_SUBSTATE_HOLD_MS = 300;       // обычное -> соглас/? и соглас <-> ? (почти мгновенно: вверх метка не флейкует)
  const CLARIFY_SUBSTATE_DEMOTE_MS = 3500;    // соглас/? -> обычное (запас против пропадания метки при рефреше таблицы, но втрое быстрее прежних 10с)
  const CLARIFY_SUBSTATE_STATE_KEY = 'tm-clarify-substate-shown-v1';   // сохранённый подстатус (переживает уход/возврат на главную)
  const CLARIFY_SUBSTATE_STATE_TTL_MS = 12 * 60 * 60 * 1000;           // 12ч (согласование живёт часами)

  if (window.__tmCrmV8LiveRedesign) return;
  window.__tmCrmV8LiveRedesign = true;
  markCopyFileDebug('main-activated');

  // Удержание подстатуса уточнения «(соглас)»/«?» против мигания (см. applyClarifySubstateHold).
  // Показываемый подстатус хранится в localStorage (переживает навигацию), ожидания перехода — в памяти.
  const clarifySubstateShownMemo = { at: 0, data: null };
  const clarifySubstatePending = new Map();
  let clarifyHoldReleaseTimer = 0;
  // Момент, когда вкладка стала активной. Демоут «(соглас)/?»→обычное считаем только по
  // активному времени: пока вкладка скрыта, фоновые перепарсы шлют plain (без клиентской
  // метки) и старый таймер иначе схлопывал бы подстатус за простой → при возврате мигание.
  let clarifyBecameVisibleAt = Date.now();
  function isDocHidden() { try { return typeof document !== 'undefined' && document.hidden === true; } catch (_e) { return false; } }
  try {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () { if (!document.hidden) clarifyBecameVisibleAt = Date.now(); });
    }
  } catch (_e) {}

  const state = {
    rows: [],
    hideNative: true,
    forceTopOnNextCardsRender: false,
    filters: {
      id: '',
      city: '',
      status: '',
      type: '',
      phone: '',
      author: '',
      addressCity: '',
      street: '',
      house: '',
      flat: ''
    },
    observer: null,
    syncTimer: 0,
    hiddenBulkPhones: null,
    remote: {
      kind: '',
      id: '',
      rows: null,
      loading: false,
      bulkPhoneTotal: 0,
      bulkPhoneDone: 0,
      timer: 0,
      seq: 0,
      moderationRowsSig: '',
      moderationRowsFetchAt: 0,
      dispatcherReportUrl: '',
      dispatcherReportHtml: '',
      dispatcherReportSig: '',
      dispatcherReportLoading: false,
      dispatcherReportError: '',
      dispatcherReportLoadedAt: 0,
      customerDirectoryUrl: '',
      customerDirectoryHtml: '',
      customerDirectorySig: '',
      customerDirectoryLoading: false,
      customerDirectoryError: '',
      customerDirectoryLoadedAt: 0,
      personalModeError: '',
      filterBaseUrl: '',
      filterSection: 'all',
      filterPage: 1,
      filterTotalPages: 0,
      filterTotalLoading: false
    },
    moderationCount: null,
    moderationCountAt: 0,
    moderationRowsRefreshAt: 0,
    mainScanSeq: 0,
    mainScanSig: '',
    mainScanAt: 0,
    autoCleanupMenuDay: SCRIPT_SETTINGS_DEFAULT_AUTO_MENU_DAY,
    autoCleanupPanelOpen: false,
    autoCleanupNeedsAttention: false
  };
  const moderationNoAnswerCacheMemo = {
    readAt: 0,
    data: {}
  };
  const mainModerationArrivalCacheMemo = {
    loaded: false,
    readAt: 0,
    data: {}
  };
  const moderationCallCheckPending = new Map();
  const moderationCallStateById = new Map();
  let moderationCallCheckRunSeq = 0;
  let moderationCallCheckActiveRunSeq = 0;
  let moderationCallRenderTimer = 0;
  let moderationLiveSignalStamp = '';
  const moderationSyncChannel = (() => {
    try {
      return typeof BroadcastChannel === 'function'
        ? new BroadcastChannel(MODERATION_SYNC_CHANNEL_NAME)
        : null;
    } catch (_error) {
      return null;
    }
  })();
  const clarifyAwaitCacheMemo = {
    readAt: 0,
    data: {}
  };
  const clarifyRouteCacheMemo = {
    readAt: 0,
    data: {}
  };
  const clarifyRouteCheckPending = new Map();
  let clarifyRouteRenderTimer = 0;
  const bulkPhoneUiState = {
    ctrlDown: false,
    clipboardPhones: [],
    savedPhones: [],
    lastClipboardSyncAt: 0,
    buttonMessage: '',
    buttonMessageTimer: 0
  };
  const reportHotkeyState = {
    ctrlDown: false,
    metaDown: false
  };
  const dispatcherReportViewState = {
    query: '',
    sort: 'accepted',
    filtersOpen: false,
    data: null,
    currentUserName: ''
  };
  const dispatcherCalendarState = {
    node: null,
    input: null,
    anchor: null,
    year: 0,
    month: 0,
    view: 'days',
    yearPageStart: 0,
    outsideHandler: null
  };
  const bulkCalledPhones = new Set();
  const bulkCustomerLinksCache = new Map();
  const bulkCustomerLinksPending = new Map();

  const statusClassMap = {
    mod: { accent: 'ac-mod', pill: 's-mod' },
    wait: { accent: 'ac-wait', pill: 's-wait' },
    road: { accent: 'ac-road', pill: 's-road' },
    work: { accent: 'ac-work', pill: 's-work' },
    worksd: { accent: 'ac-worksd', pill: 's-worksd' },
    canceled: { accent: 'ac-canceled', pill: 's-canceled' },
    reject: { accent: 'ac-reject', pill: 's-reject' },
    ready: { accent: 'ac-ready', pill: 's-ready' },
    notcreated: { accent: 'ac-notcreated', pill: 's-notcreated' },
    cl: { accent: 'ac-cl', pill: 's-cl' }
  };

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getInitials(name) {
    const parts = normalizeText(name).split(/\s+/).filter(Boolean).slice(0, 2);
    if (!parts.length) return '--';
    return parts.map((part) => part.charAt(0).toUpperCase()).join('');
  }

  function detectStatusKey(raw) {
    const status = normalizeText(raw).toLowerCase();
    if (status.includes('не создан')) return 'notcreated';
    if (status.includes('готов')) return 'ready';
    if (status.includes('в работе сд')) return 'worksd';
    if (status.includes('в работе')) return 'work';
    if (status.includes('отказ')) return 'reject';
    if (status.includes('отмена кц') || status.includes('отмена филиала') || status.includes('не оформлена') || status.includes('не оформлен')) return 'canceled';
    if (status.includes('модерац')) return 'mod';
    if (status.includes('ожида')) return 'wait';
    if (status.includes('в пути')) return 'road';
    return 'cl';
  }

  function getTagClass(type) {
    const t = normalizeText(type).toLowerCase();
    if (t.includes('гарант')) return 'tag tag-war';
    if (t.includes('повтор')) return 'tag tag-rep';
    return 'tag';
  }

  function isWaitOrRoadStatusKey(statusKey) {
    return statusKey === 'wait' || statusKey === 'road';
  }

  function isMainOnCallRow(row) {
    return isWaitOrRoadStatusKey(row?.statusKey) && Boolean(row?.isAwaitOnlyGreen);
  }

  function getMainDisplayRank(row) {
    if (row?.statusKey === 'mod') return -1;
    const status = normalizeText(row?.status || '').toLowerCase();
    const isClarify = status.includes('уточн');
    if (isClarify) return 0;
    if (isMainOnCallRow(row)) return 1;
    if (isWaitOrRoadStatusKey(row?.statusKey)) return 2;
    return 3;
  }

  function isMainClarifyRow(row) {
    const status = normalizeText(row?.status || '').toLowerCase();
    return status.includes('уточн');
  }

  function isMainLeftColumnRow(row) {
    return row?.statusKey === 'mod' || isMainClarifyRow(row);
  }

  function getRowCreatedSortTime(row) {
    const candidates = [
      row?.created,
      row?.createdFull,
      row?.reqDateTime
    ];
    for (const value of candidates) {
      const text = normalizeText(value || '');
      if (!text || text === '—') continue;
      const match = text.match(/(\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2})/);
      if (!match) continue;
      const ts = parseRuDateTimeToMillis(match[1]);
      if (Number.isFinite(ts)) return ts;
    }
    return 0;
  }

  function compareRowsByCreatedDesc(a, b) {
    const at = getRowCreatedSortTime(a);
    const bt = getRowCreatedSortTime(b);
    if (at !== bt) return bt - at;

    const aid = getRowSortId(a);
    const bid = getRowSortId(b);
    if (aid !== bid) return bid - aid;
    return normalizeText(b?.id || '').localeCompare(normalizeText(a?.id || ''), 'ru');
  }

  function getRowSourceOrder(row) {
    const value = Number(row?.sourceIndex);
    return Number.isFinite(value) ? value : null;
  }

  function readMainModerationArrivalCacheMap() {
    if (mainModerationArrivalCacheMemo.loaded) {
      return mainModerationArrivalCacheMemo.data || {};
    }

    const now = Date.now();
    let parsed = {};
    try {
      const raw = localStorage.getItem(MAIN_MODERATION_ARRIVAL_CACHE_KEY);
      const json = raw ? JSON.parse(raw) : {};
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        parsed = json;
      }
    } catch (_error) {
      parsed = {};
    }

    const next = {};
    Object.entries(parsed).forEach(([rawId, entry]) => {
      const id = normalizeRequestId(rawId);
      if (!id) return;
      const firstSeenAt = Number(entry?.enteredAt || entry?.firstSeenAt || entry?.seenAt || entry?.updatedAt || 0);
      const lastSeenAtRaw = Number(entry?.lastSeenAt || entry?.updatedAt || firstSeenAt || 0);
      const lastSeenAt = Number.isFinite(lastSeenAtRaw) && lastSeenAtRaw > 0 ? lastSeenAtRaw : firstSeenAt;
      if (!Number.isFinite(firstSeenAt) || firstSeenAt <= 0) return;
      if (!lastSeenAt || (now - lastSeenAt) > MAIN_MODERATION_ARRIVAL_CACHE_TTL_MS) return;
      next[id] = {
        enteredAt: firstSeenAt,
        lastSeenAt,
        visible: entry?.visible !== false,
        processingState: normalizeText(entry?.processingState || '').toLowerCase(),
        missingSince: Number(entry?.missingSince || 0) > 0 ? Number(entry.missingSince) : 0
      };
    });

    mainModerationArrivalCacheMemo.loaded = true;
    mainModerationArrivalCacheMemo.readAt = now;
    mainModerationArrivalCacheMemo.data = next;
    return next;
  }

  function writeMainModerationArrivalCacheMap(cache) {
    const next = cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
    try {
      localStorage.setItem(MAIN_MODERATION_ARRIVAL_CACHE_KEY, JSON.stringify(next));
    } catch (_error) {}
    mainModerationArrivalCacheMemo.loaded = true;
    mainModerationArrivalCacheMemo.readAt = Date.now();
    mainModerationArrivalCacheMemo.data = next;
  }

  function syncMainModerationArrivalStateFromRows(nextRows, prevRows) {
    const nextList = Array.isArray(nextRows) ? nextRows : [];
    const prevList = Array.isArray(prevRows) ? prevRows : [];
    const nextById = new Map();
    const prevById = new Map();

    nextList.forEach((row) => {
      const id = normalizeRequestId(row?.id || '');
      if (!id || row?.statusKey !== 'mod') return;
      nextById.set(id, row);
    });
    prevList.forEach((row) => {
      const id = normalizeRequestId(row?.id || '');
      if (!id || row?.statusKey !== 'mod') return;
      prevById.set(id, row);
    });

    const cache = { ...readMainModerationArrivalCacheMap() };
    const now = Date.now();
    let changed = false;
    let nextEnteredAt = getNextMainModerationArrivalStamp(cache, now);

    nextById.forEach((row, id) => {
      const currentProcessingState = normalizeText(row?.processingState || '').toLowerCase();
      const prevProcessingState = normalizeText(prevById.get(id)?.processingState || '').toLowerCase();
      const entry = cache[id];
      if (!entry || !Number(entry?.enteredAt || 0)) return;
      if (currentProcessingState !== 'mine') return;
      if (prevProcessingState === 'mine') return;
      nextEnteredAt = Math.max(nextEnteredAt + 1, now);
      cache[id] = {
        ...entry,
        enteredAt: nextEnteredAt,
        lastSeenAt: now,
        visible: true,
        processingState: currentProcessingState,
        missingSince: 0
      };
      changed = true;
    });

    prevById.forEach((row, id) => {
      if (!nextById.has(id)) return;
      const prevProcessingState = normalizeText(row?.processingState || '').toLowerCase();
      const currentProcessingState = normalizeText(nextById.get(id)?.processingState || '').toLowerCase();
      if (prevProcessingState !== 'mine' || currentProcessingState === 'mine') return;
      const entry = cache[id];
      cache[id] = {
        ...entry,
        lastSeenAt: now,
        visible: currentProcessingState === 'mine',
        processingState: currentProcessingState,
        missingSince: 0
      };
      changed = true;
    });

    if (changed) writeMainModerationArrivalCacheMap(cache);
  }

  function inferMainModerationArrivalSeedTime(row, now, index) {
    void row;
    void index;
    return now;
  }

  function getNextMainModerationArrivalStamp(cache, now) {
    let maxStamp = Number.isFinite(now) ? now : Date.now();
    Object.values(cache || {}).forEach((entry) => {
      const ts = Number(entry?.enteredAt || entry?.firstSeenAt || 0);
      if (Number.isFinite(ts) && ts > maxStamp) maxStamp = ts;
    });
    return maxStamp;
  }

  function rememberMainModerationArrivals(rows) {
    const list = (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.statusKey === 'mod' && normalizeRequestId(row?.id || ''));
    const orderedList = list.slice().sort((a, b) => {
      const as = getRowSourceOrder(a);
      const bs = getRowSourceOrder(b);
      if (as !== null || bs !== null) {
        if (as === null) return 1;
        if (bs === null) return -1;
        if (as !== bs) return as - bs;
      }
      return compareRowsByCreatedDesc(a, b);
    });
    const now = Date.now();
    const cache = { ...readMainModerationArrivalCacheMap() };
    let changed = false;
    let nextEnteredAt = getNextMainModerationArrivalStamp(cache, now);
    const visibleIds = new Set();

    orderedList.slice().reverse().forEach((row, index) => {
      const id = normalizeRequestId(row?.id || '');
      if (!id) return;
      visibleIds.add(id);
      const entry = cache[id];
      const enteredAt = Number(entry?.enteredAt || entry?.firstSeenAt || 0);
      const wasVisible = entry?.visible !== false;
      const currentProcessingState = normalizeText(row?.processingState || '').toLowerCase();
      const trackedProcessingState = normalizeText(entry?.processingState || '').toLowerCase();
      const hasTrackedProcessingState = Boolean(trackedProcessingState);
      const missingSince = Number(entry?.missingSince || 0);
      if (!Number.isFinite(enteredAt) || enteredAt <= 0) {
        nextEnteredAt = Math.max(nextEnteredAt + 1, inferMainModerationArrivalSeedTime(row, now, index));
        cache[id] = {
          ...entry,
          enteredAt: nextEnteredAt,
          lastSeenAt: now,
          visible: true,
          processingState: currentProcessingState,
          missingSince: 0
        };
        changed = true;
        return;
      }

      if (currentProcessingState === 'mine' && hasTrackedProcessingState && trackedProcessingState !== 'mine') {
        nextEnteredAt = Math.max(nextEnteredAt + 1, inferMainModerationArrivalSeedTime(row, now, index));
        cache[id] = {
          ...entry,
          enteredAt: nextEnteredAt,
          lastSeenAt: now,
          visible: true,
          processingState: currentProcessingState,
          missingSince: 0
        };
        changed = true;
        return;
      }

      const lastSeenAt = Number(entry?.lastSeenAt || 0);
      const ageMs = Number.isFinite(lastSeenAt) ? (now - lastSeenAt) : Number.POSITIVE_INFINITY;
      if (ageMs > MAIN_MODERATION_ARRIVAL_TOUCH_INTERVAL_MS) {
        cache[id] = {
          ...entry,
          lastSeenAt: now,
          visible: true,
          processingState: currentProcessingState,
          missingSince: 0
        };
        changed = true;
        return;
      }
      if (entry?.visible !== true || trackedProcessingState !== currentProcessingState || missingSince > 0) {
        cache[id] = {
          ...entry,
          lastSeenAt: now,
          visible: true,
          processingState: currentProcessingState,
          missingSince: 0
        };
        changed = true;
      }
    });

    Object.keys(cache).forEach((id) => {
      const entry = cache[id];
      if (!visibleIds.has(id)) {
        const missingSince = Number(entry?.missingSince || 0);
        if (entry?.visible !== false) {
          if (missingSince <= 0) {
            cache[id] = {
              ...entry,
              missingSince: now
            };
            changed = true;
          } else if ((now - missingSince) >= MAIN_MODERATION_MISSING_GRACE_MS) {
            cache[id] = {
              ...entry,
              visible: false
            };
            changed = true;
          }
        }
      }
      const lastSeenAt = Number(entry?.lastSeenAt || entry?.enteredAt || entry?.firstSeenAt || 0);
      if (!lastSeenAt || (now - lastSeenAt) > MAIN_MODERATION_ARRIVAL_CACHE_TTL_MS) {
        delete cache[id];
        changed = true;
      }
    });

    if (changed) writeMainModerationArrivalCacheMap(cache);
  }

  function getMainModerationArrivalSortTime(row) {
    const id = normalizeRequestId(row?.id || '');
    if (!id) return 0;
    const entry = readMainModerationArrivalCacheMap()[id];
    const ts = Number(entry?.enteredAt || entry?.firstSeenAt || 0);
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  }

  function sortRowsByCreatedDesc(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(compareRowsByCreatedDesc);
  }

  function getMainLeftColumnRank(row) {
    if (row?.statusKey === 'mod') return 0;
    // «(соглас)» и «?» — одна группа между модерациями и обычными уточнениями
    // (как модерации: новые сверху, старые снизу; см. compareMainLeftColumnRows).
    if (isClarifyAgreeStatus(row?.status || '') || isClarifyQuestionStatus(row?.status || '')) return 1;
    return 2;
  }

  function compareMainLeftColumnRows(a, b) {
    const ar = getMainLeftColumnRank(a);
    const br = getMainLeftColumnRank(b);
    if (ar !== br) return ar - br;
    if (a?.statusKey === 'mod' && b?.statusKey === 'mod') {
      const aa = getMainModerationArrivalSortTime(a);
      const ba = getMainModerationArrivalSortTime(b);
      if ((aa || ba) && aa !== ba) return ba - aa;
    }
    // Внутри группы «(соглас)»/«?» — по дате создания (стабильно, новее сверху).
    // НЕ по «времени прихода подстатуса»: оно волатильно (сбрасывается при флике метки),
    // из-за чего карточки прыгали и колонка пересобиралась (ghosts / дёрганье).
    return compareRowsByCreatedDesc(a, b);
  }

  function compareMainRightColumnRows(a, b) {
    const ar = isMainOnCallRow(a) ? 0 : 1;
    const br = isMainOnCallRow(b) ? 0 : 1;
    if (ar !== br) return ar - br;
    return compareRowsByCreatedDesc(a, b);
  }

  function splitMainRowsForColumns(rows) {
    const left = [];
    const right = [];
    rememberMainModerationArrivals(rows);
    sortRowsByCreatedDesc(rows).forEach((row) => {
      if (isMainLeftColumnRow(row)) left.push(row);
      else right.push(row);
    });
    left.sort(compareMainLeftColumnRows);
    right.sort(compareMainRightColumnRows);
    return { left, right };
  }

  function getRowAnimGroup(row) {
    if (!state.remote.kind) {
      return `main-${getMainDisplayRank(row)}`;
    }
    return `mode-${state.remote.kind}-${normalizeText(row?.statusKey || '')}`;
  }

  function isFreeWidthStatus(statusText) {
    const s = normalizeText(statusText).toLowerCase();
    return s.includes('соглас') || s.includes('?');
  }

  function tableContext() {
    const grid = document.querySelector(GRID_SELECTOR);
    const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
    const tbody = table ? table.querySelector('tbody') : null;
    return { grid, table, tbody };
  }

  function cellByClass(row, clsPart) {
    return Array.from(row.querySelectorAll('td')).find((cell) => String(cell.className || '').includes(clsPart)) || null;
  }

  function normalizeRequestId(value) {
    const digits = String(value || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    // Deep legacy pages can contain short numeric ids; keep them too.
    if (digits.length < 3) return '';
    return digits;
  }

  function extractId(row) {
    const idCellLink = row.querySelector('td.col__id a[href*="/customer-request/update?id="], td.col__id.pos-r a[href*="/customer-request/update?id="], td[class*="col__id"] a[href*="/customer-request/update?id="]');
    const link = idCellLink || row.querySelector('a[href*="/customer-request/update?id="]');
    if (link) {
      try {
        const url = new URL(link.href, location.origin);
        const byParam = url.searchParams.get('id');
        const normalizedByParam = normalizeRequestId(byParam);
        if (normalizedByParam) return normalizedByParam;
      } catch (_error) {}
      const fromText = normalizeText(link.textContent).match(/\d{3,}/);
      if (fromText) {
        const normalizedFromText = normalizeRequestId(fromText[0]);
        if (normalizedFromText) return normalizedFromText;
      }
    }

    const idCellText = normalizeText(
      row.querySelector('td.col__id a, td.col__id.pos-r a, td.col__id, td[class*="col__id"]')?.textContent || ''
    );
    const fallback = idCellText.match(/\d{3,}/);
    if (!fallback) return '';
    return normalizeRequestId(fallback[0]);
  }

  function nativeRowHasClaim(row) {
    if (!(row instanceof Element)) return false;
    const idCell = row.querySelector('td.col__id, td.col__id.pos-r, td[class*="col__id"]');
    const nodes = [row, idCell, ...(idCell ? Array.from(idCell.querySelectorAll('*')) : [])].filter(Boolean);
    const claimClassPattern = /(?:^|[\s_-])(?:bg[\s_-]*)?has[\s_-]*claim(?:$|[\s_-])|(?:^|[\s_-])claim(?:$|[\s_-])|\b(?:bg-danger|table-danger|danger|preten|pret|red)\b|прет/i;
    const redColorPattern = /(?:background(?:-color)?|color)\s*:\s*(?:#(?:e83b3b|e83c3c|d7192a|d83340)|rgba?\(\s*(?:[12]\d{2}|[3-9]\d)\s*,\s*(?:[0-9]|[1-8]\d|9\d|1[0-3]\d)\s*,\s*(?:[0-9]|[1-8]\d|9\d|1[0-3]\d))/i;
    return nodes.some((node) => {
      const classText = `${node.className || ''} ${node.getAttribute?.('class') || ''}`;
      const styleText = node.getAttribute?.('style') || '';
      return claimClassPattern.test(classText) || redColorPattern.test(styleText);
    });
  }

  function dedupeRowsById(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const seen = new Set();
    const result = [];
    for (const row of list) {
      const id = normalizeRequestId(row?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (row && typeof row === 'object') row.id = id;
      result.push(row);
    }
    return result;
  }

  function getRowSortId(row) {
    const directId = Number(normalizeRequestId(row?.id));
    if (Number.isFinite(directId) && directId > 0) return directId;
    const rawUrl = normalizeText(row?.url || '');
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl, location.origin);
        const byParam = Number(normalizeRequestId(parsed.searchParams.get('id') || ''));
        if (Number.isFinite(byParam) && byParam > 0) return byParam;
      } catch (_error) {}
    }
    return 0;
  }

  function pickAddress(cells, known) {
    const knownSet = new Set(known.filter(Boolean).map((v) => normalizeText(v).toLowerCase()));
    const candidates = cells
      .filter(Boolean)
      .map((v) => normalizeText(v))
      .filter((v) => !knownSet.has(v.toLowerCase()))
      .filter((v) => !/^\d+$/.test(v))
      .sort((a, b) => b.length - a.length);
    return candidates[0] || '';
  }

  function deriveCity(address, fallback) {
    const src = normalizeText(address || fallback);
    if (!src) return 'Не указан';
    const first = normalizeText((src.split(',')[0] || src).replace(/^г\.?\s*/i, '').replace(/^город\s+/i, ''));
    return first || 'Не указан';
  }

  function isCallMetaText(value) {
    const t = normalizeText(value).toLowerCase();
    if (!t) return false;
    return /^(звонил|не звонил|не отправлено)\b/.test(t);
  }

  function normalizeHeader(value) {
    return normalizeText(value).toLowerCase().replace(/ё/g, 'е').replace(/[.:]/g, '');
  }

  function resolveColumnIndexes(table) {
    const headers = Array.from(table?.querySelectorAll('thead th') || [])
      .map((th) => normalizeHeader(th.textContent));

    const indexOfAny = (variants) => headers.findIndex((header) => variants.some((v) => header.includes(v)));

    return {
      id: indexOfAny(['id']),
      reqTime: indexOfAny(['время заявки']),
      type: indexOfAny(['тип']),
      status: indexOfAny(['статус']),
      city: indexOfAny(['город']),
      phone: indexOfAny(['телефон']),
      address: indexOfAny(['адрес']),
      createdDv: indexOfAny(['создано (дв)', 'создано']),
      closed: indexOfAny(['закрыто']),
      author: indexOfAny(['автор создания', 'автор'])
    };
  }

  function cellTextByIndex(cells, index) {
    if (index < 0 || index >= cells.length) return '';
    return normalizeText(cells[index]?.textContent || '');
  }

  function hasGreenMarker(row) {
    const marker = row.querySelector('td.col__id span.__is-sort1, td.col__id.pos-r span.__is-sort1, span.__is-sort1');
    if (!marker) return false;

    // For detached/background docs (DOMParser) computed styles are unreliable.
    // Presence of __is-sort1 marker is enough there.
    if (row?.ownerDocument && row.ownerDocument !== document) {
      return true;
    }

    let bg = '';
    try {
      bg = String(getComputedStyle(marker).backgroundColor || '');
    } catch (_error) {
      return true;
    }
    const nums = bg.match(/\d+/g);
    if (!nums || nums.length < 3) return true;

    const r = Number(nums[0]) || 0;
    const g = Number(nums[1]) || 0;
    const b = Number(nums[2]) || 0;

    return g > r + 20 && g > b + 20;
  }

  function isModerationRow(row, colStatusIndex) {
    const cells = Array.from(row.querySelectorAll('td'));
    const statusByHeader = cellTextByIndex(cells, colStatusIndex);
    const statusByClass = normalizeText(cellByClass(row, 'col__req_status')?.textContent);
    const status = normalizeText(statusByHeader || statusByClass).toLowerCase();
    return status.includes('модерац');
  }

  function detectProcessingStateByRow(row) {
    const cls = normalizeText(row?.className || '').toLowerCase();
    if (cls.includes('bg-is_processing_by_me')) return 'mine';
    if (cls.includes('bg-is_processing_by')) return 'busy';
    return 'free';
  }

  function hasAwaitOnlyGreenFlag(row, reqTimeCell) {
    const rowClass = normalizeText(row?.className || '').toLowerCase();
    if (rowClass.includes('bg-status-awaitonly')) return true;

    if (!(reqTimeCell instanceof HTMLElement)) return false;

    const inlineStyle = normalizeText(reqTimeCell.getAttribute('style') || '').toLowerCase();
    if (inlineStyle.includes('54, 211, 80') || inlineStyle.includes('#54d350')) return true;

    // Reliable only for real DOM rows (not parsed via DOMParser).
    try {
      if (reqTimeCell.ownerDocument === document) {
        const bg = String(getComputedStyle(reqTimeCell).backgroundColor || '');
        const rgb = bg.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          const r = Number(rgb[0]) || 0;
          const g = Number(rgb[1]) || 0;
          const b = Number(rgb[2]) || 0;
          if (g > r + 20 && g > b + 20) return true;
        }
      }
    } catch (_error) {}

    return false;
  }

  function hasFarTripFlag(row, cellsText = []) {
    const text = normalizeText([
      row?.className || '',
      row?.getAttribute?.('title') || '',
      row?.getAttribute?.('data-original-title') || '',
      ...cellsText
    ].join(' ')).toLowerCase();
    return /дальн\w*\s+выезд/i.test(text)
      || /выезд\w*\s+дальн/i.test(text)
      || (text.includes('дальний') && text.includes('выезд'));
  }

  function readClarifyRouteCacheMap() {
    const now = Date.now();
    if ((now - Number(clarifyRouteCacheMemo.readAt || 0)) < 1500) {
      return clarifyRouteCacheMemo.data || {};
    }
    let cache = {};
    try {
      const raw = localStorage.getItem(CLARIFY_ROUTE_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        cache = parsed;
      }
    } catch (_error) {}
    Object.keys(cache).forEach((key) => {
      const updatedAt = Number(cache[key]?.updatedAt || 0);
      if (!updatedAt || (now - updatedAt) > CLARIFY_ROUTE_CACHE_TTL_MS) {
        delete cache[key];
      }
    });
    clarifyRouteCacheMemo.readAt = now;
    clarifyRouteCacheMemo.data = cache;
    return cache;
  }

  function writeClarifyRouteCacheEntry(requestId, flags) {
    const id = normalizeRequestId(requestId);
    if (!id) return;
    const now = Date.now();
    const cache = { ...readClarifyRouteCacheMap() };
    cache[id] = {
      hasFarTrip: Boolean(flags?.hasFarTrip),
      checked: true,
      updatedAt: now
    };
    try {
      localStorage.setItem(CLARIFY_ROUTE_CACHE_KEY, JSON.stringify(cache));
    } catch (_error) {}
    clarifyRouteCacheMemo.readAt = now;
    clarifyRouteCacheMemo.data = cache;
  }

  function getClarifyRouteCacheEntry(requestId) {
    const id = normalizeRequestId(requestId);
    if (!id) return null;
    const entry = readClarifyRouteCacheMap()[id];
    const updatedAt = Number(entry?.updatedAt || 0);
    if (!updatedAt || (Date.now() - updatedAt) > CLARIFY_ROUTE_CACHE_TTL_MS) return null;
    return entry;
  }

  function hydrateClarifyRouteState(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const entry = getClarifyRouteCacheEntry(row?.id || '');
      if (!entry) return row;
      return {
        ...row,
        hasFarTrip: Boolean(entry.hasFarTrip),
        clarifyRouteCheckedAt: Number(entry.updatedAt || Date.now())
      };
    });
  }

  function parseRowsFromTable(table, tbody, idSearchActive, sourceOffset = 0) {
    if (!table || !tbody) return [];
    const col = resolveColumnIndexes(table);
    const offset = Number.isFinite(Number(sourceOffset)) ? Number(sourceOffset) : 0;

    const tableRows = Array.from(tbody.querySelectorAll('tr')).filter((row) => {
      if (row.classList.contains('filters')) return false;
      if (row.classList.contains('ext-index-lookup-native-row')) return false;
      if (row.getAttribute('data-tm-moderation-duplicate-hidden') === '1') return false;
      if (row instanceof HTMLElement && row.style.display === 'none') return false;
      if (!idSearchActive && !hasGreenMarker(row) && !isModerationRow(row, col.status)) return false;
      return row.querySelectorAll('td').length > 0;
    });

    return tableRows.map((row, rowIndex) => {
      const id = extractId(row);
      if (!id) return null;

      const link = row.querySelector('a[href*="/customer-request/update?id="]');
      const cells = Array.from(row.querySelectorAll('td'));
      const cellsText = cells.map((cell) => normalizeText(cell.textContent));

      const statusFromHeader = cellTextByIndex(cells, col.status);
      const typeFromHeader = cellTextByIndex(cells, col.type);
      const phoneFromHeader = cellTextByIndex(cells, col.phone);
      const cityFromHeader = cellTextByIndex(cells, col.city);
      const addressFromHeader = cellTextByIndex(cells, col.address);
      const reqTimeFromHeader = cellTextByIndex(cells, col.reqTime);
      const createdDvRaw = cellTextByIndex(cells, col.createdDv);
      const authorFromHeader = cellTextByIndex(cells, col.author);

      const statusRaw = statusFromHeader || normalizeText(cellByClass(row, 'col__req_status')?.textContent);
      const typeRaw = typeFromHeader || normalizeText(cellByClass(row, 'col__req_type')?.textContent);
      const phoneRaw = phoneFromHeader || normalizeText(cellByClass(row, 'col__phone')?.textContent);
      const dateRaw = createdDvRaw || normalizeText((cellByClass(row, 'col__date') || cellByClass(row, 'col__openedAt'))?.textContent);
      const reqTimeCell = (col.reqTime >= 0 && col.reqTime < cells.length) ? cells[col.reqTime] : null;
      const reqTimeWarningRaw = normalizeText(
        reqTimeCell?.querySelector('.time-warning')?.textContent
        || reqTimeFromHeader
      );
      const reqDateTime = normalizeText(reqTimeWarningRaw.replace(/\s*\([^)]*\)\s*$/, '')) || '—';

      const rawAddress = addressFromHeader || pickAddress(cellsText, [
        id,
        statusRaw,
        typeRaw,
        phoneRaw,
        dateRaw,
        reqTimeFromHeader,
        reqTimeWarningRaw,
        reqDateTime
      ]);
      const address = isCallMetaText(rawAddress) ? '' : rawAddress;
      const city = cityFromHeader || deriveCity(address, cellsText[0] || '');
      const author = normalizeText(authorFromHeader) || '-';
      const statusKey = detectStatusKey(statusRaw);
      const statusEffective = applyClarifySubstateHold(id, statusRaw);
      const processingState = detectProcessingStateByRow(row);
      const isAwaitOnlyGreen = hasAwaitOnlyGreenFlag(row, reqTimeCell);
      const rowHasFarTrip = hasFarTripFlag(row, cellsText);

      let created = dateRaw || '—';
      let dv = '—';
      const dvMatch = created.match(/^(.*)\(([^)]+)\)\s*$/);
      if (dvMatch) {
        created = normalizeText(dvMatch[1]);
        dv = normalizeText(dvMatch[2]);
      }
      const createdFull = dv !== '—' ? `${created} (местное ${dv})` : created;

      return {
        id,
        sourceIndex: offset + rowIndex,
        hasClaim: nativeRowHasClaim(row),
        url: link ? link.href : '',
        city,
        address: address || '',
        phone: phoneRaw || '—',
        status: statusEffective || statusRaw || '—',
        statusKey,
        isAwaitOnlyGreen,
        hasFarTrip: rowHasFarTrip,
        clarifyRouteCheckedAt: rowHasFarTrip ? Date.now() : 0,
        processingState,
        type: typeRaw || '—',
        reqDateTime,
        dv,
        created,
        createdFull,
        av: getInitials(author === '-' ? '' : author),
        name: author
      };
    }).filter(Boolean);
  }

  function normalizePhoneForDup(value) {
    return String(value || '')
      .replace(/\s+/g, '')
      .replace(/[()\-]/g, '')
      .replace(/[^\d+*]/g, '')
      .trim();
  }

  function dedupeModerationRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    // 1) strict dedupe by request id
    // 2) for same phone keep minimal ID (legacy Fix+AHK rule)
    const byId = dedupeModerationRowsStrict(list);
    const byPhone = new Map();
    const withoutPhone = [];

    byId.forEach((row) => {
      const phoneKey = normalizePhoneForDup(row?.phone || '');
      const phoneDigits = phoneKey.replace(/[^\d]/g, '');
      if (!phoneKey || phoneDigits.length < 8) {
        withoutPhone.push(row);
        return;
      }

      const currentId = Number(moderationCanonicalId(row));
      const existing = byPhone.get(phoneKey);
      if (!existing) {
        byPhone.set(phoneKey, row);
        return;
      }
      const existingId = Number(moderationCanonicalId(existing));
      const currentNum = Number.isFinite(currentId) ? currentId : Number.MAX_SAFE_INTEGER;
      const existingNum = Number.isFinite(existingId) ? existingId : Number.MAX_SAFE_INTEGER;
      if (currentNum < existingNum) {
        byPhone.set(phoneKey, row);
      }
    });

    return withoutPhone.concat(Array.from(byPhone.values()));
  }

  function moderationCanonicalId(row) {
    const direct = normalizeRequestId(row?.id || '');
    const urlRaw = normalizeText(row?.url || '');
    if (urlRaw) {
      try {
        const parsedUrl = new URL(urlRaw, location.origin);
        const byParam = normalizeRequestId(parsedUrl.searchParams.get('id') || '');
        if (byParam) return byParam;
      } catch (_error) {
        const match = urlRaw.match(/[?&]id=(\d{3,})/i);
        const byMatch = normalizeRequestId(match?.[1] || '');
        if (byMatch) return byMatch;
      }
    }
    return direct;
  }

  function dedupeModerationRowsStrict(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const seen = new Set();
    const out = [];
    list.forEach((row) => {
      const key = moderationCanonicalId(row);
      if (!key) return;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...row, id: key });
    });
    return out;
  }

  function isNeoformStatus(statusText) {
    return normalizeText(statusText).toLowerCase().includes('не оформл');
  }

  function isEmptyRowAuthor(row) {
    const name = normalizeText(row?.name || '');
    return !name || name === '-' || name === '—';
  }

  // Фильтр результатов поиска по номеру (как в главном списке/модерациях):
  // 1) черновики «Не оформлено» без автора — мусор, не показываем;
  // 2) дубль-модерации по одному номеру схлопываем в одну (предпочитаем ту, что «в работе»,
  //    иначе — минимальный ID, как в дедупе модераций).
  function filterBulkPhoneGroupRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const filtered = list.filter((row) => !(isNeoformStatus(row?.status) && isEmptyRowAuthor(row)));
    let bestMod = null;
    filtered.forEach((row) => {
      if (row?.statusKey !== 'mod') return;
      const inWork = row?.processingState === 'mine' || row?.processingState === 'busy';
      const idRaw = Number(moderationCanonicalId(row));
      const idNum = Number.isFinite(idRaw) ? idRaw : Number.MAX_SAFE_INTEGER;
      if (!bestMod) { bestMod = { row, inWork, idNum }; return; }
      if (inWork && !bestMod.inWork) { bestMod = { row, inWork, idNum }; return; }
      if (inWork === bestMod.inWork && idNum < bestMod.idNum) { bestMod = { row, inWork, idNum }; }
    });
    if (!bestMod) return filtered;
    return filtered.filter((row) => row?.statusKey !== 'mod' || row === bestMod.row);
  }

  function parseRowsFromNativeTable() {
    const { table, tbody } = tableContext();
    if (!table || !tbody) return [];
    const idSearchActive = Boolean(state.filters.id);
    return parseRowsFromTable(table, tbody, idSearchActive);
  }

  function collectDataRowsFromTbody(tbody) {
    return Array.from(tbody?.querySelectorAll('tr') || []).filter((row) => {
      if (row.classList.contains('filters')) return false;
      if (row.classList.contains('ext-index-lookup-native-row')) return false;
      if (row.getAttribute('data-tm-moderation-duplicate-hidden') === '1') return false;
      if (row instanceof HTMLElement && row.style.display === 'none') return false;
      return row.querySelectorAll('td').length > 0;
    });
  }

  function countOwnGreenRowsInTable(table, tbody) {
    void table;
    const rows = collectDataRowsFromTbody(tbody);
    // «Свои» строки для порога догрузки страниц = зелёные (свои активные) + синие (мои модерации,
    // bg-is_processing_by_me). Иначе стр.1 забита синими модерациями, зелёных <30 → догрузка не стартует.
    return rows.filter((row) => hasGreenMarker(row) || detectProcessingStateByRow(row) === 'mine').length;
  }

  function buildMainPageUrl(page) {
    const url = new URL(location.href);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per-page', '30');
    return url.toString();
  }

  async function extendMainRowsAcrossPages(initialRows, initialOwnGreenCount, signature) {
    const seq = ++state.mainScanSeq;
    const merged = Array.isArray(initialRows) ? initialRows.slice() : [];
    let ownCount = Number(initialOwnGreenCount || 0);
    let page = 2;

    try {
      while (ownCount >= 30 && page <= 50) {
        const response = await fetch(buildMainPageUrl(page), {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const html = await response.text();
        if (seq !== state.mainScanSeq) return;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const grid = doc.querySelector(GRID_SELECTOR);
        const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
        const tbody = table ? table.querySelector('tbody') : null;
        if (!table || !tbody) break;

        const rows = parseRowsFromTable(table, tbody, false, (page - 1) * 30);
        if (!rows.length) break;
        merged.push(...rows);

        ownCount = countOwnGreenRowsInTable(table, tbody);
        if (ownCount < 30) break;
        page += 1;
      }

      if (seq !== state.mainScanSeq) return;

      const seen = new Set();
      const deduped = [];
      merged.forEach((row) => {
        const id = normalizeRequestId(row?.id);
        if (!id || seen.has(id)) return;
        seen.add(id);
        deduped.push(row);
      });

      {
        const prevRows = Array.isArray(state.rows) ? state.rows : [];
        const nextRows = hydrateModerationCallStates(mergeMainRowsWithExisting(deduped, prevRows, { carryMissing: false }));
        syncMainModerationArrivalStateFromRows(nextRows, prevRows);
        state.rows = nextRows;
      }
      state.mainScanSig = signature;
      state.mainScanAt = Date.now();
      renderAll();
      refreshModerationCallStatesInBackground(state.rows);
    } catch (_error) {
      if (seq !== state.mainScanSeq) return;
      state.mainScanSig = signature;
      state.mainScanAt = Date.now();
    }
  }

  function mergeMainRowsWithExisting(nativeRows, existingRows, options = {}) {
    const nativeList = Array.isArray(nativeRows) ? nativeRows : [];
    const existingList = Array.isArray(existingRows) ? existingRows : [];
    const carryMissing = Boolean(options?.carryMissing);
    const now = Date.now();
    const existingById = new Map(
      existingList
        .map((row) => [normalizeRequestId(row?.id), row])
        .filter(([id]) => Boolean(id))
    );
    const nativeIds = new Set(nativeList.map((row) => normalizeRequestId(row?.id)).filter(Boolean));
    const carried = existingList.flatMap((row) => {
      const id = normalizeRequestId(row?.id);
      if (!id || nativeIds.has(id)) return [];
      const prevMissingSince = Number(row?.__tmMainMissingSince || 0);
      const nextMissingSince = prevMissingSince > 0 ? prevMissingSince : now;
      const withinGrace = (now - nextMissingSince) < MAIN_MODERATION_MISSING_GRACE_MS;
      if (!carryMissing && !withinGrace) return [];
      return [{
        ...row,
        __tmMainMissingSince: nextMissingSince
      }];
    });
    const mergedNative = nativeList.map((row) => {
      const id = normalizeRequestId(row?.id);
      if (!id || !existingById.has(id)) return row;
      const prev = existingById.get(id) || {};
      const mergedRow = {
        ...prev,
        ...row,
        __tmMainMissingSince: 0,
        sourceIndex: Number.isFinite(Number(row?.sourceIndex))
          ? Number(row.sourceIndex)
          : Number(prev?.sourceIndex)
      };
      // Раз маршрут уточнения уже был проверён — держим флаг, чтобы зелёная метка
      // «На согласовании» не мигала (parse не-far-trip строки даёт 0, а route-кэш живёт 60с
      // и между перепроверками истекает). hydrateClarifyRouteState перезапишет свежим кэшем.
      const prevRouteChecked = Number(prev?.clarifyRouteCheckedAt || 0);
      if (prevRouteChecked > 0 && Number(row?.clarifyRouteCheckedAt || 0) <= 0) {
        mergedRow.clarifyRouteCheckedAt = prevRouteChecked;
        mergedRow.hasFarTrip = Boolean(prev?.hasFarTrip);
      }
      return mergedRow;
    });
    return dedupeRowsById(mergedNative.concat(carried));
  }

  function filteredRows(rows = state.rows) {
    return rows.filter((row) => {
      const f = state.filters;
      const isServerFilterMode = state.remote.kind === 'filter';
      const addressText = normalizeText(`${row.city || ''} ${row.address || ''}`).toLowerCase();
      return (!f.id || row.id.toLowerCase().includes(f.id))
        && (isServerFilterMode || !f.city || row.city.toLowerCase().includes(f.city))
        && (isServerFilterMode || !f.status || row.status.toLowerCase().includes(f.status))
        && (isServerFilterMode || !f.type || row.type.toLowerCase().includes(f.type))
        && (isServerFilterMode || !f.phone || row.phone.toLowerCase().includes(f.phone))
        && (isServerFilterMode || !f.author || row.name.toLowerCase().includes(f.author))
        && (isServerFilterMode || !f.addressCity || addressText.includes(f.addressCity))
        && (isServerFilterMode || !f.street || addressText.includes(f.street))
        && (isServerFilterMode || !f.house || addressText.includes(f.house))
        && (isServerFilterMode || !f.flat || addressText.includes(f.flat));
    });
  }

  function findNativeIdFilterInput() {
    return document.querySelector('tr#cr-index-grid-filters input[name="CRSearch[id]"]')
      || document.querySelector('#cr-index-grid-filters input[name="CRSearch[id]"]')
      || document.querySelector('tr#cr-index-grid-filters > td:nth-of-type(1) > input.form-control');
  }

  function normalizeBulkPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    let normalized = digits;
    if (normalized.length === 10) normalized = `7${normalized}`;
    if (normalized.length === 11 && normalized.startsWith('8')) normalized = `7${normalized.slice(1)}`;
    if (normalized.length !== 11 || !normalized.startsWith('7')) return '';
    return `+${normalized}`;
  }

  function extractCallPhoneFromHref(value) {
    const raw = normalizeText(value || '');
    if (!raw) return '';
    const match = raw.match(/^callto:(.+)$/i);
    const source = match ? match[1] : raw;
    return normalizeBulkPhone(source);
  }

  // Суффикс sip_id для звонка по направлению (бт=002, мнч=003, кп=003). Host-based → переживает cp+sed.
  function tmSipCallSuffix(){
    try{
      var h = String(location.hostname || '');
      if (h.indexOf('bt-lead-centre.ru') !== -1) return ';sip_id=002';
      if (h.indexOf('mnc-lead-centre.ru') !== -1) return ';sip_id=003';
      if (h.indexOf('kp-lead-centre.ru') !== -1) return ';sip_id=003';
    }catch(_){}
    return '';
  }

  function markBulkPhoneAsCalled(phoneRaw) {
    const phone = normalizeBulkPhone(phoneRaw);
    if (!phone) return;
    bulkCalledPhones.add(phone);
    const cardsArea = document.getElementById('tmCardsArea');
    if (!(cardsArea instanceof HTMLElement)) return;
    const callButtons = cardsArea.querySelectorAll('a.bulk-call-btn[data-phone]');
    callButtons.forEach((btn) => {
      if (!(btn instanceof HTMLAnchorElement)) return;
      const btnPhone = normalizeBulkPhone(btn.getAttribute('data-phone') || '');
      if (btnPhone !== phone) return;
      btn.classList.add('is-called');
      const wrap = btn.parentElement;
      if (!(wrap instanceof HTMLElement)) return;
      let check = wrap.querySelector('.bulk-call-check');
      if (!(check instanceof HTMLElement)) {
        check = document.createElement('span');
        check.className = 'bulk-call-check';
        check.title = 'Звонок отмечен';
        check.textContent = '✓';
        wrap.appendChild(check);
      }
    });
  }

  function normalizeModerationRowsStrict(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => {
      const urlRaw = normalizeText(row?.url || '');
      if (!urlRaw) return null;
      try {
        const parsedUrl = new URL(urlRaw, location.origin);
        const byParam = normalizeRequestId(parsedUrl.searchParams.get('id') || '');
        if (!byParam) return null;
        return { ...row, id: byParam };
      } catch (_error) {
        const match = urlRaw.match(/[?&]id=(\d{3,})/i);
        const byParam = normalizeRequestId(match?.[1] || '');
        if (!byParam) return null;
        return { ...row, id: byParam };
      }
    }).filter(Boolean);
  }

  // ── Источник заявки из «Поиска номера» (партнёр / листовка+город) ─────────
  // Строки ввода могут нести метаданные ПОСЛЕ телефона:
  //   «+7… 685 партнер»          → партнёр 685 (в поле ПАРТНЁР)
  //   «+7… Улан-Удэ (Мастер …)»  → листовка: ГОРОД=Улан-Удэ, ЛИСТОВКА=«Мастер …»
  // Партнёр и листовка вместе не бывают (в скрипте запрет). Запоминаем по номеру и при
  // «Создать»/«Добавить заявку» кладём в sessionStorage → новая вкладка create применит.
  function loadBulkSourceMap() { try { const r = sessionStorage.getItem(BULK_SOURCE_MAP_KEY); const o = r ? JSON.parse(r) : {}; return (o && typeof o === 'object') ? o : {}; } catch (_e) { return {}; } }
  function saveBulkSourceMap(map) { try { sessionStorage.setItem(BULK_SOURCE_MAP_KEY, JSON.stringify(map || {})); } catch (_e) {} }
  function parseBulkSourceMap(text) {
    const map = {};
    String(text || '').split(/\r?\n/).forEach((line) => {
      const m = line.match(/(?:\+7|8)[\s\-()]*\d(?:[\s\-()]*\d){9}/);
      if (!m) return;
      const phone = normalizeBulkPhone(m[0]);
      if (!phone) return;
      let tail = line.slice((m.index || 0) + m[0].length).replace(/^[\s,;:.\-–—]+/, '').trim();
      if (!tail) return;
      if (/партн[её]р/i.test(tail)) { const code = (tail.match(/\d+/) || [])[0] || ''; if (code) map[phone] = { kind: 'partner', code: code }; return; }
      map[phone] = { kind: 'leaflet', raw: tail };
    });
    return map;
  }
  function rememberBulkSourcesFromText(text) {
    const parsed = parseBulkSourceMap(text);
    if (!Object.keys(parsed).length) return;
    const cur = loadBulkSourceMap();
    Object.keys(parsed).forEach((k) => { cur[k] = parsed[k]; });
    saveBulkSourceMap(cur);
  }
  function getBulkSourceForPhone(phone) { const p = normalizeBulkPhone(phone); if (!p) return null; const m = loadBulkSourceMap(); return m[p] || null; }
  // KP-only: sip звонка по заголовку «Источник:» в буфере. «КП Старая АТС» → sip_id=002, остальные → 003.
  // Заголовок «Источник: …» назначает sip всем номерам НИЖЕ до следующего заголовка.
  function loadBulkCallSipMap() { try { const r = sessionStorage.getItem(BULK_CALL_SIP_KEY); const o = r ? JSON.parse(r) : {}; return (o && typeof o === 'object') ? o : {}; } catch (_e) { return {}; } }
  function saveBulkCallSipMap(map) { try { sessionStorage.setItem(BULK_CALL_SIP_KEY, JSON.stringify(map || {})); } catch (_e) {} }
  function parseBulkCallSipMap(text) {
    const map = {};
    let curSip = ';sip_id=003';
    String(text || '').split(/\r?\n/).forEach((line) => {
      const src = line.match(/источник\s*:\s*(.+)$/i);
      if (src) { curSip = /старая/i.test(src[1]) ? ';sip_id=002' : ';sip_id=003'; return; }
      const m = line.match(/(?:\+7|8)[\s\-()]*\d(?:[\s\-()]*\d){9}/);
      if (!m) return;
      const phone = normalizeBulkPhone(m[0]);
      if (phone) map[phone] = curSip;
    });
    return map;
  }
  function rememberBulkCallSipFromText(text) {
    const parsed = parseBulkCallSipMap(text);
    if (!Object.keys(parsed).length) return;
    const cur = loadBulkCallSipMap();
    Object.keys(parsed).forEach((k) => { cur[k] = parsed[k]; });
    saveBulkCallSipMap(cur);
  }
  function getBulkCallSipForPhone(phone) {
    try { const p = normalizeBulkPhone(phone); if (p) { const m = loadBulkCallSipMap(); if (m[p]) return m[p]; } } catch (_e) {}
    return tmSipCallSuffix(); // нет источника → направленческий (кп=003)
  }
  function writePendingCreateSourceForPhone(phone) {
    const meta = getBulkSourceForPhone(phone);
    try {
      if (meta) sessionStorage.setItem(CREATE_SOURCE_PENDING_KEY, JSON.stringify({ srcMeta: meta, createdAt: Date.now() }));
      else sessionStorage.removeItem(CREATE_SOURCE_PENDING_KEY);
    } catch (_e) {}
    return !!meta;
  }
  function clearPendingCreateSource() { try { sessionStorage.removeItem(CREATE_SOURCE_PENDING_KEY); } catch (_e) {} }
  // «Добавить заявку» открывается с noopener → sessionStorage НЕ наследуется новой вкладкой.
  // Поэтому источник передаём ПАРАМЕТРОМ URL (tm_src), create-страница его прочитает.
  function appendBulkSourceToUrl(urlStr, phone) {
    try {
      const meta = getBulkSourceForPhone(phone);
      if (!meta) return urlStr;
      const u = new URL(urlStr, location.origin);
      u.searchParams.set('tm_src', JSON.stringify(meta));
      return u.toString();
    } catch (_e) { return urlStr; }
  }

  function writePendingCreatePhone(phone) {
    const normalizedPhone = normalizeBulkPhone(phone);
    if (!normalizedPhone) return false;
    const payload = {
      phone: normalizedPhone,
      createdAt: Date.now(),
      sourceUrl: window.location.href,
      source: 'open-all-numbers-create'
    };
    try {
      sessionStorage.setItem(CREATE_PHONE_PENDING_KEY, JSON.stringify(payload));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function openCreateRequestForPhone(phoneRaw) {
    const normalizedPhone = normalizeBulkPhone(phoneRaw);
    if (!normalizedPhone) return false;
    if (!writePendingCreatePhone(normalizedPhone)) return false;
    writePendingCreateSourceForPhone(normalizedPhone); // источник (партнёр/листовка) для новой вкладки

    // В create-странице Фикс+AHK проверяет referrer вида /customer-request/index?...tm_open_all_numbers=1.
    // Делаем временный URL в текущей вкладке без перезагрузки, затем открываем "чистый" /create.
    const originalHref = String(window.location.href || '');
    const originalState = window.history?.state ?? null;
    const syntheticReferrerUrl = new URL('/admin/domain/customer-request/index', location.origin);
    syntheticReferrerUrl.searchParams.set('phone', normalizedPhone);
    syntheticReferrerUrl.searchParams.set(OPEN_ALL_NUMBERS_MARKER, '1');
    const createUrl = `${location.origin}/admin/domain/customer-request/create`;

    let replaced = false;
    try {
      window.history.replaceState(originalState, '', syntheticReferrerUrl.toString());
      replaced = true;
    } catch (_error) {}

    const opened = window.open(createUrl, '_blank');

    if (replaced) {
      setTimeout(() => {
        try {
          window.history.replaceState(originalState, '', originalHref);
        } catch (_error) {}
      }, 0);
    }

    // Новая вкладка уже унаследовала копию sessionStorage с телефоном — снимаем ключ
    // у опенера, чтобы он не «протёк» в следующее ЧИСТОЕ создание заявки.
    try { sessionStorage.removeItem(CREATE_PHONE_PENDING_KEY); } catch (_e) {}
    clearPendingCreateSource();
    return !!opened;
  }

  function openCreateRequestBlank() {
    // Чистое создание: снять pending-телефон от прошлого «Поиск номера → Создать»,
    // иначе новая вкладка наследует копию sessionStorage опенера и подставит старый номер.
    try { sessionStorage.removeItem(CREATE_PHONE_PENDING_KEY); } catch (_e) {}
    clearPendingCreateSource(); // и источник (партнёр/листовка) — чтобы не протёк в чистое создание
    const originalHref = String(window.location.href || '');
    const originalState = window.history?.state ?? null;
    const syntheticReferrerUrl = new URL('/admin/domain/customer-request/index', location.origin);
    syntheticReferrerUrl.searchParams.set(OPEN_ALL_NUMBERS_MARKER, '1');
    const createUrl = `${location.origin}/admin/domain/customer-request/create`;

    let replaced = false;
    try {
      window.history.replaceState(originalState, '', syntheticReferrerUrl.toString());
      replaced = true;
    } catch (_e) {}

    const opened = window.open(createUrl, '_blank');

    if (replaced) {
      setTimeout(() => {
        try { window.history.replaceState(originalState, '', originalHref); } catch (_e) {}
      }, 0);
    }

    return !!opened;
  }

  function addV8TypeLookupMarker(urlRaw) {
    const raw = normalizeText(urlRaw || '');
    if (!raw) return '';
    try {
      const url = new URL(raw, location.origin);
      url.searchParams.set(V8_TYPE_LOOKUP_MARKER, '1');
      return url.toString();
    } catch (_error) {
      return raw;
    }
  }

  async function resolveBulkCustomerLinksFromRequest(requestUrl, requestId) {
    const cleanUrl = normalizeText(requestUrl || '');
    const cleanId = normalizeRequestId(requestId || '');
    const cacheKey = cleanUrl || cleanId;
    const emptyResult = { customerCardUrl: '', createRequestUrl: '', customerId: '', debugReason: '' };
    if (!cacheKey) {
      return { ...emptyResult, debugReason: 'Не передан URL или ID заявки' };
    }
    if (bulkCustomerLinksCache.has(cacheKey)) {
      return bulkCustomerLinksCache.get(cacheKey);
    }
    if (bulkCustomerLinksPending.has(cacheKey)) {
      return bulkCustomerLinksPending.get(cacheKey);
    }
    const result = { ...emptyResult };
    const addDiag = (text) => {
      const message = normalizeText(text || '');
      if (!message) return;
      result.debugReason = message;
    };
    const task = (async () => {
      const requestUrls = [];
      if (cleanUrl) {
        try {
          const parsed = new URL(cleanUrl, location.origin);
          if (parsed.pathname.includes('/customer-request/update')) {
            requestUrls.push(parsed.toString());
          }
        } catch (_error) {}
      }
      if (cleanId) {
        requestUrls.push(new URL(`/admin/domain/customer-request/update?id=${encodeURIComponent(cleanId)}`, location.origin).toString());
      }
      if (!requestUrls.length) {
        addDiag('Не удалось собрать адрес страницы заявки');
        bulkCustomerLinksCache.set(cacheKey, result);
        return result;
      }
      try {
        let requestDoc = null;
        const requestFetchErrors = [];
        for (const requestSourceUrl of requestUrls) {
          try {
            const response = await fetch(requestSourceUrl, {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store'
            });
            if (!response.ok) {
              requestFetchErrors.push(`${requestSourceUrl} -> HTTP ${response.status}`);
              continue;
            }
            const html = await response.text();
            requestDoc = new DOMParser().parseFromString(html, 'text/html');
            if (requestDoc) break;
            requestFetchErrors.push(`${requestSourceUrl} -> пустой DOM`);
          } catch (error) {
            requestFetchErrors.push(`${requestSourceUrl} -> ${normalizeText(error?.message || 'ошибка fetch')}`);
          }
        }
        if (!requestDoc) {
          addDiag(requestFetchErrors.length
            ? `Страница заявки не загрузилась: ${requestFetchErrors.join(' | ')}`
            : 'Страница заявки не загрузилась');
          bulkCustomerLinksCache.set(cacheKey, result);
          return result;
        }

        const customerIdInput = requestDoc.querySelector(
          'input[name="CustomerRequest[customer_id]"], input#customerrequest-customer_id, input[name="CustomerRequest[customer_id][]"]'
        );
        const customerIdByInput = normalizeRequestId(customerIdInput?.getAttribute('value') || customerIdInput?.value || '');
        if (customerIdByInput) {
          result.customerId = customerIdByInput;
        }
        if (!result.customerId) {
          const customerIdByRawHtml = normalizeRequestId((requestDoc.documentElement?.innerHTML || '').match(/\/admin\/domain\/customer\/update\?id=(\d+)/i)?.[1] || '');
          if (customerIdByRawHtml) result.customerId = customerIdByRawHtml;
        }
        if (!result.customerId) {
          addDiag('На странице заявки не найден customer_id');
        }

        const customerCardAnchor = requestDoc.querySelector(
          'div.form-group.field-customerrequest-customer_id > label.d-flex.flex-row > a.btn.btn-sm.btn-outline-secondary[href*="/admin/domain/customer/update?id="]'
        ) || requestDoc.querySelector('a.btn.btn-sm.btn-outline-secondary[href*="/admin/domain/customer/update?id="]');

        if (customerCardAnchor instanceof HTMLAnchorElement) {
          result.customerCardUrl = new URL(customerCardAnchor.getAttribute('href') || '', location.origin).toString();
          try {
            const tmp = new URL(result.customerCardUrl, location.origin);
            result.customerId = normalizeRequestId(tmp.searchParams.get('id') || '');
          } catch (_error) {}
        }
        if (!result.customerCardUrl) {
          addDiag('На странице заявки не найдена кнопка "Карточка клиента"');
        }

        if (!result.createRequestUrl && result.customerId) {
          result.createRequestUrl = new URL(`/admin/domain/customer-request/create?customer_id=${encodeURIComponent(result.customerId)}`, location.origin).toString();
        }
        if (!result.createRequestUrl) {
          const rawCreateMatch = (requestDoc.documentElement?.innerHTML || '').match(/\/admin\/domain\/customer-request\/create\?customer_id=(\d+)/i);
          const customerIdByCreate = normalizeRequestId(rawCreateMatch?.[1] || '');
          if (customerIdByCreate) {
            result.customerId = result.customerId || customerIdByCreate;
            result.createRequestUrl = new URL(`/admin/domain/customer-request/create?customer_id=${encodeURIComponent(customerIdByCreate)}`, location.origin).toString();
          }
        }

        if (result.customerCardUrl && !result.createRequestUrl) {
          try {
            const customerResponse = await fetch(result.customerCardUrl, {
              method: 'GET',
              credentials: 'same-origin',
              cache: 'no-store'
            });
            if (customerResponse.ok) {
              const customerHtml = await customerResponse.text();
              const customerDoc = new DOMParser().parseFromString(customerHtml, 'text/html');
              const createFromCustomerAnchor = customerDoc.querySelector(
                'a.btn.btn-success[href*="/admin/domain/customer-request/create?customer_id="]'
              );
              if (createFromCustomerAnchor instanceof HTMLAnchorElement) {
                result.createRequestUrl = new URL(createFromCustomerAnchor.getAttribute('href') || '', location.origin).toString();
              }
              if (!result.createRequestUrl) {
                const rawCreateMatch = (customerDoc.documentElement?.innerHTML || '').match(/\/admin\/domain\/customer-request\/create\?customer_id=(\d+)/i);
                const customerIdByCreate = normalizeRequestId(rawCreateMatch?.[1] || '');
                if (customerIdByCreate) {
                  result.customerId = result.customerId || customerIdByCreate;
                  result.createRequestUrl = new URL(`/admin/domain/customer-request/create?customer_id=${encodeURIComponent(customerIdByCreate)}`, location.origin).toString();
                }
              }
            } else {
              addDiag(`Карточка клиента не открылась (HTTP ${customerResponse.status})`);
            }
          } catch (error) {
            addDiag(`Ошибка загрузки карточки клиента: ${normalizeText(error?.message || 'fetch error')}`);
          }
        }
      } catch (_error) {
        addDiag('Непредвиденная ошибка при подготовке ссылки');
      }
      if (!result.createRequestUrl && !result.debugReason) {
        addDiag('Не удалось собрать ссылку "Добавить заявку" из страницы заявки/клиента');
      }
      bulkCustomerLinksCache.set(cacheKey, result);
      if (cleanId) bulkCustomerLinksCache.set(cleanId, result);
      if (cleanUrl) bulkCustomerLinksCache.set(cleanUrl, result);
      return result;
    })().finally(() => {
      bulkCustomerLinksPending.delete(cacheKey);
    });
    bulkCustomerLinksPending.set(cacheKey, task);
    return task;
  }

  function prefetchBulkCreateLinks(cardsArea) {
    if (!(cardsArea instanceof HTMLElement)) return;
    const buttons = Array.from(cardsArea.querySelectorAll('button[data-action="bulk-add-request"]'));
    buttons.forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const requestUrl = normalizeText(button.getAttribute('data-request-url') || '');
      const requestId = normalizeRequestId(button.getAttribute('data-request-id') || '');
      if (!requestUrl && !requestId) return;
      void resolveBulkCustomerLinksFromRequest(requestUrl, requestId).then((links) => {
        if (!links?.createRequestUrl) return;
        button.setAttribute('data-create-url', links.createRequestUrl);
      });
    });
  }

  function phoneMaskMatchesTarget(maskedPhone, targetPhone) {
    const rowDigits = String(maskedPhone || '').replace(/\D/g, '');
    const targetDigits = String(targetPhone || '').replace(/\D/g, '');
    if (targetDigits.length !== 11 || !targetDigits.startsWith('7')) return false;
    if (rowDigits.length < 8) return false;
    const rowPrefix = rowDigits.slice(0, 4);
    const rowSuffix = rowDigits.slice(-4);
    const targetPrefix = targetDigits.slice(0, 4);
    const targetSuffix = targetDigits.slice(-4);
    return rowPrefix === targetPrefix && rowSuffix === targetSuffix;
  }

  function extractRequestIdFromUpdateUrl(value) {
    const raw = normalizeText(value || '');
    if (!raw) return '';
    try {
      const parsed = new URL(raw, location.origin);
      return normalizeRequestId(parsed.searchParams.get('id') || '');
    } catch (_error) {
      const match = raw.match(/[?&]id=(\d+)/i);
      return normalizeRequestId(match?.[1] || '');
    }
  }

  function extractBulkPhonesFromText(text) {
    const src = String(text || '');
    const matches = src.match(/(?:\+7|8)[\s\-()]*\d(?:[\s\-()]*\d){9}/g) || [];
    const seen = new Set();
    const result = [];
    matches.forEach((raw) => {
      const phone = normalizeBulkPhone(raw);
      if (!phone || seen.has(phone)) return;
      seen.add(phone);
      result.push(phone);
    });
    return result;
  }

  function normalizeBulkPhonesList(list) {
    const src = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
    src.forEach((value) => {
      const phone = normalizeBulkPhone(value);
      if (!phone || seen.has(phone)) return;
      seen.add(phone);
      out.push(phone);
    });
    return out;
  }

  function readSavedBulkPhones() {
    try {
      const raw = sessionStorage.getItem(BULK_SAVED_NUMBERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return normalizeBulkPhonesList(Array.isArray(parsed) ? parsed : []);
    } catch (_error) {
      return [];
    }
  }

  function writeSavedBulkPhones(list) {
    const normalized = normalizeBulkPhonesList(list);
    try {
      if (normalized.length) {
        sessionStorage.setItem(BULK_SAVED_NUMBERS_KEY, JSON.stringify(normalized));
      } else {
        sessionStorage.removeItem(BULK_SAVED_NUMBERS_KEY);
      }
    } catch (_error) {}
    bulkPhoneUiState.savedPhones = normalized;
    return normalized;
  }

  function mergeUniquePhones(baseList, appendList) {
    const seen = new Set();
    const out = [];
    normalizeBulkPhonesList(baseList).forEach((phone) => {
      if (seen.has(phone)) return;
      seen.add(phone);
      out.push(phone);
    });
    normalizeBulkPhonesList(appendList).forEach((phone) => {
      if (seen.has(phone)) return;
      seen.add(phone);
      out.push(phone);
    });
    return out;
  }

  function getCurrentBulkSearchPhones() {
    if (state.remote.kind !== 'bulk-phones' || !Array.isArray(state.remote.rows)) return [];
    return normalizeBulkPhonesList(
      state.remote.rows
        .filter((row) => row?.isBulkHeader)
        .map((row) => row?.bulkPhone || '')
    );
  }

  function getBulkClipboardFreshPhones() {
    const clipboard = normalizeBulkPhonesList(bulkPhoneUiState.clipboardPhones);
    const saved = normalizeBulkPhonesList(bulkPhoneUiState.savedPhones);
    const alreadyOpen = getCurrentBulkSearchPhones();
    const blocked = mergeUniquePhones(saved, alreadyOpen);
    if (!clipboard.length || !blocked.length) return clipboard.slice();
    return clipboard.filter((phone) => !blocked.includes(phone));
  }

  function getBulkPhonesToOpen() {
    const saved = normalizeBulkPhonesList(bulkPhoneUiState.savedPhones);
    const alreadyOpen = getCurrentBulkSearchPhones();
    const source = saved.length ? saved.slice() : normalizeBulkPhonesList(bulkPhoneUiState.clipboardPhones);
    return alreadyOpen.length ? source.filter((phone) => !alreadyOpen.includes(phone)) : source;
  }

  const NOTICE_HOST_STYLE = 'position:fixed;right:16px;top:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;pointer-events:none;';

  function getNoticeHost() {
    let host = document.getElementById('tmBulkPhonesNoticeHost');
    if (!(host instanceof HTMLElement)) {
      host = document.createElement('div');
      host.id = 'tmBulkPhonesNoticeHost';
      document.body.appendChild(host);
    }
    host.style.cssText = NOTICE_HOST_STYLE;
    return host;
  }

  function showBulkPhonesNotice(message) {
    const text = normalizeText(message);
    if (!text) return;
    const host = getNoticeHost();
    const note = document.createElement('div');
    note.className = 'tm-bulk-phone-note';
    note.textContent = text;
    host.appendChild(note);
    requestAnimationFrame(() => note.classList.add('show'));
    setTimeout(() => {
      note.classList.remove('show');
      setTimeout(() => note.remove(), 220);
    }, 2300);
  }

  function formatPhoneRu(raw) {
    const d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
      return `+7 ${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7,11)}`;
    }
    if (d.length === 10) {
      return `+7 ${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6,10)}`;
    }
    return raw;
  }

  // Стек активных уведомлений — для расчёта top каждого следующего
  const _dupNoticeStack = [];
  const _DUP_NOTICE_TOP = 16;
  const _DUP_NOTICE_GAP = 8;

  function _dupNoticeReflow() {
    let top = _DUP_NOTICE_TOP;
    _dupNoticeStack.forEach((n) => {
      n.style.top = top + 'px';
      top += n.offsetHeight + _DUP_NOTICE_GAP;
    });
  }

  function showDuplicateNotice(phones) {
    const DURATION = 5000;

    // Считаем правильный top ДО добавления в DOM — новое уведомление
    // сразу появляется на нужной позиции, без анимации прыжка
    let startTop = _DUP_NOTICE_TOP;
    _dupNoticeStack.forEach((n) => { startTop += n.offsetHeight + _DUP_NOTICE_GAP; });

    const note = document.createElement('div');
    note.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:' + startTop + 'px',
      'z-index:2147483647',
      'overflow:hidden',
      'min-width:220px',
      'max-width:min(320px,80vw)',
      'padding:11px 14px 15px 14px',
      'background:#ffffff',
      'border:0.5px solid #E4E2DA',
      'border-left:3px solid #db3b4c',
      'border-radius:10px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:13px',
      'line-height:1.4',
      'box-shadow:0 4px 20px rgba(0,0,0,.11),0 1px 4px rgba(0,0,0,.06)',
      'opacity:0',
      'transform:translateX(calc(100% + 20px))',
      // top-transition пока нет — добавим после слайда, чтобы не анимировать начальную позицию
      'transition:opacity .2s ease,transform .22s cubic-bezier(.22,.68,0,1.1)',
    ].join(';');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:5px;margin-bottom:5px;';
    const icon = document.createElement('span');
    icon.textContent = '⚠';
    icon.style.cssText = 'color:#db3b4c;font-size:12px;line-height:1;flex-shrink:0;';
    head.appendChild(icon);
    const title = document.createElement('span');
    title.style.cssText = 'font-weight:600;font-size:13px;color:#1C1B18;';
    title.textContent = phones.length === 1 ? 'Номер уже в списке' : `Дублей: ${phones.length}`;
    head.appendChild(title);
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('role', 'button');
    closeBtn.title = 'Закрыть';
    closeBtn.style.cssText = 'margin-left:auto;cursor:pointer;color:#9B9A95;font-size:18px;line-height:1;flex-shrink:0;padding:0 0 0 10px;transition:color .14s ease;';
    closeBtn.addEventListener('mouseenter', function () { closeBtn.style.color = '#db3b4c'; });
    closeBtn.addEventListener('mouseleave', function () { closeBtn.style.color = '#9B9A95'; });
    closeBtn.addEventListener('click', function () { if (note.__tmDismiss) note.__tmDismiss(); });
    head.appendChild(closeBtn);
    note.appendChild(head);

    phones.slice(0, 5).forEach((p) => {
      const row = document.createElement('div');
      row.style.cssText = 'font-size:12px;color:#6B6963;margin-top:2px;font-variant-numeric:tabular-nums;';
      row.textContent = formatPhoneRu(p);
      note.appendChild(row);
    });
    if (phones.length > 5) {
      const more = document.createElement('div');
      more.style.cssText = 'font-size:11px;color:#9B9A95;margin-top:3px;';
      more.textContent = `и ещё ${phones.length - 5}`;
      note.appendChild(more);
    }

    // Крепим к <html>, не к <body> — body могут перестраивать
    document.documentElement.appendChild(note);
    _dupNoticeStack.push(note);
    // Не вызываем reflow при добавлении — top уже верный, reflow не нужен

    // Slide in: сначала слайд, потом включаем top-transition для будущих reflow
    void note.getBoundingClientRect();
    requestAnimationFrame(() => {
      note.style.opacity = '1';
      note.style.transform = 'translateX(0)';
      // Включаем top-transition только после появления
      note.style.transition = 'opacity .2s ease,transform .22s cubic-bezier(.22,.68,0,1.1),top .22s ease';
    });

    // Постоянное уведомление: закрывается только по крестику (без авто-таймера и прогресс-бара).
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      note.style.transition = 'opacity .18s ease,transform .18s ease';
      note.style.opacity = '0';
      note.style.transform = 'translateX(calc(100% + 20px))';
      setTimeout(() => {
        note.remove();
        const idx = _dupNoticeStack.indexOf(note);
        if (idx >= 0) _dupNoticeStack.splice(idx, 1);
        _dupNoticeReflow();
      }, 220);
    };
    note.__tmDismiss = dismiss;
  }

  function updateBulkPhonesButtonUi() {
    const btn = document.getElementById('tmBulkPhonesBtn');
    if (!(btn instanceof HTMLButtonElement)) return;
    const badgeNode = btn.querySelector('.bulk-n');
    const openLabel = btn.querySelector('.bulk-btn-label-open');
    const messageLabel = btn.querySelector('.bulk-btn-label-message');

    const clipboard = normalizeBulkPhonesList(bulkPhoneUiState.clipboardPhones);
    const saved = normalizeBulkPhonesList(bulkPhoneUiState.savedPhones);
    const fresh = getBulkClipboardFreshPhones();
    const duplicateClipboardCount = Math.max(0, clipboard.length - fresh.length);
    const hiddenBulkBlocks = hasHiddenBulkPhones() && state.remote.kind !== 'bulk-phones';
    const searchingBulkPhones = state.remote.kind === 'bulk-phones' && Boolean(state.remote.loading);
    const buttonMessage = normalizeText(bulkPhoneUiState.buttonMessage || '');
    const addMode = Boolean(!hiddenBulkBlocks && !searchingBulkPhones && !buttonMessage && bulkPhoneUiState.ctrlDown && fresh.length > 0);
    btn.disabled = Boolean(hiddenBulkBlocks || searchingBulkPhones || buttonMessage);
    btn.classList.toggle('is-add-mode', addMode);
    btn.classList.toggle('is-disabled', hiddenBulkBlocks || searchingBulkPhones || buttonMessage);
    btn.classList.toggle('is-message', Boolean(buttonMessage));
    if (openLabel) openLabel.textContent = 'Открыть номера';
    if (messageLabel) messageLabel.textContent = buttonMessage || 'Номеров нету';
    const totalToOpen = getBulkPhonesToOpen().length;
    if (badgeNode) {
      badgeNode.textContent = saved.length ? `${fresh.length}+${saved.length}` : String(fresh.length);
      badgeNode.style.display = buttonMessage ? 'none' : 'inline-flex';
    }
    btn.title = hiddenBulkBlocks
      ? 'Сначала откройте или закройте пропущенные номера'
      : (searchingBulkPhones ? 'Идёт поиск номеров' : (buttonMessage || (saved.length
      ? `Добавится: ${totalToOpen}. Буфер новых: ${fresh.length} | Запомнено: ${saved.length} | Дублей в буфере: ${duplicateClipboardCount}`
      : `Добавится: ${totalToOpen}. Буфер: ${fresh.length}. Ctrl+клик добавляет номера в память`)));
  }

  function flashBulkPhonesButtonMessage(message, duration = 1600) {
    clearTimeout(bulkPhoneUiState.buttonMessageTimer);
    bulkPhoneUiState.buttonMessage = normalizeText(message || '');
    updateBulkPhonesButtonUi();
    bulkPhoneUiState.buttonMessageTimer = setTimeout(() => {
      bulkPhoneUiState.buttonMessage = '';
      updateBulkPhonesButtonUi();
    }, duration);
  }

  async function refreshBulkClipboardPhones(force) {
    // Вкладка в фоне/свёрнута — не дёргаем сервер за bulk-телефоны (кроме явного force).
    if (!force && typeof document !== 'undefined' && document.hidden) return normalizeBulkPhonesList(bulkPhoneUiState.clipboardPhones);
    const now = Date.now();
    if (!force && (now - Number(bulkPhoneUiState.lastClipboardSyncAt || 0)) < 1200) {
      return normalizeBulkPhonesList(bulkPhoneUiState.clipboardPhones);
    }
    bulkPhoneUiState.lastClipboardSyncAt = now;
    try {
      const text = await navigator.clipboard.readText();
      bulkPhoneUiState.clipboardPhones = extractBulkPhonesFromText(text);
      try { rememberBulkSourcesFromText(text); } catch (_e) {}
      try { rememberBulkCallSipFromText(text); } catch (_e) {}
    } catch (_error) {
      bulkPhoneUiState.clipboardPhones = bulkPhoneUiState.clipboardPhones || [];
    }
    updateBulkPhonesButtonUi();
    return normalizeBulkPhonesList(bulkPhoneUiState.clipboardPhones);
  }

  function buildPhoneSearchUrl(phone, page = 1) {
    const normalizedPhone = normalizeBulkPhone(phone);
    if (!normalizedPhone) return '';
    const url = new URL('/admin/domain/customer-request/index', location.origin);
    const digits = String(normalizedPhone).replace(/\D/g, '');
    url.searchParams.set('CRSearch[phone]', digits);
    url.searchParams.set('page', String(Math.max(1, Number(page || 1))));
    url.searchParams.set('per-page', '30');
    url.searchParams.set('sort', '-id');
    return url.toString();
  }

  function findNativeStatusFilterSelect() {
    return document.querySelector('select#crsearch-status')
      || document.querySelector('tr#cr-index-grid-filters select[name="CRSearch[status][]"]')
      || document.querySelector('select[name="CRSearch[status][]"]');
  }

  function findNativeCityFilterSelect() {
    return document.querySelector('select#crsearch-city_id')
      || document.querySelector('tr#cr-index-grid-filters select[name="CRSearch[city_id]"]')
      || document.querySelector('select[name="CRSearch[city_id]"]');
  }

  function findNativeAuthorFilterSelect() {
    return document.querySelector('select#crsearch-author_id')
      || document.querySelector('tr#cr-index-grid-filters select[name="CRSearch[author_id]"]')
      || document.querySelector('select[name="CRSearch[author_id]"]');
  }

  function findNativeTypeFilterSelect() {
    return document.querySelector('select#crsearch-type')
      || document.querySelector('tr#cr-index-grid-filters select[name="CRSearch[type]"]')
      || document.querySelector('select[name="CRSearch[type]"]');
  }

  function findNativePhoneFilterInput() {
    return document.querySelector('tr#cr-index-grid-filters input[name="CRSearch[phone]"]')
      || document.querySelector('#cr-index-grid-filters input[name="CRSearch[phone]"]')
      || document.querySelector('input[name="CRSearch[phone]"]');
  }

  function getFilterPhoneNationalDigits(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    return digits.slice(0, 10);
  }

  function formatFilterPhone(value) {
    const digits = getFilterPhoneNationalDigits(value);
    if (!digits) return '+7';
    const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)]
      .filter(Boolean);
    return `+7 ${groups.join('-')}`;
  }

  function bindFilterPhoneMask(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.phoneMaskBound === '1') return;
    input.dataset.phoneMaskBound = '1';
    input.inputMode = 'tel';
    input.autocomplete = 'off';
    input.maxLength = 16;

    const applyMask = (source = input.value) => {
      input.value = formatFilterPhone(source);
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    };

    input.addEventListener('input', () => applyMask());
    input.addEventListener('focus', () => applyMask());
    input.addEventListener('paste', (event) => {
      const pasted = event.clipboardData?.getData('text') || '';
      if (!pasted) return;
      event.preventDefault();
      applyMask(pasted);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('keydown', (event) => {
      if ((event.key === 'Backspace' || event.key === 'Delete')
        && getFilterPhoneNationalDigits(input.value).length === 0) {
        event.preventDefault();
      }
    });

    applyMask();
  }

  function isFilterAddressHouseToken(value) {
    const normalized = normalizeText(value || '').replace(/^(?:д(?:ом)?\.?\s*)/i, '');
    if (!normalized) return false;
    return /^(?:к[а-яa-z]?\d+[а-яa-z]?|[сСcC][а-яa-z]?\d+[а-яa-z]?|\d+[а-я]?(?:\/\d+[а-яa-z]?)?(?:[кК][а-яa-z]?\d+[а-яa-z]?)?(?:[сСcC][а-яa-z]?\d+[а-яa-z]?)?(?:[-\s]\d+[а-я]?)?(?:(?:\s*|)лит(?:ер)?\.?\s*[а-яa-z0-9-]+)?)$/i.test(normalized);
  }

  function extractFilterAddressHouse(text) {
    const source = normalizeText(text || '');
    if (!source) return { street: '', house: '' };

    const cleanHouse = (value) => normalizeText(value || '').replace(/^(?:д(?:ом)?\.?\s*)/i, '');
    const parts = source.split(',').map((part) => normalizeText(part)).filter(Boolean);
    if (parts.length < 2) return { street: source, house: '' };

    const hasKilometer = /\d+\s*-?[йы]?\s*километр|\d+\s*км/i.test(source);
    const lastPart = parts[parts.length - 1];
    const cleanedLastPart = cleanHouse(lastPart);
    if (hasKilometer && isFilterAddressHouseToken(lastPart)) {
      return { street: parts.slice(0, -1).join(', '), house: cleanedLastPart };
    }

    const firstPart = parts[0];
    const cleanedFirstPart = cleanHouse(firstPart);
    const restStreet = parts.slice(1).join(', ');
    const streetHintPatterns = [
      /\bулиц|\bул\.?/i,
      /\bпереул|\bпер\.?/i,
      /\bпросп|\bпр-т\b/i,
      /\bбульв|\bб-р\b/i,
      /\bшоссе\b|\bтракт\b|\bпроезд\b|\bтупик\b|\bлиния\b|\bаллея\b/i,
      /\bнабережн|\bплощад/i,
      /\b[1-9]-[йя]/i
    ];
    if (isFilterAddressHouseToken(firstPart)
      && restStreet
      && streetHintPatterns.some((pattern) => pattern.test(restStreet))) {
      return { street: restStreet, house: cleanedFirstPart };
    }

    const specialLastPart = /(?:переулок|пер\.|проспект|пр-т|бульвар|б-р|шоссе|тракт|проезд|тупик|линия|аллея)/i.test(lastPart);
    if (!specialLastPart && isFilterAddressHouseToken(lastPart)) {
      return { street: parts.slice(0, -1).join(', '), house: cleanedLastPart };
    }

    return { street: source, house: '' };
  }

  function bindFilterAddressHouseTransfer(streetInput, houseInput) {
    if (!(streetInput instanceof HTMLInputElement)
      || !(houseInput instanceof HTMLInputElement)
      || streetInput.dataset.houseTransferBound === '1') return;

    streetInput.dataset.houseTransferBound = '1';
    let processing = false;
    let pastePending = false;
    let lastProcessedStreet = '';
    let inputTimer = 0;

    const transferHouse = () => {
      if (processing) return false;
      const streetValue = normalizeText(streetInput.value || '');
      if (!streetValue) return false;
      const result = extractFilterAddressHouse(streetValue);
      if (!result.house) return false;

      processing = true;
      streetInput.value = result.street;
      houseInput.value = result.house;
      lastProcessedStreet = result.street;
      ['input', 'change'].forEach((eventName) => {
        streetInput.dispatchEvent(new Event(eventName, { bubbles: true }));
        houseInput.dispatchEvent(new Event(eventName, { bubbles: true }));
      });
      processing = false;
      return true;
    };

    streetInput.addEventListener('paste', () => {
      pastePending = true;
      clearTimeout(inputTimer);
      setTimeout(() => {
        transferHouse();
        pastePending = false;
      }, 50);
    });

    streetInput.addEventListener('input', () => {
      if (processing || pastePending) return;
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        const currentValue = normalizeText(streetInput.value || '');
        if (currentValue && currentValue !== lastProcessedStreet) transferHouse();
      }, 500);
    });

    streetInput.addEventListener('blur', () => {
      clearTimeout(inputTimer);
      setTimeout(() => {
        const currentValue = normalizeText(streetInput.value || '');
        if (currentValue && currentValue !== lastProcessedStreet) transferHouse();
      }, 100);
    });
  }

  function findNativeAddressLocalityFilterInput() {
    return document.querySelector('input[name="CRSearch[address][locality]"]');
  }

  function findNativeAddressStreetFilterInput() {
    return document.querySelector('input[name="CRSearch[address][street]"]');
  }

  function findNativeAddressBuildingFilterInput() {
    return document.querySelector('input[name="CRSearch[address][building]"]');
  }

  function findNativeAddressOfficeFilterInput() {
    return document.querySelector('input[name="CRSearch[address][office]"]');
  }

  function setNativeSelectValueByText(selectEl, textValue) {
    if (!(selectEl instanceof HTMLSelectElement)) return false;
    const target = normalizeText(textValue).toLowerCase();
    const isEmpty = !target;
    let changed = false;

    if (selectEl.multiple) {
      Array.from(selectEl.options).forEach((opt) => {
        const next = !isEmpty && normalizeText(opt.textContent).toLowerCase() === target;
        if (opt.selected !== next) {
          opt.selected = next;
          changed = true;
        }
      });
    } else {
      let matchedValue = '';
      if (!isEmpty) {
        const opt = Array.from(selectEl.options).find((o) => normalizeText(o.textContent).toLowerCase() === target);
        if (opt) matchedValue = String(opt.value || '');
      }
      if (String(selectEl.value || '') !== matchedValue) {
        selectEl.value = matchedValue;
        changed = true;
      }
    }

    if (changed) {
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return changed;
  }

  function normalizeFilterSection(section) {
    const value = normalizeText(section || '').toLowerCase();
    return value === 'main' || value === 'address' ? value : 'all';
  }

  function filterSectionUsesMain(section) {
    return normalizeFilterSection(section) !== 'address';
  }

  function filterSectionUsesAddress(section) {
    return normalizeFilterSection(section) !== 'main';
  }

  function setNativeInputValue(inputEl, nextValue) {
    if (!(inputEl instanceof HTMLInputElement)) return false;
    const next = normalizeText(nextValue || '');
    if (normalizeText(inputEl.value || '') === next) return false;
    inputEl.value = next;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function syncCustomFiltersToNativeControls(section = 'all') {
    const useMain = filterSectionUsesMain(section);
    const useAddress = filterSectionUsesAddress(section);
    const citySelect = findNativeCityFilterSelect();
    const authorSelect = findNativeAuthorFilterSelect();
    const statusSelect = findNativeStatusFilterSelect();
    const typeSelect = findNativeTypeFilterSelect();
    const phoneInput = findNativePhoneFilterInput();
    const addressLocalityInput = findNativeAddressLocalityFilterInput();
    const addressStreetInput = findNativeAddressStreetFilterInput();
    const addressBuildingInput = findNativeAddressBuildingFilterInput();
    const addressOfficeInput = findNativeAddressOfficeFilterInput();
    const customCitySelect = document.getElementById('tmFilterCity');
    const customAuthorSelect = document.getElementById('tmFilterAuthor');
    const customPhoneInput = document.getElementById('tmFilterPhone');
    const customAddressCityInput = document.getElementById('tmFilterAddressCity');
    const customStreetInput = document.getElementById('tmFilterStreet');
    const customHouseInput = document.getElementById('tmFilterHouse');
    const customFlatInput = document.getElementById('tmFilterFlat');
    const statusText = useMain ? normalizeText(document.getElementById('tmFilterStatus')?.value || '') : '';
    const typeText = useMain ? normalizeText(document.getElementById('tmFilterType')?.value || '') : '';
    if (citySelect instanceof HTMLSelectElement && customCitySelect instanceof HTMLSelectElement) {
      const nextValue = useMain ? normalizeText(customCitySelect.value || '') : '';
      if (String(citySelect.value || '') !== nextValue) {
        citySelect.value = nextValue;
        citySelect.dispatchEvent(new Event('input', { bubbles: true }));
        citySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (authorSelect instanceof HTMLSelectElement && customAuthorSelect instanceof HTMLSelectElement) {
      const nextValue = useMain ? normalizeText(customAuthorSelect.value || '') : '';
      if (String(authorSelect.value || '') !== nextValue) {
        authorSelect.value = nextValue;
        authorSelect.dispatchEvent(new Event('input', { bubbles: true }));
        authorSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (phoneInput instanceof HTMLInputElement && customPhoneInput instanceof HTMLInputElement) {
      const nextValue = useMain && getFilterPhoneNationalDigits(customPhoneInput.value).length
        ? formatFilterPhone(customPhoneInput.value)
        : '';
      setNativeInputValue(phoneInput, nextValue);
    }
    if (addressLocalityInput instanceof HTMLInputElement && customAddressCityInput instanceof HTMLInputElement) {
      const nextValue = useAddress ? normalizeText(customAddressCityInput.value || '') : '';
      setNativeInputValue(addressLocalityInput, nextValue);
    }
    if (addressStreetInput instanceof HTMLInputElement && customStreetInput instanceof HTMLInputElement) {
      const nextValue = useAddress ? normalizeText(customStreetInput.value || '') : '';
      setNativeInputValue(addressStreetInput, nextValue);
    }
    if (addressBuildingInput instanceof HTMLInputElement && customHouseInput instanceof HTMLInputElement) {
      const nextValue = useAddress ? normalizeText(customHouseInput.value || '') : '';
      setNativeInputValue(addressBuildingInput, nextValue);
    }
    if (addressOfficeInput instanceof HTMLInputElement && customFlatInput instanceof HTMLInputElement) {
      const nextValue = useAddress ? normalizeText(customFlatInput.value || '') : '';
      setNativeInputValue(addressOfficeInput, nextValue);
    }
    setNativeSelectValueByText(statusSelect, statusText);
    setNativeSelectValueByText(typeSelect, typeText);
  }

  function hasServerFilterCriteria(section = 'all') {
    const useMain = filterSectionUsesMain(section);
    const useAddress = filterSectionUsesAddress(section);
    const cityValue = normalizeText(document.getElementById('tmFilterCity')?.value || '');
    const authorValue = normalizeText(document.getElementById('tmFilterAuthor')?.value || '');
    const phoneValue = getFilterPhoneNationalDigits(document.getElementById('tmFilterPhone')?.value || '');
    const addressCityValue = normalizeText(document.getElementById('tmFilterAddressCity')?.value || '');
    const streetValue = normalizeText(document.getElementById('tmFilterStreet')?.value || '');
    const houseValue = normalizeText(document.getElementById('tmFilterHouse')?.value || '');
    const flatValue = normalizeText(document.getElementById('tmFilterFlat')?.value || '');
    const statusValue = normalizeText(document.getElementById('tmFilterStatus')?.value || '');
    const typeValue = normalizeText(document.getElementById('tmFilterType')?.value || '');
    return Boolean(
      (useMain && (cityValue || authorValue || phoneValue || statusValue || typeValue))
      || (useAddress && (addressCityValue || streetValue || houseValue || flatValue))
    );
  }

  function buildServerFilterUrlFromNativeControls(section = 'all') {
    const useMain = filterSectionUsesMain(section);
    const useAddress = filterSectionUsesAddress(section);
    const url = new URL(location.href);
    url.searchParams.delete('page');
    url.searchParams.delete('per-page');

    // Clear known status/type params before reapplying current selection
    url.searchParams.delete('CRSearch[status]');
    url.searchParams.delete('CRSearch[status][]');
    url.searchParams.delete('CRSearch[status][0]');
    url.searchParams.delete('CRSearch[type]');
    url.searchParams.delete('CRSearch[city_id]');
    url.searchParams.delete('CRSearch[author_id]');
    url.searchParams.delete('CRSearch[phone]');
    url.searchParams.delete('CRSearch[address][locality]');
    url.searchParams.delete('CRSearch[address][street]');
    url.searchParams.delete('CRSearch[address][building]');
    url.searchParams.delete('CRSearch[address][office]');

    const statusSelect = findNativeStatusFilterSelect();
    if (useMain && statusSelect instanceof HTMLSelectElement) {
      const selectedValues = Array.from(statusSelect.options)
        .filter((opt) => opt.selected && normalizeText(opt.value) !== '')
        .map((opt) => String(opt.value));
      if (selectedValues.length === 1) {
        url.searchParams.set('CRSearch[status][0]', selectedValues[0]);
      } else if (selectedValues.length > 1) {
        selectedValues.forEach((value) => {
          url.searchParams.append('CRSearch[status][]', value);
        });
      }
    }

    const typeSelect = findNativeTypeFilterSelect();
    if (useMain && typeSelect instanceof HTMLSelectElement) {
      const typeValue = normalizeText(typeSelect.value || '');
      if (typeValue) {
        url.searchParams.set('CRSearch[type]', typeValue);
      }
    }

    const citySelect = findNativeCityFilterSelect();
    if (useMain && citySelect instanceof HTMLSelectElement) {
      const cityValue = normalizeText(citySelect.value || '');
      if (cityValue) {
        url.searchParams.set('CRSearch[city_id]', cityValue);
      }
    }

    const authorSelect = findNativeAuthorFilterSelect();
    if (useMain && authorSelect instanceof HTMLSelectElement) {
      const authorValue = normalizeText(authorSelect.value || '');
      if (authorValue) {
        url.searchParams.set('CRSearch[author_id]', authorValue);
      }
    }

    const phoneInput = findNativePhoneFilterInput();
    if (useMain && phoneInput instanceof HTMLInputElement) {
      const phoneValue = normalizeText(phoneInput.value || '');
      if (phoneValue) {
        url.searchParams.set('CRSearch[phone]', phoneValue);
      }
    }

    const addressLocalityInput = findNativeAddressLocalityFilterInput();
    if (useAddress && addressLocalityInput instanceof HTMLInputElement) {
      const value = normalizeText(addressLocalityInput.value || '');
      if (value) url.searchParams.set('CRSearch[address][locality]', value);
    }
    const addressStreetInput = findNativeAddressStreetFilterInput();
    if (useAddress && addressStreetInput instanceof HTMLInputElement) {
      const value = normalizeText(addressStreetInput.value || '');
      if (value) url.searchParams.set('CRSearch[address][street]', value);
    }
    const addressBuildingInput = findNativeAddressBuildingFilterInput();
    if (useAddress && addressBuildingInput instanceof HTMLInputElement) {
      const value = normalizeText(addressBuildingInput.value || '');
      if (value) url.searchParams.set('CRSearch[address][building]', value);
    }
    const addressOfficeInput = findNativeAddressOfficeFilterInput();
    if (useAddress && addressOfficeInput instanceof HTMLInputElement) {
      const value = normalizeText(addressOfficeInput.value || '');
      if (value) url.searchParams.set('CRSearch[address][office]', value);
    }

    return url.toString();
  }

  function parseActivePageNumberFromDoc(doc) {
    const activeNode = doc?.querySelector('nav ul.pagination li.active a, nav ul.pagination li.active span, ul.pagination li.active a, ul.pagination li.active span');
    const activeText = normalizeText(activeNode?.textContent || '');
    const activeNum = Number(activeText);
    if (Number.isFinite(activeNum) && activeNum > 0) return activeNum;
    const nums = Array.from(doc?.querySelectorAll('ul.pagination li a, ul.pagination li span') || [])
      .map((el) => Number(normalizeText(el.textContent)))
      .filter((n) => Number.isFinite(n) && n > 0);
    return nums.length ? Math.max(...nums) : 1;
  }

  function parseLastPageNumberFromDoc(doc) {
    const candidates = [];
    const links = Array.from(doc?.querySelectorAll('ul.pagination a[href], nav ul.pagination a[href]') || []);
    links.forEach((link) => {
      const textNum = Number(normalizeText(link.textContent || ''));
      if (Number.isFinite(textNum) && textNum > 0) candidates.push(textNum);
      try {
        const href = link.getAttribute('href') || '';
        const abs = new URL(href, location.origin);
        const pageNum = Number(abs.searchParams.get('page'));
        if (Number.isFinite(pageNum) && pageNum > 0) candidates.push(pageNum);
      } catch (_error) {}
    });
    const explicitLast = doc?.querySelector('ul.pagination li.last a[href], nav ul.pagination li.last a[href]');
    if (explicitLast) {
      try {
        const abs = new URL(explicitLast.getAttribute('href') || '', location.origin);
        const pageNum = Number(abs.searchParams.get('page'));
        if (Number.isFinite(pageNum) && pageNum > 0) candidates.push(pageNum);
      } catch (_error) {}
    }
    if (!candidates.length) return Math.max(1, parseActivePageNumberFromDoc(doc));
    return Math.max(1, ...candidates);
  }

  function isSameRemoteRun(seq, expectedKind) {
    return seq === state.remote.seq
      && normalizeText(state.remote.kind || '') === normalizeText(expectedKind || '');
  }

  // Идентификатор «прогона» фильтра/режима: меняется при смене фильтра,
  // но НЕ при переключении страниц — чтобы навигация не сбивала фоновый
  // поиск последней страницы («Ищу последнюю...»).
  function isSameFilterRun(runId, expectedKind) {
    return Number(state.remote.filterRunId || 0) === Number(runId)
      && normalizeText(state.remote.kind || '') === normalizeText(expectedKind || '');
  }

  async function detectRemoteLastPageInBackground(baseUrl, runId, expectedKind) {
    if (!baseUrl) return;
    const modeKind = normalizeText(expectedKind || state.remote.kind || '');
    if (!modeKind) return;
    state.remote.filterTotalLoading = true;
    renderAll();
    try {
      const probeUrl = new URL(baseUrl, location.origin);
      probeUrl.searchParams.set('page', '100000');
      probeUrl.searchParams.set('per-page', '30');
      const response = await fetch(probeUrl.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await response.text();
      if (!isSameFilterRun(runId, modeKind)) return;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const lastPage = Math.max(parseActivePageNumberFromDoc(doc), parseLastPageNumberFromDoc(doc));
      state.remote.filterTotalPages = Math.max(1, Number(lastPage || 1));
    } catch (_error) {
      if (!isSameFilterRun(runId, modeKind)) return;
      state.remote.filterTotalPages = Math.max(1, Number(state.remote.filterPage || 1));
    } finally {
      if (!isSameFilterRun(runId, modeKind)) return;
      state.remote.filterTotalLoading = false;
      renderAll();
    }
  }

  async function loadRowsByServerFilterPage(pageNumber, forceRender = true, detectLastPage = false) {
    const nextPage = Math.max(1, Number(pageNumber || 1));
    const filterSection = normalizeFilterSection(state.remote.filterSection || 'all');
    const baseUrl = normalizeText(state.remote.filterBaseUrl || buildServerFilterUrlFromNativeControls(filterSection));
    const seq = ++state.remote.seq;
    state.remote.kind = 'filter';
    state.remote.id = '';
    state.remote.personalModeError = '';
    state.remote.loading = true;
    state.remote.filterPage = nextPage;
    state.remote.filterSection = filterSection;
    if (!state.remote.filterTotalPages || state.remote.filterTotalPages < nextPage) {
      state.remote.filterTotalPages = Math.max(nextPage, Number(state.remote.filterTotalPages || 0));
    }
    if (forceRender) {
      state.remote.rows = null;
      scrollCardsAreaToTop();
      renderAll();
    }

    try {
      const requestUrl = new URL(baseUrl, location.origin);
      requestUrl.searchParams.set('page', String(nextPage));
      requestUrl.searchParams.set('per-page', '30');
      const response = await fetch(requestUrl.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await response.text();
      if (seq !== state.remote.seq || state.remote.kind !== 'filter') return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const grid = doc.querySelector(GRID_SELECTOR);
      const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
      const tbody = table ? table.querySelector('tbody') : null;
      state.remote.rows = parseRowsFromTable(table, tbody, true);
      state.remote.filterPage = nextPage;
      if (!state.remote.filterTotalPages) {
        state.remote.filterTotalPages = Math.max(1, parseActivePageNumberFromDoc(doc));
      }
    } catch (_error) {
      if (seq !== state.remote.seq || state.remote.kind !== 'filter') return;
      state.remote.rows = [];
      state.remote.personalModeError = 'Не удалось загрузить заявки по фильтру';
    } finally {
      if (seq !== state.remote.seq || state.remote.kind !== 'filter') return;
      state.remote.loading = false;
      renderAll();
      if (detectLastPage) {
        void detectRemoteLastPageInBackground(baseUrl, Number(state.remote.filterRunId || 0), 'filter');
      }
    }
  }

  function applyServerFilterMode(forceRender = true, section = 'all') {
    const filterSection = normalizeFilterSection(section);
    const requestUrl = buildServerFilterUrlFromNativeControls(filterSection);
    state.remote.kind = 'filter';
    state.remote.id = '';
    state.remote.personalModeError = '';
    state.remote.filterBaseUrl = requestUrl;
    state.remote.filterSection = filterSection;
    state.remote.filterPage = 1;
    state.remote.filterTotalPages = 0;
    state.remote.filterTotalLoading = false;
    state.remote.filterRunId = (Number(state.remote.filterRunId) || 0) + 1;
    void loadRowsByServerFilterPage(1, forceRender, true);
  }

  function findNativeResetFilterControl() {
    return document.querySelector('div.cr-index-filter-actions button._danger')
      || document.querySelector('div.cr-index-filter-actions a')
      || Array.from(document.querySelectorAll('button._danger,a'))
        .find((node) => /сбросить\s*фильтр/i.test(normalizeText(node.textContent)));
  }

  function findNativeApplyFilterControl() {
    return document.querySelector('#cr-index-apply-filter')
      || document.querySelector('button#cr-index-apply-filter._apply')
      || Array.from(document.querySelectorAll('button._apply,button'))
        .find((node) => /применить\s*фильтр/i.test(normalizeText(node.textContent)));
  }

  function triggerNativeApplyFilter() {
    const control = findNativeApplyFilterControl();
    if (!(control instanceof HTMLElement)) return false;
    control.click();
    return true;
  }

  function triggerNativeResetFilter() {
    const control = findNativeResetFilterControl();
    if (!control) return false;
    const anchor = control instanceof HTMLAnchorElement ? control : control.closest('a');
    if (anchor) {
      anchor.click();
      return true;
    }
    if (control instanceof HTMLElement) {
      control.click();
      return true;
    }
    return false;
  }

  function syncIdFromNativeToCustom() {
    const nativeInput = findNativeIdFilterInput();
    const searchInput = document.getElementById('tmSearchInput');
    if (!nativeInput || !searchInput) return;
    const nativeValue = normalizeText(nativeInput.value || '');
    if (normalizeText(searchInput.value) !== nativeValue) {
      searchInput.value = nativeValue;
    }
    state.filters.id = nativeValue.toLowerCase();
  }

  function syncNativeIdFilter(value, submit) {
    const nativeInput = findNativeIdFilterInput();
    if (!nativeInput) return false;
    const nextValue = String(value ?? '');
    if (nativeInput.value !== nextValue) {
      nativeInput.value = nextValue;
    }

    nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
    nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
    void submit;
    return true;
  }

  async function loadRowsByIdInBackground(rawId) {
    const idValue = normalizeText(rawId);
    const idKey = idValue.toLowerCase();
    const seq = ++state.remote.seq;

    if (!idValue) {
      state.mainScanSeq += 1;
      state.remote.kind = '';
      state.remote.id = '';
      state.remote.rows = null;
      state.remote.loading = false;
      state.remote.personalModeError = '';
      syncFromNative();
      return;
    }

    state.remote.kind = 'id';
    state.remote.id = idKey;
    state.remote.personalModeError = '';
    state.remote.loading = true;
    renderAll();

    try {
      const url = new URL(location.href);
      url.searchParams.set('CRSearch[id]', idValue);
      url.searchParams.delete('page');

      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await response.text();
      if (seq !== state.remote.seq) return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const grid = doc.querySelector(GRID_SELECTOR);
      const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
      const tbody = table ? table.querySelector('tbody') : null;
      state.remote.rows = parseRowsFromTable(table, tbody, true);
    } catch (_error) {
      if (seq !== state.remote.seq) return;
      state.remote.rows = [];
    } finally {
      if (seq !== state.remote.seq) return;
      state.remote.loading = false;
      renderAll();
    }
  }

  async function loadRowsBySinglePhoneInBackground(phone, seq) {
    const targetPhone = normalizeBulkPhone(phone);
    if (!targetPhone) {
      return { rows: [], aborted: false, error: 'Некорректный номер' };
    }
    const baseSearchUrl = buildPhoneSearchUrl(targetPhone, 1);
    if (!baseSearchUrl) {
      return { rows: [], aborted: false, error: 'Некорректный номер' };
    }
    const rowsCollected = [];
    let lastPage = 1;
    const hardPageLimit = 120;
    for (let page = 1; page <= hardPageLimit; page += 1) {
      if (seq !== state.remote.seq || state.remote.kind !== 'bulk-phones') {
        return { rows: rowsCollected, aborted: true };
      }
      const requestUrl = buildPhoneSearchUrl(targetPhone, page);
      if (!requestUrl) {
        return { rows: rowsCollected, aborted: false, error: 'Некорректный номер' };
      }
      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await response.text();
      if (seq !== state.remote.seq || state.remote.kind !== 'bulk-phones') {
        return { rows: rowsCollected, aborted: true };
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const grid = doc.querySelector(GRID_SELECTOR);
      const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
      const tbody = table ? table.querySelector('tbody') : null;
      const rows = parseRowsFromTable(table, tbody, true).map((row) => ({
        ...row,
        bulkPhoneMatchedByServerFilter: true,
        bulkPhoneMatchedByVisiblePhone: phoneMaskMatchesTarget(row?.phone, targetPhone)
      }));
      if (rows.length) rowsCollected.push(...rows);
      if (page === 1) {
        lastPage = Math.max(1, parseLastPageNumberFromDoc(doc));
      }
      if (page >= lastPage) break;
    }
    return { rows: rowsCollected, aborted: false, error: '' };
  }

  async function loadRowsByBulkPhonesInBackground(phonesRaw, options = {}) {
    const phones = normalizeBulkPhonesList(phonesRaw);
    const appendMode = Boolean(options && options.append && state.remote.kind === 'bulk-phones' && Array.isArray(state.remote.rows));
    const baseRows = appendMode ? state.remote.rows.slice() : [];
    const baseGroupCount = appendMode ? baseRows.filter((row) => row?.isBulkHeader).length : 0;
    if (!phones.length) {
      state.remote.kind = 'bulk-phones';
      state.remote.id = '';
      state.remote.rows = [];
      state.remote.loading = false;
      state.remote.bulkPhoneTotal = 0;
      state.remote.bulkPhoneDone = 0;
      state.remote.personalModeError = 'В буфере не найдены номера';
      renderAll();
      return;
    }

    const seq = ++state.remote.seq;
    state.remote.kind = 'bulk-phones';
    state.remote.id = '';
    state.remote.rows = appendMode ? baseRows : null;
    state.remote.loading = true;
    state.remote.personalModeError = '';
    state.remote.bulkPhoneTotal = phones.length;
    state.remote.bulkPhoneDone = 0;
    if (!appendMode) scrollCardsAreaToTop();
    updateBulkPhonesButtonUi();
    renderAll();

    try {
      const tasks = phones.map((phone, index) => (async () => {
        try {
          const result = await loadRowsBySinglePhoneInBackground(phone, seq);
          if (result?.aborted) {
            return {
              phone,
              index,
              rows: [],
              aborted: true,
              error: ''
            };
          }
          const resultRows = Array.isArray(result?.rows) ? result.rows : [];
          return {
            phone,
            index,
            rows: resultRows,
            aborted: false,
            error: normalizeText(result?.error || '')
          };
        } catch (_error) {
          return {
            phone,
            index,
            rows: [],
            aborted: false,
            error: (_error && _error.message) ? String(_error.message) : 'Ошибка запроса'
          };
        } finally {
          try {
            if (seq === state.remote.seq && state.remote.kind === 'bulk-phones') {
              state.remote.bulkPhoneDone = Math.min(
                state.remote.bulkPhoneTotal,
                Number(state.remote.bulkPhoneDone || 0) + 1
              );
              updateBulkPhonesButtonUi();
              renderAll();
            }
          } catch (_renderError) {}
        }
      })());

      const settledRaw = await Promise.allSettled(tasks);
      if (seq !== state.remote.seq || state.remote.kind !== 'bulk-phones') return;
      const settled = settledRaw.map((item, idx) => {
        if (item && item.status === 'fulfilled') return item.value;
        const reason = item && item.status === 'rejected'
          ? ((item.reason && item.reason.message) ? String(item.reason.message) : String(item.reason || 'Ошибка задачи'))
          : 'Ошибка задачи';
        return {
          phone: phones[idx] || '',
          index: idx,
          rows: [],
          aborted: false,
          error: reason
        };
      });

      const groupedRows = [];
      settled
        .sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0))
        .forEach((entry) => {
          const phone = normalizeBulkPhone(entry?.phone || phones[Number(entry?.index || 0)] || '')
            || normalizeText(entry?.phone || phones[Number(entry?.index || 0)] || '');
          const index = Math.max(0, Number(entry?.index || 0));
          const bulkIndex = baseGroupCount + index + 1;
          const rows = filterBulkPhoneGroupRows(dedupeRowsById(Array.isArray(entry?.rows) ? entry.rows : []))
            .map((row) => {
              const visiblePhoneMatch = Boolean(row?.bulkPhoneMatchedByVisiblePhone)
                || phoneMaskMatchesTarget(row?.phone, phone);
              return {
                ...row,
                bulkPhoneMatchedByServerFilter: true,
                bulkPhoneMatchedByVisiblePhone: visiblePhoneMatch
              };
            });
          const error = normalizeText(entry?.error || '');
          groupedRows.push({
            isBulkHeader: true,
            id: `bulk-header-${seq}-${bulkIndex}`,
            bulkPhone: phone,
            bulkIndex,
            bulkCount: rows.length,
            bulkError: error
          });
          rows.forEach((row, rowIdx) => {
            groupedRows.push({
              ...row,
              bulkPhone: phone,
              bulkIndex,
              bulkCompositeId: `${normalizeRequestId(row?.id)}__p${bulkIndex}__r${rowIdx + 1}`
            });
          });
        });

      state.remote.rows = appendMode ? baseRows.concat(groupedRows) : groupedRows;
      const totalRealRows = state.remote.rows.filter((row) => !row?.isBulkHeader).length;
      if (!appendMode && !totalRealRows) {
        state.remote.personalModeError = 'По номерам из буфера ничего не найдено';
      }
    } catch (_error) {
      if (seq !== state.remote.seq || state.remote.kind !== 'bulk-phones') return;
      state.remote.rows = appendMode ? baseRows : [];
      const errorText = (_error && _error.message) ? String(_error.message) : 'Ошибка фонового поиска по номерам';
      state.remote.personalModeError = `Ошибка фонового поиска по номерам: ${errorText}`;
    } finally {
      if (seq !== state.remote.seq || state.remote.kind !== 'bulk-phones') return;
      state.remote.loading = false;
      updateBulkPhonesButtonUi();
      renderAll();
    }
  }

  // Тихое дообновление «Открыть номера»: карточки грузятся один раз, поэтому заявку, добавленную
  // другим диспетчером, не видно. Раз в минуту перепрашиваем номера и синхронизируем группы:
  // добавляем новые заявки И обновляем изменившиеся (статус/время) — bulk-подпись рендера
  // (data-bulk-sig) как раз включает status, так что без обновления самих строк карточка
  // продолжала показывать старый статус («Модерация», хотя заявка уже «На уточнении»).
  // Если после синхронизации ничего не поменялось — НЕ рендерим вообще (иначе рвём выделение).
  // Кого опрашиваем: только номера, которые ещё НЕ прозвонены (без зелёной галочки), плюс
  // ПОСЛЕДНИЙ прозвоненный — по нему изменения ещё ждём. Ранее прозвоненные не трогаем:
  // лишние запросы и лишние перерисовки уже отработанных групп.
  let bulkPhonesRefreshInFlight = false;
  function bulkRowsSignature(rows) {
    try {
      return (Array.isArray(rows) ? rows : []).map((row) => {
        if (row?.isBulkHeader) {
          return `h:${row.bulkIndex}:${normalizeText(row.bulkPhone)}:${normalizeText(row.bulkCount)}:${normalizeText(row.bulkError)}`;
        }
        return `r:${normalizeRequestId(row?.id)}:${normalizeText(row?.status)}:${normalizeText(row?.created || row?.createdFull || '')}`;
      }).join('|');
    } catch (_error) {
      return '';
    }
  }
  function getBulkPhonesToRefresh(phones) {
    try {
      const called = Array.from(bulkCalledPhones);           // Set хранит порядок вставки = порядок прозвона
      const lastCalled = called.length ? called[called.length - 1] : '';
      return phones.filter((phone) => !bulkCalledPhones.has(phone) || phone === lastCalled);
    } catch (_error) {
      return phones;
    }
  }
  async function refreshBulkPhonesInBackground() {
    if (state.remote.kind !== 'bulk-phones') return;
    if (state.remote.loading) return;            // идёт основной поиск — не мешаем
    if (bulkPhonesRefreshInFlight) return;
    if (!Array.isArray(state.remote.rows) || !state.remote.rows.length) return;
    const phones = getBulkPhonesToRefresh(getCurrentBulkSearchPhones());
    if (!phones.length) return;                  // всё прозвонено — обновлять нечего
    // seq НЕ бампим: loadRowsBySinglePhoneInBackground прерывается при смене seq, а нам нужен
    // тихий догруз в рамках текущего поиска. Если юзер запустит новый — seq изменится и мы выйдем.
    const seq = state.remote.seq;
    bulkPhonesRefreshInFlight = true;
    try {
      const settled = await Promise.allSettled(
        phones.map((phone) => loadRowsBySinglePhoneInBackground(phone, seq))
      );
      if (seq !== state.remote.seq || state.remote.kind !== 'bulk-phones') return;
      if (state.remote.loading) return;
      const rows = Array.isArray(state.remote.rows) ? state.remote.rows : null;
      if (!rows || !rows.length) return;

      const freshByPhone = new Map();
      settled.forEach((item, idx) => {
        if (!item || item.status !== 'fulfilled') return;
        const value = item.value;
        if (!value || value.aborted || value.error) return;
        const phone = normalizeBulkPhone(phones[idx] || '');
        if (!phone) return;
        freshByPhone.set(phone, filterBulkPhoneGroupRows(dedupeRowsById(Array.isArray(value.rows) ? value.rows : [])));
      });
      if (!freshByPhone.size) return;

      const before = bulkRowsSignature(rows);
      const out = [];
      let i = 0;
      while (i < rows.length) {
        const row = rows[i];
        i += 1;
        if (!row?.isBulkHeader) { out.push(row); continue; }
        const headerPos = out.length;
        out.push(row);
        const phone = normalizeBulkPhone(row.bulkPhone || '');
        const bulkIndex = row.bulkIndex;
        const groupRows = [];
        while (i < rows.length && !rows[i]?.isBulkHeader) { groupRows.push(rows[i]); i += 1; }
        const fresh = freshByPhone.get(phone);
        if (!fresh) { groupRows.forEach((r) => out.push(r)); continue; }  // номер не опрашивали — как есть

        // NB: именно bulkPhone: phone. Сокращённая запись `bulkPhone,` тут = обращение к
        // несуществующей переменной bulkPhone → ReferenceError на первой же группе со строками,
        // и весь догруз молча падал в общий catch.
        const decorate = (r, compositeId) => ({
          ...r,
          bulkPhone: phone,
          bulkIndex,
          bulkPhoneMatchedByServerFilter: true,
          bulkPhoneMatchedByVisiblePhone: Boolean(r?.bulkPhoneMatchedByVisiblePhone)
            || phoneMaskMatchesTarget(r?.phone, phone),
          bulkCompositeId: compositeId
        });
        // ПОРЯДОК = как отдал сервер (buildPhoneSearchUrl шлёт sort=-id, т.е. новые сверху).
        // Раньше новые дописывались В КОНЕЦ группы — свежая заявка оказывалась под старыми.
        // Существующим сохраняем bulkCompositeId: по нему DOM узнаёт карточку и не мигает.
        const oldById = new Map();
        groupRows.forEach((old) => {
          const id = normalizeRequestId(old?.id);
          if (id) oldById.set(id, old);
        });
        const seen = new Set();
        fresh.forEach((r, idx) => {
          const id = normalizeRequestId(r?.id);
          if (!id) return;
          seen.add(id);
          const old = oldById.get(id);
          out.push(decorate(r, old ? old.bulkCompositeId : `${id}__p${bulkIndex}__r${idx + 1}`));
        });
        // Строки, которых сервер уже не отдаёт, НЕ удаляем — дописываем следом.
        const kept = groupRows.filter((old) => {
          const id = normalizeRequestId(old?.id);
          return !id || !seen.has(id);
        });
        kept.forEach((old) => out.push(old));
        const total = fresh.filter((r) => normalizeRequestId(r?.id)).length + kept.length;
        if (total !== groupRows.length) out[headerPos] = { ...row, bulkCount: total };
      }
      if (bulkRowsSignature(out) === before) return;   // ничего не изменилось — оставляем всё как есть
      state.remote.rows = out;
      renderAll();
    } catch (error) {
      // Тихий фоновый догруз: сеть моргнула — ждём следующей минуты. НО глушить молча нельзя:
      // именно так ReferenceError в decorate съедал весь догруз без единого следа.
      try { console.warn('[v8] bulk refresh failed:', error); } catch (_e) {}
    } finally {
      bulkPhonesRefreshInFlight = false;
    }
  }
  function scheduleBackgroundIdLookup(rawId, immediate) {
    clearTimeout(state.remote.timer);
    const idValue = normalizeText(rawId);
    const idKey = idValue.toLowerCase();
    if (!idValue) {
      state.mainScanSeq += 1;
      state.remote.kind = '';
      state.remote.id = '';
      state.remote.rows = null;
      state.remote.loading = false;
      state.remote.personalModeError = '';
      syncFromNative();
      return;
    }

    state.remote.kind = 'id';
    state.remote.id = idKey;
    state.remote.personalModeError = '';
    state.remote.rows = null;
    state.remote.loading = true;
    renderAll();

    if (immediate) {
      loadRowsByIdInBackground(idValue);
      return;
    }

    state.remote.timer = setTimeout(() => {
      loadRowsByIdInBackground(idValue);
    }, 180);
  }

  function findNativeModerationUrl() {
    const link = document.querySelector('a.btn.btn-sm.btn-danger[href*="__view-mode=4"]')
      || document.querySelector('section.content-header a[href*="__view-mode=4"]');
    const href = link?.getAttribute('href') || '/admin/domain/customer-request/index?__view-mode=4&sort=-id';
    try {
      return new URL(href, location.origin).toString();
    } catch (_error) {
      return `${location.origin}/admin/domain/customer-request/index?__view-mode=4&sort=-id`;
    }
  }

  function getModerationPageUrl(page) {
    try {
      const url = new URL(findNativeModerationUrl());
      if (page > 1) url.searchParams.set('page', String(page));
      else url.searchParams.delete('page');
      return url.toString();
    } catch (_e) {
      const base = findNativeModerationUrl();
      return page > 1 ? `${base}&page=${page}` : base;
    }
  }

  async function fetchModerationPage(pageUrl, signal) {
    const response = await fetch(pageUrl, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const grid = doc.querySelector(GRID_SELECTOR);
    const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
    const tbody = table ? table.querySelector('tbody') : null;
    const parsed = parseRowsFromTable(table, tbody, true).filter((row) => row.statusKey === 'mod');
    return {
      rows: normalizeModerationRowsStrict(parsed),
      lastPage: Math.max(1, Number(parseLastPageNumberFromDoc(doc) || 1))
    };
  }

  let moderationRowsFetchSeq = 0;
  let moderationRowsFetchInProgress = false;
  let moderationRowsAbortController = null;
  let moderationCountFetchInProgress = false;
  let moderationCountFetchAt = 0;

  async function fetchAllModerationRows(isCurrent = () => true, signal = undefined) {
    const buildPageUrl = (page) => {
      try {
        const url = new URL(findNativeModerationUrl(), location.origin);
        if (page > 1) url.searchParams.set('page', String(page));
        else url.searchParams.delete('page');
        return url.toString();
      } catch (_error) {
        return getModerationPageUrl(page);
      }
    };

    const firstPage = await fetchModerationPage(buildPageUrl(1), signal);
    if (!isCurrent()) return null;

    const allRows = firstPage.rows.slice();
    const lastPage = Math.min(MODERATION_MAX_PAGES, Math.max(1, Number(firstPage.lastPage || 1)));
    for (let page = 2; page <= lastPage; page += 1) {
      const pageData = await fetchModerationPage(buildPageUrl(page), signal);
      if (!isCurrent()) return null;
      if (!pageData.rows.length) break;
      allRows.push(...pageData.rows);
    }

    return dedupeModerationRows(allRows);
  }

  function extractModerationServiceComment(doc) {
    const field = doc?.querySelector('textarea[name="CustomerRequest[comments_service]"]')
      || doc?.querySelector('#customerrequest-comments_service')
      || doc?.querySelector('textarea[name*="comments_service"]');
    if (!field) return null;
    return String(field.value || field.textContent || '');
  }

  function extractLastModerationCallDateTime(commentText) {
    const text = String(commentText || '').replace(/\r/g, '\n');
    const parseRuDateTimeToMillisLocal = (value) => {
      const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
      if (!match) return NaN;
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = 2000 + Number(match[3]);
      const hours = Number(match[4]);
      const minutes = Number(match[5]);
      const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
      if (!Number.isFinite(date.getTime())) return NaN;
      if (date.getFullYear() !== year || (date.getMonth() + 1) !== month || date.getDate() !== day) return NaN;
      return date.getTime();
    };
    const pickLatest = (matches) => {
      let bestValue = '';
      let bestTs = NaN;
      matches.forEach((match) => {
        const value = normalizeText(match?.[1] || '');
        const ts = parseRuDateTimeToMillisLocal(value);
        if (!value) return;
        if (!Number.isFinite(bestTs) || (Number.isFinite(ts) && ts >= bestTs)) {
          bestValue = value;
          bestTs = ts;
        }
      });
      return bestValue;
    };
    const notAnswerMatches = Array.from(text.matchAll(/(\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2})\s*не\s*отвечает/gi));
    if (notAnswerMatches.length) {
      return pickLatest(notAnswerMatches);
    }
    const dateTimeMatches = Array.from(text.matchAll(/(\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2})/g));
    return pickLatest(dateTimeMatches);
  }

  function writeModerationNoAnswerCacheEntry(requestId, value) {
    const id = normalizeRequestId(requestId);
    if (!id) return;
    const now = Date.now();
    let cache = {};
    try {
      const raw = localStorage.getItem(MODERATION_NO_ANSWER_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        cache = parsed;
      }
    } catch (_error) {}

    Object.keys(cache).forEach((key) => {
      const updatedAt = Number(cache[key]?.updatedAt || 0);
      if (!updatedAt || (now - updatedAt) > MODERATION_NO_ANSWER_CACHE_TTL_MS) {
        delete cache[key];
      }
    });
    const prevCachedValue = normalizeText(cache[id]?.value || '');
    const effectiveValue = shouldReplaceModerationCallValue(prevCachedValue, value)
      ? normalizeText(value || '')
      : prevCachedValue;
    cache[id] = {
      value: effectiveValue,
      updatedAt: now
    };
    try {
      localStorage.setItem(MODERATION_NO_ANSWER_CACHE_KEY, JSON.stringify(cache));
    } catch (_error) {}
    moderationNoAnswerCacheMemo.readAt = 0;
  }

  function applyModerationCallState(requestId, value, updatedAt = Date.now()) {
    const id = normalizeRequestId(requestId);
    if (!id) return;
    const prevValue = normalizeText(moderationCallStateById.get(id)?.value || '');
    const effectiveValue = shouldReplaceModerationCallValue(prevValue, value)
      ? normalizeText(value || '')
      : prevValue;
    const entry = {
      value: effectiveValue,
      updatedAt: Number(updatedAt || Date.now())
    };
    moderationCallStateById.set(id, entry);
    const applyToList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((row) => {
        if (normalizeRequestId(row?.id || '') !== id) return;
        row.moderationCallValue = entry.value;
        row.moderationCallCheckedAt = entry.updatedAt;
      });
    };
    applyToList(state.rows);
    applyToList(state.remote.rows);
  }

  function hydrateModerationCallStates(rows, options = {}) {
    const includePersistentCache = options.includePersistentCache !== false;
    const cache = includePersistentCache ? readModerationNoAnswerCacheMap() : {};
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const id = normalizeRequestId(row?.id || '');
      const memoryEntry = moderationCallStateById.get(id);
      const cacheEntry = includePersistentCache ? cache[id] : null;
      const entry = memoryEntry && Number(memoryEntry.updatedAt || 0) >= Number(cacheEntry?.updatedAt || 0)
        ? memoryEntry
        : cacheEntry;
      if (!entry) return row;
      return {
        ...row,
        moderationCallValue: normalizeText(entry.value || ''),
        moderationCallCheckedAt: Number(entry.updatedAt || 0)
      };
    });
  }

  function scheduleModerationCallRender() {
    clearTimeout(moderationCallRenderTimer);
    moderationCallRenderTimer = setTimeout(() => {
      moderationCallRenderTimer = 0;
      if (!state.remote.kind || state.remote.kind === 'moderation') renderAll();
    }, 100);
  }

  function broadcastModerationCallState(requestId, value, updatedAt = Date.now(), source = '') {
    const id = normalizeRequestId(requestId);
    if (!id || !moderationSyncChannel) return;
    try {
      moderationSyncChannel.postMessage({
        type: 'moderation-call-state',
        requestId: id,
        value: normalizeText(value || ''),
        updatedAt: Number(updatedAt || Date.now()),
        source: normalizeText(source || '')
      });
    } catch (_error) {}
  }

  function readModerationLiveSignal() {
    try {
      const raw = localStorage.getItem(MODERATION_LIVE_SIGNAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function applyModerationLiveSignal(detail, source = '') {
    const stamp = normalizeText(detail?.stamp || '');
    if (!stamp || stamp === moderationLiveSignalStamp) return false;
    const requestId = normalizeRequestId(detail?.requestId || '');
    if (!requestId) return false;
    moderationLiveSignalStamp = stamp;
    if (state.remote.kind) return false;
    const value = normalizeText(detail?.value || '');
    const updatedAt = Number(detail?.updatedAt || Date.now());
    markCopyFileDebug('index-live-signal-applied', {
      requestId,
      value,
      source: normalizeText(source || '')
    });
    moderationNoAnswerCacheMemo.readAt = 0;
    moderationNoAnswerCacheMemo.data = {};
    applyModerationCallState(requestId, value, updatedAt);
    state.rows = hydrateModerationCallStates(state.rows);
    if (Array.isArray(state.remote.rows)) {
      state.remote.rows = hydrateModerationCallStates(state.remote.rows);
    }
    scheduleModerationCallRender();
    return true;
  }

  function applyClarifyRouteState(requestId, flags, updatedAt = Date.now()) {
    const id = normalizeRequestId(requestId);
    if (!id) return 0;
    const hasFarTrip = Boolean(flags?.hasFarTrip);
    let appliedRows = 0;
    const applyToList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((row) => {
        if (normalizeRequestId(row?.id || '') !== id) return;
        const nextCheckedAt = Number(updatedAt || Date.now());
        if (row.hasFarTrip === hasFarTrip && Number(row.clarifyRouteCheckedAt || 0) === nextCheckedAt) return;
        row.hasFarTrip = hasFarTrip;
        row.clarifyRouteCheckedAt = nextCheckedAt;
        appliedRows += 1;
      });
    };
    applyToList(state.rows);
    applyToList(state.remote.rows);
    return appliedRows;
  }

  function scheduleClarifyRouteRender() {
    clearTimeout(clarifyRouteRenderTimer);
    clarifyRouteRenderTimer = setTimeout(() => {
      clarifyRouteRenderTimer = 0;
      renderAll();
    }, 120);
  }

  function extractClarifyRouteFlagsFromDoc(doc) {
    const farRideSelect = doc?.getElementById?.('customerrequest-is_far_ride')
      || doc?.querySelector?.('select[name="CustomerRequest[is_far_ride]"]');
    if (farRideSelect instanceof HTMLSelectElement) {
      const opt = farRideSelect.options?.[farRideSelect.selectedIndex];
      const optText = normalizeText(opt?.text || '').toLowerCase();
      const value = normalizeText(farRideSelect.value || '').toLowerCase();
      return {
        hasFarTrip: !/\bнет\b/i.test(optText)
          && (/\bда\b/i.test(optText) || ['1', 'true', 'yes', 'да'].includes(value))
      };
    }
    const text = normalizeText(doc?.body?.textContent || '').toLowerCase();
    return {
      hasFarTrip: /дальн\w*\s+выезд/i.test(text)
        || /выезд\w*\s+дальн/i.test(text)
        || (text.includes('дальний') && text.includes('выезд'))
    };
  }

  async function fetchClarifyRouteState(row) {
    const requestId = normalizeRequestId(row?.id || '');
    if (!requestId) return false;
    if (clarifyRouteCheckPending.has(requestId)) {
      return clarifyRouteCheckPending.get(requestId);
    }

    const task = (async () => {
      const requestUrl = row?.url
        ? new URL(row.url, location.origin).toString()
        : new URL(`/admin/domain/customer-request/update?id=${encodeURIComponent(requestId)}`, location.origin).toString();
      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (normalizeText(html).length < 500) throw new Error('short-response');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const flags = extractClarifyRouteFlagsFromDoc(doc);
      writeClarifyRouteCacheEntry(requestId, flags);
      const appliedRows = applyClarifyRouteState(requestId, flags);
      if (appliedRows) scheduleClarifyRouteRender();
      return true;
    })().catch((_error) => false).finally(() => {
      clarifyRouteCheckPending.delete(requestId);
    });

    clarifyRouteCheckPending.set(requestId, task);
    return task;
  }

  function refreshClarifyRouteStatesInBackground(rows) {
    const seen = new Set();
    const queue = (Array.isArray(rows) ? rows : []).filter((row) => {
      const id = normalizeRequestId(row?.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      if (!isClarifyAgreeStatus(row?.status || '')) return false;
      if (row?.hasFarTrip) return false;
      if (clarifyRouteCheckPending.has(id)) return false;
      const cached = getClarifyRouteCacheEntry(id);
      return !cached;
    });
    if (!queue.length) return;
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const row = queue[cursor];
        cursor += 1;
        if (!row) return;
        await fetchClarifyRouteState(row);
      }
    };
    const workerCount = Math.min(CLARIFY_ROUTE_CHECK_CONCURRENCY, queue.length);
    void Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  async function fetchModerationCallState(row) {
    const requestId = normalizeRequestId(row?.id || '');
    if (!requestId) return false;
    if (moderationCallCheckPending.has(requestId)) {
      return moderationCallCheckPending.get(requestId);
    }

    const task = (async () => {
      let requestUrl = '';
      try {
        const candidate = new URL(normalizeText(row?.url || ''), location.origin);
        if (candidate.pathname.includes('/customer-request/update')) {
          requestUrl = candidate.toString();
        }
      } catch (_error) {}
      if (!requestUrl) {
        requestUrl = new URL(`/admin/domain/customer-request/update?id=${encodeURIComponent(requestId)}`, location.origin).toString();
      }

      let response;
      if (!state.remote.kind) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), MODERATION_CALL_FETCH_TIMEOUT_MS);
        try {
          response = await fetch(requestUrl, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
      } else {
        response = await fetch(requestUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        });
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const serviceComment = extractModerationServiceComment(doc);
      if (serviceComment === null) throw new Error('service-comment-not-found');
      const value = extractLastModerationCallDateTime(serviceComment);
      // writeModerationNoAnswerCacheEntry / applyModerationCallState монотонны: пустой/устаревший
      // результат stale-фетча не затрёт уже известный «не отвечает» (см. shouldReplaceModerationCallValue).
      writeModerationNoAnswerCacheEntry(requestId, value);
      applyModerationCallState(requestId, value);
      scheduleModerationCallRender();
      return true;
    })().finally(() => {
      moderationCallCheckPending.delete(requestId);
    });

    moderationCallCheckPending.set(requestId, task);
    return task;
  }

  function refreshModerationCallStatesInBackground(rows, options = {}) {
    // Вкладка в фоне/свёрнута — не фетчим деталки звонков (сработает на возврате).
    if (typeof document !== 'undefined' && document.hidden) return;
    const isVisibleModerationContext = () => !state.remote.kind || state.remote.kind === 'moderation';
    if (!isVisibleModerationContext()) return;
    if (moderationCallCheckActiveRunSeq === moderationCallCheckRunSeq && moderationCallCheckActiveRunSeq !== 0) {
      return;
    }
    const strictModerationMode = state.remote.kind === 'moderation';
    const forceFresh = Boolean(options.forceFresh);
    const allowPersistentCache = !strictModerationMode;
    const checkOnceOnMain = !state.remote.kind;
    const seen = new Set();
    const cache = allowPersistentCache ? readModerationNoAnswerCacheMap() : {};
    const queue = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!state.remote.kind && row?.statusKey !== 'mod') return false;
      const id = normalizeRequestId(row?.id || '');
      if (!id || seen.has(id)) return false;
      seen.add(id);
      if (forceFresh) return true;
      const memoryUpdatedAt = Number(moderationCallStateById.get(id)?.updatedAt || 0);
      const cacheUpdatedAt = allowPersistentCache ? Number(cache[id]?.updatedAt || 0) : 0;
      const updatedAt = checkOnceOnMain ? memoryUpdatedAt : Math.max(memoryUpdatedAt, cacheUpdatedAt);
      if (checkOnceOnMain) return !memoryUpdatedAt;
      return !updatedAt || (Date.now() - updatedAt) >= MODERATION_CALL_CHECK_TTL_MS;
    });
    if (!queue.length) return;

    const runSeq = ++moderationCallCheckRunSeq;
    moderationCallCheckActiveRunSeq = runSeq;
    let cursor = 0;
    const worker = async () => {
      while (runSeq === moderationCallCheckRunSeq && isVisibleModerationContext()) {
        const row = queue[cursor];
        cursor += 1;
        if (!row) return;

        const id = normalizeRequestId(row?.id || '');
        if (!forceFresh) {
          const memoryUpdatedAt = Number(moderationCallStateById.get(id)?.updatedAt || 0);
          const freshEntry = allowPersistentCache ? readModerationNoAnswerCacheMap()[id] : null;
          const cacheUpdatedAt = allowPersistentCache ? Number(freshEntry?.updatedAt || 0) : 0;
          const updatedAt = checkOnceOnMain ? memoryUpdatedAt : Math.max(memoryUpdatedAt, cacheUpdatedAt);
          if (checkOnceOnMain && memoryUpdatedAt) continue;
          if (updatedAt && (Date.now() - updatedAt) < MODERATION_CALL_CHECK_TTL_MS) continue;
        }

        try {
          await fetchModerationCallState(row);
        } catch (_error) {
          // Помечаем «проверено» даже при ошибке/непарсе служебного комментария, иначе на
          // Главной модерация перефетчит update-страницу в СЛЕДУЮЩЕМ же круге (checkOnceOnMain
          // смотрит на updatedAt) = флуд запросов на сервер (~каждые 2с на idle-Главной).
          // В мод-вью повтор будет по TTL (не сразу). Известное значение не затрётся (монотонно).
          try { if (!Number(moderationCallStateById.get(id)?.updatedAt || 0)) applyModerationCallState(id, '', Date.now()); } catch (_e) {}
        }
      }
    };

    const workerCount = Math.min(MODERATION_CALL_CHECK_CONCURRENCY, queue.length);
    void Promise.all(Array.from({ length: workerCount }, () => worker())).finally(() => {
      if (moderationCallCheckActiveRunSeq === runSeq) {
        moderationCallCheckActiveRunSeq = 0;
      }
    });
  }

  async function loadRowsByCustomFilterInBackground(kind, requestUrl, forceRender) {
    const modeKind = normalizeText(kind);
    const seq = ++state.remote.seq;
    state.remote.kind = modeKind;
    state.remote.id = '';
    state.remote.personalModeError = '';
    state.remote.loading = true;
    // On explicit mode switch, clear previous mode rows immediately
    // so old cards (e.g. moderation/KC) don't stay visible while loading.
    if (forceRender) {
      state.remote.rows = null;
    }
    if (forceRender) renderAll();

    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await response.text();
      if (seq !== state.remote.seq) return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const grid = doc.querySelector(GRID_SELECTOR);
      const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
      const tbody = table ? table.querySelector('tbody') : null;
      const parsedRows = parseRowsFromTable(table, tbody, true);
      state.remote.rows = applyPersonalKindFilter(parsedRows, modeKind);
    } catch (_error) {
      if (seq !== state.remote.seq) return;
      state.remote.rows = [];
      state.remote.personalModeError = 'Не удалось загрузить данные';
    } finally {
      if (seq !== state.remote.seq) return;
      state.remote.loading = false;
      renderAll();
    }
  }

  async function loadRowsByPersonalRequestsPage(kind, pageNumber = 1, forceRender = true, detectLastPage = false) {
    const modeKind = normalizeText(kind || state.remote.kind || '');
    if (!isPersonalRequestsMode(modeKind)) return;

    const requestUrl = normalizeText(state.remote.filterBaseUrl || buildPersonalRequestsFilterUrl(modeKind));
    const nextPage = Math.max(1, Number(pageNumber || 1));
    const seq = ++state.remote.seq;
    state.remote.kind = modeKind;
    state.remote.id = '';
    state.remote.personalModeError = '';
    state.remote.filterBaseUrl = requestUrl;
    state.remote.loading = true;
    state.remote.filterPage = nextPage;
    if (!state.remote.filterTotalPages || state.remote.filterTotalPages < nextPage) {
      state.remote.filterTotalPages = Math.max(nextPage, Number(state.remote.filterTotalPages || 0));
    }

    if (forceRender) {
      state.remote.rows = null;
      scrollCardsAreaToTop();
      renderAll();
    }

    if (!requestUrl) {
      if (!isSameRemoteRun(seq, modeKind)) return;
      state.remote.rows = [];
      state.remote.loading = false;
      state.remote.personalModeError = 'Не найден номер договора в шапке CRM';
      renderAll();
      return;
    }

    try {
      const pageUrl = new URL(requestUrl, location.origin);
      pageUrl.searchParams.set('page', String(nextPage));
      pageUrl.searchParams.set('per-page', '30');
      const response = await fetch(pageUrl.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await response.text();
      if (!isSameRemoteRun(seq, modeKind)) return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const grid = doc.querySelector(GRID_SELECTOR);
      const table = grid ? grid.querySelector(TABLE_SELECTOR) : null;
      const tbody = table ? table.querySelector('tbody') : null;
      const parsedRows = parseRowsFromTable(table, tbody, true);
      state.remote.rows = applyPersonalKindFilter(parsedRows, modeKind);
      state.remote.filterPage = nextPage;
      if (!state.remote.filterTotalPages) {
        state.remote.filterTotalPages = Math.max(1, parseActivePageNumberFromDoc(doc));
      }
    } catch (_error) {
      if (!isSameRemoteRun(seq, modeKind)) return;
      state.remote.rows = [];
      state.remote.personalModeError = 'Не удалось загрузить данные';
    } finally {
      if (!isSameRemoteRun(seq, modeKind)) return;
      state.remote.loading = false;
      renderAll();
      if (detectLastPage) {
        void detectRemoteLastPageInBackground(requestUrl, Number(state.remote.filterRunId || 0), modeKind);
      }
    }
  }

  function activatePersonalRequestsMode(kind, forceReload) {
    const modeKind = normalizeText(kind || '');
    if (!isPersonalRequestsMode(modeKind)) return;

    // Personal quick filters from Фикс+ахк open a clean filtered view.
    // Drop local UI filters so loaded rows are not hidden by stale constraints.
    state.filters = { id: '', city: '', status: '', type: '', phone: '', author: '', addressCity: '', street: '', house: '', flat: '' };
    [
      'tmSearchInput',
      'tmFilterCity',
      'tmFilterStatus',
      'tmFilterType',
      'tmFilterPhone',
      'tmFilterAuthor',
      'tmFilterAddressCity',
      'tmFilterStreet',
      'tmFilterHouse',
      'tmFilterFlat'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'tmFilterPhone' ? '+7' : '';
    });

    const requestUrl = buildPersonalRequestsFilterUrl(modeKind);
    state.remote.kind = modeKind;
    state.remote.id = '';
    state.remote.personalModeError = '';
    state.remote.filterBaseUrl = requestUrl;
    state.remote.filterSection = 'all';
    state.remote.filterPage = 1;
    state.remote.filterTotalPages = 0;
    state.remote.filterTotalLoading = false;
    scrollCardsAreaToTop();
    if (!requestUrl) {
      state.remote.rows = [];
      state.remote.loading = false;
      state.remote.personalModeError = 'Не найден номер договора в шапке CRM';
      renderAll();
      return;
    }

    const shouldReload = Boolean(forceReload)
      || !Array.isArray(state.remote.rows)
      || state.remote.rows.length === 0;
    if (shouldReload) {
      state.remote.filterRunId = (Number(state.remote.filterRunId) || 0) + 1;
      void loadRowsByPersonalRequestsPage(modeKind, 1, true, true);
      return;
    }
    renderAll();
  }

  function refreshPersonalModeInBackground(forceReload) {
    const modeKind = normalizeText(state.remote.kind || '');
    if (!isPersonalRequestsMode(modeKind)) return;
    if (!forceReload && typeof document !== 'undefined' && document.hidden) return;
    if (state.remote.loading) return;
    const requestUrl = buildPersonalRequestsFilterUrl(modeKind);
    if (!requestUrl) {
      state.remote.rows = [];
      state.remote.loading = false;
      state.remote.personalModeError = 'Не найден номер договора в шапке CRM';
      renderAll();
      return;
    }
    state.remote.filterBaseUrl = requestUrl;
    state.remote.filterSection = 'all';
    const currentPage = Math.max(1, Number(state.remote.filterPage || 1));
    void loadRowsByPersonalRequestsPage(modeKind, currentPage, Boolean(forceReload), !state.remote.filterTotalPages);
  }

  function findDispatcherReportUrl() {
    try {
      return new URL(DISPATCHER_REPORT_URL, location.origin).toString();
    } catch (_error) {
      return `${location.origin}${DISPATCHER_REPORT_URL}`;
    }
  }

  function findCustomerDirectoryUrl() {
    try {
      return new URL(CUSTOMER_DIRECTORY_URL, location.origin).toString();
    } catch (_error) {
      return `${location.origin}${CUSTOMER_DIRECTORY_URL}`;
    }
  }

  function getCustomerDirectoryNationalDigits(value) {
    const raw = String(value || '');
    const trimmed = raw.trim();
    let digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    const hasExplicitPlusPrefix = /^\+\s*[78]/.test(trimmed);
    const hasFullCountryPrefix = digits.length > 10 && (digits.startsWith('7') || digits.startsWith('8'));
    const hasCountryPrefix = hasExplicitPlusPrefix || hasFullCountryPrefix;
    if (hasCountryPrefix) {
      digits = digits.slice(1);
    }
    return digits.slice(0, 10);
  }

  function getCustomerDirectorySearchDigits(value) {
    const national = getCustomerDirectoryNationalDigits(value);
    return national ? `7${national}` : '';
  }

  function formatCustomerDirectoryPhoneInput(value) {
    const digits = getCustomerDirectoryNationalDigits(value);
    if (!digits) return '+7';
    const parts = [
      digits.slice(0, 3),
      digits.slice(3, 6),
      digits.slice(6, 8),
      digits.slice(8, 10)
    ].filter(Boolean);
    return `+7 ${parts.join('-')}`.trim();
  }

  function formatCustomerDirectoryPhoneDisplay(value) {
    const digits = String(value || '').replace(/\D/g, '');
    let national = digits;
    if (national.length >= 11 && (national.startsWith('7') || national.startsWith('8'))) {
      national = national.slice(1);
    }
    if (national.length === 10) {
      return `+7 ${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6, 8)}-${national.slice(8, 10)}`;
    }
    return normalizeText(value || '') || '—';
  }

  function buildCustomerDirectoryPhoneSearchUrl(phoneValue) {
    const url = new URL(findCustomerDirectoryUrl(), location.origin);
    const phoneDigits = getCustomerDirectorySearchDigits(phoneValue);
    if (!phoneDigits) return url.toString();
    url.searchParams.set('CustomerSearch[id]', '');
    url.searchParams.set('CustomerSearch[full_name]', '');
    url.searchParams.set('CustomerSearch[city_id]', '');
    url.searchParams.set('CustomerSearch[address]', '');
    url.searchParams.set('CustomerSearch[phone]', phoneDigits);
    url.searchParams.set('CustomerSearch[author_id]', '');
    return url.toString();
  }

  function getCustomerDirectoryPhoneFromUrl(urlValue = state.remote.customerDirectoryUrl) {
    try {
      const url = new URL(urlValue || findCustomerDirectoryUrl(), location.origin);
      return url.searchParams.get('CustomerSearch[phone]') || '';
    } catch (_error) {
      return '';
    }
  }

  function getCustomerDirectoryPageFromUrl(urlValue = state.remote.customerDirectoryUrl) {
    try {
      const url = new URL(urlValue || findCustomerDirectoryUrl(), location.origin);
      const page = Number(url.searchParams.get('page') || '1');
      return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    } catch (_error) {
      return 1;
    }
  }

  function buildCustomerDirectoryPageUrl(pageValue) {
    const page = Math.max(1, Math.floor(Number(pageValue || 1) || 1));
    const url = new URL(state.remote.customerDirectoryUrl || findCustomerDirectoryUrl(), location.origin);
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  function openCustomerDirectoryPage(pageValue) {
    const page = Math.max(1, Math.floor(Number(pageValue || 1) || 1));
    if (!Number.isFinite(page) || page < 1) return false;
    const url = buildCustomerDirectoryPageUrl(page);
    state.remote.customerDirectoryUrl = url;
    void fetchCustomerDirectoryCardInBackground(true, url);
    return true;
  }

  function makeCustomerDirectorySig(requestUrl, html) {
    const source = `${requestUrl || ''}\n${html || ''}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    }
    return `${source.length}:${Math.abs(hash)}`;
  }

  function getCurrentAuthorId() {
    const nodes = Array.from(document.querySelectorAll('#navbarSupportedContent .header-user-info.nav-item.text-center .text-nowrap small'));
    const nodeWithContract = nodes.find((node) => /договор\s*№/i.test(normalizeText(node?.textContent)));
    const text = normalizeText(nodeWithContract?.textContent || '');
    const match = text.match(/договор\s*№\s*(\d+)/i);
    return match?.[1] || '';
  }

  function buildInitialsFromName(name) {
    const source = normalizeText(name || '');
    if (!source) return 'ПД';
    const parts = source.split(/\s+/).filter(Boolean);
    const first = (parts[0] || '').charAt(0);
    const second = (parts[1] || '').charAt(0);
    const letters = `${first}${second}`.trim().toUpperCase();
    return letters || first.toUpperCase() || 'ПД';
  }

  function getHeaderInfoSmallNodes(rootNode = document) {
    return Array.from(rootNode.querySelectorAll('#navbarSupportedContent .header-user-info.nav-item.text-center .text-nowrap small'));
  }

  function readCurrentUserProfileFromNativeHeader() {
    const smallNodes = getHeaderInfoSmallNodes(document);
    const smallTexts = smallNodes.map((node) => normalizeText(node?.textContent || '')).filter(Boolean);

    const contractFromSmall = smallTexts.find((text) => /договор\s*№/i.test(text)) || '';
    const dispatcherFromSmall = smallTexts.find((text) => /диспетчер\s+кол-центра/i.test(text)) || '';

    const userInfoRoot = document.querySelector('#navbarSupportedContent .header-user-info')
      || document.querySelector('.header-user-info');
    const headerText = normalizeText(userInfoRoot?.textContent || '');

    const contractFromHeader = normalizeText((headerText.match(/договор\s*№[^-–—|]*/i)?.[0] || ''));
    const dispatcherFromHeader = normalizeText((headerText.match(/диспетчер\s+кол-центра\s*[-–—]\s*[^|]+/i)?.[0] || ''));

    const contract = contractFromSmall || contractFromHeader;
    const dispatcherLine = dispatcherFromSmall || dispatcherFromHeader;

    let role = '';
    let name = '';
    if (dispatcherLine) {
      role = 'Диспетчер Кол-Центра';
      name = normalizeText(dispatcherLine.replace(/^диспетчер\s+кол-центра\s*[-–—]\s*/i, ''));
    }

    if (!name && userInfoRoot instanceof HTMLElement) {
      const textNodes = Array.from(userInfoRoot.querySelectorAll('small, span, div, strong, b'))
        .map((node) => normalizeText(node?.textContent || ''))
        .filter((text) => text && !/договор\s*№/i.test(text));
      const candidate = textNodes.find((text) => /[-–—]/.test(text) && /диспетчер|кол-центр/i.test(text))
        || textNodes.find((text) => !/диспетчер|кол-центр/i.test(text));
      if (candidate) {
        if (/диспетчер|кол-центр/i.test(candidate)) {
          if (!role) role = 'Диспетчер Кол-Центра';
          name = normalizeText(candidate.replace(/^.*[-–—]\s*/, ''));
        } else {
          name = candidate;
        }
      }
    }

    if (!role && name) {
      role = 'Диспетчер Кол-Центра';
    }

    return {
      name: normalizeText(name),
      role: normalizeText(role),
      contract: normalizeText(contract)
    };
  }

  function syncSidebarUserProfile(retry = 0) {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const nameNode = host.querySelector('.sb-uname');
    const roleNode = host.querySelector('.sb-role');
    const contractNode = host.querySelector('.sb-contract');
    const avatarNode = host.querySelector('.sb-av');
    const profile = readCurrentUserProfileFromNativeHeader();
    const hasAny = Boolean(profile.name || profile.role || profile.contract);

    if (nameNode instanceof HTMLElement && profile.name) {
      nameNode.textContent = profile.name;
      nameNode.setAttribute('title', profile.name);
    }
    if (roleNode instanceof HTMLElement && profile.role) {
      roleNode.textContent = profile.role;
      roleNode.setAttribute('title', profile.role);
    }
    if (contractNode instanceof HTMLElement && profile.contract) {
      contractNode.textContent = profile.contract;
      contractNode.setAttribute('title', profile.contract);
    }
    if (avatarNode instanceof HTMLElement && profile.name) {
      avatarNode.textContent = buildInitialsFromName(profile.name);
    }
    if (profile.name) {
      const previousName = normalizeText(dispatcherReportViewState.currentUserName || '');
      dispatcherReportViewState.currentUserName = profile.name;
      if (previousName !== profile.name && state.remote.kind === 'dispatcher-report') {
        const cardsArea = document.getElementById('tmCardsArea');
        if (cardsArea instanceof HTMLElement) refreshDispatcherReportView(cardsArea);
      }
    }

    if (!hasAny && retry < 20) {
      setTimeout(() => syncSidebarUserProfile(retry + 1), 250);
    }
  }

  function normalizeWeekdaySetting(value) {
    if (value === SCRIPT_SETTINGS_AUTO_MENU_DISABLED) return SCRIPT_SETTINGS_AUTO_MENU_DISABLED;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0 || num > 6) return null;
    return num;
  }

  function readAutoCleanupDayFromSettingsPanel() {
    const radio = document.querySelector('#tm-script-settings-panel input[name="tm-script-auto-day"]:checked');
    if (!radio) {
      const current = normalizeWeekdaySetting(state.autoCleanupMenuDay);
      return current === null ? SCRIPT_SETTINGS_DEFAULT_AUTO_MENU_DAY : current;
    }
    const normalized = normalizeWeekdaySetting(String(radio.value || ''));
    return normalized === null ? SCRIPT_SETTINGS_DEFAULT_AUTO_MENU_DAY : normalized;
  }

  function isAutoCleanupAvailableNow() {
    const setting = normalizeWeekdaySetting(state.autoCleanupMenuDay);
    if (setting === SCRIPT_SETTINGS_AUTO_MENU_DISABLED) return false;
    const showDay = setting === null ? SCRIPT_SETTINGS_DEFAULT_AUTO_MENU_DAY : setting;
    const now = new Date();
    return now.getDay() === showDay && now.getHours() >= SCHEDULE_MENU_SHOW_HOUR;
  }

  function isAutoCleanupPlanned() {
    const setting = normalizeWeekdaySetting(state.autoCleanupMenuDay);
    return setting !== SCRIPT_SETTINGS_AUTO_MENU_DISABLED;
  }

  function hasAutoCleanupScheduledTime() {
    const panel = document.getElementById('bulk-nf-clarify-friday-panel');
    if (!(panel instanceof HTMLElement)) return null;

    const statusText = normalizeText(panel.querySelector('#bulk-nf-clarify-friday-status')?.textContent || '')
      .toLowerCase()
      .replace(/ё/g, 'е');
    if (statusText.includes('время еще не задано') || statusText.includes('укажи его вручную')) {
      return false;
    }

    const savedValue = normalizeText(panel.querySelector('#bulk-nf-clarify-friday-saved-value')?.textContent || '');
    if (/\b\d{1,2}:\d{2}\b/.test(savedValue)) {
      return true;
    }

    const timeInput = panel.querySelector('#bulk-nf-clarify-friday-time');
    if (timeInput instanceof HTMLInputElement) {
      return /^\d{2}:\d{2}$/.test(normalizeText(timeInput.value));
    }

    return null;
  }

  function isAutoCleanupUnplanned() {
    const panel = document.getElementById('bulk-nf-clarify-friday-panel');
    const byPanel = hasAutoCleanupScheduledTime();
    if (byPanel !== null) return !byPanel;
    if (panel instanceof HTMLElement) return state.autoCleanupNeedsAttention;
    return !isAutoCleanupPlanned();
  }

  function syncAutoCleanupAttentionUi() {
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    const unplanned = isAutoCleanupUnplanned();
    const availableNow = isAutoCleanupAvailableNow();
    const showAttention = availableNow && unplanned;
    state.autoCleanupNeedsAttention = unplanned;
    host.classList.toggle('autoclean-unplanned', showAttention);
    const dot = host.querySelector('.sb-autoclean-dot');
    if (dot instanceof HTMLElement) {
      dot.setAttribute('title', showAttention ? 'Автоочистка не запланирована' : 'Автоочистка запланирована');
      dot.setAttribute('aria-hidden', showAttention ? 'false' : 'true');
    }
  }

  function syncAutoCleanupMenuLabel() {
    const item = document.querySelector(`#${HOST_ID} .sb-item.sb-autoclean .sb-label`);
    if (!item) return;
    item.textContent = isAutoCleanupAvailableNow()
      ? 'Автоочистка'
      : 'Автоочистка (Не активна)';
    syncAutoCleanupAttentionUi();
  }

  function isPersonalRequestsMode(kind = state.remote.kind) {
    const key = normalizeText(kind || '');
    return key === 'my-cancel-kc' || key === 'my-cancel-nf' || key === 'my-clarify';
  }

  function scrollCardsAreaToTop() {
    const cardsArea = document.getElementById('tmCardsArea');
    if (cardsArea instanceof HTMLElement) {
      cardsArea.scrollTop = 0;
    }
  }

  function requestTopOnNextCardsRender() {
    state.forceTopOnNextCardsRender = true;
    scrollCardsAreaToTop();
  }

  function writeThemeCookie(value) {
    try { document.cookie = 'tmcrmtheme=' + value + ';path=/;max-age=31536000;samesite=lax'; } catch (_ck) {}
  }
  function readSavedTheme() {
    let value = '';
    try {
      value = normalizeText(
        localStorage.getItem(SHARED_THEME_STORAGE_KEY)
        || localStorage.getItem(THEME_STORAGE_KEY)
        || ''
      ).toLowerCase();
    } catch (_error) {}
    // localStorage сработал (страница списка) — САМИ синхронизируем cookie, чтобы страницы заявки
    // (где localStorage заблокирован) читали тему на document_start без ручного переключения тумблера.
    if (value === 'dark' || value === 'light') {
      writeThemeCookie(value);
      return value;
    }
    // Фолбэк на cookie (localStorage на странице заявки заблокирован).
    try {
      const m = document.cookie.match(/(?:^|;\s*)tmcrmtheme=(dark|light)/);
      if (m) return m[1];
    } catch (_c) {}
    return 'light';
  }

  function saveTheme(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    try {
      localStorage.setItem(SHARED_THEME_STORAGE_KEY, normalizedTheme);
      localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
    } catch (_error) {
      // ignore storage errors
    }
    // Дублируем в cookie — читается синхронно на document_start заявки, где localStorage заблокирован.
    try { document.cookie = 'tmcrmtheme=' + normalizedTheme + ';path=/;max-age=31536000;samesite=lax'; } catch (_ck) {}
    window.dispatchEvent(new CustomEvent(SHARED_THEME_EVENT, {
      detail: { theme: normalizedTheme, source: 'v8' }
    }));
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    // color-scheme на <html> — чтобы браузерная «пустая» область при переходе на заявку шла в тон темы.
    try { document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'; } catch (_cs) {}
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    host.classList.toggle('theme-dark', isDark);
    host.classList.toggle('theme-light', !isDark);
    const toggle = document.getElementById('tmThemeToggle');
    if (toggle instanceof HTMLInputElement) {
      toggle.checked = isDark;
    }
  }

  // Открыть URL в новой вкладке с ПРЕД-ПОКРАСКОЙ в цвет темы: сначала пустая вкладка с тёмной/светлой
  // заглушкой, затем навигация. Пока сервер отвечает, браузер держит нашу заглушку (paint-holding),
  // а не свой белый фон. Так убираем белый загрузочный экран при открытии заявки.
  function tmOpenThemedBlank(url) {
    let w = null;
    try { w = window.open('', '_blank'); } catch (_e) { w = null; }
    if (!w) { try { return window.open(url, '_blank', 'noopener'); } catch (_e2) { return null; } }
    try {
      const dark = readSavedTheme() === 'dark';
      const col = dark ? '#141413' : '#ECEBE7';
      const scheme = dark ? 'dark' : 'light';
      w.document.open();
      w.document.write(
        '<!doctype html><html style="background:' + col + ';color-scheme:' + scheme + '">'
        + '<head><meta charset="utf-8"><meta name="color-scheme" content="' + scheme + '"><title>Загрузка…</title></head>'
        + '<body style="margin:0;background:' + col + '"></body></html>'
      );
      w.document.close();
    } catch (_e3) {}
    // Навигацию откладываем на 2 кадра (double-rAF), чтобы заглушка ГАРАНТИРОВАННО
    // отрисовалась и держалась (paint-holding) — иначе гонка «write vs navigate» иногда
    // не успевала покрасить и вылезал белый браузерный about:blank. setTimeout — фолбэк
    // для фоновых/троттлящихся вкладок (там rAF не тикает); guard от двойного перехода.
    var _navDone = false;
    var _nav = function () { if (_navDone) return; _navDone = true; try { w.location.href = url; } catch (_e4) { try { w.location = url; } catch (_e5) {} } };
    try { w.requestAnimationFrame(function () { w.requestAnimationFrame(_nav); }); } catch (_r) {}
    setTimeout(_nav, 120);
    return w;
  }

  function buildPersonalRequestsFilterUrl(kind) {
    const authorId = normalizeText(getCurrentAuthorId());
    if (!authorId) return '';

    const params = new URLSearchParams();
    params.set('CRSearch[id]', '');
    params.set('CRSearch[opened_at_dates]', '');
    params.set('CRSearch[type]', '');
    params.set('CRSearch[status]', '');

    if (kind === 'my-cancel-kc') {
      params.append('CRSearch[status][]', '1001');
    } else if (kind === 'my-cancel-nf') {
      params.set('CRSearch[status][0]', '20');
      params.append('CRSearch[status][]', '20');
    } else if (kind === 'my-clarify') {
      params.append('CRSearch[status][]', '3');
    }

    params.set('CRSearch[city_id]', '');
    params.set('CRSearch[phone]', '');
    params.set('CRSearch[created_at_dates]', '');
    params.set('CRSearch[closed_at_dates]', '');
    params.set('CRSearch[author_id]', authorId);
    if (kind === 'my-cancel-nf') {
      params.set('sort', '-id');
    } else if (kind === 'my-cancel-kc') {
      params.set('sort', '-closed_at_local');
    }

    return `${location.origin}/admin/domain/customer-request/index?${params.toString()}`;
  }

  function applyPersonalKindFilter(rows, kind) {
    const list = Array.isArray(rows) ? rows : [];
    const modeKind = normalizeText(kind || '');
    const isStatusLike = (row, patterns) => {
      const text = normalizeText(row?.status || '').toLowerCase();
      return patterns.some((p) => text.includes(p));
    };

    if (modeKind === 'my-cancel-kc') {
      return list.filter((row) => isStatusLike(row, ['отмена кц']));
    }
    if (modeKind === 'my-cancel-nf') {
      return list.filter((row) => isStatusLike(row, ['не оформ', 'отмена филиал', 'отмена филиала']));
    }
    if (modeKind === 'my-clarify') {
      return list.filter((row) => isStatusLike(row, ['уточн']));
    }
    return list;
  }

  function buildRowsSignature(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((row) => [
        row.id || '',
        row.status || '',
        row.reqDateTime || '',
        row.created || '',
        row.phone || '',
        row.address || '',
        row.hasFarTrip ? 'far' : ''
      ].join('|'))
      .join('||');
  }

  async function fetchDispatcherReportCardInBackground(forceRender, targetUrl) {
    closeDispatcherCalendar(true);
    state.remote.dispatcherReportLoading = true;
    if (forceRender) renderAll();
    try {
      const requestUrl = targetUrl || state.remote.dispatcherReportUrl || findDispatcherReportUrl();
      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const reportTable = doc.querySelector('#repDispTable');
      const cardNode = reportTable?.closest('.card')
        || doc.querySelector('div.wrapper > div.content-wrapper.position-relative > section.content > div.--container > div.card:nth-of-type(1)')
        || doc.querySelector('section.content div.--container div.card')
        || doc.querySelector('section.content .card');
      if (!cardNode) {
        throw new Error('card-not-found');
      }
      const nextHtml = cardNode.outerHTML;
      const changed = nextHtml !== String(state.remote.dispatcherReportSig || '');
      state.remote.dispatcherReportSig = nextHtml;
      state.remote.dispatcherReportHtml = nextHtml;
      state.remote.dispatcherReportUrl = requestUrl;
      state.remote.dispatcherReportError = '';
      state.remote.dispatcherReportLoadedAt = Date.now();
      state.remote.dispatcherReportLoading = false;
      if (changed || forceRender) renderAll();
      return true;
    } catch (error) {
      state.remote.dispatcherReportLoading = false;
      state.remote.dispatcherReportError = String(error && error.message ? error.message : error);
      if (forceRender) renderAll();
      return false;
    }
  }

  async function fetchCustomerDirectoryCardInBackground(forceRender, targetUrl) {
    state.remote.customerDirectoryLoading = true;
    if (forceRender) renderAll();
    try {
      const requestUrl = targetUrl || state.remote.customerDirectoryUrl || findCustomerDirectoryUrl();
      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const cardNode = doc.querySelector('div#p0 > div.card')
        || doc.querySelector('#p0 .card')
        || doc.querySelector('section.content .card')
        || doc.querySelector('section.content')
        || doc.querySelector('main')
        || doc.body;
      if (!cardNode) {
        throw new Error('customer-card-not-found');
      }
      const nextHtml = cardNode.outerHTML;
      const nextSig = makeCustomerDirectorySig(requestUrl, nextHtml);
      const changed = nextSig !== String(state.remote.customerDirectorySig || '');
      state.remote.customerDirectorySig = nextSig;
      state.remote.customerDirectoryHtml = nextHtml;
      state.remote.customerDirectoryUrl = requestUrl;
      state.remote.customerDirectoryError = '';
      state.remote.customerDirectoryLoadedAt = Date.now();
      state.remote.customerDirectoryLoading = false;
      if (changed || forceRender) renderAll();
      return true;
    } catch (error) {
      state.remote.customerDirectoryLoading = false;
      state.remote.customerDirectoryError = String(error && error.message ? error.message : error);
      if (forceRender) renderAll();
      return false;
    }
  }

  function activateDispatcherReportMode(forceReload) {
    state.remote.kind = 'dispatcher-report';
    state.remote.id = '';
    state.remote.rows = null;
    state.remote.loading = false;
    if (!state.remote.dispatcherReportUrl) {
      const shift = getDispatcherShiftPeriod();
      state.remote.dispatcherReportUrl = buildDispatcherPeriodUrl(shift.dateFrom, shift.dateTill);
    }
    const shouldReload = Boolean(forceReload)
      || !normalizeText(state.remote.dispatcherReportHtml || '');
    if (shouldReload) {
      void fetchDispatcherReportCardInBackground(true);
      return;
    }
    renderAll();
  }

  function resetDispatcherReportToCurrentShift() {
    const shift = getDispatcherShiftPeriod();
    state.remote.dispatcherReportUrl = buildDispatcherPeriodUrl(shift.dateFrom, shift.dateTill);
    state.remote.dispatcherReportHtml = '';
    state.remote.dispatcherReportSig = '';
    state.remote.dispatcherReportError = '';
    state.remote.dispatcherReportLoadedAt = 0;
    state.remote.dispatcherReportLoading = false;
    dispatcherReportViewState.query = '';
    dispatcherReportViewState.sort = 'accepted';
    dispatcherReportViewState.data = null;
    closeDispatcherCalendar(true);
  }

  function activateCustomerDirectoryMode(forceReload) {
    state.remote.kind = 'customer-directory';
    state.remote.id = '';
    state.remote.rows = null;
    state.remote.loading = false;
    if (!state.remote.customerDirectoryUrl) {
      state.remote.customerDirectoryUrl = findCustomerDirectoryUrl();
    }
    const shouldReload = Boolean(forceReload)
      || !normalizeText(state.remote.customerDirectoryHtml || '');
    if (shouldReload) {
      void fetchCustomerDirectoryCardInBackground(true);
      return;
    }
    renderAll();
  }

  async function loadModerationRowsInBackground(forceReload) {
    const modeChanged = state.remote.kind !== 'moderation';
    if (modeChanged) moderationCallCheckRunSeq += 1;
    state.remote.kind = 'moderation';
    state.remote.id = '';
    state.remote.personalModeError = '';
    if (modeChanged) {
      state.remote.rows = null;
      state.remote.moderationRowsSig = '';
    }
    const forceFreshCallState = Boolean(modeChanged || forceReload);
    if (forceFreshCallState) {
      moderationCallStateById.clear();
    }

    const now = Date.now();
    if (!forceReload && moderationRowsFetchInProgress) return;
    if (!forceReload && (now - Number(state.remote.moderationRowsFetchAt || 0)) < MODERATION_VIEW_REFRESH_MS) return;

    const hadRows = !modeChanged && Array.isArray(state.remote.rows);
    if (!hadRows) {
      state.remote.loading = true;
      state.remote.rows = null;
      renderAll();
    }

    if (moderationRowsAbortController) {
      moderationRowsAbortController.abort();
    }
    const controller = new AbortController();
    moderationRowsAbortController = controller;
    const fetchSeq = ++moderationRowsFetchSeq;
    const remoteSeq = ++state.remote.seq;
    moderationRowsFetchInProgress = true;
    state.remote.moderationRowsFetchAt = now;

    const isCurrent = () => (
      fetchSeq === moderationRowsFetchSeq
      && remoteSeq === state.remote.seq
      && state.remote.kind === 'moderation'
    );

    try {
      const fetchedRows = await fetchAllModerationRows(isCurrent, controller.signal);
      if (!fetchedRows || !isCurrent()) return;
      const rows = hydrateModerationCallStates(fetchedRows, { includePersistentCache: false });
      const nextSig = buildRowsSignature(rows);
      const changed = nextSig !== String(state.remote.moderationRowsSig || '');
      state.remote.moderationRowsSig = nextSig;
      state.remote.rows = rows;
      state.remote.personalModeError = '';
      state.moderationRowsRefreshAt = Date.now();
      setModerationCountValue(rows.length);
      if (changed || forceReload || forceFreshCallState) renderAll();
      refreshModerationCallStatesInBackground(rows, { forceFresh: forceFreshCallState });
    } catch (error) {
      if (!isCurrent() || error?.name === 'AbortError') return;
      if (!hadRows) state.remote.rows = [];
      state.remote.personalModeError = 'Не удалось загрузить модерации';
    } finally {
      if (fetchSeq !== moderationRowsFetchSeq) return;
      moderationRowsFetchInProgress = false;
      if (moderationRowsAbortController === controller) {
        moderationRowsAbortController = null;
      }
      if (state.remote.kind === 'moderation') {
        state.remote.loading = false;
        renderAll();
      }
    }
  }

  function isModerationViewUrl() {
    try {
      const url = new URL(location.href);
      return normalizeText(url.searchParams.get('__view-mode') || '') === '4';
    } catch (_error) {
      return String(location.search || '').includes('__view-mode=4');
    }
  }

  function ensureModerationBackgroundMode(forceReload) {
    if (!isModerationViewUrl()) return;
    if (state.filters.id) return;

    const needInit = state.remote.kind !== 'moderation';
    if (needInit) {
      clearTimeout(state.remote.timer);
      state.remote.kind = 'moderation';
      state.remote.id = '';
      state.remote.rows = null;
      state.remote.loading = false;
      loadModerationRowsInBackground(true);
      return;
    }

    if (forceReload) {
      loadModerationRowsInBackground(true);
    }
  }

  async function refreshModerationCountInBackground() {
    if (state.remote.kind === 'moderation') return;
    // Вкладка в фоне/свёрнута — не грузим сервер счётчиком (досчёт будет на возврате).
    if (typeof document !== 'undefined' && document.hidden) return;

    const now = Date.now();
    if (moderationCountFetchInProgress) return;
    if ((now - Number(moderationCountFetchAt || 0)) < MODERATION_COUNT_REFRESH_MS) return;
    moderationCountFetchInProgress = true;
    moderationCountFetchAt = now;
    state.moderationCountAt = now;
    try {
      const rows = await fetchAllModerationRows();
      if (rows) setModerationCountValue(rows.length);
    } catch (_error) {
      // keep previous value when background moderation count fetch fails
    } finally {
      moderationCountFetchInProgress = false;
    }
  }

  function hideNativePage() {
    const host = document.getElementById(HOST_ID);
    if (!host) return;

    Array.from(document.body.children).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.id === HOST_ID) return;
      const nodeId = String(node.id || '');
      // Keep Fix+AHK floating panels visible (auto-clean, warnings, settings panel, toasts, widgets).
      if (
        nodeId.startsWith('bulk-nf-clarify')
        || nodeId.startsWith('tm-')
        || nodeId === 'tm-script-settings-panel'
        || nodeId === 'tm-script-settings-btn'
        || nodeId === 'clipboard-open-all-btn'
      ) {
        if (node.getAttribute(HIDDEN_NATIVE_ATTR) === '1') {
          node.removeAttribute(HIDDEN_NATIVE_ATTR);
          node.style.display = '';
        }
        return;
      }
      node.setAttribute(HIDDEN_NATIVE_ATTR, '1');
      node.style.display = 'none';
    });

    host.style.display = '';
  }

  function minutesFromMetaText(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return null;
    let match = text.match(/(\d+)\s*(?:м|мин)/i);
    if (match) {
      const minutes = Number(match[1]);
      return Number.isFinite(minutes) ? minutes : null;
    }
    match = text.match(/(\d+)\s*(?:ч|час)/i);
    if (match) {
      const hours = Number(match[1]);
      return Number.isFinite(hours) ? (hours * 60) : null;
    }
    return null;
  }

  function parseRuDateTimeToMillis(value) {
    const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) return NaN;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = 2000 + Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);
    const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (!Number.isFinite(date.getTime())) return NaN;
    if (date.getFullYear() !== year || (date.getMonth() + 1) !== month || date.getDate() !== day) return NaN;
    return date.getTime();
  }

  function elapsedMinutesFromDateTime(value) {
    const ts = parseRuDateTimeToMillis(value);
    if (!Number.isFinite(ts)) return NaN;
    return Math.max(0, (Date.now() - ts) / 60000);
  }

  // Значение звонка модерации может только «идти вперёд» (новые «не отвечает» позже старых).
  // Не принимаем пустой/более старый результат поверх уже известного — иначе карточка на Главной
  // «забывает» звонок из-за stale-фетча (сервер не успел отдать новый комментарий) или пустого парса.
  function shouldReplaceModerationCallValue(prevValue, nextValue) {
    const prev = normalizeText(prevValue || '');
    const next = normalizeText(nextValue || '');
    if (!prev) return true;
    if (!next) return false;
    const prevTs = parseRuDateTimeToMillis(prev);
    const nextTs = parseRuDateTimeToMillis(next);
    if (Number.isFinite(prevTs) && Number.isFinite(nextTs)) return nextTs >= prevTs;
    return true;
  }

  function parseClockMinutes(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return (hours * 60) + minutes;
  }

  function dateWithClockFromBase(baseTs, clockMinutes) {
    if (!Number.isFinite(baseTs) || !Number.isFinite(clockMinutes)) return NaN;
    const base = new Date(baseTs);
    return new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      Math.floor(clockMinutes / 60),
      clockMinutes % 60,
      0,
      0
    ).getTime();
  }

  function getRowCityTimeContext(row) {
    const createdTs = parseRuDateTimeToMillis(row?.created || '');
    if (!Number.isFinite(createdTs)) return null;

    const dvText = normalizeText(row?.dv || '');
    const cityClockMinutes = parseClockMinutes(dvText);
    const createdClockMinutes = parseClockMinutes(row?.created || '');
    const localClockMinutes = cityClockMinutes !== null ? cityClockMinutes : createdClockMinutes;
    if (localClockMinutes === null) return null;

    let localCreatedTs = cityClockMinutes !== null
      ? dateWithClockFromBase(createdTs, localClockMinutes)
      : createdTs;
    if (!Number.isFinite(localCreatedTs)) return null;

    const dayMs = 24 * 60 * 60 * 1000;
    const maxTimezoneDeltaMs = 12 * 60 * 60 * 1000;
    let offsetMs = createdTs - localCreatedTs;
    if (offsetMs < -maxTimezoneDeltaMs) {
      localCreatedTs -= dayMs;
      offsetMs = createdTs - localCreatedTs;
    } else if (offsetMs > maxTimezoneDeltaMs) {
      localCreatedTs += dayMs;
      offsetMs = createdTs - localCreatedTs;
    }

    return { localCreatedTs, offsetMs, localClockMinutes };
  }

  // Текущее время ГОРОДА в минутах от полуночи (тот же offset, что и в расчёте минут согласования).
  function getCurrentCityClockMinutes(row) {
    const context = getRowCityTimeContext(row);
    if (!context) return null;
    const nowCityTs = Date.now() - Number(context.offsetMs || 0);
    const d = new Date(nowCityTs);
    if (!Number.isFinite(d.getTime())) return null;
    return (d.getHours() * 60) + d.getMinutes();
  }

  // Время ОТПРАВКИ на соглас в минутах города от полуночи (сейчас − прошло_минут).
  function getSentCityClockMinutes(row, elapsedMinutes) {
    const context = getRowCityTimeContext(row);
    if (!context) return null;
    const elapsed = Number(elapsedMinutes);
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;
    const sentCityTs = Date.now() - Number(context.offsetMs || 0) - (elapsed * 60000);
    const d = new Date(sentCityTs);
    if (!Number.isFinite(d.getTime())) return null;
    return (d.getHours() * 60) + d.getMinutes();
  }

  function getClarifyAgreeEffectiveMinutes(row, elapsedMinutes) {
    const elapsed = Number(elapsedMinutes);
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;

    const context = getRowCityTimeContext(row);
    if (!context || Number(context.localClockMinutes) >= 10 * 60) return elapsed;

    const nowCityTs = Date.now() - Number(context.offsetMs || 0);
    const sentCityTs = Date.now() - (elapsed * 60000) - Number(context.offsetMs || 0);
    const gateBase = new Date(context.localCreatedTs);
    const gateTs = new Date(
      gateBase.getFullYear(),
      gateBase.getMonth(),
      gateBase.getDate(),
      10,
      0,
      0,
      0
    ).getTime();
    const effectiveStartTs = Math.max(sentCityTs, gateTs);
    return Math.max(0, (nowCityTs - effectiveStartTs) / 60000);
  }

  function shouldWarnClarifyAgreeRoute(row) {
    if (row?.hasFarTrip) return true;
    const city = normalizeText(row?.city || '').toLowerCase();
    if (!city) return false;
    if (/\([^)]*\)/.test(city)) return true;
    if (/(^|[\s(])мск([\s)]|$)/i.test(city)) return true;
    if (/(^|[\s(])спб([\s)\d]|$)/i.test(city)) return true;
    if (city.includes('санкт-петербург') || city.includes('санкт петербург')) return true;
    return false;
  }

  function readModerationCountCache() {
    try {
      const raw = localStorage.getItem(MODERATION_COUNT_CACHE_KEY);
      if (!raw) return null;
      const json = JSON.parse(raw);
      const value = Number(json?.count);
      const updatedAt = Number(json?.updatedAt || 0);
      if (!Number.isFinite(value) || value < 0) return null;
      if (!updatedAt || (Date.now() - updatedAt) > MODERATION_COUNT_CACHE_TTL_MS) return null;
      return Math.floor(value);
    } catch (_error) {
      return null;
    }
  }

  function writeModerationCountCache(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value < 0) return;
    try {
      localStorage.setItem(MODERATION_COUNT_CACHE_KEY, JSON.stringify({
        count: Math.floor(value),
        updatedAt: Date.now()
      }));
    } catch (_error) {}
  }

  function setModerationCountValue(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value < 0) return;
    const normalized = Math.floor(value);
    state.moderationCount = normalized;
    writeModerationCountCache(normalized);
    const modBadge = document.querySelector(`#${HOST_ID} .mod-n`);
    if (modBadge) modBadge.textContent = String(normalized);
  }

  function readModerationNoAnswerCacheMap() {
    const now = Date.now();
    if ((now - Number(moderationNoAnswerCacheMemo.readAt || 0)) < 1500) {
      return moderationNoAnswerCacheMemo.data || {};
    }

    let parsed = {};
    try {
      const raw = localStorage.getItem(MODERATION_NO_ANSWER_CACHE_KEY);
      if (raw) {
        const json = JSON.parse(raw);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          parsed = json;
        }
      }
    } catch (_error) {
      parsed = {};
    }

    const next = {};
    Object.entries(parsed).forEach(([requestId, entry]) => {
      const id = String(requestId || '').trim();
      if (!id) return;
      const updatedAt = Number(entry?.updatedAt || 0);
      if (!updatedAt || (now - updatedAt) > MODERATION_NO_ANSWER_CACHE_TTL_MS) return;
      next[id] = {
        value: normalizeText(entry?.value || ''),
        updatedAt
      };
    });

    moderationNoAnswerCacheMemo.readAt = now;
    moderationNoAnswerCacheMemo.data = next;
    return next;
  }

  function readClarifyAwaitCacheMap() {
    const now = Date.now();
    if ((now - Number(clarifyAwaitCacheMemo.readAt || 0)) < 1500) {
      return clarifyAwaitCacheMemo.data || {};
    }

    let parsed = {};
    try {
      const raw = localStorage.getItem(CLARIFY_AWAIT_CACHE_KEY);
      if (raw) {
        const json = JSON.parse(raw);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          parsed = json;
        }
      }
    } catch (_error) {
      parsed = {};
    }

    const next = {};
    Object.entries(parsed).forEach(([requestId, entry]) => {
      const id = String(requestId || '').trim();
      if (!id) return;
      const value = normalizeText(entry?.value || '');
      const updatedAt = Number(entry?.updatedAt || 0);
      if (!value) return;
      if (!updatedAt || (now - updatedAt) > CLARIFY_AWAIT_CACHE_TTL_MS) return;
      next[id] = { value, updatedAt };
    });

    clarifyAwaitCacheMemo.readAt = now;
    clarifyAwaitCacheMemo.data = next;
    return next;
  }

  function formatCallAgoText(dateTimeText) {
    const elapsed = elapsedMinutesFromDateTime(dateTimeText);
    if (!Number.isFinite(elapsed)) return '';
    if (elapsed < 60) {
      return `Звонил ${Math.floor(elapsed)} мин назад`;
    }
    const hours = Math.max(1, Math.floor(elapsed / 60));
    return `Звонил ${hours} ч. назад`;
  }

  function getModerationMetaEntryFromCache(rowId) {
    const id = String(rowId || '').trim();
    if (!id) return null;
    const map = readModerationNoAnswerCacheMap();
    const entry = map[id];
    if (!entry) return null;
    const value = normalizeText(entry.value || '');
    const text = value ? (formatCallAgoText(value) || 'Не звонил') : 'Не звонил';
    return {
      text,
      updatedAt: Number(entry.updatedAt || 0)
    };
  }

  function extractCalledAgoMinutes(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text || text.includes('не звонил')) return null;

    let match = text.match(/звонил\s+(\d+)\s*(?:м|мин|минут)/i);
    if (match) {
      const mins = Number(match[1]);
      return Number.isFinite(mins) ? mins : null;
    }
    match = text.match(/звонил\s+(\d+)\s*(?:ч|час)/i);
    if (match) {
      const hours = Number(match[1]);
      return Number.isFinite(hours) ? (hours * 60) : null;
    }
    return null;
  }

  function moderationMetaKind(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return 'empty';
    if (text.includes('не звонил')) return 'no_answer';
    if (text.includes('звонил')) return 'called';
    return 'other';
  }

  function resolveModerationMetaText(rowId, fallbackMetaText, directValue = undefined, directUpdatedAt = 0) {
    const fallback = normalizeText(fallbackMetaText);
    const fallbackLower = fallback.toLowerCase();
    if (Number(directUpdatedAt || 0) > 0) {
      const value = normalizeText(directValue || '');
      return value ? (formatCallAgoText(value) || 'Не звонил') : 'Не звонил';
    }
    const cacheEntry = getModerationMetaEntryFromCache(rowId);
    if (cacheEntry && (Date.now() - cacheEntry.updatedAt) < MODERATION_CALL_CHECK_TTL_MS) {
      return cacheEntry.text;
    }
    if (fallbackLower.includes('звонил') || fallbackLower.includes('не звонил')) {
      return fallback;
    }

    const fromCache = cacheEntry?.text ?? null;
    if (fromCache !== null) {
      const fbKind = moderationMetaKind(fallback);
      const cacheKind = moderationMetaKind(fromCache);

      if (fbKind === 'empty' || fbKind === 'other') {
        return fromCache;
      }
      // If row says "не звонил", but cache already has a call, trust cache.
      if (fbKind === 'no_answer' && cacheKind === 'called') {
        return fromCache;
      }
      // If both say "called", keep fresher one (smaller elapsed minutes).
      if (fbKind === 'called' && cacheKind === 'called') {
        const fbMins = extractCalledAgoMinutes(fallback);
        const cacheMins = extractCalledAgoMinutes(fromCache);
        if (fbMins !== null && cacheMins !== null) {
          return cacheMins <= fbMins ? fromCache : fallback;
        }
        return fallback || fromCache;
      }
      // In the rest of conflicts prefer row text.
      if (fbKind === 'called' && cacheKind === 'no_answer') {
        return fallback;
      }
      if (fbKind === 'no_answer' && cacheKind === 'no_answer') {
        return fallback || fromCache;
      }
      return fallback || fromCache;
    }

    return '';
  }

  function formatElapsedCompactText(dateTimeText) {
    const elapsed = elapsedMinutesFromDateTime(dateTimeText);
    if (!Number.isFinite(elapsed)) return '';
    if (elapsed < 60) {
      return `${Math.floor(elapsed)} минут`;
    }
    const hours = Math.max(1, Math.floor(elapsed / 60));
    return `${hours} ч.`;
  }

  function resolveClarifyAgreeMetaText(rowId, fallbackMetaText) {
    const fallback = normalizeText(fallbackMetaText || '');
    const lower = fallback.toLowerCase();
    if (fallback && !lower.includes('не отправлено') && fallback !== '—' && fallback !== '-') {
      return fallback;
    }

    const id = String(rowId || '').trim();
    if (!id) return fallback;
    const cache = readClarifyAwaitCacheMap();
    const entry = cache[id];
    if (!entry?.value) return fallback;
    const fromCache = formatElapsedCompactText(entry.value);
    return fromCache || fallback;
  }

  function formatClarifyAgreeDisplayText(value) {
    const text = normalizeText(value || '');
    if (!text) return text;
    if (/^на\s+согласован/i.test(text)) return text;
    if (/не\s*отправлено/i.test(text)) return text;

    let match = text.match(/(\d+)\s*(?:м|мин)/i);
    if (match) {
      return `На согласовании ${match[1]} минут`;
    }
    match = text.match(/(\d+)\s*ч/i);
    if (match) {
      return `На согласовании ${match[1]} ч`;
    }
    return text;
  }

  function expandShortCallText(value) {
    const text = normalizeText(value);
    if (!text) return text;
    if (/^\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}/.test(text)) {
      return '';
    }
    let match = text.match(/^звонил\s+(\d+)\s*м\s*наз\.?$/i);
    if (match) {
      return `Звонил ${match[1]} мин назад`;
    }
    match = text.match(/^звонил\s+(\d+)\s*ч\s*наз\.?$/i);
    if (match) {
      return `Звонил ${match[1]} ч. назад`;
    }
    return text;
  }

  function buildNoAnswerModerationText(createdValue) {
    const elapsed = elapsedMinutesFromDateTime(createdValue);
    if (!Number.isFinite(elapsed)) {
      return 'Пришла недавно, звонков не было';
    }
    if (elapsed < 60) {
      return `Пришла ${Math.floor(elapsed)} мин назад, звонков не было`;
    }
    const hours = Math.max(1, Math.floor(elapsed / 60));
    return `Пришла ${hours} ч. назад, звонков не было`;
  }

  function isDashLikeText(value) {
    const t = normalizeText(value);
    return !t || t === '—' || t === '-';
  }

  function buildModerationAgeCompact(createdValue) {
    const elapsed = elapsedMinutesFromDateTime(createdValue);
    if (!Number.isFinite(elapsed)) return 'неизвестно';
    if (elapsed < 60) return `${Math.floor(elapsed)} мин`;
    const hours = Math.max(1, Math.floor(elapsed / 60));
    return `${hours} ч.`;
  }

  function isClarifyAgreeStatus(statusText) {
    const s = normalizeText(statusText).toLowerCase();
    return s.includes('на уточнении') && s.includes('соглас');
  }

  function isClarifyQuestionStatus(statusText) {
    const s = normalizeText(statusText).toLowerCase();
    return s.includes('на уточнении') && s.includes('?');
  }

  function clarifySubstateKind(statusText) {
    const s = normalizeText(statusText).toLowerCase();
    if (!s.includes('уточн')) return 'none';
    if (s.includes('соглас')) return 'agree';
    if (s.includes('?')) return 'question';
    return 'plain';
  }

  function scheduleClarifyHoldRelease(delayMs) {
    if (clarifyHoldReleaseTimer) return;
    const delay = Math.max(80, Math.min(11000, Number(delayMs) || CLARIFY_SUBSTATE_HOLD_MS));
    clarifyHoldReleaseTimer = setTimeout(() => {
      clarifyHoldReleaseTimer = 0;
      if (!state.remote.kind) syncFromNative();
    }, delay);
  }

  function readClarifySubstateShownMap() {
    const now = Date.now();
    if (clarifySubstateShownMemo.data && (now - Number(clarifySubstateShownMemo.at || 0)) < 1000) {
      return clarifySubstateShownMemo.data;
    }
    let map = {};
    try {
      const raw = localStorage.getItem(CLARIFY_SUBSTATE_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) map = parsed;
    } catch (_e) {}
    // Сливаем с прежним in-memory состоянием: берём запись с более свежим at
    // (защищает закоммиченный «соглас»/«?» от отката, если localStorage отстаёт).
    const prevMemo = clarifySubstateShownMemo.data;
    if (prevMemo && typeof prevMemo === 'object') {
      Object.keys(prevMemo).forEach((id) => {
        const fresh = map[id];
        const kept = prevMemo[id];
        if (kept && (!fresh || Number(kept.at || 0) > Number(fresh.at || 0))) map[id] = kept;
      });
    }
    Object.keys(map).forEach((id) => {
      const at = Number(map[id] && map[id].at || 0);
      if (!at || (now - at) > CLARIFY_SUBSTATE_STATE_TTL_MS) delete map[id];
    });
    clarifySubstateShownMemo.data = map;
    clarifySubstateShownMemo.at = now;
    return map;
  }

  function writeClarifySubstateShown(key, kind, statusText) {
    try {
      const map = readClarifySubstateShownMap();
      map[key] = { k: kind, s: statusText, at: Date.now() };
      localStorage.setItem(CLARIFY_SUBSTATE_STATE_KEY, JSON.stringify(map));
      clarifySubstateShownMemo.data = map;
      clarifySubstateShownMemo.at = Date.now();
    } catch (_e) {}
  }

  // Подстатус уточнения «(соглас)»/«?»/обычное флейкает: внешний скрипт-аннотатор добавляет/теряет
  // метку на секунды (и на секунды же при новой загрузке главной, пока метка не навешана) →
  // карточка прыгает по рангу. Асимметричный дебаунс + СОХРАНЁННОЕ показываемое состояние
  // (localStorage, переживает уход/возврат на главную): при возврате показываем прежний подстатус
  // сразу, а «обычное» без метки на первых парсах трактуем как кандидат на медленный демоут, а не
  // как истину. Провал соглас/?->обычное подтверждаем медленно (метка часто пропадает), обратно —
  // быстро. Только для живого списка главной.
  function applyClarifySubstateHold(id, statusRaw) {
    if (state.remote.kind) return statusRaw;
    const key = normalizeRequestId(id);
    if (!key) return statusRaw;
    const kind = clarifySubstateKind(statusRaw);
    // Пустой/не-уточнение статус (часто промежуточный при обновлении таблицы) — не трогаем
    // сохранённый подстатус, чтобы флейк не переинициализировал состояние.
    if (kind === 'none') return statusRaw;
    const now = Date.now();
    const shownMap = readClarifySubstateShownMap();
    const shown = shownMap[key];
    if (!shown || !shown.k) {
      writeClarifySubstateShown(key, kind, statusRaw);
      clarifySubstatePending.delete(key);
      return statusRaw;
    }
    if (kind === shown.k) {
      clarifySubstatePending.delete(key);
      // изредка продлеваем TTL, чтобы долгие согласования не выпали
      if (now - Number(shown.at || 0) > 30 * 60 * 1000) writeClarifySubstateShown(key, kind, statusRaw);
      return statusRaw;
    }
    const confirmMs = (kind === 'plain') ? CLARIFY_SUBSTATE_DEMOTE_MS : CLARIFY_SUBSTATE_HOLD_MS;
    const pend = clarifySubstatePending.get(key);
    if (pend && pend.pendKind === kind) {
      // Демоут (kind==='plain') отсчитываем только по активному времени вкладки и не
      // подтверждаем, пока вкладка скрыта — иначе подстатус схлопывается за простой.
      let pendStart = Number(pend.pendSince || 0);
      if (kind === 'plain') {
        pendStart = Math.max(pendStart, clarifyBecameVisibleAt);
        if (isDocHidden()) pendStart = now;
      }
      if (now - pendStart >= confirmMs) {
        writeClarifySubstateShown(key, kind, statusRaw);
        clarifySubstatePending.delete(key);
        return statusRaw;
      }
      scheduleClarifyHoldRelease(pendStart + confirmMs - now);
      return shown.s || statusRaw;
    }
    clarifySubstatePending.set(key, { pendKind: kind, pendSince: now });
    scheduleClarifyHoldRelease(confirmMs);
    return shown.s || statusRaw;
  }

  function getCardTimingVisual(row) {
    const rawMetaText = normalizeText(row.reqDateTime || '');
    const isMod = row.statusKey === 'mod';
    const isClarifyAgree = isClarifyAgreeStatus(row.status);
    let metaText = isMod
      ? resolveModerationMetaText(row.id, rawMetaText, row.moderationCallValue, row.moderationCallCheckedAt)
      : rawMetaText;
    if (isClarifyAgree) {
      metaText = resolveClarifyAgreeMetaText(row.id, metaText);
      metaText = formatClarifyAgreeDisplayText(metaText);
    }
    const displayMetaText = expandShortCallText(metaText);
    const metaLower = metaText.toLowerCase();
    const isNoAnswerText = metaLower.includes('не звонил');
    const mins = minutesFromMetaText(metaText);
    const calledAgoMinutes = isMod ? extractCalledAgoMinutes(metaText) : null;
    const createdElapsedMinutes = elapsedMinutesFromDateTime(row.created);
    const moveMetaToTopRight = isMod || isClarifyAgree;

    let toneClass = '';
    let cardAlertClass = '';
    if (isMod) {
      if (isNoAnswerText) {
        if (Number.isFinite(createdElapsedMinutes) && createdElapsedMinutes >= 15) {
          toneClass = 'is-danger';
          cardAlertClass = 'alert-red';
        } else if (Number.isFinite(createdElapsedMinutes) && createdElapsedMinutes >= 10) {
          toneClass = 'is-warn';
          cardAlertClass = 'alert-yellow';
        }
      } else if (((calledAgoMinutes !== null) ? calledAgoMinutes : mins) !== null && ((calledAgoMinutes !== null) ? calledAgoMinutes : mins) >= 15) {
        toneClass = 'is-danger';
        cardAlertClass = 'alert-red';
      } else if (((calledAgoMinutes !== null) ? calledAgoMinutes : mins) !== null && ((calledAgoMinutes !== null) ? calledAgoMinutes : mins) >= 10) {
        toneClass = 'is-warn';
        cardAlertClass = 'alert-yellow';
      }
    } else if (isClarifyAgree) {
      if (metaLower.includes('не отправлено')) {
        toneClass = 'is-warn';
        cardAlertClass = 'alert-yellow';
      } else {
        // Подсветка «на соглас» по времени ГОРОДА:
        //  • до 10:00 — не светит ничего;
        //  • 10:00–21:30 (рабочее окно) — зелёная и жёлтая как обычно;
        //  • после 21:30 — жёлтая гаснет всегда; зелёная только если отправлено на соглас ≤ 21:15.
        const OPEN_MIN = 10 * 60;            // 10:00
        const CLOSE_MIN = (21 * 60) + 30;    // 21:30
        const SENT_CUTOFF_MIN = (21 * 60) + 15; // 21:15
        const cityNowMin = getCurrentCityClockMinutes(row);
        const sentCityMin = getSentCityClockMinutes(row, mins);
        const afterOpen = (cityNowMin === null) || (cityNowMin >= OPEN_MIN);
        const inWorkWindow = (cityNowMin === null) || (cityNowMin >= OPEN_MIN && cityNowMin < CLOSE_MIN);
        const sentByCutoff = (sentCityMin === null) || (sentCityMin <= SENT_CUTOFF_MIN);
        const clarifyEffectiveMinutes = getClarifyAgreeEffectiveMinutes(row, mins);
        if (afterOpen && clarifyEffectiveMinutes !== null && clarifyEffectiveMinutes >= 15) {
          if (shouldWarnClarifyAgreeRoute(row)) {
            // жёлтая (предупреждение) — только в рабочем окне, после 21:30 не показываем
            if (inWorkWindow) {
              toneClass = 'is-warn';
              cardAlertClass = 'alert-yellow';
            }
          } else if (Number(row?.clarifyRouteCheckedAt || 0) > 0) {
            // зелёная — в рабочем окне всегда; после 21:30 только если отправлено ≤ 21:15
            if (inWorkWindow || sentByCutoff) {
              toneClass = 'is-success';
              cardAlertClass = 'alert-green';
            }
          }
        }
      }
    }

    const noAnswerModerationText = (isMod && isNoAnswerText)
      ? buildNoAnswerModerationText(row.created)
      : '';
    const moderationAgeText = isMod ? buildModerationAgeCompact(row.created) : '';
    const moderationProgressText = moderationAgeText === 'неизвестно'
      ? 'Пришла недавно'
      : `Пришла ${moderationAgeText} назад`;
    const displayMetaMeaningful = isDashLikeText(displayMetaText) ? '' : displayMetaText;
    const displayMetaNormalized = normalizeText(displayMetaMeaningful).toLowerCase();
    const isCalledText = displayMetaNormalized.includes('звонил') && !displayMetaNormalized.includes('не звонил');
    const moderationRightText = noAnswerModerationText
      || (isCalledText
        ? displayMetaMeaningful
        : (displayMetaMeaningful
          ? `${displayMetaMeaningful}, ${moderationProgressText}`
          : ''));
    const topRightText = moveMetaToTopRight
      ? (isMod
        ? moderationRightText
        : (displayMetaMeaningful || (row.createdFull || row.created)))
      : (row.reqDateTime || '—');
    return {
      showBottomMeta: !moveMetaToTopRight,
      topRightText,
      toneClass,
      cardAlertClass
    };
  }

  function buildCard(row, options = {}) {
    if (row?.isBulkHeader) {
      const phoneText = escapeHtml(formatPhoneRu(row.bulkPhone || '—'));
      const idx = Math.max(1, Number(row.bulkIndex || 1));
      const count = Math.max(0, Number(row.bulkCount || 0));
      const err = normalizeText(row.bulkError || '');
      const subtitle = err
        ? `Ошибка: ${escapeHtml(err)}`
        : (count > 0 ? `Найдено заявок: ${count}` : 'Ничего не найдено');
      const normalizedCallPhone0 = normalizeBulkPhone(row.bulkPhone || '');
      const callHref0 = escapeHtml(normalizedCallPhone0 || row.bulkPhone || '');
      const callMarked0 = normalizedCallPhone0 && bulkCalledPhones.has(normalizedCallPhone0);
      return `
        <div class="bulk-phone-sep">
          <div class="bulk-phone-sep-title">
            <span>Поиск номера ${idx}: ${phoneText}</span>
            ${callHref0 ? `<span class="bulk-call-wrap"><a class="bulk-call-btn${callMarked0 ? ' is-called' : ''}" data-phone="${escapeHtml(normalizedCallPhone0)}" href="callto:${callHref0}${getBulkCallSipForPhone(normalizedCallPhone0)}" title="Позвонить ${phoneText}"><svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8zM16 2h6v6l-2.3-2.3-4 4-1.4-1.4 4-4z"/></svg></a>${callMarked0 ? '<span class="bulk-call-check" title="Звонок отмечен">✓</span>' : ''}</span>` : ''}
          </div>
          <div class="bulk-phone-sep-sub">${subtitle}</div>
        </div>
      `;
    }

    const statusMeta = statusClassMap[row.statusKey] || statusClassMap.cl;
    const timing = getCardTimingVisual(row);
    const isClarifyAgree = isClarifyAgreeStatus(row.status);
    const isMod = row.statusKey === 'mod';
    const showOnCallPill = isMainOnCallRow(row);
    const rightExtraClass = normalizeText(timing.topRightText || '').toLowerCase().includes('звонков не было')
      ? ' is-no-answer'
      : '';
    const rightClass = timing.toneClass ? `c-time-right ${timing.toneClass}${rightExtraClass}` : 'c-time-right';
    const rightText = normalizeText(timing.topRightText || '')
      ? `<span class="${rightClass}">${escapeHtml(timing.topRightText)}</span>`
      : '<span class="c-time-right is-placeholder" aria-hidden="true">&nbsp;</span>';
    const freeStatus = isFreeWidthStatus(row.status);
    const statusClass = freeStatus ? `spill spill-free ${statusMeta.pill}` : `spill ${statusMeta.pill}`;
    const showWorkPill = row.statusKey === 'mod'
      && ['moderation', 'bulk-phones', 'filter'].includes(state.remote.kind);
    // Плашка «В работе» всегда стоит РЯДОМ со статусом/типом (не прижимается вправо):
    // на широком (2K) мониторе margin-left:auto уносил её к правому краю и на модерации,
    // и в «Поиск номера»/фильтре. wp-inline снимает auto → плашка в gap:7px после статуса/типа.
    const wpInline = showWorkPill ? ' wp-inline' : '';
    const workPill = showWorkPill
      ? (
        row.processingState === 'mine'
          ? `<span class="work-pill wp-mine${wpInline}">В работе у меня</span>`
          : row.processingState === 'busy'
            ? `<span class="work-pill wp-busy${wpInline}">В работе</span>`
            : `<span class="work-pill wp-free${wpInline}">Свободна</span>`
      )
      : '';
    const typeClass = `${getTagClass(row.type)} tag-fixed`;
    // Тип прячем только на странице модераций (там пилюля исторически заменяла тип).
    // В остальных списках (поиск по номеру, фильтр, главная) показываем и тип, и пилюлю;
    // пилюля прижата вправо «напротив статуса» через CSS (.work-pill{margin-left:auto}).
    const hideTypeTag = showWorkPill && state.remote.kind === 'moderation';
    const typeTag = hideTypeTag ? '' : `<span class="${typeClass}">${escapeHtml(row.type)}</span>`;
    const openUrl = row.url || `/admin/domain/customer-request/update?id=${encodeURIComponent(row.id)}`;
    const cardStatusClass = row.statusKey ? `card-status-${escapeHtml(row.statusKey)}` : 'card-status-default';
    const cardClass = ['card', cardStatusClass, timing.cardAlertClass || ''].filter(Boolean).join(' ');
    const cardDataId = (state.remote.kind === 'bulk-phones' && row?.bulkCompositeId)
      ? String(row.bulkCompositeId)
      : String(row.id || '');
    const metaBottom = (timing.showBottomMeta || isClarifyAgree || isMod)
      ? `<span class="c-meta"><i class="ti ti-calendar" aria-hidden="true"></i>${escapeHtml(row.createdFull || row.created || '—')}</span>`
      : '';
    const animGroup = getRowAnimGroup(row);
    const visiblePhoneText = row.phone ? escapeHtml(formatPhoneRu(row.phone)) : '—';
    const listIndex = Number(options.listIndex || 0);
    const listIndexBadge = listIndex > 0
      ? `<span class="c-list-index" title="Позиция в списке">${escapeHtml(String(listIndex))}</span>`
      : '';
    const hasListIndexClass = listIndex > 0 ? ' has-list-index' : '';
    const showClaimMark = Boolean(row?.hasClaim);

    return `
      <div class="${cardClass}${hasListIndexClass}" data-id="${escapeHtml(cardDataId)}" data-url="${escapeHtml(openUrl)}" data-action="open-request" data-anim-group="${escapeHtml(animGroup)}">
        <div class="card-accent ${statusMeta.accent}"></div>
        ${listIndexBadge}
        <div class="card-inner">
          <div class="crow1${showOnCallPill ? ' has-call-pill' : ''}">
            <span class="c-id${showClaimMark ? ' has-claim' : ''}"${showClaimMark ? ' title="Претензия"' : ''}>${escapeHtml(row.id)}</span>
            <span class="${statusClass}">${escapeHtml(row.status)}</span>
            ${typeTag}${workPill}
            ${showOnCallPill ? '<span class="call-pill" title="На прозвоне"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.5c.35-.35.9-.35 1.25 0l2.1 2.1c.28.28.34.72.14 1.06l-.9 1.52c.96 1.8 2.43 3.27 4.23 4.23l1.52-.9c.34-.2.78-.14 1.06.14l2.1 2.1c.35.35.35.9 0 1.25l-1.18 1.18c-.74.74-1.84 1-2.82.64C9.98 17.17 6.83 14.02 5.18 9.5c-.36-.98-.1-2.08.64-2.82L7 5.5z"/><path d="M15 5h4v4"/><path d="M14.5 9.5 19 5"/></svg><span>На прозвоне</span></span>' : ''}
          </div>
          <div class="crow2">
            <span class="c-city">${escapeHtml(row.city)}</span>
          </div>
          <div class="crow3">
            <div class="c-author"><div class="c-av">${escapeHtml(row.av)}</div><span class="c-author-name">${escapeHtml(row.name)}</span></div>
            ${metaBottom}
          </div>
          <div class="c-right-col">
            ${rightText}
            <span class="c-address" title="${escapeHtml(row.address || '')}">${escapeHtml(row.address || '—')}</span>
            <span class="c-phone-block"><span class="c-phone-right">${visiblePhoneText}</span></span>
          </div>
        </div>
      </div>
    `;
  }

  function getCurrentRows(rows = state.rows) {
    return filteredRows(rows);
  }

  function parseIntSafe(raw) {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  function parsePercentSafe(raw) {
    const text = String(raw || '');
    const explicit = (text.match(/%\s*Отмен:\s*([\d.,]+)/i) || [])[1];
    const value = explicit || (text.match(/([\d.,]+)/) || [])[1] || '';
    return value ? value.replace('.', ',') : '0,0';
  }

  function getHeaderStats() {
    const wrap = document.querySelector('section.content-header .city-stat')
      || document.querySelector('.city-stat');
    if (!wrap) return null;

    const text = normalizeText(wrap.textContent);
    const badges = Array.from(wrap.querySelectorAll('span.badge')).map((el) => normalizeText(el.textContent));

    const acceptedByText = (text.match(/Заявок\s*принято:\s*(\d+)/i) || [])[1];
    const canceledByText = (text.match(/Отмен:\s*(\d+)/i) || [])[1];
    const percentByText = (text.match(/%\s*Отмен:\s*([\d.,]+)/i) || [])[1];
    const salaryByText = (text.match(/ЗП:\s*(\d+)/i) || [])[1];

    const canceledByBadge = badges.find((line) => /Отмен:\s*\d+/i.test(line));
    const percentByBadge = badges.find((line) => /%\s*Отмен:\s*[\d.,]+/i.test(line));
    const salaryByBadge = badges.find((line) => /ЗП:\s*\d+/i.test(line));
    const acceptedByBadge = badges.find((line) => /Заявок\s*принято:\s*\d+/i.test(line));

    const accepted = parseIntSafe(acceptedByText || acceptedByBadge);
    const canceled = parseIntSafe(canceledByText || canceledByBadge);
    const percent = parsePercentSafe(percentByText || percentByBadge);
    const salary = parseIntSafe(salaryByText || salaryByBadge);

    if (!accepted && !canceled && !percent && !salary) return null;

    return { accepted, canceled, percent, salary };
  }

  function getDailyStatsFromFixAhk() {
    const box = document.getElementById('tm-dispatcher-stats-box');
    if (box) {
      const accepted = normalizeText(box.querySelector('[data-cell="accepted"] .tm-dispatcher-stats-value')?.textContent || '');
      const canceled = normalizeText(box.querySelector('[data-cell="canceled"] .tm-dispatcher-stats-value')?.textContent || '');
      const calls = normalizeText(box.querySelector('[data-cell="calls"] .tm-dispatcher-stats-value')?.textContent || '');
      const amount = normalizeText(box.querySelector('[data-cell="amount"] .tm-dispatcher-stats-value')?.textContent || '');
      const reportButton = box.querySelector('.tm-dispatcher-stats-report-btn');

      if (accepted || canceled || calls || amount) {
        return {
          accepted: parseIntSafe(accepted),
          canceled: parseIntSafe(canceled),
          calls: parseIntSafe(calls),
          amount: parseIntSafe(amount),
          reportReady: Boolean(reportButton && !reportButton.disabled)
        };
      }
    }

    try {
      const raw = localStorage.getItem('tm-dispatcher-stats-cache-v2');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const data = parsed?.data || {};
      const accepted = parseIntSafe(data.accepted);
      const canceled = parseIntSafe(data.canceled);
      const calls = parseIntSafe(data.calls);
      if (!accepted && !canceled && !calls) return null;
      return {
        accepted,
        canceled,
        calls,
        amount: 0,
        reportReady: Boolean(document.querySelector('#tm-dispatcher-stats-box .tm-dispatcher-stats-report-btn'))
      };
    } catch (_error) {
      return null;
    }
  }

  // Отчёт в процессе. Периодическая синхронизация плашки безусловно переставляла disabled
  // (по состоянию кнопки Фикс+ахк) и могла оживить кнопку прямо посреди сбора — держим до
  // конца, т.е. пока команда не уйдёт в АХК.
  let reportSendInProgress = false;
  function triggerFixAhkReport(options = {}) {
    const reportButton = document.querySelector('#tm-dispatcher-stats-box .tm-dispatcher-stats-report-btn');
    if (!reportButton || reportButton.disabled) return false;
    const ctrlKey = Boolean(options && options.ctrlKey);
    const metaKey = Boolean(options && options.metaKey);
    const wantNight = Boolean(options && options.wantNight);
    if (wantNight) {
      try { window.__tmForceNightReportOnce = Date.now(); } catch (_e) {}
      try { reportButton.dataset.tmForceNightOnce = '1'; } catch (_e) {}
    }
    try {
      const synthetic = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey,
        metaKey
      });
      reportButton.dispatchEvent(synthetic);
    } catch (_error) {
      reportButton.click();
    }
    return true;
  }

  function renderStats(rows) {
    const acceptedNode = document.getElementById('tmKpiAccepted');
    const canceledNode = document.getElementById('tmKpiCanceled');
    const salaryNode = document.getElementById('tmKpiSalary');
    const acceptedNoteNode = document.getElementById('tmKpiAcceptedNote');
    const canceledPercentNode = document.getElementById('tmKpiCanceledPercent');
    const dayNode = document.getElementById('tmKpiDay');
    const daySubNode = document.getElementById('tmKpiDaySub');
    const reportBtn = document.getElementById('tmKpiReportBtn');
    if (!acceptedNode || !canceledNode || !salaryNode) return;
    const fromHeader = getHeaderStats();
    const setStatsMeta = (accepted, canceled, percent) => {
      const clean = Math.max(0, Number(accepted || 0) - Number(canceled || 0));
      if (acceptedNoteNode) acceptedNoteNode.textContent = `Чистых: ${clean}`;
      if (canceledPercentNode) canceledPercentNode.textContent = `${String(percent || '0,0').replace('.', ',')}%`;
    };

    if (fromHeader) {
      acceptedNode.textContent = String(fromHeader.accepted);
      canceledNode.textContent = String(fromHeader.canceled);
      salaryNode.textContent = `${fromHeader.salary.toLocaleString('ru-RU')} ₽`;
      setStatsMeta(fromHeader.accepted, fromHeader.canceled, fromHeader.percent);
    } else {
      const total = rows.length;
      const canceled = rows.filter((row) => row.statusKey === 'cl').length;
      const canceledPercent = total ? ((canceled / total) * 100).toFixed(1).replace('.', ',') : '0,0';
      const salary = total * 82;
      acceptedNode.textContent = String(total);
      canceledNode.textContent = String(canceled);
      salaryNode.textContent = `${salary.toLocaleString('ru-RU')} ₽`;
      setStatsMeta(total, canceled, canceledPercent);
    }

    const dayStats = getDailyStatsFromFixAhk();
    if (dayNode) {
      dayNode.textContent = dayStats ? `${dayStats.amount.toLocaleString('ru-RU')} ₽` : '—';
    }
    if (daySubNode) {
      daySubNode.textContent = dayStats
        ? `Заявки ${dayStats.accepted} · Отмены ${dayStats.canceled}`
        : 'Жду данные Фикс+ахк';
    }
    if (reportBtn && !reportSendInProgress) {
      reportBtn.disabled = !dayStats?.reportReady;
    }
  }

  function buildCardsStatusHtml(message) {
    const text = normalizeText(message || '');
    return `<div class="cards-status-note">${escapeHtml(text || 'Загрузка...')}</div>`;
  }

  function getBulkPhonesLoadingProgress() {
    const total = Math.max(0, Number(state.remote.bulkPhoneTotal || 0));
    const done = Math.min(total, Math.max(0, Number(state.remote.bulkPhoneDone || 0)));
    if (!total) return null;
    return `Поиск номеров: ${done}/${total}`;
  }

  function hasHiddenBulkPhones() {
    return Boolean(state.hiddenBulkPhones && Array.isArray(state.hiddenBulkPhones.rows));
  }

  function snapshotCurrentBulkPhones() {
    if (state.remote.kind !== 'bulk-phones') return null;
    return {
      rows: Array.isArray(state.remote.rows) ? state.remote.rows.slice() : [],
      loading: Boolean(state.remote.loading),
      bulkPhoneTotal: Math.max(0, Number(state.remote.bulkPhoneTotal || 0)),
      bulkPhoneDone: Math.max(0, Number(state.remote.bulkPhoneDone || 0)),
      personalModeError: normalizeText(state.remote.personalModeError || '')
    };
  }

  function hideBulkPhonesToMain() {
    const snapshot = snapshotCurrentBulkPhones();
    if (!snapshot) return;
    state.hiddenBulkPhones = snapshot;
    state.remote.seq += 1;
    state.remote.kind = '';
    state.remote.id = '';
    state.remote.rows = null;
    state.remote.loading = false;
    state.remote.personalModeError = '';
    state.remote.bulkPhoneTotal = 0;
    state.remote.bulkPhoneDone = 0;
    requestTopOnNextCardsRender();
    renderAll();
    updateBulkPhonesButtonUi();
  }

  function restoreHiddenBulkPhones() {
    if (!hasHiddenBulkPhones()) return;
    const snapshot = state.hiddenBulkPhones;
    state.remote.kind = 'bulk-phones';
    state.remote.id = '';
    state.remote.rows = Array.isArray(snapshot.rows) ? snapshot.rows.slice() : [];
    state.remote.loading = Boolean(snapshot.loading);
    state.remote.personalModeError = normalizeText(snapshot.personalModeError || '');
    state.remote.bulkPhoneTotal = Math.max(0, Number(snapshot.bulkPhoneTotal || 0));
    state.remote.bulkPhoneDone = Math.max(0, Number(snapshot.bulkPhoneDone || 0));
    requestTopOnNextCardsRender();
    renderAll();
    updateBulkPhonesButtonUi();
  }

  function closeHiddenBulkPhones() {
    if (!hasHiddenBulkPhones()) return;
    state.hiddenBulkPhones = null;
    renderAll();
    updateBulkPhonesButtonUi();
  }

  function closeCurrentBulkPhones() {
    state.hiddenBulkPhones = null;
    state.remote.seq += 1;
    state.remote.kind = '';
    state.remote.id = '';
    state.remote.rows = null;
    state.remote.loading = false;
    state.remote.personalModeError = '';
    state.remote.bulkPhoneTotal = 0;
    state.remote.bulkPhoneDone = 0;
    requestTopOnNextCardsRender();
    renderAll();
    updateBulkPhonesButtonUi();
  }

  function buildCardsLoadingHtml(progress = null) {
    const progressText = normalizeText(progress || '');
    const progressHtml = progressText
      ? `<div class="cards-loading-progress">${escapeHtml(progressText)}</div>`
      : '';
    return `<div class="cards-loading"><div class="cards-loading-spinner" aria-label="Загрузка"></div>${progressHtml}</div>`;
  }

  function setElementClass(el, className, enabled) {
    if (!(el instanceof HTMLElement)) return;
    const hasClass = el.classList.contains(className);
    if (enabled && !hasClass) el.classList.add(className);
    if (!enabled && hasClass) el.classList.remove(className);
  }

  function cleanupStaleCardGhosts(force = false) {
    const hostRoot = document.getElementById(HOST_ID);
    const root = hostRoot || document;
    const now = Date.now();
    root.querySelectorAll('.card-ghost-leave').forEach((ghost) => {
      if (!(ghost instanceof HTMLElement)) return;
      const createdAt = Number(ghost.getAttribute('data-tm-ghost-created-at') || '0');
      const expireAt = Number(ghost.getAttribute('data-tm-ghost-expire-at') || '0');
      if (force || (expireAt && now >= expireAt) || (createdAt && now - createdAt > 1800)) {
        ghost.remove();
      }
    });
  }

  function armCardGhostLifecycle(ghost, sourceCard, durationMs) {
    if (!(ghost instanceof HTMLElement)) return;
    const hostRoot = document.getElementById(HOST_ID);
    const root = hostRoot || document;
    const id = String(sourceCard?.getAttribute?.('data-id') || ghost.getAttribute('data-id') || '');
    if (id) {
      root.querySelectorAll('.card-ghost-leave').forEach((node) => {
        if (node !== ghost && node instanceof HTMLElement && String(node.getAttribute('data-id') || '') === id) {
          node.remove();
        }
      });
    }
    const duration = Number(durationMs) || 620;
    const ttl = Math.max(900, duration + 520);
    const now = Date.now();
    ghost.setAttribute('data-tm-ghost-created-at', String(now));
    ghost.setAttribute('data-tm-ghost-expire-at', String(now + ttl));
    let removed = false;
    let removeTimer = 0;
    const remove = () => {
      if (removed) return;
      removed = true;
      if (removeTimer) clearTimeout(removeTimer);
      ghost.removeEventListener('transitionend', onTransitionEnd);
      ghost.removeEventListener('transitioncancel', onTransitionEnd);
      ghost.remove();
    };
    const onTransitionEnd = (event) => {
      if (event.target !== ghost) return;
      if (!['opacity', 'transform', 'filter'].includes(String(event.propertyName || ''))) return;
      remove();
    };
    ghost.addEventListener('transitionend', onTransitionEnd);
    ghost.addEventListener('transitioncancel', onTransitionEnd);
    removeTimer = setTimeout(remove, ttl);
  }

  const TRANSIENT_CARD_ANIMATION_CLASSES = new Set([
    'card-enter',
    'card-enter-active',
    'card-move'
  ]);

  function stripTransientCardAnimationMarkup(html) {
    return String(html || '').replace(/class="([^"]*)"/g, (_match, classValue) => {
      const classes = String(classValue || '')
        .split(/\s+/)
        .filter((name) => name && !TRANSIENT_CARD_ANIMATION_CLASSES.has(name));
      return `class="${classes.join(' ')}"`;
    });
  }

  function patchCardsLoadingProgress(cardsArea, nextHtml) {
    if (!(cardsArea instanceof HTMLElement)) return false;
    const currentLoading = Array.from(cardsArea.children)
      .find((node) => node instanceof HTMLElement && node.classList.contains('cards-loading'));
    if (!(currentLoading instanceof HTMLElement)) return false;

    const template = document.createElement('template');
    template.innerHTML = String(nextHtml || '').trim();
    const nextLoading = template.content.querySelector('.cards-loading');
    if (!(nextLoading instanceof HTMLElement)) return false;

    const nextProgressText = normalizeText(nextLoading.querySelector('.cards-loading-progress')?.textContent || '');
    const currentProgress = currentLoading.querySelector('.cards-loading-progress');
    if (!nextProgressText) {
      if (currentProgress) currentProgress.remove();
      return true;
    }

    if (currentProgress instanceof HTMLElement) {
      if (currentProgress.textContent !== nextProgressText) {
        currentProgress.textContent = nextProgressText;
      }
      return true;
    }

    const progressNode = document.createElement('div');
    progressNode.className = 'cards-loading-progress';
    progressNode.textContent = nextProgressText;
    currentLoading.appendChild(progressNode);
    return true;
  }

  function setCardsAreaContent(cardsArea, html, contentKey, options = {}) {
    if (!(cardsArea instanceof HTMLElement)) return false;
    const nextHtml = String(html ?? '');
    const nextKey = String(contentKey ?? '');
    const prevKey = String(cardsArea.getAttribute('data-content-key') || '');
    const prevHtml = String(cardsArea.innerHTML || '');
    const nextHasCustomerDirectory = nextHtml.includes('customer-directory-modern');
    const swapLeaveMs = Math.max(0, Number(options.swapLeaveMs ?? 90));
    const swapEnterMs = Math.max(0, Number(options.swapEnterMs ?? (nextHasCustomerDirectory ? 460 : 190)));
    const afterApply = typeof options.afterApply === 'function' ? options.afterApply : null;
    const notifyApplied = () => {
      if (!afterApply) return;
      try {
        afterApply();
      } catch (error) {
        console.error('[CRM v8] content apply hook failed', error);
      }
    };
    if (prevKey === nextKey) {
      if (prevHtml === nextHtml) {
        notifyApplied();
        return false;
      }
      if (patchCardsLoadingProgress(cardsArea, nextHtml)) {
        notifyApplied();
        return false;
      }
      if (stripTransientCardAnimationMarkup(prevHtml) === stripTransientCardAnimationMarkup(nextHtml)) {
        notifyApplied();
        return false;
      }
    }
    const nextSeq = Number(cardsArea.getAttribute('data-content-seq') || '0') + 1;
    cardsArea.setAttribute('data-content-seq', String(nextSeq));

    const clearSwapClasses = () => {
      cardsArea.classList.remove('cards-area-swap-leave', 'cards-area-swap-enter', 'cards-area-swap-enter-active');
    };
    const applyNow = () => {
      clearSwapClasses();
      cardsArea.innerHTML = nextHtml;
      cardsArea.setAttribute('data-content-key', nextKey);
      notifyApplied();
    };

    const shouldAnimate = Boolean(options.animate !== false && prevKey && prevKey !== nextKey);
    if (!shouldAnimate) {
      applyNow();
      return true;
    }

    clearSwapClasses();
    cardsArea.classList.add('cards-area-swap-leave');
    setTimeout(() => {
      if (String(cardsArea.getAttribute('data-content-seq') || '') !== String(nextSeq)) return;
      cardsArea.innerHTML = nextHtml;
      cardsArea.setAttribute('data-content-key', nextKey);
      notifyApplied();
      cardsArea.classList.remove('cards-area-swap-leave');
      cardsArea.classList.add('cards-area-swap-enter');
      requestAnimationFrame(() => {
        if (String(cardsArea.getAttribute('data-content-seq') || '') !== String(nextSeq)) return;
        cardsArea.classList.add('cards-area-swap-enter-active');
      });
      setTimeout(() => {
        if (String(cardsArea.getAttribute('data-content-seq') || '') !== String(nextSeq)) return;
        cardsArea.classList.remove('cards-area-swap-enter', 'cards-area-swap-enter-active');
      }, swapEnterMs);
    }, swapLeaveMs);
    return true;
  }

  function animateCardsFromDepth(cards, options = {}) {
    const list = Array.from(cards || []).filter((card) => card instanceof HTMLElement);
    if (!list.length) return;
    const enterMs = Math.max(1, Number(options.enterMs || 560));
    const baseDelay = Math.max(0, Number(options.baseDelay ?? 0));
    const staggerStep = Math.max(0, Number(options.staggerStep ?? 8));
    const maxStagger = Math.max(0, Number(options.maxStagger ?? 64));
    list.forEach((card, index) => {
      card.classList.remove('card-enter-active');
      card.classList.add('card-enter');
      void card.offsetWidth;
      const showDelay = baseDelay + Math.min(index * staggerStep, maxStagger);
      setTimeout(() => {
        requestAnimationFrame(() => {
          card.classList.add('card-enter-active');
        });
      }, showDelay);
      setTimeout(() => {
        card.classList.remove('card-enter', 'card-enter-active');
      }, showDelay + enterMs);
    });
  }

  function animateBulkPhoneGroupsFromDepth(cardsArea, groups = null) {
    if (!(cardsArea instanceof HTMLElement)) return;
    animateCardsFromDepth(groups || cardsArea.querySelectorAll('.bulk-phone-group'), {
      enterMs: 560,
      baseDelay: 0,
      staggerStep: 8,
      maxStagger: 64
    });
  }

  function dispatcherReportNumber(value) {
    const match = normalizeText(value || '').replace(/\s+/g, '').match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return 0;
    const parsed = Number(match[0].replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dispatcherReportPercent(value) {
    const match = normalizeText(value || '').match(/\d+(?:[.,]\d+)?\s*%/);
    return match ? match[0].replace(/\s+/g, '').replace(',', '.') : '';
  }

  function parseDispatcherReportData(html) {
    const source = String(html || '');
    if (!source) return null;
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const normalizeHead = (value) => normalizeText(value || '').toLowerCase().replace(/ё/g, 'е');
    const tables = Array.from(doc.querySelectorAll('table'));
    let table = doc.querySelector('#repDispTable');
    let bestScore = -1;
    tables.forEach((candidate) => {
      if (table?.id === 'repDispTable') return;
      const head = normalizeHead(Array.from(candidate.querySelectorAll('thead th, thead td')).map((cell) => cell.textContent).join(' '));
      const fallbackHead = head || normalizeHead(Array.from(candidate.querySelectorAll('tr:first-child th, tr:first-child td')).map((cell) => cell.textContent).join(' '));
      const score = (fallbackHead.includes('диспетчер') ? 8 : 0)
        + (fallbackHead.includes('принят') ? 4 : 0)
        + (fallbackHead.includes('отмен') ? 2 : 0)
        + Math.min(3, candidate.querySelectorAll('tbody tr').length / 10);
      if (score > bestScore) {
        bestScore = score;
        table = candidate;
      }
    });
    if (!table || (table.id !== 'repDispTable' && bestScore < 8)) return null;

    let headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
    if (!headerCells.length) headerCells = Array.from(table.querySelectorAll('tr:first-child th, tr:first-child td'));
    const headers = headerCells.map((cell) => normalizeHead(cell.textContent));
    const findCol = (variants, excludes = []) => headers.findIndex((header) => (
      variants.some((variant) => header.includes(variant))
      && !excludes.some((variant) => header.includes(variant))
    ));
    const columns = {
      name: findCol(['диспетчер', 'сотрудник', 'фио']),
      cls: findCol(['класс']),
      accepted: findCol(['принят']),
      ccCancel: findCol(['отмена кц', 'отмен кц', 'кц']),
      ccCancelForPct: findCol(['в зачет', 'зачет кц', 'зачетных отмен']),
      cancelPct: findCol(['% отмен', 'процент отмен', 'зачетный процент']),
      branchCancel: findCol(['отмена филиал', 'отмен филиал']),
      calls: findCol(['прозвон', 'аудит']),
      bsoErrors: findCol(['бсо']),
      cancelledTotal: findCol(['отменено диспетчер', 'отменил', 'снято с линии']),
      claims: findCol(['претенз'])
    };
    if (table.id === 'repDispTable') {
      Object.assign(columns, {
        name: 0,
        cls: -1,
        accepted: 1,
        ccCancel: 2,
        ccCancelForPct: 3,
        cancelPct: 4,
        branchCancel: 5,
        calls: 6,
        bsoErrors: 7,
        cancelledTotal: 8,
        claims: 9
      });
    }
    if (columns.name < 0 || columns.accepted < 0) return null;

    let rowNodes = Array.from(table.querySelectorAll('tbody tr'));
    if (!rowNodes.length) rowNodes = Array.from(table.querySelectorAll('tr')).slice(1);
    const dispatchers = [];
    rowNodes.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td, th'));
      if (!cells.length || columns.name >= cells.length) return;
      const nameCell = cells[columns.name];
      const rawName = normalizeText(nameCell.querySelector('a')?.textContent || nameCell.textContent || '');
      if (!rawName || /^(?:итого|всего|сумма)\b/i.test(rawName)) return;
      const classPattern = /(?:\(|\b)\s*(III|II|I|3|2|1)\s*[- ]*класс\s*(?:\)|\b)/i;
      const classFromName = normalizeText(nameCell.textContent || '').match(classPattern)?.[1] || '';
      const clsRaw = columns.cls >= 0 && columns.cls < cells.length
        ? normalizeText(cells[columns.cls].textContent || '')
        : classFromName;
      const rawClassValue = normalizeText(clsRaw.replace(/[()]/g, '').replace(/\s*[- ]*класс\s*/i, '')).toUpperCase();
      const cls = ({ '1': 'I', '2': 'II', '3': 'III' }[rawClassValue] || rawClassValue) || null;
      const name = normalizeText(rawName.replace(classPattern, ''));
      if (!name) return;

      const cellText = (index) => index >= 0 && index < cells.length ? normalizeText(cells[index].textContent || '') : '';
      const accepted = Math.max(0, Math.trunc(dispatcherReportNumber(cellText(columns.accepted))));
      const ccText = cellText(columns.ccCancel);
      const ccCancel = Math.max(0, Math.trunc(dispatcherReportNumber(ccText)));
      const inCountMatch = ccText.match(/(\d+)\s*(?:в\s*)?зач[её]т/i);
      const countedCellText = cellText(columns.ccCancelForPct);
      const ccCancelForPct = countedCellText
        ? Math.max(0, Math.trunc(dispatcherReportNumber(countedCellText)))
        : (inCountMatch ? Number(inCountMatch[1]) : ccCancel);
      const pctText = cellText(columns.cancelPct) || ccText;
      const parsedPct = dispatcherReportPercent(pctText);
      const cancelPct = parsedPct || (accepted > 0 && ccCancelForPct > 0
        ? `${((ccCancelForPct / accepted) * 100).toFixed(1).replace(/\.0$/, '')}%`
        : '');

      dispatchers.push({
        name,
        cls,
        accepted,
        ccCancel,
        ccCancelForPct,
        cancelPct,
        branchCancel: Math.max(0, Math.trunc(dispatcherReportNumber(cellText(columns.branchCancel)))),
        calls: Math.max(0, Math.trunc(dispatcherReportNumber(cellText(columns.calls)))),
        bsoErrors: Math.max(0, Math.trunc(dispatcherReportNumber(cellText(columns.bsoErrors)))),
        cancelledTotal: Math.max(0, Math.trunc(dispatcherReportNumber(cellText(columns.cancelledTotal)))),
        claims: Math.max(0, Math.trunc(dispatcherReportNumber(cellText(columns.claims))))
      });
    });
    if (!dispatchers.length) return null;

    const totals = dispatchers.reduce((sum, item) => {
      sum.accepted += item.accepted;
      sum.ccCancel += item.ccCancel;
      sum.ccCancelForPct += item.ccCancelForPct;
      sum.branchCancel += item.branchCancel;
      sum.calls += item.calls;
      sum.bsoErrors += item.bsoErrors;
      sum.cancelledTotal += item.cancelledTotal;
      sum.claims += item.claims;
      return sum;
    }, { accepted: 0, ccCancel: 0, ccCancelForPct: 0, branchCancel: 0, calls: 0, bsoErrors: 0, cancelledTotal: 0, claims: 0 });
    totals.cancelPct = totals.accepted > 0
      ? `${((totals.ccCancelForPct / totals.accepted) * 100).toFixed(1).replace(/\.0$/, '')}%`
      : '0%';

    const pageText = normalizeText(doc.body?.textContent || '');
    const reportDate = pageText.match(/\b\d{2}\.\d{2}\.\d{4}\b/)?.[0] || '';
    return { dispatchers, totals, reportDate };
  }

  function getVisibleDispatcherRows(data) {
    const source = Array.isArray(data?.dispatchers) ? data.dispatchers : [];
    const query = normalizeText(dispatcherReportViewState.query || '').toLowerCase();
    const rows = query
      ? source.filter((item) => normalizeText(item.name || '').toLowerCase().includes(query))
      : source.slice();
    const sortMode = getDispatcherReportSortMode();
    if (sortMode === 'pct') {
      rows.sort((a, b) => {
        const aEligible = a.accepted >= 900;
        const bEligible = b.accepted >= 900;
        if (aEligible !== bEligible) return aEligible ? -1 : 1;
        if (aEligible) {
          return dispatcherReportNumber(a.cancelPct) - dispatcherReportNumber(b.cancelPct)
            || b.accepted - a.accepted
            || a.name.localeCompare(b.name, 'ru');
        }
        return b.accepted - a.accepted || a.name.localeCompare(b.name, 'ru');
      });
    } else if (sortMode === 'net') {
      rows.sort((a, b) => dispatcherNetAccepted(b) - dispatcherNetAccepted(a)
        || b.accepted - a.accepted
        || a.name.localeCompare(b.name, 'ru'));
    } else {
      rows.sort((a, b) => b.accepted - a.accepted || a.name.localeCompare(b.name, 'ru'));
    }
    return rows;
  }

  function buildDispatcherFlags(item) {
    const pct = dispatcherReportNumber(item.cancelPct);
    const pctTone = dispatcherNetAccepted(item) >= 1800
      ? 'grey'
      : pct > 9 ? 'red' : pct > 6 ? 'amber' : 'grey';
    return [
      `<span class="dr-flag dr-flag-red">Отмен <b>${item.ccCancel}</b></span>`,
      `<span class="dr-flag dr-flag-grey">В % отмен <b>${item.ccCancelForPct}</b></span>`,
      isDispatcherMonthlyReport()
        ? `<span class="dr-flag dr-flag-${pctTone}">% отмен <b>${escapeHtml(item.cancelPct || '0%')}</b></span>`
        : ''
    ].join('');
  }

  function normalizeDispatcherIdentity(value) {
    return normalizeText(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^а-яa-z0-9]+/gi, ' ')
      .trim();
  }

  function isCurrentDispatcher(item) {
    const profileName = normalizeText(dispatcherReportViewState.currentUserName || '')
      || normalizeText(document.querySelector(`#${HOST_ID} .sb-uname`)?.textContent || '')
      || readCurrentUserProfileFromNativeHeader().name;
    return Boolean(profileName)
      && normalizeDispatcherIdentity(item?.name) === normalizeDispatcherIdentity(profileName);
  }

  function buildDispatcherRowsHtml(data) {
    const rows = getVisibleDispatcherRows(data);
    if (!rows.length) return '<div class="dr-empty">Диспетчер не найден</div>';
    const sortMode = getDispatcherReportSortMode();
    const multiDayPeriod = isDispatcherMultiDayReport();
    return rows.map((item, index) => {
      const salaryReached = !multiDayPeriod && item.accepted >= 35;
      const pctInactive = sortMode === 'pct' && item.accepted < 900;
      const currentDispatcher = isCurrentDispatcher(item);
      const width = item.accepted > 0 ? Math.max(3, Math.min(100, (item.accepted / 35) * 100)) : 0;
      return `
        <div class="dr-row${item.accepted === 0 ? ' is-zero' : ''}${salaryReached ? ' salary-reached' : ''}${multiDayPeriod ? ' multi-day-period' : ''}${pctInactive ? ' pct-inactive' : ''}${currentDispatcher ? ' is-current-dispatcher' : ''}">
          <div class="dr-rank${index === 0 && (sortMode === 'accepted' || sortMode === 'net') ? ' top' : ''}">${index + 1}</div>
          <div class="dr-person">
            <div class="dr-name-line">
              <span class="dr-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
              ${item.cls ? `<span class="dr-class">${escapeHtml(item.cls)} класс</span>` : ''}
              ${salaryReached ? '<span class="dr-salary">Оклад</span>' : ''}
            </div>
            <div class="dr-progress"><span class="dr-progress-fill" style="--dr-width:${width.toFixed(2)}%"></span></div>
          </div>
          <div class="dr-accepted">${sortMode === 'net'
            ? `<span>Принято чистых:</span><b>${dispatcherNetAccepted(item)}</b><span>шт.</span>`
            : `<span>Принято:</span><b>${item.accepted}</b><span>шт.</span>`}</div>
          <div class="dr-flags">${buildDispatcherFlags(item)}</div>
        </div>`;
    }).join('');
  }

  function buildDispatcherKpisHtml(data) {
    const totals = data.totals;
    const active = Math.max(1, data.dispatchers.filter((item) => item.accepted > 0).length);
    const pct = dispatcherReportNumber(totals.cancelPct);
    const cards = [
      ['blue', 'ti-inbox', 'Принято заявок', totals.accepted, `в среднем ${(totals.accepted / active).toFixed(1)} на активного`, ''],
      ['red', 'ti-circle-x', 'Отмена КЦ', totals.ccCancel, `${totals.ccCancelForPct} в зачёт`, ''],
      [pct >= 15 ? 'red' : pct >= 7 ? 'amber' : 'green', 'ti-percentage', '% отмен (зачётный)', totals.cancelPct, 'от принятых', pct >= 15 ? 'bad' : pct >= 7 ? 'warn' : 'good'],
      ['amber', 'ti-hierarchy-2', 'Отмена филиала', totals.branchCancel, 'не в зачёт диспетчеру', ''],
      ['blue', 'ti-phone-call', 'Прозвоны (аудит)', totals.calls, 'контрольных звонков', ''],
      [totals.bsoErrors > 0 ? 'red' : 'green', 'ti-file-alert', 'Ошибок БСО', totals.bsoErrors, totals.bsoErrors > 0 ? 'требуют внимания' : 'без ошибок', totals.bsoErrors > 0 ? 'bad' : 'good'],
      ['red', 'ti-x', 'Отменено диспетчерами', totals.cancelledTotal, 'заявок снято с линии', ''],
      [totals.claims > 5 ? 'amber' : 'green', 'ti-flag', 'Претензий', totals.claims, 'от клиентов за период', '']
    ];
    return cards.map(([tone, icon, label, value]) => `
      <div class="dr-kpi">
        <span class="dr-kpi-icon ${tone}"><i class="ti ${icon}" aria-hidden="true"></i></span>
        <span class="dr-kpi-label">${escapeHtml(label)}</span>
        <b class="dr-kpi-number">${escapeHtml(String(value))}</b>
      </div>`).join('');
  }

  function dispatcherReportDateToInput(value) {
    const match = normalizeText(value || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
  }

  function dispatcherReportDateFromInput(value) {
    const match = normalizeText(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
  }

  function dispatcherDateDisplay(value) {
    const match = normalizeText(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
  }

  function parseDispatcherIsoDate(value) {
    const match = normalizeText(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return { year, month, day };
  }

  function dispatcherIsoDate(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function getDispatcherWorkdayDate(now = new Date()) {
    const date = new Date(now);
    if (date.getHours() < 8) date.setDate(date.getDate() - 1);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  function dispatcherDateWithOffset(dayOffset = 0) {
    const date = getDispatcherWorkdayDate();
    date.setDate(date.getDate() + dayOffset);
    return dispatcherIsoDate(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function getDispatcherShiftPeriod(dayOffset = 0) {
    return {
      dateFrom: dispatcherDateWithOffset(dayOffset),
      dateTill: dispatcherDateWithOffset(dayOffset + 1)
    };
  }

  function getDispatcherCalendarDayPeriod(dayOffset = 0) {
    const date = getDispatcherWorkdayDate();
    date.setDate(date.getDate() + dayOffset);
    const value = dispatcherIsoDate(date.getFullYear(), date.getMonth(), date.getDate());
    return { dateFrom: value, dateTill: value };
  }

  function getDispatcherMonthPeriod() {
    const now = getDispatcherWorkdayDate();
    return {
      dateFrom: dispatcherIsoDate(now.getFullYear(), now.getMonth(), 1),
      dateTill: dispatcherIsoDate(now.getFullYear(), now.getMonth(), now.getDate())
    };
  }

  function isDispatcherMonthlyReport() {
    const filters = getDispatcherReportFilters();
    const month = getDispatcherMonthPeriod();
    return filters.dateFrom === month.dateFrom && filters.dateTill === month.dateTill;
  }

  function isDispatcherMultiDayReport() {
    const filters = getDispatcherReportFilters();
    const shift = getDispatcherShiftPeriod();
    const isCurrentShift = filters.dateFrom === shift.dateFrom && filters.dateTill === shift.dateTill;
    return !isCurrentShift && filters.dateFrom !== filters.dateTill;
  }

  function getDispatcherReportSortMode() {
    if (!isDispatcherMonthlyReport()) return 'accepted';
    if (dispatcherReportViewState.sort === 'pct') return 'pct';
    if (dispatcherReportViewState.sort === 'net') return 'net';
    return 'accepted';
  }

  function dispatcherNetAccepted(item) {
    return (Number(item?.accepted) || 0) - (Number(item?.ccCancel) || 0);
  }

  function buildDispatcherPeriodUrl(dateFrom, dateTill) {
    const url = new URL(state.remote.dispatcherReportUrl || findDispatcherReportUrl(), location.origin);
    ['year', 'month', 'date_from', 'date_till'].forEach((key) => {
      url.searchParams.delete(`ReportRequestSearch[${key}]`);
    });
    const periodDate = parseDispatcherIsoDate(dateFrom) || parseDispatcherIsoDate(dateTill);
    if (periodDate) {
      url.searchParams.set('ReportRequestSearch[year]', String(periodDate.year));
      url.searchParams.set('ReportRequestSearch[month]', String(periodDate.month + 1));
    }
    const fromValue = dispatcherReportDateFromInput(dateFrom);
    const tillValue = dispatcherReportDateFromInput(dateTill);
    if (fromValue) url.searchParams.set('ReportRequestSearch[date_from]', fromValue);
    if (tillValue) url.searchParams.set('ReportRequestSearch[date_till]', tillValue);
    return url.toString();
  }

  function applyDispatcherPeriod(root) {
    if (!(root instanceof Element)) return;
    const dateFrom = normalizeText(root.querySelector('[data-dispatcher-filter="date_from"]')?.value || '');
    const dateTill = normalizeText(root.querySelector('[data-dispatcher-filter="date_till"]')?.value || '');
    if (!parseDispatcherIsoDate(dateFrom) || !parseDispatcherIsoDate(dateTill)) return;
    closeDispatcherCalendar();
    void fetchDispatcherReportCardInBackground(true, buildDispatcherPeriodUrl(dateFrom, dateTill));
  }

  function updateDispatcherDateControl(input) {
    if (!(input instanceof HTMLInputElement)) return;
    const control = input.closest('.dr-date-control');
    const text = control?.querySelector('.dr-date-text');
    const display = dispatcherDateDisplay(input.value);
    if (text) text.textContent = display || 'дд.мм.гггг';
    control?.classList.toggle('has-value', Boolean(display));
  }

  function updateDispatcherPeriodSearchButton(root) {
    if (!(root instanceof HTMLElement)) return;
    const inputs = Array.from(root.querySelectorAll('input[data-dispatcher-filter]'))
      .filter((input) => input instanceof HTMLInputElement);
    const button = root.querySelector('[data-action="dispatcher-filter-search"]');
    if (!(button instanceof HTMLButtonElement)) return;
    const changed = inputs.some((input) => input.value !== String(input.dataset.originalValue || ''));
    const valid = inputs.length === 2 && inputs.every((input) => Boolean(parseDispatcherIsoDate(input.value)));
    button.classList.toggle('show', changed);
    button.disabled = !valid;
  }

  function markDispatcherPeriodPending(input) {
    if (!(input instanceof HTMLInputElement)) return;
    updateDispatcherDateControl(input);
    updateDispatcherPeriodSearchButton(input.closest('.dr-period-controls'));
  }

  function animateDispatcherCalendarOpen(node) {
    if (!(node instanceof HTMLElement)) return;
    node.animate(
      [
        { opacity: 0, transform: 'translateY(-6px) scale(.97)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
      ],
      { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
    );
  }

  function closeDispatcherCalendar(immediate = false) {
    const node = dispatcherCalendarState.node;
    dispatcherCalendarState.node = null;
    dispatcherCalendarState.input = null;
    dispatcherCalendarState.anchor = null;
    if (dispatcherCalendarState.outsideHandler) {
      document.removeEventListener('pointerdown', dispatcherCalendarState.outsideHandler, true);
      dispatcherCalendarState.outsideHandler = null;
    }
    if (!(node instanceof HTMLElement)) return;
    if (immediate) {
      node.remove();
      return;
    }
    node.style.pointerEvents = 'none';
    const animation = node.animate(
      [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(-6px) scale(.97)' }
      ],
      { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );
    const remove = () => node.remove();
    animation.onfinish = remove;
    animation.oncancel = remove;
    setTimeout(remove, 220);
  }

  function positionDispatcherCalendar() {
    const node = dispatcherCalendarState.node;
    const anchor = dispatcherCalendarState.anchor;
    if (!(node instanceof HTMLElement) || !(anchor instanceof HTMLElement)) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(250, Math.round(rect.width));
    const margin = 8;
    let left = rect.left + (rect.width - width) / 2;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    left = Math.max(margin, left);
    const nodeHeight = Math.max(320, node.offsetHeight || 0);
    let top = rect.bottom + 6;
    if (top + nodeHeight > window.innerHeight - margin && rect.top > nodeHeight + margin) {
      top = rect.top - nodeHeight - 6;
      node.classList.add('open-up');
    } else {
      node.classList.remove('open-up');
    }
    node.style.transformOrigin = node.classList.contains('open-up') ? 'bottom center' : 'top center';
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(Math.max(margin, top))}px`;
    node.style.width = `${width}px`;
  }

  function renderDispatcherCalendar() {
    const node = dispatcherCalendarState.node;
    const input = dispatcherCalendarState.input;
    if (!(node instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const monthShortNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    const selected = parseDispatcherIsoDate(input.value);
    const today = new Date();
    const year = dispatcherCalendarState.year;
    const month = dispatcherCalendarState.month;
    const view = dispatcherCalendarState.view || 'days';
    const title = node.querySelector('.dr-calendar-title');
    const week = node.querySelector('.dr-calendar-week');
    const grid = node.querySelector('.dr-calendar-grid');
    if (!(grid instanceof HTMLElement)) return;
    node.dataset.calendarView = view;
    if (week instanceof HTMLElement) week.hidden = view !== 'days';
    grid.className = `dr-calendar-grid ${view === 'days' ? 'is-days' : 'is-picker'}`;
    grid.innerHTML = '';

    if (view === 'months') {
      if (title) title.textContent = String(year);
      monthShortNames.forEach((name, monthIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dr-calendar-pick';
        button.textContent = name;
        if (year === today.getFullYear() && monthIndex === today.getMonth()) button.classList.add('today');
        if (selected && selected.year === year && selected.month === monthIndex) button.classList.add('selected');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          dispatcherCalendarState.month = monthIndex;
          dispatcherCalendarState.view = 'days';
          renderDispatcherCalendar();
        });
        grid.appendChild(button);
      });
      positionDispatcherCalendar();
      return;
    }

    if (view === 'years') {
      const pageStart = Number.isFinite(dispatcherCalendarState.yearPageStart)
        ? dispatcherCalendarState.yearPageStart
        : Math.floor(year / 10) * 10;
      dispatcherCalendarState.yearPageStart = pageStart;
      if (title) title.textContent = `${pageStart}–${pageStart + 9}`;
      for (let shownYear = pageStart - 1; shownYear <= pageStart + 10; shownYear += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dr-calendar-pick';
        button.textContent = String(shownYear);
        if (shownYear < pageStart || shownYear > pageStart + 9) button.classList.add('muted');
        if (shownYear === today.getFullYear()) button.classList.add('today');
        if (selected && selected.year === shownYear) button.classList.add('selected');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          dispatcherCalendarState.year = shownYear;
          dispatcherCalendarState.view = 'months';
          renderDispatcherCalendar();
        });
        grid.appendChild(button);
      }
      positionDispatcherCalendar();
      return;
    }

    if (title) title.textContent = `${monthNames[month]} ${year}`;
    const appendDay = (day, targetYear, targetMonth, muted = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `dr-calendar-day${muted ? ' muted' : ''}`;
      button.textContent = String(day);
      if (targetYear === today.getFullYear() && targetMonth === today.getMonth() && day === today.getDate()) {
        button.classList.add('today');
      }
      if (selected && selected.year === targetYear && selected.month === targetMonth && selected.day === day) {
        button.classList.add('selected');
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        input.value = dispatcherIsoDate(targetYear, targetMonth, day);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        markDispatcherPeriodPending(input);
        closeDispatcherCalendar();
      });
      grid.appendChild(button);
    };

    const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysCurrent = new Date(year, month + 1, 0).getDate();
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 11 : month - 1;
    const daysPrev = new Date(prevYear, prevMonth + 1, 0).getDate();
    for (let index = 0; index < firstDay; index += 1) {
      appendDay(daysPrev - firstDay + index + 1, prevYear, prevMonth, true);
    }
    for (let day = 1; day <= daysCurrent; day += 1) appendDay(day, year, month);
    const used = firstDay + daysCurrent;
    const nextDays = (7 - (used % 7)) % 7;
    const nextYear = month === 11 ? year + 1 : year;
    const nextMonth = month === 11 ? 0 : month + 1;
    for (let day = 1; day <= nextDays; day += 1) appendDay(day, nextYear, nextMonth, true);
    positionDispatcherCalendar();
  }

  function openDispatcherCalendar(anchor) {
    if (!(anchor instanceof HTMLElement)) return;
    const input = anchor.querySelector('input[data-dispatcher-filter]');
    if (!(input instanceof HTMLInputElement)) return;
    if (dispatcherCalendarState.node && dispatcherCalendarState.anchor === anchor) {
      closeDispatcherCalendar();
      return;
    }
    closeDispatcherCalendar(true);
    const selected = parseDispatcherIsoDate(input.value);
    const now = new Date();
    dispatcherCalendarState.input = input;
    dispatcherCalendarState.anchor = anchor;
    dispatcherCalendarState.year = selected?.year ?? now.getFullYear();
    dispatcherCalendarState.month = selected?.month ?? now.getMonth();
    dispatcherCalendarState.view = 'days';
    dispatcherCalendarState.yearPageStart = Math.floor(dispatcherCalendarState.year / 10) * 10;

    const node = document.createElement('div');
    node.id = 'tm-dispatcher-calendar';
    node.className = 'dr-calendar';
    node.classList.toggle('theme-dark', document.getElementById(HOST_ID)?.classList.contains('theme-dark'));
    node.innerHTML = `
      <div class="dr-calendar-head">
        <button type="button" class="dr-calendar-title" aria-label="Выбрать месяц или год"></button>
        <div class="dr-calendar-nav"><button type="button" data-step="-1" aria-label="Предыдущий месяц">‹</button><button type="button" data-step="1" aria-label="Следующий месяц">›</button></div>
      </div>
      <div class="dr-calendar-week">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => `<span>${day}</span>`).join('')}</div>
      <div class="dr-calendar-grid"></div>
      <div class="dr-calendar-foot"><button type="button" data-calendar-action="clear">Удалить</button><button type="button" data-calendar-action="today">Сегодня</button></div>`;
    document.body.appendChild(node);
    dispatcherCalendarState.node = node;

    node.querySelector('.dr-calendar-title')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (dispatcherCalendarState.view === 'days') {
        dispatcherCalendarState.view = 'months';
      } else if (dispatcherCalendarState.view === 'months') {
        dispatcherCalendarState.view = 'years';
        dispatcherCalendarState.yearPageStart = Math.floor(dispatcherCalendarState.year / 10) * 10;
      }
      renderDispatcherCalendar();
    });
    node.querySelectorAll('[data-step]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const step = Number(button.getAttribute('data-step') || 0);
        if (dispatcherCalendarState.view === 'years') {
          dispatcherCalendarState.yearPageStart += step * 10;
          renderDispatcherCalendar();
          return;
        }
        if (dispatcherCalendarState.view === 'months') {
          dispatcherCalendarState.year += step;
          renderDispatcherCalendar();
          return;
        }
        dispatcherCalendarState.month += step;
        if (dispatcherCalendarState.month < 0) {
          dispatcherCalendarState.month = 11;
          dispatcherCalendarState.year -= 1;
        } else if (dispatcherCalendarState.month > 11) {
          dispatcherCalendarState.month = 0;
          dispatcherCalendarState.year += 1;
        }
        renderDispatcherCalendar();
      });
    });
    node.querySelector('[data-calendar-action="clear"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      markDispatcherPeriodPending(input);
      closeDispatcherCalendar();
    });
    node.querySelector('[data-calendar-action="today"]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const today = new Date();
      input.value = dispatcherIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      markDispatcherPeriodPending(input);
      closeDispatcherCalendar();
    });

    renderDispatcherCalendar();
    animateDispatcherCalendarOpen(node);
    setTimeout(() => {
      const outsideHandler = (event) => {
        if (node.contains(event.target) || anchor.contains(event.target)) return;
        closeDispatcherCalendar();
      };
      dispatcherCalendarState.outsideHandler = outsideHandler;
      document.addEventListener('pointerdown', outsideHandler, true);
    }, 0);
  }

  function bindDispatcherCalendarControls(root) {
    if (!(root instanceof Element)) return;
    root.querySelectorAll('[data-action="dispatcher-date-open"]').forEach((control) => {
      if (!(control instanceof HTMLElement) || control.dataset.calendarBound === '1') return;
      control.dataset.calendarBound = '1';
      control.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDispatcherCalendar(control);
      });
    });
  }

  function getDispatcherReportFilters() {
    const shift = getDispatcherShiftPeriod();
    try {
      const url = new URL(state.remote.dispatcherReportUrl || findDispatcherReportUrl(), location.origin);
      return {
        dateFrom: dispatcherReportDateToInput(url.searchParams.get('ReportRequestSearch[date_from]') || '') || shift.dateFrom,
        dateTill: dispatcherReportDateToInput(url.searchParams.get('ReportRequestSearch[date_till]') || '') || shift.dateTill
      };
    } catch (_error) {
      return shift;
    }
  }

  function buildDispatcherFiltersHtml() {
    const filters = getDispatcherReportFilters();
    const shift = getDispatcherShiftPeriod();
    const hasActive = filters.dateFrom !== shift.dateFrom || filters.dateTill !== shift.dateTill;
    return `
      <div class="dr-period-controls">
        <button type="button" class="dr-period-search" data-action="dispatcher-filter-search" aria-label="Поиск" title="Поиск"><i class="ti ti-search" aria-hidden="true"></i></button>
        <div class="dr-filter-field"><span>Дата от</span><span class="dr-date-control has-value" data-action="dispatcher-date-open"><i class="ti ti-calendar" aria-hidden="true"></i><span class="dr-date-text">${escapeHtml(dispatcherDateDisplay(filters.dateFrom))}</span><input type="hidden" data-dispatcher-filter="date_from" data-original-value="${escapeHtml(filters.dateFrom)}" value="${escapeHtml(filters.dateFrom)}"></span></div>
        <div class="dr-filter-field"><span>Дата до</span><span class="dr-date-control has-value" data-action="dispatcher-date-open"><i class="ti ti-calendar" aria-hidden="true"></i><span class="dr-date-text">${escapeHtml(dispatcherDateDisplay(filters.dateTill))}</span><input type="hidden" data-dispatcher-filter="date_till" data-original-value="${escapeHtml(filters.dateTill)}" value="${escapeHtml(filters.dateTill)}"></span></div>
        <button type="button" class="dr-period-btn" data-action="dispatcher-filter-month">Месяц</button>
        <button type="button" class="dr-period-btn" data-action="dispatcher-filter-yesterday">Вчера</button>
        ${hasActive ? '<button type="button" class="dr-filter-reset" data-action="dispatcher-filter-reset">Сбросить</button>' : ''}
      </div>`;
  }

  function buildDispatcherFilteredUrl(filterWrap) {
    const read = (key) => normalizeText(filterWrap?.querySelector(`[data-dispatcher-filter="${key}"]`)?.value || '');
    return buildDispatcherPeriodUrl(read('date_from'), read('date_till'));
  }

  function buildDispatcherModernReportHtml(data) {
    const visibleCount = getVisibleDispatcherRows(data).length;
    const isMonthly = isDispatcherMonthlyReport();
    const sortMode = getDispatcherReportSortMode();
    return `
      <div class="dispatcher-modern">
        <div class="dr-toolbar">
          <label class="dr-search"><i class="ti ti-search" aria-hidden="true"></i><input class="dispatcher-report-search" value="${escapeHtml(dispatcherReportViewState.query)}" placeholder="Найти диспетчера..."></label>
          ${isMonthly ? `
            <div class="dr-sort">
              <button type="button" data-dispatcher-sort="net" class="${sortMode === 'net' ? 'active' : ''}">По чистым</button>
              <button type="button" data-dispatcher-sort="pct" class="${sortMode === 'pct' ? 'active' : ''}">По % отмен</button>
            </div>` : ''}
          ${buildDispatcherFiltersHtml()}
        </div>
        <div class="dr-count">Показано <b>${visibleCount}</b> из <b>${data.dispatchers.length}</b> диспетчеров</div>
        <div class="dr-board">
          <div class="dr-board-head"><span>#</span><span>Диспетчер</span><span>Показатели</span></div>
          <div class="dr-board-body">${buildDispatcherRowsHtml(data)}</div>
        </div>
        <div class="dr-kpi-grid">${buildDispatcherKpisHtml(data)}</div>
        <div class="dr-footnote">Цель для получения оклада: 35 принятых заявок</div>
      </div>`;
  }

  function refreshDispatcherReportView(cardsArea) {
    if (!(cardsArea instanceof HTMLElement) || !dispatcherReportViewState.data) return;
    const wrap = cardsArea.querySelector('.dispatcher-modern');
    if (!(wrap instanceof HTMLElement)) return;
    const rows = getVisibleDispatcherRows(dispatcherReportViewState.data);
    const body = wrap.querySelector('.dr-board-body');
    const count = wrap.querySelector('.dr-count');
    if (body) body.innerHTML = buildDispatcherRowsHtml(dispatcherReportViewState.data);
    if (count) count.innerHTML = `Показано <b>${rows.length}</b> из <b>${dispatcherReportViewState.data.dispatchers.length}</b> диспетчеров`;
    wrap.querySelectorAll('[data-dispatcher-sort]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-dispatcher-sort') === dispatcherReportViewState.sort);
    });
    requestAnimationFrame(() => {
      wrap.querySelectorAll('.dr-progress-fill').forEach((bar) => bar.classList.add('ready'));
    });
  }

  function renderDispatcherReportCard(cardsArea, afterApply = null, options = {}) {
    if (!(cardsArea instanceof HTMLElement)) return;
    const contentOptions = () => {
      const base = { animate: true, ...options };
      if (afterApply) base.afterApply = afterApply;
      return base;
    };
    if (state.remote.dispatcherReportLoading) {
      setCardsAreaContent(
        cardsArea,
        buildCardsLoadingHtml(),
        'remote:dispatcher-report:loading',
        contentOptions()
      );
      return;
    }
    if (!state.remote.dispatcherReportHtml) {
      const reason = normalizeText(state.remote.dispatcherReportError || '');
      setCardsAreaContent(
        cardsArea,
        buildCardsStatusHtml(`Не удалось загрузить статистику по диспетчерам${reason ? ` (${reason})` : ''}`),
        `remote:dispatcher-report:error:${reason || 'unknown'}`,
        contentOptions()
      );
      return;
    }
    const sig = String(state.remote.dispatcherReportSig || '');
    const reportData = parseDispatcherReportData(state.remote.dispatcherReportHtml);
    dispatcherReportViewState.data = reportData;
    const nextKey = `remote:dispatcher-report:content:${sig}`;
    if (String(cardsArea.getAttribute('data-content-key') || '') === nextKey) {
      bindDispatcherCalendarControls(cardsArea);
      return;
    }
    setCardsAreaContent(
      cardsArea,
      `<div class="dispatcher-report-wrap" data-sig="${escapeHtml(sig)}">${reportData ? buildDispatcherModernReportHtml(reportData) : state.remote.dispatcherReportHtml}</div>`,
      nextKey,
      {
        ...contentOptions(),
        afterApply: () => {
          if (typeof afterApply === 'function') afterApply();
          bindDispatcherCalendarControls(cardsArea);
          requestAnimationFrame(() => {
            cardsArea.querySelectorAll('.dr-progress-fill').forEach((bar) => bar.classList.add('ready'));
          });
        }
      }
    );
  }

  function readCustomerDirectoryCell(cells, index) {
    if (!Array.isArray(cells) || index < 0 || index >= cells.length) return '';
    return normalizeText(cells[index]?.textContent || '');
  }

  function extractCustomerDirectoryPhones(cell) {
    if (!(cell instanceof HTMLElement)) return [];
    const values = Array.from(cell.querySelectorAll('span'))
      .map((node) => normalizeText(node.textContent || ''))
      .filter(Boolean);
    if (!values.length) {
      const text = normalizeText(cell.textContent || '');
      const matches = text.match(/(?:\+?\s*[78])?[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*(?:\d{2}[\s.-]*\d{2}|\d{4})/g);
      if (matches?.length) values.push(...matches);
      else if (text) values.push(text);
    }
    const seen = new Set();
    return values.filter((value) => {
      const national = getCustomerDirectoryNationalDigits(value);
      if (national.length !== 10 || seen.has(national)) return false;
      seen.add(national);
      return true;
    });
  }

  function parseCustomerDirectoryData(html) {
    const source = String(html || '');
    if (!source) return null;
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const normalizeHead = (value) => normalizeText(value || '').toLowerCase().replace(/ё/g, 'е');
    const tables = Array.from(doc.querySelectorAll('table'));
    let table = null;
    let bestScore = -1;
    tables.forEach((candidate) => {
      const headerText = normalizeHead(Array.from(candidate.querySelectorAll('thead th, thead td, tr:first-child th')).map((cell) => cell.textContent).join(' '));
      const score = (headerText.includes('id') ? 5 : 0)
        + (headerText.includes('имя') || headerText.includes('клиент') ? 4 : 0)
        + (headerText.includes('телефон') ? 4 : 0)
        + (headerText.includes('город') ? 2 : 0)
        + (headerText.includes('адрес') ? 2 : 0)
        + Math.min(6, candidate.querySelectorAll('tbody tr, tr').length);
      if (score > bestScore) {
        bestScore = score;
        table = candidate;
      }
    });

    const headerCells = table
      ? Array.from(table.querySelectorAll('thead th, thead td, tr:first-child th'))
      : [];
    const headers = headerCells.map((cell) => normalizeHead(cell.textContent));
    const findCol = (variants) => headers.findIndex((header) => variants.some((variant) => header.includes(variant)));
    const col = {
      id: findCol(['id']),
      name: findCol(['имя клиента', 'клиент', 'фио', 'имя']),
      city: findCol(['город']),
      address: findCol(['адрес']),
      phone: findCol(['телефон']),
      created: findCol(['создан']),
      author: findCol(['автор'])
    };
    if (col.id < 0) col.id = 0;
    if (col.name < 0) col.name = 1;
    if (col.city < 0) col.city = 2;
    if (col.address < 0) col.address = 3;
    if (col.phone < 0) col.phone = 4;
    if (col.created < 0) col.created = 5;
    if (col.author < 0) col.author = 6;
    const requestedPhone = getCustomerDirectoryNationalDigits(getCustomerDirectoryPhoneFromUrl());

    const rawRows = table
      ? Array.from((table.querySelector('tbody') || table).querySelectorAll('tr'))
      : [];
    const rows = rawRows.map((row) => {
      if (!(row instanceof HTMLTableRowElement)) return null;
      if (row.querySelector('th')) return null;
      if (row.classList.contains('filters')) return null;
      const cells = Array.from(row.querySelectorAll('td'));
      if (!cells.length) return null;
      if (row.querySelector('input, select, textarea')) return null;
      const controlCount = row.querySelectorAll('input, select, textarea').length;
      if (controlCount >= Math.max(2, cells.length - 1)) return null;

      const idCell = cells[col.id] || cells[0] || null;
      const idLink = idCell?.querySelector('a[href]')
        || row.querySelector('a[href*="/customer/update"], a[href*="/customer/view"], a[href*="/customer/index"]')
        || row.querySelector('a[href]');
      const idText = normalizeText(idCell?.textContent || idLink?.textContent || '');
      let id = normalizeRequestId((idText.match(/\d{3,}/) || [])[0] || '');
      const href = normalizeText(idLink?.getAttribute('href') || '');
      if (!id && href) {
        try {
          const parsedHref = new URL(href, state.remote.customerDirectoryUrl || findCustomerDirectoryUrl());
          id = normalizeRequestId(parsedHref.searchParams.get('id') || '');
        } catch (_error) {
          id = normalizeRequestId((href.match(/[?&]id=(\d{3,})/i) || [])[1] || '');
        }
      }
      if (!id) return null;

      const name = readCustomerDirectoryCell(cells, col.name) || 'Без имени';
      const city = readCustomerDirectoryCell(cells, col.city);
      const address = readCustomerDirectoryCell(cells, col.address);
      const phoneCell = cells[col.phone] || null;
      const phones = extractCustomerDirectoryPhones(phoneCell);
      const phone = phones.length ? phones.join(', ') : readCustomerDirectoryCell(cells, col.phone);
      const created = readCustomerDirectoryCell(cells, col.created);
      const author = readCustomerDirectoryCell(cells, col.author);
      const rowPhones = phones.length
        ? phones.map((value) => getCustomerDirectoryNationalDigits(value))
        : [getCustomerDirectoryNationalDigits(phone)].filter(Boolean);
      if (requestedPhone && !rowPhones.some((value) => value.includes(requestedPhone))) return null;

      let url = '';
      if (href && !href.startsWith('#') && !href.toLowerCase().startsWith('javascript:')) {
        try {
          url = new URL(href, state.remote.customerDirectoryUrl || findCustomerDirectoryUrl()).toString();
        } catch (_error) {
          url = href;
        }
      }

      return {
        id,
        url,
        name,
        city: city || 'Не указан',
        address,
        phone,
        phones,
        created,
        author,
        av: getInitials(author || name)
      };
    }).filter(Boolean);

    const bodyText = normalizeText(doc.body?.textContent || source);
    const rangeMatch = bodyText.match(/Показан[а-яё\s]*запис[а-яё\s]*(\d[\d\s]*)\s*-\s*(\d[\d\s]*)\s*из\s*(\d[\d\s]*)/i);
    const totalMatch = rangeMatch || bodyText.match(/из\s*(\d[\d\s]*)\s*(?:запис|клиент)/i);
    const total = rangeMatch ? parseIntSafe(rangeMatch[3]) : parseIntSafe(totalMatch?.[1] || '');
    const rangeStart = rangeMatch ? parseIntSafe(rangeMatch[1]) : 0;
    const rangeEnd = rangeMatch ? parseIntSafe(rangeMatch[2]) : 0;
    const pageSize = rangeStart && rangeEnd && rangeEnd >= rangeStart
      ? (rangeEnd - rangeStart + 1)
      : (rows.length || 20);
    const rangeText = rangeMatch
      ? `Показаны ${normalizeText(rangeMatch[1])}-${normalizeText(rangeMatch[2])} из ${normalizeText(rangeMatch[3])}`
      : '';
    const pagination = Array.from(doc.querySelectorAll('.pagination a[href], ul.pagination a[href]')).map((link) => {
      const text = normalizeText(link.textContent || link.getAttribute('aria-label') || '');
      const href = normalizeText(link.getAttribute('href') || '');
      if (!href) return null;
      let url = '';
      try {
        url = new URL(href, state.remote.customerDirectoryUrl || findCustomerDirectoryUrl()).toString();
      } catch (_error) {
        url = href;
      }
      return {
        text: text || '...',
        url,
        disabled: link.closest('.disabled') !== null,
        active: link.closest('.active') !== null
      };
    }).filter(Boolean);

    return {
      rows,
      total: total || rows.length,
      rangeStart,
      rangeEnd,
      pageSize,
      rangeText,
      pagination
    };
  }

  function buildCustomerDirectoryCardHtml(item, queryDigits) {
    const nationalQuery = getCustomerDirectoryNationalDigits(queryDigits);
    const itemPhones = Array.isArray(item.phones) && item.phones.length
      ? item.phones
      : [item.phone].filter(Boolean);
    const selectedPhone = itemPhones.find((value) => {
      const national = getCustomerDirectoryNationalDigits(value);
      return nationalQuery && national.includes(nationalQuery);
    }) || itemPhones[0] || '';
    const phoneDisplay = formatCustomerDirectoryPhoneDisplay(selectedPhone);
    const matchClass = nationalQuery && itemPhones.some((value) => {
      return getCustomerDirectoryNationalDigits(value).includes(nationalQuery);
    }) ? ' is-match' : '';
    const clickableClass = item.url ? ' is-clickable' : '';
    const cardUrlAttr = item.url ? ` data-customer-url="${escapeHtml(item.url)}"` : '';
    const idHtml = `<span class="cd-id">${escapeHtml(item.id || '—')}</span>`;
    const nameHtml = `<span class="cd-name">${escapeHtml(item.name || 'Без имени')}</span>`;
    const phoneHtml = phoneDisplay
      ? `<span class="cd-phone"><i class="ti ti-phone" aria-hidden="true"></i><span>${escapeHtml(phoneDisplay)}</span></span>`
      : `<span class="cd-phone is-empty"><i class="ti ti-phone-off" aria-hidden="true"></i><span>Телефон не указан</span></span>`;
    const createdText = item.created || '—';
    const authorText = item.author || '—';
    return `
      <article class="cd-client-card${matchClass}${clickableClass}" data-customer-id="${escapeHtml(item.id || '')}"${cardUrlAttr}>
        <div class="cd-card-head">
          <div class="cd-card-title">
            ${nameHtml}
            <span class="cd-city">${escapeHtml(item.city || 'Не указан')}</span>
          </div>
          ${idHtml}
        </div>
        ${phoneHtml}
        <div class="cd-location">
          <i class="ti ti-map-pin" aria-hidden="true"></i>
          <span><b>${escapeHtml(item.city || 'Не указан')}</b>${item.address ? ` · ${escapeHtml(item.address)}` : ' · адрес не указан'}</span>
        </div>
        <div class="cd-foot">
          <span class="cd-author"><span class="cd-av">${escapeHtml(item.av || '--')}</span>${escapeHtml(authorText)}</span>
          <span class="cd-created"><i class="ti ti-calendar" aria-hidden="true"></i>${escapeHtml(createdText)}</span>
        </div>
      </article>
    `;
  }

  function buildCustomerDirectoryModernHtml(data) {
    const safeData = data || { rows: [], total: 0, rangeText: '', rangeStart: 0, rangeEnd: 0, pageSize: 20, pagination: [] };
    const queryDigits = getCustomerDirectoryPhoneFromUrl();
    const inputValue = queryDigits ? formatCustomerDirectoryPhoneInput(queryDigits) : '+7';
    const hasQuery = Boolean(getCustomerDirectoryNationalDigits(queryDigits));
    const queryPhoneDisplay = formatCustomerDirectoryPhoneDisplay(queryDigits);
    const cardsHtml = safeData.rows.length
      ? safeData.rows.map((item) => buildCustomerDirectoryCardHtml(item, queryDigits)).join('')
      : (hasQuery ? `
        <div class="cd-empty cd-empty-phone">
          <div class="cd-empty-title">Карточки с номером ${escapeHtml(queryPhoneDisplay)} нету в базе</div>
        </div>
      ` : `
        <div class="cd-empty">
          <i class="ti ti-users-off" aria-hidden="true"></i>
          <div class="cd-empty-title">Карточек клиентов не найдено</div>
          <div>CRM не вернула строки клиентов для этой страницы.</div>
        </div>
      `);
    const pageSize = Math.max(1, Number(safeData.pageSize || safeData.rows.length || 20));
    const totalPages = Math.max(1, Math.ceil(Number(safeData.total || safeData.rows.length || 0) / pageSize));
    const currentPage = Math.max(1, Math.min(getCustomerDirectoryPageFromUrl(), totalPages));
    const pageControlsHtml = safeData.rows.length
      ? `
        <div class="cd-page-box">
          <div class="cd-page-row">
            <input class="cd-page-input" type="text" inputmode="numeric" autocomplete="off" placeholder="Страница" value="">
            <button class="cd-page-go" type="button" data-action="customer-directory-page-go">Перейти</button>
          </div>
          <div class="cd-page-hint">Страница ${escapeHtml(String(currentPage))} из ${escapeHtml(String(totalPages))}</div>
        </div>
      `
      : '';

    return `
      <div class="customer-directory-modern">
        <form class="cd-search-panel customer-directory-search-form" method="get" action="${escapeHtml(findCustomerDirectoryUrl())}">
          <label class="cd-phone-field">
            <span>Номер телефона</span>
            <div class="cd-phone-input-wrap">
              <i class="ti ti-phone" aria-hidden="true"></i>
              <input class="customer-directory-phone-input" name="CustomerSearch[phone]" value="${escapeHtml(inputValue)}" placeholder="+7 999-999-99-99" inputmode="tel" autocomplete="off">
            </div>
          </label>
          <div class="cd-search-actions">
            <button class="cd-btn cd-btn-primary" type="submit"><i class="ti ti-search" aria-hidden="true"></i>Поиск</button>
            <button class="cd-btn cd-btn-ghost" type="button" data-action="customer-directory-reset"${hasQuery ? '' : ' disabled'}><i class="ti ti-x" aria-hidden="true"></i>Сброс</button>
          </div>
          ${pageControlsHtml}
        </form>
        <div class="cd-grid${safeData.rows.length ? '' : ' is-empty'}">${cardsHtml}</div>
      </div>
    `;
  }

  function renderCustomerDirectoryCard(cardsArea, afterApply = null, options = {}) {
    if (!(cardsArea instanceof HTMLElement)) return;
    const contentOptions = () => {
      const base = { animate: true, ...options };
      if (afterApply) base.afterApply = afterApply;
      return base;
    };
    if (state.remote.customerDirectoryLoading) {
      setCardsAreaContent(
        cardsArea,
        buildCardsLoadingHtml(),
        'remote:customer-directory:loading',
        contentOptions()
      );
      return;
    }
    if (!state.remote.customerDirectoryHtml) {
      const reason = normalizeText(state.remote.customerDirectoryError || '');
      setCardsAreaContent(
        cardsArea,
        buildCardsStatusHtml(`Не удалось загрузить поиск карточки клиента${reason ? ` (${reason})` : ''}`),
        `remote:customer-directory:error:${reason || 'unknown'}`,
        contentOptions()
      );
      return;
    }
    const sig = String(state.remote.customerDirectorySig || '');
    const nextKey = `remote:customer-directory:content:${sig}`;
    if (String(cardsArea.getAttribute('data-content-key') || '') === nextKey) {
      return;
    }
    const directoryData = parseCustomerDirectoryData(state.remote.customerDirectoryHtml);
    setCardsAreaContent(
      cardsArea,
      `<div class="customer-directory-wrap" data-sig="${escapeHtml(sig)}">${buildCustomerDirectoryModernHtml(directoryData)}</div>`,
      nextKey,
      {
        ...contentOptions(),
        afterApply: () => {
          if (typeof afterApply === 'function') afterApply();
          requestAnimationFrame(() => {
            animateCardsFromDepth(cardsArea.querySelectorAll('.cd-client-card'), {
              enterMs: 520,
              baseDelay: 0,
              staggerStep: 12,
              maxStagger: 96
            });
          });
        }
      }
    );
  }

  function renderBulkPhoneGroupsHtml(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const groups = [];
    let current = null;
    list.forEach((row) => {
      if (row?.isBulkHeader) {
        if (current) groups.push(current);
        current = { header: row, rows: [] };
        return;
      }
      if (!current) {
        current = {
          header: {
            isBulkHeader: true,
            bulkPhone: row?.bulkPhone || '',
            bulkIndex: Number(row?.bulkIndex || 1),
            bulkCount: 0,
            bulkError: ''
          },
          rows: []
        };
      }
      current.rows.push(row);
    });
    if (current) groups.push(current);

    const groupItems = groups.map((group) => {
      const header = group.header || {};
      const rowList = Array.isArray(group.rows) ? group.rows : [];
      const phoneText = escapeHtml(formatPhoneRu(header.bulkPhone || '—'));
      const idx = Math.max(1, Number(header.bulkIndex || 1));
      const count = Math.max(0, Number(rowList.length || header.bulkCount || 0));
      const err = normalizeText(header.bulkError || '');
      const canCreate = !err && count === 0 && Boolean(normalizeBulkPhone(header.bulkPhone || ''));
      const canAddForExisting = !err && count > 0;
      const subtitle = err
        ? `Ошибка: ${escapeHtml(err)}`
        : (count > 0 ? `Найдено заявок: ${count}` : 'Ничего не найдено');
      const cardsHtml = rowList.map((row) => buildCard(row)).join('');
      const normalizedCallPhone = normalizeBulkPhone(header.bulkPhone || '');
      const callHref = escapeHtml(normalizedCallPhone || header.bulkPhone || '');
      const callMarked = normalizedCallPhone && bulkCalledPhones.has(normalizedCallPhone);
      const firstRowWithUrl = rowList.find((row) => normalizeText(row?.url || ''));
      const firstRequestUrl = normalizeText(firstRowWithUrl?.url || '');
      const firstRequestId = normalizeRequestId(firstRowWithUrl?.id || rowList.find((row) => normalizeRequestId(row?.id || ''))?.id || '');
      const groupKey = `${idx}:${normalizeBulkPhone(header.bulkPhone || '') || normalizeText(header.bulkPhone || '')}`;
      return `
        <div class="bulk-phone-group" data-bulk-group-key="${escapeHtml(groupKey)}">
          <div class="bulk-phone-sep">
            <div class="bulk-phone-sep-main">
              <div class="bulk-phone-sep-title">
                <span class="bulk-phone-title-main">
                  <span>Поиск номера ${idx}: ${phoneText}</span>
                  ${callHref ? `<span class="bulk-call-wrap"><a class="bulk-call-btn${callMarked ? ' is-called' : ''}" data-phone="${escapeHtml(normalizedCallPhone)}" href="callto:${callHref}${getBulkCallSipForPhone(normalizedCallPhone)}" title="Позвонить ${phoneText}"><svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8zM16 2h6v6l-2.3-2.3-4 4-1.4-1.4 4-4z"/></svg></a>${callMarked ? '<span class="bulk-call-check" title="Звонок отмечен">✓</span>' : ''}</span>` : ''}
                </span>
                <span class="bulk-phone-title-actions">
                  ${canAddForExisting ? `<button type="button" class="bulk-add-top-btn" data-action="bulk-add-request" data-request-url="${escapeHtml(firstRequestUrl)}" data-request-id="${escapeHtml(firstRequestId)}" data-phone="${escapeHtml(header.bulkPhone || '')}" title="Добавить заявку">Добавить заявку</button>` : ''}
                </span>
              </div>
              ${cardsHtml ? `<div class="bulk-phone-list">${cardsHtml}</div>` : ''}
              <div class="bulk-phone-sep-foot">
                <div class="bulk-phone-sep-sub">${subtitle}</div>
              </div>
            </div>
            ${canCreate ? `<button type="button" class="bulk-create-btn" data-action="bulk-create" data-phone="${escapeHtml(header.bulkPhone || '')}">Создать</button>` : ''}
          </div>
        </div>
      `;
    });
    const leftCount = Math.ceil(groupItems.length / 2);
    const leftHtml = groupItems.slice(0, leftCount).join('');
    const rightHtml = groupItems.slice(leftCount).join('');
    return `
      <div class="bulk-phone-groups-wrap">
        <div class="bulk-phone-groups-grid">
          <div class="bulk-phone-groups-col">${leftHtml}</div>
          <div class="bulk-phone-groups-col">${rightHtml}</div>
        </div>
      </div>
    `;
  }

  function getMainSplitEmptyKey(node) {
    if (!(node instanceof HTMLElement)) return '';
    const explicitKey = normalizeText(node.getAttribute('data-main-empty') || '');
    if (explicitKey) return explicitKey;
    const col = node.closest?.('[data-main-col]');
    return normalizeText(col?.getAttribute?.('data-main-col') || node.textContent || '');
  }

  function buildMainSplitColumnHtml(rows, emptyText, emptyKey = '') {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      const keyAttr = emptyKey ? ` data-main-empty="${escapeHtml(emptyKey)}"` : '';
      return `<div class="cards-status-note main-split-empty"${keyAttr}>${escapeHtml(emptyText || 'Пока пусто')}</div>`;
    }
    return list.map((row) => buildCard(row)).join('');
  }

  function buildMainSplitCardsHtml(rows, precomputedSplit = null) {
    const split = precomputedSplit && typeof precomputedSplit === 'object'
      ? precomputedSplit
      : splitMainRowsForColumns(rows);
    return `
      <div class="main-split" data-main-split="1">
        <div class="main-split-col" data-main-col="left">
          <div class="main-split-col-flow">
            ${buildMainSplitColumnHtml(split.left, 'Модераций и уточнений нет', 'left')}
          </div>
        </div>
        <div class="main-split-col" data-main-col="right">
          <div class="main-split-col-flow">
            ${buildMainSplitColumnHtml(split.right, 'Ожидающих и заявок в пути нет', 'right')}
          </div>
        </div>
      </div>
    `;
  }

  function buildModerationSplitColumnHtml(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list.map((entry) => buildCard(entry.row, { listIndex: entry.index })).join('');
  }

  function buildModerationSplitCardsHtml(rows) {
    const entries = (Array.isArray(rows) ? rows : []).map((row, index) => ({
      row,
      index: index + 1
    }));
    const leftCount = Math.ceil(entries.length / 2);
    const leftHtml = buildModerationSplitColumnHtml(entries.slice(0, leftCount));
    const rightHtml = buildModerationSplitColumnHtml(entries.slice(leftCount));
    return `
      <div class="moderation-split" data-moderation-split="1">
        <div class="moderation-split-col" data-moderation-col="left">
          <div class="moderation-split-col-flow">${leftHtml}</div>
        </div>
        <div class="moderation-split-col" data-moderation-col="right">
          <div class="moderation-split-col-flow">${rightHtml}</div>
        </div>
      </div>
    `;
  }

  function setClassNamePreservingCardMotion(el, nextClassName) {
    if (!(el instanceof HTMLElement)) return;
    const currentMotion = Array.from(el.classList || [])
      .filter((name) => TRANSIENT_CARD_ANIMATION_CLASSES.has(name));
    const nextClasses = String(nextClassName || '')
      .split(/\s+/)
      .filter((name) => name && !TRANSIENT_CARD_ANIMATION_CLASSES.has(name));
    currentMotion.forEach((name) => {
      if (!nextClasses.includes(name)) nextClasses.push(name);
    });
    const merged = nextClasses.join(' ');
    if (el.className !== merged) el.className = merged;
  }

  function patchTextClassAndTitle(currentRoot, nextRoot, selector) {
    const current = currentRoot?.querySelector?.(selector);
    const next = nextRoot?.querySelector?.(selector);
    if (!current && !next) return true;
    if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) return false;
    if (current.className !== next.className) current.className = next.className;
    if (current.textContent !== next.textContent) current.textContent = next.textContent;
    const nextTitle = next.getAttribute('title');
    if (nextTitle !== current.getAttribute('title')) {
      if (nextTitle === null) current.removeAttribute('title');
      else current.setAttribute('title', nextTitle);
    }
    return true;
  }

  function patchModerationCardInPlace(currentCard, nextCard) {
    if (!(currentCard instanceof HTMLElement) || !(nextCard instanceof HTMLElement)) return false;
    setClassNamePreservingCardMotion(currentCard, nextCard.className);
    ['data-url', 'data-action', 'data-anim-group'].forEach((name) => {
      const value = nextCard.getAttribute(name);
      if (value === null) currentCard.removeAttribute(name);
      else if (currentCard.getAttribute(name) !== value) currentCard.setAttribute(name, value);
    });

    const selectors = [
      '.card-accent',
      '.c-list-index',
      '.c-id',
      '.spill',
      '.work-pill',
      '.tag-fixed',
      '.c-city',
      '.c-av',
      '.c-author-name',
      '.c-meta',
      '.c-time-right',
      '.c-address',
      '.c-phone-right'
    ];
    const canPatchSmall = selectors.every((selector) => patchTextClassAndTitle(currentCard, nextCard, selector));
    if (!canPatchSmall) {
      currentCard.innerHTML = nextCard.innerHTML;
    }
    return true;
  }

  function patchModerationSplitContent(cardsArea, nextHtml) {
    if (!(cardsArea instanceof HTMLElement)) return false;
    if (String(cardsArea.getAttribute('data-content-key') || '') !== 'cards:list:moderation') return false;
    const currentSplit = cardsArea.querySelector('.moderation-split');
    if (!(currentSplit instanceof HTMLElement)) return false;

    const template = document.createElement('template');
    template.innerHTML = String(nextHtml || '').trim();
    const nextSplit = template.content.querySelector('.moderation-split');
    if (!(nextSplit instanceof HTMLElement)) return false;

    const collect = (root, side) => Array.from(root.querySelectorAll(`[data-moderation-col="${side}"] .moderation-split-col-flow > .card[data-id]`))
      .filter((node) => node instanceof HTMLElement);
    const currentLeft = collect(currentSplit, 'left');
    const currentRight = collect(currentSplit, 'right');
    const nextLeft = collect(nextSplit, 'left');
    const nextRight = collect(nextSplit, 'right');
    const sameColumn = (currentCards, nextCards) => currentCards.length === nextCards.length
      && currentCards.every((card, index) => String(card.getAttribute('data-id') || '') === String(nextCards[index]?.getAttribute('data-id') || ''));
    if (!sameColumn(currentLeft, nextLeft) || !sameColumn(currentRight, nextRight)) return false;

    currentLeft.forEach((card, index) => patchModerationCardInPlace(card, nextLeft[index]));
    currentRight.forEach((card, index) => patchModerationCardInPlace(card, nextRight[index]));
    return true;
  }

  function patchMainSplitContent(cardsArea, nextHtml) {
    if (!(cardsArea instanceof HTMLElement)) return false;
    const currentKey = String(cardsArea.getAttribute('data-content-key') || '');
    if (!currentKey.startsWith('cards:main-split:')) return false;
    const currentSplit = cardsArea.querySelector('.main-split');
    if (!(currentSplit instanceof HTMLElement)) return false;

    const template = document.createElement('template');
    template.innerHTML = String(nextHtml || '').trim();
    const nextSplit = template.content.querySelector('.main-split');
    if (!(nextSplit instanceof HTMLElement)) return false;

    const collect = (root, side) => Array.from(root.querySelectorAll(`[data-main-col="${side}"] .main-split-col-flow > .card[data-id], [data-main-col="${side}"] .main-split-col-flow > .main-split-empty`))
      .filter((node) => node instanceof HTMLElement);
    const currentLeft = collect(currentSplit, 'left');
    const currentRight = collect(currentSplit, 'right');
    const nextLeft = collect(nextSplit, 'left');
    const nextRight = collect(nextSplit, 'right');
    const sameColumn = (currentNodes, nextNodes) => currentNodes.length === nextNodes.length
      && currentNodes.every((node, index) => {
        const currentId = String(node.getAttribute('data-id') || node.getAttribute('data-main-empty') || '');
        const nextId = String(nextNodes[index]?.getAttribute('data-id') || nextNodes[index]?.getAttribute('data-main-empty') || '');
        return currentId === nextId;
      });
    if (!sameColumn(currentLeft, nextLeft) || !sameColumn(currentRight, nextRight)) return false;

    const patchColumn = (currentNodes, nextNodes) => {
      currentNodes.forEach((node, index) => {
        const nextNode = nextNodes[index];
        if (!(node instanceof HTMLElement) || !(nextNode instanceof HTMLElement)) return;
        if (node.classList.contains('main-split-empty') || nextNode.classList.contains('main-split-empty')) {
          if (node.className !== nextNode.className) node.className = nextNode.className;
          if (node.textContent !== nextNode.textContent) node.textContent = nextNode.textContent;
          const nextKey = nextNode.getAttribute('data-main-empty');
          if (nextKey === null) node.removeAttribute('data-main-empty');
          else if (node.getAttribute('data-main-empty') !== nextKey) node.setAttribute('data-main-empty', nextKey);
          return;
        }
        patchModerationCardInPlace(node, nextNode);
      });
    };

    patchColumn(currentLeft, nextLeft);
    patchColumn(currentRight, nextRight);
    return true;
  }

  // Призрак ухода для инкрементального патча (аналог локального createMainSplitLeaveGhost,
  // но как модульная функция — используется в reconcileMainSplit).
  function spawnMainSplitLeaveGhost(node, rect, leaveMs) {
    if (!(node instanceof HTMLElement)) return;
    if (!rect || rect.width < 2 || rect.height < 2) return;
    const ghost = node.cloneNode(true);
    if (!(ghost instanceof HTMLElement)) return;
    ghost.classList.remove('card-enter', 'card-enter-active', 'card-move');
    ghost.classList.add('card-ghost-leave', 'card-ghost-main-split');
    try { node.style.opacity = '0'; node.style.pointerEvents = 'none'; } catch (_hideNode) {}
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '2147483646';
    armCardGhostLifecycle(ghost, node, leaveMs);
    const hostRoot = document.getElementById(HOST_ID);
    const ghostLayer = hostRoot?.querySelector('.tm-anim-layer');
    if (ghostLayer instanceof HTMLElement) ghostLayer.appendChild(ghost);
    else if (node.parentElement) node.parentElement.appendChild(ghost);
    requestAnimationFrame(() => { ghost.classList.add('card-ghost-leave-active'); });
  }

  // Инкрементальное обновление обеих колонок main-split БЕЗ пересборки всего innerHTML:
  // существующие карточки переиспользуются (patch на месте), новые вставляются с enter-анимацией,
  // ушедшие — ghost, сдвинувшиеся — FLIP. Неизменная колонка вообще не трогается → не «дёргается».
  // Возвращает false (откат на полный ре-рендер) при неожиданной структуре/ошибке.
  // Вызывается только когда нет смены ранга-тира (transitioned) и без panel-swap.
  function reconcileMainSplit(cardsArea, nextSplit, timing) {
    try {
      const currentSplit = cardsArea.querySelector('.main-split');
      if (!(currentSplit instanceof HTMLElement) || !(nextSplit instanceof HTMLElement)) return false;
      const sides = ['left', 'right'];
      const flowOf = (root, side) => root.querySelector(`[data-main-col="${side}"] .main-split-col-flow`);
      for (const side of sides) {
        if (!(flowOf(currentSplit, side) instanceof HTMLElement) || !(flowOf(nextSplit, side) instanceof HTMLElement)) return false;
      }
      const isItem = (n) => n instanceof HTMLElement && (n.hasAttribute('data-id') || n.classList.contains('main-split-empty'));
      const keyOf = (n) => {
        if (!(n instanceof HTMLElement)) return '';
        const id = n.getAttribute('data-id');
        if (id) return `id:${id}`;
        if (n.classList.contains('main-split-empty')) return `empty:${n.getAttribute('data-main-empty') || ''}`;
        return '';
      };
      const itemsOf = (flow) => Array.from(flow.children).filter(isItem);

      const prevRectByKey = new Map();
      sides.forEach((side) => itemsOf(flowOf(currentSplit, side)).forEach((n) => {
        const k = keyOf(n); if (k) prevRectByKey.set(k, n.getBoundingClientRect());
      }));

      const reusedCards = [];
      const enterCards = [];
      const removedCards = [];

      sides.forEach((side) => {
        const curFlow = flowOf(currentSplit, side);
        const nextItems = itemsOf(flowOf(nextSplit, side));
        const curItems = itemsOf(curFlow);
        const curByKey = new Map();
        curItems.forEach((n) => { const k = keyOf(n); if (k && !curByKey.has(k)) curByKey.set(k, n); });
        const desiredKeys = new Set(nextItems.map(keyOf));

        const ordered = nextItems.map((nextNode) => {
          const k = keyOf(nextNode);
          const existing = curByKey.get(k);
          if (existing) {
            curByKey.delete(k);
            if (existing.hasAttribute('data-id')) {
              patchModerationCardInPlace(existing, nextNode);
              reusedCards.push(existing);
            } else {
              if (existing.className !== nextNode.className) existing.className = nextNode.className;
              if (existing.textContent !== nextNode.textContent) existing.textContent = nextNode.textContent;
              const ek = nextNode.getAttribute('data-main-empty');
              if (ek === null) existing.removeAttribute('data-main-empty');
              else if (existing.getAttribute('data-main-empty') !== ek) existing.setAttribute('data-main-empty', ek);
            }
            return existing;
          }
          const imported = nextNode.cloneNode(true);
          if (imported instanceof HTMLElement && imported.hasAttribute('data-id')) enterCards.push(imported);
          return imported;
        });

        ordered.forEach((node, i) => {
          const ref = curFlow.children[i] || null;
          if (ref !== node) curFlow.insertBefore(node, ref);
        });

        curByKey.forEach((node, k) => {
          if (desiredKeys.has(k)) return;
          if (node.hasAttribute('data-id')) removedCards.push({ node, rect: prevRectByKey.get(k) });
          else { try { node.remove(); } catch (_removeEmpty) {} }
        });
      });

      removedCards.forEach(({ node, rect }) => {
        spawnMainSplitLeaveGhost(node, rect, timing.leaveMs);
        try { node.remove(); } catch (_removeCard) {}
      });

      reusedCards.forEach((card) => {
        const prevRect = prevRectByKey.get(`id:${card.getAttribute('data-id')}`);
        if (!prevRect) return;
        const dy = prevRect.top - card.getBoundingClientRect().top;
        if (!Number.isFinite(dy) || Math.abs(dy) < 1) return;
        card.classList.add('card-move');
        card.style.transition = 'transform 0s';
        card.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          card.style.transition = '';
          card.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
          card.classList.remove('card-move');
          card.style.transform = '';
          card.style.transition = '';
        }, timing.moveMs);
      });

      enterCards.forEach((card, index) => {
        if (!(card instanceof HTMLElement)) return;
        card.classList.add('card-enter');
        void card.offsetWidth;
        const delay = Math.min(index * 8, 64);
        setTimeout(() => requestAnimationFrame(() => card.classList.add('card-enter-active')), delay);
        setTimeout(() => card.classList.remove('card-enter', 'card-enter-active'), delay + timing.enterMs);
      });

      return true;
    } catch (_error) {
      return false;
    }
  }

  function getRenderedCardStatusText(node) {
    if (!(node instanceof HTMLElement)) return '';
    return normalizeText(node.querySelector('.spill')?.textContent || '');
  }

  function isClarifyPriorityStatus(statusText) {
    return isClarifyAgreeStatus(statusText) || isClarifyQuestionStatus(statusText);
  }

  function isClarifyStatusText(statusText) {
    const s = normalizeText(statusText).toLowerCase();
    return s.includes('уточн');
  }

  function buildMainSplitRowsSignature(rows, precomputedSplit = null) {
    const split = precomputedSplit && typeof precomputedSplit === 'object'
      ? precomputedSplit
      : splitMainRowsForColumns(rows);
    const orderedRows = [
      ...((Array.isArray(split?.left) ? split.left : []).map((row) => ({ row, col: 'left' }))),
      ...((Array.isArray(split?.right) ? split.right : []).map((row) => ({ row, col: 'right' })))
    ];
    return orderedRows
      .map(({ row, col }) => [
        `col:${col}`,
        normalizeRequestId(row?.id || ''),
        Number.isFinite(Number(row?.sourceIndex)) ? `src:${Number(row.sourceIndex)}` : '',
        normalizeText(row?.status || ''),
        normalizeText(row?.statusKey || ''),
        normalizeText(row?.type || ''),
        normalizeText(row?.city || ''),
        normalizeText(row?.address || ''),
        normalizeText(row?.phone || ''),
        normalizeText(row?.reqDateTime || ''),
        normalizeText(row?.created || ''),
        normalizeText(row?.createdFull || ''),
        normalizeText(row?.name || ''),
        row?.statusKey === 'mod' ? `arr:${Number(getMainModerationArrivalSortTime(row) || 0)}` : '',
        normalizeText(row?.moderationCallValue || ''),
        Number(row?.moderationCallCheckedAt || 0) > 0 ? `call:${Number(row.moderationCallCheckedAt)}` : '',
        row?.statusKey === 'mod' && Number(row?.moderationCallCheckedAt || 0) > 0 ? `clock:${Math.floor(Date.now() / 60000)}` : '',
        row?.isAwaitOnlyGreen ? 'await-green' : '',
        row?.hasFarTrip ? 'far-trip' : '',
        normalizeText(row?.processingState || '')
      ].join('|'))
      .join('||');
  }

  function renderMainSplitCards(cardsArea, rows, forceTopNow, animSnapshot = {}) {
    if (!(cardsArea instanceof HTMLElement)) return;
    const safeRows = Array.isArray(rows) ? rows : [];
    const prevCards = Array.isArray(animSnapshot.prevCards)
      ? animSnapshot.prevCards.filter((node) => node instanceof HTMLElement && !node.classList.contains('card-ghost-leave'))
      : Array.from(cardsArea.querySelectorAll('.card[data-id]:not(.card-ghost-leave)'));
    const prevEmptyNotes = Array.isArray(animSnapshot.prevEmptyNotes)
      ? animSnapshot.prevEmptyNotes.filter((node) => node instanceof HTMLElement && !node.classList.contains('card-ghost-leave'))
      : Array.from(cardsArea.querySelectorAll('.main-split-col-flow > .main-split-empty:not(.card-ghost-leave)'));
    const prevIdSet = animSnapshot.prevIdSet instanceof Set
      ? animSnapshot.prevIdSet
      : new Set(prevCards.map((node) => String(node.getAttribute('data-id') || '')));
    const prevEmptyKeySet = new Set(prevEmptyNotes.map((node) => getMainSplitEmptyKey(node)).filter(Boolean));
    const prevGroupById = animSnapshot.prevGroupById instanceof Map
      ? animSnapshot.prevGroupById
      : new Map(prevCards.map((node) => [
        String(node.getAttribute('data-id') || ''),
        String(node.getAttribute('data-anim-group') || '')
      ]));
    const prevStatusById = new Map(
      prevCards.map((node) => [
        String(node.getAttribute('data-id') || ''),
        getRenderedCardStatusText(node)
      ])
    );
    const prevPositionById = new Map();
    ['left', 'right'].forEach((side) => {
      prevCards
        .filter((node) => node.closest?.(`[data-main-col="${side}"]`))
        .forEach((node, index) => {
          const id = String(node.getAttribute('data-id') || '');
          if (!id) return;
          prevPositionById.set(id, { side, index });
        });
    });
    const prevTopById = animSnapshot.prevTopById instanceof Map
      ? animSnapshot.prevTopById
      : new Map(prevCards.map((node) => [String(node.getAttribute('data-id') || ''), node.getBoundingClientRect().top]));
    const prevRectByCard = animSnapshot.prevRectByCard instanceof Map
      ? animSnapshot.prevRectByCard
      : new Map(prevCards.map((node) => [node, node.getBoundingClientRect()]));
    const prevRectByEmpty = new Map(prevEmptyNotes.map((node) => [node, node.getBoundingClientRect()]));
    const prevLeft = cardsArea.querySelector('[data-main-col="left"]');
    const prevRight = cardsArea.querySelector('[data-main-col="right"]');
    const prevLeftTop = prevLeft instanceof HTMLElement ? prevLeft.scrollTop : 0;
    const prevRightTop = prevRight instanceof HTMLElement ? prevRight.scrollTop : 0;
    const leftWasAtTop = prevLeftTop <= 2;
    const rightWasAtTop = prevRightTop <= 2;
    const sortedRows = sortRowsByCreatedDesc(safeRows);
    const nextSplit = splitMainRowsForColumns(sortedRows);
    const nextEmptyKeySet = new Set([
      !nextSplit.left.length ? 'left' : '',
      !nextSplit.right.length ? 'right' : ''
    ].filter(Boolean));
    const contentKey = `cards:main-split:${buildMainSplitRowsSignature(sortedRows, nextSplit)}`;
    const prevContentKey = String(cardsArea.getAttribute('data-content-key') || '');
    const prevWasMainSplit = prevContentKey.startsWith('cards:main-split:');
    const forcePanelSwap = Boolean(animSnapshot.forcePanelSwap && !prevWasMainSplit);
    const nextIds = sortedRows.map((row) => String(row?.id || ''));
    const nextIdSet = new Set(nextIds);
    const nextGroupById = new Map(
      sortedRows.map((row) => [String(row?.id || ''), getRowAnimGroup(row)])
    );
    const nextStatusById = new Map(
      sortedRows.map((row) => [String(row?.id || ''), normalizeText(row?.status || '')])
    );
    const nextPositionById = new Map();
    (Array.isArray(nextSplit.left) ? nextSplit.left : []).forEach((row, index) => {
      const id = String(row?.id || '');
      if (!id) return;
      nextPositionById.set(id, { side: 'left', index });
    });
    (Array.isArray(nextSplit.right) ? nextSplit.right : []).forEach((row, index) => {
      const id = String(row?.id || '');
      if (!id) return;
      nextPositionById.set(id, { side: 'right', index });
    });
    const transitionedIds = new Set();
    const leaveOnlyIds = new Set();
    const deferredRevealIds = new Set();
    const delayedRevealEnterIds = new Set();
    nextGroupById.forEach((group, id) => {
      if (!id || !prevGroupById.has(id)) return;
      if (String(prevGroupById.get(id) || '') !== String(group || '')) {
        transitionedIds.add(id);
      }
    });
    nextStatusById.forEach((statusText, id) => {
      if (!id || !prevStatusById.has(id)) return;
      const prevStatusText = String(prevStatusById.get(id) || '');
      const prevPos = prevPositionById.get(id) || null;
      const nextPos = nextPositionById.get(id) || null;
      const prevWasPriorityClarify = isClarifyPriorityStatus(prevStatusText);
      const nextIsPriorityClarify = isClarifyPriorityStatus(statusText);
      const clarifyTierChanged = isClarifyStatusText(prevStatusText)
        && isClarifyStatusText(statusText)
        && prevWasPriorityClarify !== nextIsPriorityClarify;
      const positionChanged = Boolean(
        prevPos
        && nextPos
        && (prevPos.side !== nextPos.side || prevPos.index !== nextPos.index)
      );
      if (clarifyTierChanged && positionChanged) {
        transitionedIds.add(id);
        deferredRevealIds.add(id);
        if (prevWasPriorityClarify && !nextIsPriorityClarify) {
          leaveOnlyIds.add(id);
        } else if (!prevWasPriorityClarify && nextIsPriorityClarify) {
          delayedRevealEnterIds.add(id);
        }
      }
    });
    const MOVE_MS = 560;
    const LEAVE_MS = 620;
    const ENTER_MS = 560;
    const forceCardPanelSwap = forcePanelSwap;
    const shouldAnimateCards = Boolean(!forceTopNow && prevContentKey && (prevCards.length || prevEmptyNotes.length));
    const shouldAnimatePanelSwap = Boolean(forcePanelSwap && animSnapshot.animatePanelSwap);
    const removedCount = prevCards.filter((node) => {
      const id = String(node.getAttribute('data-id') || '');
      return id && (!nextIdSet.has(id) || transitionedIds.has(id));
    }).length;
    const addedCount = nextIds.filter((id) => id && (!prevIdSet.has(id) || transitionedIds.has(id))).length;

    if (cardsArea.hasAttribute('data-bulk-sig')) cardsArea.removeAttribute('data-bulk-sig');
    if (!shouldAnimatePanelSwap) {
      setElementClass(cardsArea, 'bulk-phone-split-mode', false);
      setElementClass(cardsArea, 'cards-grid-mode', false);
      setElementClass(cardsArea, 'moderation-split-mode', false);
      setElementClass(cardsArea, 'main-split-mode', true);
    }
    if (!forceTopNow && prevContentKey === contentKey) {
      return;
    }
    // Инкрементальный путь: пока это не panel-swap, обновляем колонки с переиспользованием
    // DOM-узлов (новая → enter, ушедшая → ghost, сдвиг/смена ранга → патч бейджа на месте + FLIP),
    // не пересобирая весь innerHTML. Покрывает и переходы (соглас→обычное, уезд в др. колонку):
    // карточка плавно съезжает на новую позицию вместо ghost+re-enter старого полного пути.
    if (!forcePanelSwap && prevWasMainSplit && shouldAnimateCards) {
      const reconcileTpl = document.createElement('template');
      reconcileTpl.innerHTML = String(buildMainSplitCardsHtml(sortedRows, nextSplit) || '').trim();
      const nextSplitEl = reconcileTpl.content.querySelector('.main-split');
      if (nextSplitEl && reconcileMainSplit(cardsArea, nextSplitEl, { enterMs: ENTER_MS, moveMs: MOVE_MS, leaveMs: LEAVE_MS })) {
        // Бампаем seq, чтобы отложенные колбэки прошлого полного рендера (setCardsAreaContent)
        // отменились и не применили устаревшую анимацию поверх инкрементального обновления.
        cardsArea.setAttribute('data-content-seq', String(Number(cardsArea.getAttribute('data-content-seq') || '0') + 1));
        cardsArea.setAttribute('data-content-key', contentKey);
        cleanupStaleCardGhosts(false);
        return;
      }
    }
    if (shouldAnimateCards && !forcePanelSwap) {
      // При каждом новом анимированном рендере убираем ВСЕ прежние призраки —
      // их исходные карточки уже ушли из DOM. Иначе при частой смене страниц
      // призраки копятся десятками и «зависают» дублями.
      cleanupStaleCardGhosts(true);
      const hostRoot = document.getElementById(HOST_ID);
      const ghostLayer = hostRoot?.querySelector('.tm-anim-layer');
      const createMainSplitLeaveGhost = (node, rect) => {
        if (!(node instanceof HTMLElement)) return;
        if (!rect || rect.width < 2 || rect.height < 2) return;
        const ghost = node.cloneNode(true);
        if (!(ghost instanceof HTMLElement)) return;
        // Клон мог быть снят с карточки прямо во время ЕЁ анимации появления —
        // убираем enter-классы, иначе они конфликтуют с анимацией ухода,
        // transitionend не срабатывает и призрак «застывает» (не удаляется).
        ghost.classList.remove('card-enter', 'card-enter-active', 'card-move');
        ghost.classList.add('card-ghost-leave');
        // Прячем сам оригинал (он уходит) — иначе призрак-клон двоится поверх него.
        try { node.style.opacity = '0'; node.style.pointerEvents = 'none'; } catch (_hideNode) {}
        if (node.closest('.main-split-col-flow')) {
          ghost.classList.add('card-ghost-main-split');
        }
        if (node.closest('.moderation-split-col-flow')) {
          ghost.classList.add('card-ghost-moderation-split');
        }
        ghost.style.position = 'fixed';
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.margin = '0';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '2147483646';
        armCardGhostLifecycle(ghost, node, LEAVE_MS);
        if (ghostLayer instanceof HTMLElement) {
          ghostLayer.appendChild(ghost);
        } else {
          cardsArea.appendChild(ghost);
        }
        requestAnimationFrame(() => {
          ghost.classList.add('card-ghost-leave-active');
        });
      };
      prevCards.forEach((card) => {
        const id = String(card.getAttribute('data-id') || '');
        if (!id) return;
        if (!forceCardPanelSwap && nextIdSet.has(id) && !transitionedIds.has(id)) return;
        const rect = prevRectByCard.get(card) || card.getBoundingClientRect();
        createMainSplitLeaveGhost(card, rect);
      });
      prevEmptyNotes.forEach((note) => {
        const key = getMainSplitEmptyKey(note);
        if (!key || nextEmptyKeySet.has(key)) return;
        const rect = prevRectByEmpty.get(note) || note.getBoundingClientRect();
        createMainSplitLeaveGhost(note, rect);
      });
    }
    const restoreScroll = () => {
      const nextLeft = cardsArea.querySelector('[data-main-col="left"]');
      const nextRight = cardsArea.querySelector('[data-main-col="right"]');
      cardsArea.scrollTop = 0;
      if (nextLeft instanceof HTMLElement) {
        nextLeft.scrollTop = (forceTopNow || leftWasAtTop) ? 0 : prevLeftTop;
      }
      if (nextRight instanceof HTMLElement) {
        nextRight.scrollTop = (forceTopNow || rightWasAtTop) ? 0 : prevRightTop;
      }
    };

    const animatePanelCardsEnter = () => {
      animateCardsFromDepth(cardsArea.querySelectorAll('.main-split-col-flow > .card[data-id], .main-split-col-flow > .main-split-empty'), {
        enterMs: ENTER_MS,
        baseDelay: 0,
        staggerStep: 8,
        maxStagger: 64
      });
    };

    const afterPanelSwapApply = () => {
      cardsArea.classList.remove('cards-area-panel-real-leave');
      setElementClass(cardsArea, 'bulk-phone-split-mode', false);
      setElementClass(cardsArea, 'cards-grid-mode', false);
      setElementClass(cardsArea, 'moderation-split-mode', false);
      setElementClass(cardsArea, 'main-split-mode', true);
      restoreScroll();
      requestAnimationFrame(restoreScroll);
      animatePanelCardsEnter();
    };

    const nextMainHtml = buildMainSplitCardsHtml(sortedRows, nextSplit);
    if (!forceCardPanelSwap && !addedCount && !removedCount && !transitionedIds.size && patchMainSplitContent(cardsArea, nextMainHtml)) {
      restoreScroll();
      requestAnimationFrame(restoreScroll);
      return;
    }
    const didChange = setCardsAreaContent(
      cardsArea,
      nextMainHtml,
      contentKey,
      {
        animate: shouldAnimatePanelSwap,
        ...(shouldAnimatePanelSwap ? { swapLeaveMs: 220, swapEnterMs: ENTER_MS } : {}),
        afterApply: shouldAnimatePanelSwap ? afterPanelSwapApply : null
      }
    );
    if (!didChange && !forceTopNow) return;
    if (shouldAnimatePanelSwap) return;

    restoreScroll();
    requestAnimationFrame(restoreScroll);

    if (forceCardPanelSwap && didChange) {
      animatePanelCardsEnter();
      return;
    }

    if (!didChange || !shouldAnimateCards) return;

    const nextCards = Array.from(cardsArea.querySelectorAll('.main-split-col-flow > .card[data-id]'));
    const nextEmptyNotes = Array.from(cardsArea.querySelectorAll('.main-split-col-flow > .main-split-empty'));
    const deferredRevealCards = nextCards.filter((card) => deferredRevealIds.has(String(card.getAttribute('data-id') || '')));
    deferredRevealCards.forEach((card) => {
      card.style.opacity = '0';
      card.style.visibility = 'hidden';
      card.style.transition = 'none';
    });
    if (deferredRevealCards.length) {
      setTimeout(() => {
        deferredRevealCards.forEach((card) => {
          if (!(card instanceof HTMLElement) || !card.isConnected) return;
          card.style.opacity = '';
          card.style.visibility = '';
          card.style.transition = '';
          const id = String(card.getAttribute('data-id') || '');
          if (!delayedRevealEnterIds.has(id)) return;
          card.classList.add('card-enter');
          void card.offsetWidth;
          requestAnimationFrame(() => {
            card.classList.add('card-enter-active');
          });
          setTimeout(() => {
            card.classList.remove('card-enter', 'card-enter-active');
          }, ENTER_MS);
        });
      }, LEAVE_MS + 30);
    }
    const moveItems = [];
    let hasDownShift = false;
    nextCards.forEach((card) => {
      if (forceCardPanelSwap) return;
      const id = String(card.getAttribute('data-id') || '');
      if (!id || !prevTopById.has(id)) return;
      if (transitionedIds.has(id) || deferredRevealIds.has(id)) return;
      const prevTop = Number(prevTopById.get(id));
      const nextTop = card.getBoundingClientRect().top;
      const dy = prevTop - nextTop;
      if (!Number.isFinite(dy) || Math.abs(dy) < 1) return;
      const movingUpToFillGap = dy > 1 && removedCount > 0;
      const movingDownForInsert = dy < -1 && addedCount > 0;
      if (!movingUpToFillGap && !movingDownForInsert) return;
      if (movingDownForInsert) hasDownShift = true;
      moveItems.push({ card, dy });
    });

    const animatedCards = [];
    moveItems.forEach(({ card, dy }) => {
      card.classList.add('card-move');
      card.style.transition = 'transform 0s';
      card.style.transform = `translateY(${dy}px)`;
      animatedCards.push(card);
    });
    if (animatedCards.length) {
      requestAnimationFrame(() => {
        animatedCards.forEach((card) => {
          card.style.transition = '';
          card.style.transform = 'translateY(0)';
        });
      });
      setTimeout(() => {
        animatedCards.forEach((card) => {
          card.classList.remove('card-move');
          card.style.transform = '';
          card.style.transition = '';
        });
      }, MOVE_MS);
    }

    nextCards.forEach((card, index) => {
      const id = String(card.getAttribute('data-id') || '');
      if (!id) return;
      if (!forceCardPanelSwap && leaveOnlyIds.has(id)) return;
      if (!forceCardPanelSwap && deferredRevealIds.has(id)) return;
      if (!forceCardPanelSwap && prevIdSet.has(id) && !transitionedIds.has(id)) return;
      card.classList.add('card-enter');
      void card.offsetWidth;
      const baseDelay = hasDownShift ? 120 : 0;
      const stagger = Math.min(index * 8, 64);
      const showDelay = baseDelay + stagger;
      setTimeout(() => {
        requestAnimationFrame(() => {
          card.classList.add('card-enter-active');
        });
      }, showDelay);
      setTimeout(() => {
        card.classList.remove('card-enter', 'card-enter-active');
      }, showDelay + ENTER_MS);
    });
    nextEmptyNotes.forEach((note, index) => {
      if (!(note instanceof HTMLElement)) return;
      const key = getMainSplitEmptyKey(note);
      if (!key || prevEmptyKeySet.has(key)) return;
      note.classList.add('card-enter');
      void note.offsetWidth;
      const baseDelay = hasDownShift ? 120 : 0;
      const stagger = Math.min(index * 8, 64);
      const showDelay = baseDelay + stagger;
      setTimeout(() => {
        requestAnimationFrame(() => {
          note.classList.add('card-enter-active');
        });
      }, showDelay);
      setTimeout(() => {
        note.classList.remove('card-enter', 'card-enter-active');
      }, showDelay + ENTER_MS);
    });
  }

  function renderCards(rows) {
    const cardsArea = document.getElementById('tmCardsArea');
    if (!cardsArea) return;
    const forceTopNow = Boolean(state.forceTopOnNextCardsRender);
    if (forceTopNow) {
      state.forceTopOnNextCardsRender = false;
    }
    const isMainMode = !state.remote.kind;
    const isModerationMode = state.remote.kind === 'moderation';
    const isSpecialRemoteMode = ['dispatcher-report', 'customer-directory'].includes(state.remote.kind || '');
    const isCustomerDirectoryMode = state.remote.kind === 'customer-directory';
    const isBulkPhonesMode = state.remote.kind === 'bulk-phones';
    const isCardGridMode = !isMainMode && !isSpecialRemoteMode && !isBulkPhonesMode && !isModerationMode;
    const safeRows = Array.isArray(rows) ? rows : getCurrentRows();
    const prevContentKeyBeforeRender = String(cardsArea.getAttribute('data-content-key') || '');
    const prevWasMainSplitBeforeRender = prevContentKeyBeforeRender.startsWith('cards:main-split:');
    const prevWasCustomerDirectoryBeforeRender = prevContentKeyBeforeRender.startsWith('remote:customer-directory:');
    const prevWasDispatcherReportBeforeRender = prevContentKeyBeforeRender.startsWith('remote:dispatcher-report:');
    const prevWasRemotePanelBeforeRender = prevWasCustomerDirectoryBeforeRender || prevWasDispatcherReportBeforeRender;
    const prevWasCardListBeforeRender = prevContentKeyBeforeRender.startsWith('cards:list:')
      || prevContentKeyBeforeRender.startsWith('cards:empty:')
      || prevContentKeyBeforeRender.startsWith('cards:loading:');
    const prevListModeMatch = prevContentKeyBeforeRender.match(/^cards:(?:list|loading|empty):([^:]+)/);
    const prevListMode = normalizeText(prevListModeMatch?.[1] || '');
    const nextListMode = normalizeText(state.remote.kind || 'main');
    const prevWasBulkBeforeRender = prevContentKeyBeforeRender.startsWith('cards:bulk:')
      || cardsArea.classList.contains('bulk-phone-split-mode');
    const leavingBulkPhonesMode = Boolean(prevWasBulkBeforeRender && !isBulkPhonesMode);
    if (!leavingBulkPhonesMode) {
      cardsArea.classList.remove('cards-area-hide-real-bulk');
    }
    const forcePanelSwapToMain = Boolean(
      isMainMode
      && prevContentKeyBeforeRender
      && !prevWasMainSplitBeforeRender
    );
    const isPanelSwapFromMain = Boolean(!isMainMode && prevWasMainSplitBeforeRender);
    const isPanelSwapFromListToRemotePanel = Boolean(isSpecialRemoteMode && prevWasCardListBeforeRender);
    const isPanelSwapFromRemotePanelToList = Boolean(isCardGridMode && prevWasRemotePanelBeforeRender);
    const isPanelSwapFromRemotePanelToBulk = Boolean(isBulkPhonesMode && prevWasRemotePanelBeforeRender);
    const isPanelSwapFromListToList = Boolean(
      isCardGridMode
      && prevWasCardListBeforeRender
      && prevListMode
      && nextListMode
      && prevListMode !== nextListMode
    );
    const deferRemoteModeClasses = Boolean(
      isPanelSwapFromMain
      || isPanelSwapFromListToRemotePanel
      || isPanelSwapFromRemotePanelToList
      || isPanelSwapFromRemotePanelToBulk
      || leavingBulkPhonesMode
    );
    const animateRealCardsForPanelSwap = Boolean(
      deferRemoteModeClasses
      || forcePanelSwapToMain
      || isPanelSwapFromListToList
    );
    const hideRealCardsForPanelSwap = false;
    const forceEnterAllCardsForPanelSwap = Boolean(
      deferRemoteModeClasses
      || isPanelSwapFromListToList
    );
    const forceLeaveAllCardsForPanelSwap = hideRealCardsForPanelSwap;
    const applyRemoteModeClasses = () => {
      cardsArea.classList.remove('cards-area-panel-real-leave');
      cardsArea.classList.remove('cards-area-hide-real-cards');
      cardsArea.classList.remove('cards-area-hide-real-bulk');
      setElementClass(cardsArea, 'main-split-mode', false);
      setElementClass(cardsArea, 'cards-grid-mode', isCardGridMode);
      setElementClass(cardsArea, 'moderation-split-mode', isModerationMode);
      setElementClass(cardsArea, 'bulk-phone-split-mode', isBulkPhonesMode);
      setElementClass(cardsArea, 'customer-directory-mode', isCustomerDirectoryMode);
    };
    if (!animateRealCardsForPanelSwap) {
      cardsArea.classList.remove('cards-area-panel-real-leave');
    }

    const isFullPanelTransition = Boolean(
      deferRemoteModeClasses
      || forcePanelSwapToMain
      || leavingBulkPhonesMode
      || isPanelSwapFromListToList
    );
    cleanupStaleCardGhosts(isFullPanelTransition);
    if (animateRealCardsForPanelSwap) {
      cardsArea.classList.add('cards-area-panel-real-leave');
    }
    const hostRoot = document.getElementById(HOST_ID);
    const ghostLayer = hostRoot?.querySelector('.tm-anim-layer');
    const prevBulkGroups = leavingBulkPhonesMode
      ? Array.from(cardsArea.querySelectorAll('.bulk-phone-group:not(.card-ghost-leave)'))
      : [];
    const shouldCapturePrevCards = Boolean(!leavingBulkPhonesMode && (isPanelSwapFromMain || (!isBulkPhonesMode && !isSpecialRemoteMode)));
    const prevCards = shouldCapturePrevCards
      ? Array.from(cardsArea.querySelectorAll('.card[data-id]:not(.card-ghost-leave)'))
      : [];
    const cardsAreaRect = cardsArea.getBoundingClientRect();
    const prevScrollTop = cardsArea.scrollTop;
    const wasAtTopBeforeRender = prevScrollTop <= 2;
    // Один замер геометрии на карточку вместо 3-4: раньше каждая карточка
    // измерялась несколько раз (anchor + top + rect), и фоновые перерисовки
    // во время прокрутки давали всплеск forced layout и просадку FPS.
    const prevIdSet = new Set();
    const prevGroupById = new Map();
    const prevTopById = new Map();
    const prevRectByCard = new Map();
    const prevRectById = new Map();
    let prevAnchorCard = null;
    const prevAnchorThreshold = cardsAreaRect.top + 2;
    for (const node of prevCards) {
      const cardId = String(node.getAttribute('data-id') || '');
      const rect = node.getBoundingClientRect();
      prevIdSet.add(cardId);
      prevGroupById.set(cardId, String(node.getAttribute('data-anim-group') || ''));
      prevTopById.set(cardId, rect.top);
      prevRectByCard.set(node, rect);
      prevRectById.set(cardId, rect);
      if (!prevAnchorCard && rect.bottom >= prevAnchorThreshold) prevAnchorCard = node;
    }
    const prevAnchorId = prevAnchorCard ? String(prevAnchorCard.getAttribute('data-id') || '') : '';
    const prevAnchorOffset = prevAnchorCard
      ? ((prevRectByCard.get(prevAnchorCard) || prevAnchorCard.getBoundingClientRect()).top - cardsAreaRect.top)
      : 0;
    const createLeaveGhostForCard = (card) => {
      if (!(card instanceof HTMLElement)) return;
      const rect = prevRectByCard.get(card) || card.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const ghost = card.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) return;
      // Снимаем enter-классы у клона: иначе анимация появления конфликтует с уходом,
      // transitionend не срабатывает и призрак «застывает» до TTL.
      ghost.classList.remove('card-enter', 'card-enter-active', 'card-move');
      ghost.classList.add('card-ghost-leave');
      // Прячем сам оригинал (он уходит) — иначе призрак-клон двоится поверх него.
      try { card.style.opacity = '0'; card.style.pointerEvents = 'none'; } catch (_hideCard) {}
      if (card.closest('.main-split-col-flow')) {
        ghost.classList.add('card-ghost-main-split');
      }
      if (card.closest('.moderation-split-col-flow')) {
        ghost.classList.add('card-ghost-moderation-split');
      }
      ghost.style.position = 'fixed';
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.margin = '0';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '2147483646';
      armCardGhostLifecycle(ghost, card, 620);
      if (ghostLayer instanceof HTMLElement) {
        ghostLayer.appendChild(ghost);
      } else {
        cardsArea.appendChild(ghost);
      }
      requestAnimationFrame(() => {
        ghost.classList.add('card-ghost-leave-active');
      });
    };
    const createLeaveGhostForBulkGroup = (group) => {
      if (!(group instanceof HTMLElement)) return;
      const rect = group.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const ghost = group.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) return;
      ghost.classList.remove('card-enter', 'card-enter-active', 'card-move');
      ghost.classList.add('card-ghost-leave', 'bulk-phone-group-ghost');
      try { group.style.opacity = '0'; group.style.pointerEvents = 'none'; } catch (_hideGroup) {}
      ghost.style.position = 'fixed';
      ghost.style.left = `${rect.left}px`;
      ghost.style.top = `${rect.top}px`;
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.margin = '0';
      ghost.style.pointerEvents = 'none';
      ghost.style.zIndex = '2147483646';
      armCardGhostLifecycle(ghost, group, 620);
      if (ghostLayer instanceof HTMLElement) {
        ghostLayer.appendChild(ghost);
      } else {
        cardsArea.appendChild(ghost);
      }
      requestAnimationFrame(() => {
        ghost.classList.add('card-ghost-leave-active');
      });
    };
    const animateBulkPhoneLeaveGhosts = () => {
      if (!leavingBulkPhonesMode || !prevBulkGroups.length) return;
      cleanupStaleCardGhosts(true);
      cardsArea.classList.add('cards-area-hide-real-bulk');
      prevBulkGroups.forEach(createLeaveGhostForBulkGroup);
    };
    const animatePanelSwapLeaveGhosts = () => {
      if (!hideRealCardsForPanelSwap) return;
      cleanupStaleCardGhosts(true);
      cardsArea.classList.add('cards-area-hide-real-cards');
      prevCards.forEach(createLeaveGhostForCard);
    };

    if (!animateRealCardsForPanelSwap) {
      animateBulkPhoneLeaveGhosts();
    }

    if (!isMainMode && !deferRemoteModeClasses) {
      setElementClass(cardsArea, 'cards-grid-mode', isCardGridMode);
      setElementClass(cardsArea, 'moderation-split-mode', isModerationMode);
      setElementClass(cardsArea, 'bulk-phone-split-mode', isBulkPhonesMode);
      setElementClass(cardsArea, 'customer-directory-mode', isCustomerDirectoryMode);
    }
    if (isMainMode) {
      setElementClass(cardsArea, 'customer-directory-mode', false);
      renderMainSplitCards(cardsArea, safeRows, forcePanelSwapToMain ? false : forceTopNow, {
        prevCards,
        prevIdSet,
        prevGroupById,
        prevTopById,
        prevRectByCard,
        forcePanelSwap: forcePanelSwapToMain,
        animatePanelSwap: forcePanelSwapToMain
      });
      return;
    }
    if (!deferRemoteModeClasses) {
      setElementClass(cardsArea, 'main-split-mode', false);
    }
    if (state.remote.kind === 'dispatcher-report') {
      animatePanelSwapLeaveGhosts();
      renderDispatcherReportCard(
        cardsArea,
        deferRemoteModeClasses ? applyRemoteModeClasses : null,
        animateRealCardsForPanelSwap ? { swapLeaveMs: 220, swapEnterMs: 220 } : {}
      );
      return;
    }
    if (state.remote.kind === 'customer-directory') {
      animatePanelSwapLeaveGhosts();
      renderCustomerDirectoryCard(
        cardsArea,
        deferRemoteModeClasses ? applyRemoteModeClasses : null,
        animateRealCardsForPanelSwap ? { swapLeaveMs: 220, swapEnterMs: 460 } : {}
      );
      return;
    }

    const nextIds = safeRows.map((row) => String(row.id || ''));
    const nextGroupById = new Map(
      safeRows.map((row) => [String(row.id || ''), getRowAnimGroup(row)])
    );
    const nextIdSet = new Set(nextIds);
    const transitionedIds = new Set();
    nextGroupById.forEach((group, id) => {
      if (!id || !prevGroupById.has(id)) return;
      if (String(prevGroupById.get(id) || '') !== String(group || '')) {
        transitionedIds.add(id);
      }
    });
    if (isModerationMode && prevContentKeyBeforeRender === 'cards:list:moderation') {
      const prevModerationColumnById = new Map(
        prevCards.map((card) => [
          String(card.getAttribute('data-id') || ''),
          String(card.closest('[data-moderation-col]')?.getAttribute('data-moderation-col') || '')
        ])
      );
      const nextModerationLeftCount = Math.ceil(safeRows.length / 2);
      safeRows.forEach((row, index) => {
        const id = String(row?.id || '');
        if (!id || !prevModerationColumnById.has(id)) return;
        const prevColumn = String(prevModerationColumnById.get(id) || '');
        const nextColumn = index < nextModerationLeftCount ? 'left' : 'right';
        if (prevColumn && prevColumn !== nextColumn) {
          transitionedIds.add(id);
        }
      });
    }
    const MOVE_MS = 560;
    const ENTER_MS = 560;
    const afterListPanelSwapApply = () => {
      if (deferRemoteModeClasses) applyRemoteModeClasses();
      else cardsArea.classList.remove('cards-area-panel-real-leave');
      if (forceEnterAllCardsForPanelSwap) {
        cardsArea.scrollTop = 0;
        animateCardsFromDepth(cardsArea.querySelectorAll('.card[data-id]'), {
          enterMs: ENTER_MS,
          baseDelay: 0,
          staggerStep: 8,
          maxStagger: 64
        });
      }
    };
    const listAfterApply = (deferRemoteModeClasses || forceEnterAllCardsForPanelSwap)
      ? afterListPanelSwapApply
      : null;
    const animateListPanelSwap = Boolean(
      animateRealCardsForPanelSwap
      && !isBulkPhonesMode
    );
    const removedCount = prevCards.filter((node) => {
      const id = String(node.getAttribute('data-id') || '');
      return id && (!nextIdSet.has(id) || transitionedIds.has(id));
    }).length;
    const addedCount = nextIds.filter((id) => id && (!prevIdSet.has(id) || transitionedIds.has(id))).length;

    if (hideRealCardsForPanelSwap) {
      animatePanelSwapLeaveGhosts();
    }
    if (!isBulkPhonesMode && !hideRealCardsForPanelSwap && !animateListPanelSwap) {
      // Animate cards that disappear.
      prevCards.forEach((card) => {
        const id = String(card.getAttribute('data-id') || '');
        if (!id) return;
        if (!forceLeaveAllCardsForPanelSwap && nextIdSet.has(id) && !transitionedIds.has(id)) return;
        createLeaveGhostForCard(card);
      });
    }

    if (!safeRows.length) {
      const loading = Boolean(state.remote.kind) && state.remote.loading;
      const emptyText = state.remote.personalModeError
        ? state.remote.personalModeError
        : 'Ничего не найдено';
      const emptyKeyText = normalizeText(emptyText || '').slice(0, 140) || 'none';
      const contentKey = loading
        ? `cards:loading:${state.remote.kind || 'id'}`
        : `cards:empty:${state.remote.kind || 'main'}:${emptyKeyText}`;
      setCardsAreaContent(
        cardsArea,
        loading ? buildCardsLoadingHtml(state.remote.kind === 'bulk-phones' ? getBulkPhonesLoadingProgress() : null) : buildCardsStatusHtml(emptyText),
        contentKey,
        {
          animate: true,
          ...(animateRealCardsForPanelSwap ? { swapLeaveMs: 220 } : {}),
          afterApply: animateRealCardsForPanelSwap
            ? afterListPanelSwapApply
            : (deferRemoteModeClasses ? applyRemoteModeClasses : null)
        }
      );
      if (forceTopNow) {
        cardsArea.scrollTop = 0;
        requestAnimationFrame(() => {
          cardsArea.scrollTop = 0;
        });
      }
      return;
    }

    if (state.remote.kind === 'bulk-phones') {
      const bulkHtml = renderBulkPhoneGroupsHtml(safeRows);
      const wasBulkContent = String(cardsArea.getAttribute('data-content-key') || '').startsWith('cards:bulk:');
      const shouldAnimateBulkEnter = Boolean(!wasBulkContent || forceTopNow || deferRemoteModeClasses);
      const prevBulkGroupKeys = new Set(
        wasBulkContent
          ? Array.from(cardsArea.querySelectorAll('.bulk-phone-group[data-bulk-group-key]'))
            .map((node) => String(node.getAttribute('data-bulk-group-key') || ''))
            .filter(Boolean)
          : []
      );
      // Скролл в bulk-режиме НИКТО не восстанавливал → фоновый догруз (refreshBulkPhonesInBackground)
      // перерисовывал innerHTML и выбрасывал юзера в начало списка.
      // ГЛАВНОЕ: в bulk-режиме скроллится НЕ .cards-area — на неё вешается класс
      // bulk-phone-split-mode с overflow:hidden, а прокручивается ВНУТРЕННЯЯ колонка
      // .bulk-phone-groups-col (overflow-y:auto). Поэтому cardsArea.scrollTop всегда 0
      // (диаг это и показал: «prev=0, былВверху=true», хотя список был прокручен).
      // Есть и медиа-вариант, где скроллер — сама .cards-area, поэтому берём тот элемент,
      // который реально прокручен/прокручиваем.
      const pickBulkScroller = () => {
        const col = cardsArea.querySelector('.bulk-phone-groups-col');
        if (col instanceof HTMLElement && col.scrollHeight > col.clientHeight + 1) return col;
        return cardsArea;
      };
      const prevBulkScroller = pickBulkScroller();
      const bulkPrevScrollTop = prevBulkScroller.scrollTop;
      // Колонку пересоздаёт innerHTML → после рендера ищем её заново.
      let bulkScroller = prevBulkScroller;
      const restoreBulkScroll = () => {
        try {
          if (forceTopNow || bulkPrevScrollTop <= 2) return;   // были наверху — нечего восстанавливать
          // Колонка после innerHTML — уже другой узел, поэтому берём актуальную.
          const col = cardsArea.querySelector('.bulk-phone-groups-col');
          bulkScroller = (col instanceof HTMLElement && col.scrollHeight > col.clientHeight + 1) ? col : cardsArea;
          const max = Math.max(0, bulkScroller.scrollHeight - bulkScroller.clientHeight);
          const next = Math.max(0, Math.min(bulkPrevScrollTop, max));
          if (bulkScroller.scrollTop !== next) bulkScroller.scrollTop = next;
        } catch (_error) {}
      };
      const afterBulkApply = () => {
        if (deferRemoteModeClasses) applyRemoteModeClasses();
        restoreBulkScroll();
        if (shouldAnimateBulkEnter) {
          animateBulkPhoneGroupsFromDepth(cardsArea);
          return;
        }
        const addedGroups = Array.from(cardsArea.querySelectorAll('.bulk-phone-group[data-bulk-group-key]'))
          .filter((node) => !prevBulkGroupKeys.has(String(node.getAttribute('data-bulk-group-key') || '')));
        if (addedGroups.length) {
          animateBulkPhoneGroupsFromDepth(cardsArea, addedGroups);
        }
      };
      const bulkSig = String(safeRows.map((row) => {
        if (row?.isBulkHeader) {
          return `h:${row.bulkIndex}:${normalizeText(row.bulkPhone)}:${normalizeText(row.bulkCount)}:${normalizeText(row.bulkError)}`;
        }
        return `r:${normalizeRequestId(row?.id)}:${normalizeText(row?.bulkIndex)}:${normalizeText(row?.status)}:${normalizeText(row?.created || row?.createdFull || '')}`;
      }).join('|'));
      const currentSig = String(cardsArea.getAttribute('data-bulk-sig') || '');
      const nextBulkSig = bulkSig;
      if (currentSig !== nextBulkSig) {
        setCardsAreaContent(cardsArea, bulkHtml, `cards:bulk:${nextBulkSig}`, {
          animate: shouldAnimateBulkEnter,
          ...(animateRealCardsForPanelSwap ? { swapLeaveMs: 220 } : {}),
          afterApply: afterBulkApply
        });
        cardsArea.setAttribute('data-bulk-sig', nextBulkSig);
      } else if (deferRemoteModeClasses) {
        applyRemoteModeClasses();
      }
      prefetchBulkCreateLinks(cardsArea);
    } else if (isModerationMode) {
      if (cardsArea.hasAttribute('data-bulk-sig')) cardsArea.removeAttribute('data-bulk-sig');
      const prevModerationLeft = cardsArea.querySelector('[data-moderation-col="left"]');
      const prevModerationRight = cardsArea.querySelector('[data-moderation-col="right"]');
      const prevModerationLeftTop = prevModerationLeft instanceof HTMLElement ? prevModerationLeft.scrollTop : 0;
      const prevModerationRightTop = prevModerationRight instanceof HTMLElement ? prevModerationRight.scrollTop : 0;
      const moderationLeftWasAtTop = prevModerationLeftTop <= 2;
      const moderationRightWasAtTop = prevModerationRightTop <= 2;
      const restoreModerationColumnScroll = () => {
        const nextModerationLeft = cardsArea.querySelector('[data-moderation-col="left"]');
        const nextModerationRight = cardsArea.querySelector('[data-moderation-col="right"]');
        const clampScrollTop = (node, top) => Math.max(0, Math.min(Number(top) || 0, Math.max(0, node.scrollHeight - node.clientHeight)));
        if (nextModerationLeft instanceof HTMLElement) {
          nextModerationLeft.scrollTop = (forceTopNow || moderationLeftWasAtTop) ? 0 : clampScrollTop(nextModerationLeft, prevModerationLeftTop);
        }
        if (nextModerationRight instanceof HTMLElement) {
          nextModerationRight.scrollTop = (forceTopNow || moderationRightWasAtTop) ? 0 : clampScrollTop(nextModerationRight, prevModerationRightTop);
        }
      };
      const animateModerationReflow = () => {
        if (forceEnterAllCardsForPanelSwap) return;
        if (!addedCount && !removedCount && !transitionedIds.size) return;
        const nextModerationCards = Array.from(cardsArea.querySelectorAll('.moderation-split-col-flow > .card[data-id]'));
        let moderationHasDownShift = false;
        const moderationMoveItems = [];

        nextModerationCards.forEach((card) => {
          if (!(card instanceof HTMLElement)) return;
          const id = String(card.getAttribute('data-id') || '');
          if (!id || !prevRectById.has(id) || transitionedIds.has(id)) return;
          const prevRect = prevRectById.get(id);
          const nextRect = card.getBoundingClientRect();
          const dx = Number(prevRect?.left || 0) - nextRect.left;
          const dy = Number(prevRect?.top || 0) - nextRect.top;
          if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          if (dy < -1) moderationHasDownShift = true;
          moderationMoveItems.push({ card, dx, dy });
        });

        const moderationAnimatedCards = [];
        moderationMoveItems.forEach(({ card, dx, dy }) => {
          if (typeof card.animate === 'function') {
            card.classList.add('card-move');
            const animation = card.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0, 0)' }
              ],
              {
                duration: MOVE_MS,
                easing: 'cubic-bezier(.22,.84,.26,1)',
                fill: 'none'
              }
            );
            animation.addEventListener('finish', () => {
              card.classList.remove('card-move');
            }, { once: true });
            animation.addEventListener('cancel', () => {
              card.classList.remove('card-move');
            }, { once: true });
            return;
          }
          card.classList.add('card-move');
          card.style.transition = 'transform 0s';
          card.style.transform = `translate(${dx}px, ${dy}px)`;
          moderationAnimatedCards.push(card);
        });

        if (moderationAnimatedCards.length) {
          requestAnimationFrame(() => {
            moderationAnimatedCards.forEach((card) => {
              card.style.transition = '';
              card.style.transform = 'translate(0, 0)';
            });
          });
          setTimeout(() => {
            moderationAnimatedCards.forEach((card) => {
              card.classList.remove('card-move');
              card.style.transform = '';
              card.style.transition = '';
            });
          }, MOVE_MS);
        }

        nextModerationCards.forEach((card, index) => {
          if (!(card instanceof HTMLElement)) return;
          const id = String(card.getAttribute('data-id') || '');
          if (!id) return;
          if (prevIdSet.has(id) && !transitionedIds.has(id)) return;
          card.classList.add('card-enter');
          void card.offsetWidth;
          const baseDelay = moderationHasDownShift ? 120 : 0;
          const stagger = Math.min(index * 8, 64);
          const showDelay = baseDelay + stagger;
          setTimeout(() => {
            requestAnimationFrame(() => {
              card.classList.add('card-enter-active');
            });
          }, showDelay);
          setTimeout(() => {
            card.classList.remove('card-enter', 'card-enter-active');
          }, showDelay + ENTER_MS);
        });
      };
      const shouldRestoreModerationScroll = Boolean(
        forceTopNow
        || addedCount
        || removedCount
        || transitionedIds.size
        || prevContentKeyBeforeRender !== 'cards:list:moderation'
      );
      const afterModerationApply = () => {
        if (listAfterApply) listAfterApply();
        if (!shouldRestoreModerationScroll) return;
        restoreModerationColumnScroll();
        requestAnimationFrame(animateModerationReflow);
      };
      const moderationHtml = buildModerationSplitCardsHtml(safeRows);
      if (!forceEnterAllCardsForPanelSwap && !addedCount && !removedCount && !transitionedIds.size && patchModerationSplitContent(cardsArea, moderationHtml)) {
        if (listAfterApply) listAfterApply();
        return;
      }
      const didListChange = setCardsAreaContent(
        cardsArea,
        moderationHtml,
        'cards:list:moderation',
        {
          animate: animateListPanelSwap,
          ...(animateListPanelSwap ? { swapLeaveMs: 220 } : {}),
          afterApply: afterModerationApply
        }
      );
      if (forceEnterAllCardsForPanelSwap && didListChange) return;
      return;
    } else {
      if (cardsArea.hasAttribute('data-bulk-sig')) cardsArea.removeAttribute('data-bulk-sig');
      const didListChange = setCardsAreaContent(
        cardsArea,
        safeRows.map((row, index) => buildCard(row, { listIndex: index + 1 })).join(''),
        `cards:list:${state.remote.kind || 'main'}`,
        {
          animate: animateListPanelSwap,
          ...(animateListPanelSwap ? { swapLeaveMs: 220 } : {}),
          afterApply: listAfterApply
        }
      );
      if (forceEnterAllCardsForPanelSwap && didListChange) return;
    }
    if (forceTopNow) {
      cardsArea.scrollTop = 0;
      requestAnimationFrame(() => {
        cardsArea.scrollTop = 0;
      });
    } else {
      // If user is already at the very top on main screen, do not preserve an anchor:
      // let the list naturally shift down so newly appeared top cards are visible immediately.
      if (!state.remote.kind && wasAtTopBeforeRender) {
        cardsArea.scrollTop = 0;
      } else
      if (prevAnchorId) {
        if (transitionedIds.has(prevAnchorId)) {
          cardsArea.scrollTop = prevScrollTop;
        } else {
          const nextAnchor = Array.from(cardsArea.querySelectorAll('.card[data-id]'))
            .find((node) => String(node.getAttribute('data-id') || '') === prevAnchorId);
          if (nextAnchor) {
            const nextOffset = nextAnchor.getBoundingClientRect().top - cardsAreaRect.top;
            cardsArea.scrollTop += (nextOffset - prevAnchorOffset);
          } else {
            cardsArea.scrollTop = prevScrollTop;
          }
        }
      } else {
        cardsArea.scrollTop = prevScrollTop;
      }
    }

    // Animate cards that appear.
    const nextCards = isBulkPhonesMode ? [] : Array.from(cardsArea.querySelectorAll('.card[data-id]'));
    // FLIP animation for cards that stayed but changed position.
    // Use exact per-card delta to avoid leapfrogging when cards are inserted/removed mid-list.
    let hasDownShift = false;
    const moveItems = [];

    nextCards.forEach((card) => {
      if (forceEnterAllCardsForPanelSwap) return;
      const id = String(card.getAttribute('data-id') || '');
      if (!id || !prevRectById.has(id)) return;
      if (transitionedIds.has(id)) return;
      const prevRect = prevRectById.get(id);
      const nextRect = card.getBoundingClientRect();
      const dx = Number(prevRect?.left || 0) - nextRect.left;
      const dy = Number(prevRect?.top || 0) - nextRect.top;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const movingUpToFillGap = dy > 1 && removedCount > 0;
      const movingDownForInsert = dy < -1 && addedCount > 0;
      const moderationReflowMove = isModerationMode && (removedCount > 0 || addedCount > 0);
      // Only animate meaningful replacement moves:
      // - up when a card disappeared
      // - down when a new card appeared
      // - any column/position reflow inside the moderation split.
      if (!movingUpToFillGap && !movingDownForInsert && !moderationReflowMove) return;

      if (dy < -1 && (movingDownForInsert || moderationReflowMove)) hasDownShift = true;
      moveItems.push({ card, dx, dy });
    });
    const animatedCards = [];
    moveItems.forEach(({ card, dx, dy }) => {
      card.classList.add('card-move');
      card.style.transition = 'transform 0s';
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      animatedCards.push(card);
    });

    if (!isBulkPhonesMode && animatedCards.length) {
      requestAnimationFrame(() => {
        animatedCards.forEach((card) => {
          card.style.transition = '';
          card.style.transform = 'translate(0, 0)';
        });
      });
      setTimeout(() => {
        animatedCards.forEach((card) => {
          card.classList.remove('card-move');
          card.style.transform = '';
          card.style.transition = '';
        });
      }, MOVE_MS);
    }

    nextCards.forEach((card, index) => {
      const id = String(card.getAttribute('data-id') || '');
      if (!id) return;
      if (!forceEnterAllCardsForPanelSwap && prevIdSet.has(id) && !transitionedIds.has(id)) return;
      card.classList.add('card-enter');
      void card.offsetWidth;
      const baseDelay = hasDownShift ? 120 : 0;
      const stagger = Math.min(index * 8, 64);
      const showDelay = baseDelay + stagger;
      setTimeout(() => {
        requestAnimationFrame(() => {
          card.classList.add('card-enter-active');
        });
      }, showDelay);
      setTimeout(() => {
        card.classList.remove('card-enter', 'card-enter-active');
      }, showDelay + ENTER_MS);
    });
  }

  function sortRowsForDisplay(rows = []) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    if (state.remote.kind === 'moderation') {
      // In moderation mode:
      // 1) requests "in work by me" must always be on top;
      // 2) all other requests are one group sorted by newest ID first.
      list.sort((a, b) => {
        const prio = (stateValue) => (stateValue === 'mine' ? 0 : 1);
        const pa = prio(a?.processingState);
        const pb = prio(b?.processingState);
        if (pa !== pb) return pa - pb;

        const aNum = getRowSortId(a);
        const bNum = getRowSortId(b);
        return bNum - aNum;
      });
      return list;
    }

    if (!state.remote.kind) {
      rememberMainModerationArrivals(list);
      return sortRowsByCreatedDesc(list);
    }

    return list;
  }

  // Пока пользователь активно крутит список — не перерисовываем его (иначе
  // фоновое авто-обновление дёргает прокрутку). Откладываем один renderAll
  // на момент ~180мс после остановки скролла.
  let __v8ScrollingUntil = 0;
  let __v8RenderPendingDuringScroll = false;
  let __v8ScrollIdleTimer = 0;
  function markUserScrolling() {
    __v8ScrollingUntil = Date.now() + 200;
    if (__v8ScrollIdleTimer) clearTimeout(__v8ScrollIdleTimer);
    __v8ScrollIdleTimer = setTimeout(() => {
      __v8ScrollIdleTimer = 0;
      if (__v8RenderPendingDuringScroll) {
        __v8RenderPendingDuringScroll = false;
        renderAllImmediate();
      }
    }, 180);
  }

  function renderAll() {
    if (Date.now() < __v8ScrollingUntil) {
      __v8RenderPendingDuringScroll = true;
      return;
    }
    renderAllImmediate();
  }

  function renderAllImmediate() {
    const isDispatcherReportMode = state.remote.kind === 'dispatcher-report';
    const isCustomerDirectoryMode = state.remote.kind === 'customer-directory';
    const isRemotePanelMode = isDispatcherReportMode || isCustomerDirectoryMode;
    const isMyCancelKcMode = state.remote.kind === 'my-cancel-kc';
    const isMyCancelNfMode = state.remote.kind === 'my-cancel-nf';
    const isMyClarifyMode = state.remote.kind === 'my-clarify';
    syncAutoCleanupMenuLabel();
    syncSidebarActiveState();
    const titleNode = document.querySelector(`#${HOST_ID} .page-title`);
    if (titleNode) {
      let pageTitle = 'Главная';
      if (isDispatcherReportMode) pageTitle = 'Статистика по диспетчерам';
      else if (isCustomerDirectoryMode) pageTitle = 'Поиск карточки клиента';
      else if (isMyCancelKcMode) pageTitle = 'Мои отмены КЦ';
      else if (isMyCancelNfMode) pageTitle = 'Мои отмены НФ';
      else if (isMyClarifyMode) pageTitle = 'Мои уточнения';
      else if (state.remote.kind === 'moderation') pageTitle = 'Модерации';
      else if (state.remote.kind === 'bulk-phones') pageTitle = 'Поиск по номеру';
      titleNode.textContent = pageTitle;
    }

    let sourceRows;
    if (isRemotePanelMode) {
      sourceRows = [];
    } else if (!state.remote.kind) {
      sourceRows = state.rows;
    } else if (Array.isArray(state.remote.rows)) {
      if (state.remote.kind === 'moderation' && state.remote.rows.length === 0) {
        sourceRows = dedupeModerationRows((state.rows || []).filter((row) => row.statusKey === 'mod'));
      } else {
        sourceRows = state.remote.rows;
      }
    } else if (state.remote.kind === 'moderation') {
      sourceRows = dedupeModerationRows((state.rows || []).filter((row) => row.statusKey === 'mod'));
    } else {
      sourceRows = [];
    }

    const rows = state.remote.kind === 'bulk-phones'
      ? (Array.isArray(sourceRows) ? sourceRows.slice() : [])
      : hydrateClarifyRouteState(sortRowsForDisplay(filteredRows(dedupeRowsById(sourceRows))));
    const statsRows = isRemotePanelMode
      ? filteredRows(state.rows || [])
      : (state.remote.kind === 'bulk-phones'
        ? dedupeRowsById((sourceRows || []).filter((row) => row && !row.isBulkHeader))
        : rows);
    renderStats(statsRows);
    renderCards(rows);
    if (!isRemotePanelMode && state.remote.kind !== 'bulk-phones') {
      refreshClarifyRouteStatesInBackground(rows);
    }
    const modBadge = document.querySelector(`#${HOST_ID} .mod-n`);
    if (modBadge) {
      if (Number.isFinite(state.moderationCount) && state.moderationCount >= 0) {
        modBadge.textContent = String(state.moderationCount);
      } else if (!normalizeText(modBadge.textContent || '')) {
        modBadge.textContent = '…';
      }
    }
    const badge = document.getElementById('filterBadge');
    const filterBtnNode = document.getElementById('filterBtn');
    const activeFilters = Object.values(state.filters).filter(Boolean).length;
    if (badge) {
      badge.textContent = '';
      badge.classList.remove('show');
    }
    if (filterBtnNode) {
      filterBtnNode.classList.toggle('has-filters', activeFilters > 0);
    }

    const resetBtn = document.getElementById('tmNativeResetBtn');
    const bulkProgress = document.getElementById('tmBulkTopProgress');
    const bulkHideBtn = document.getElementById('tmBulkHideBtn');
    const bulkRestoreBtn = document.getElementById('tmBulkRestoreBtn');
    const bulkCloseBtn = document.getElementById('tmBulkCloseBtn');
    const filterPageBox = document.getElementById('tmFilterPageBox');
    const filterPageInput = document.getElementById('tmFilterPageInput');
    const filterPageHint = document.getElementById('tmFilterPageHint');
    if (resetBtn) {
      const idFilled = Boolean(normalizeText(document.getElementById('tmSearchInput')?.value || ''));
      const moderationMode = state.remote.kind === 'moderation';
      const serverFilterMode = state.remote.kind === 'filter';
      const bulkPhonesMode = state.remote.kind === 'bulk-phones';
      const dispatcherMode = state.remote.kind === 'dispatcher-report';
      const customerMode = state.remote.kind === 'customer-directory';
      const personalMode = isPersonalRequestsMode(state.remote.kind);
      resetBtn.classList.toggle('show', dispatcherMode || customerMode || personalMode || idFilled || moderationMode || serverFilterMode || bulkPhonesMode);
    }
    const hiddenBulkControlsVisible = hasHiddenBulkPhones() && state.remote.kind !== 'bulk-phones';
    const bulkHideVisible = state.remote.kind === 'bulk-phones' && !state.remote.loading && Array.isArray(state.remote.rows);
    const fbar = document.querySelector(`#${HOST_ID} .fbar`);
    if (fbar) {
      fbar.classList.toggle('has-hidden-bulk-controls', hiddenBulkControlsVisible);
      fbar.classList.toggle('has-visible-bulk-hide', bulkHideVisible);
    }
    if (bulkHideBtn) {
      bulkHideBtn.classList.toggle('show', bulkHideVisible);
    }
    if (bulkProgress) {
      const showProgress = Boolean(
        state.remote.kind === 'bulk-phones'
        && state.remote.loading
        && Array.isArray(state.remote.rows)
        && state.remote.rows.some((row) => row?.isBulkHeader)
      );
      bulkProgress.classList.toggle('show', showProgress);
      if (showProgress) {
        const done = Math.min(Number(state.remote.bulkPhoneDone || 0), Number(state.remote.bulkPhoneTotal || 0));
        const total = Number(state.remote.bulkPhoneTotal || 0);
        const textNode = bulkProgress.querySelector('.bulk-top-progress-text');
        if (textNode) textNode.textContent = `Поиск номеров: ${done}/${total}`;
      }
    }
    if (bulkRestoreBtn) {
      bulkRestoreBtn.classList.toggle('show', hiddenBulkControlsVisible);
    }
    if (bulkCloseBtn) {
      bulkCloseBtn.classList.toggle('show', hiddenBulkControlsVisible);
    }
    if (filterPageBox) {
      const pagedMode = state.remote.kind === 'filter' || isPersonalRequestsMode(state.remote.kind);
      filterPageBox.classList.toggle('show', pagedMode);
      if (!pagedMode && filterPageInput instanceof HTMLInputElement && filterPageInput.value) {
        filterPageInput.value = '';
      }
      if (filterPageHint) {
        if (!pagedMode) {
          filterPageHint.textContent = 'Страницы: —';
        } else if (state.remote.filterTotalLoading) {
          filterPageHint.textContent = `Страница ${Math.max(1, Number(state.remote.filterPage || 1))}. Ищу последнюю...`;
        } else {
          const total = Math.max(1, Number(state.remote.filterTotalPages || 1));
          const current = Math.max(1, Number(state.remote.filterPage || 1));
          filterPageHint.textContent = `Страница ${current} из ${total}`;
        }
      }
      const filterPagePrevBtn = document.getElementById('tmFilterPagePrev');
      const filterPageNextBtn = document.getElementById('tmFilterPageNext');
      const curPageNav = Math.max(1, Number(state.remote.filterPage || 1));
      const totalPagesNav = Number(state.remote.filterTotalPages || 0);
      if (filterPagePrevBtn instanceof HTMLButtonElement) {
        filterPagePrevBtn.disabled = !pagedMode || curPageNav <= 1;
      }
      if (filterPageNextBtn instanceof HTMLButtonElement) {
        // Во время фонового поиска последней страницы общее число ещё неизвестно —
        // не блокируем «вперёд».
        const totalKnownNav = !state.remote.filterTotalLoading && totalPagesNav > 0;
        filterPageNextBtn.disabled = !pagedMode || (totalKnownNav && curPageNav >= totalPagesNav);
      }
    }
    updateBulkPhonesButtonUi();
  }

  function syncFromNative() {
    // Пока вкладка свёрнута/в фоне — не делаем тяжёлый обход таблицы и перерисовку.
    // Запоминаем, что нужно синкнуться, и доделаем это при возврате на вкладку.
    if (typeof document !== 'undefined' && document.hidden) {
      state.syncPendingWhileHidden = true;
      return;
    }
    state.syncPendingWhileHidden = false;
    hydrateCityFilterSelectFromNative();
    hydrateAuthorFilterSelectFromNative();
    const parsedNativeRows = dedupeRowsById(parseRowsFromNativeTable());
    const nativeRows = !state.remote.kind
      ? hydrateModerationCallStates(parsedNativeRows)
      : parsedNativeRows;

    // Main list can span multiple native pages (30 per page).
    // If current page is full of own green-marked requests, load subsequent pages
    // until a page has less than 30 own green rows.
    if (!state.remote.kind && !state.filters.id) {
      const { table, tbody } = tableContext();
      const ownGreenCount = table && tbody ? countOwnGreenRowsInTable(table, tbody) : 0;
      if (ownGreenCount >= 30) {
        const existingRows = Array.isArray(state.rows) ? state.rows : [];
        {
          const prevRows = Array.isArray(existingRows) ? existingRows : [];
          const nextRows = mergeMainRowsWithExisting(nativeRows, prevRows, { carryMissing: true });
          syncMainModerationArrivalStateFromRows(nextRows, prevRows);
          state.rows = nextRows;
        }
        renderAll();
        refreshModerationCallStatesInBackground(state.rows);

        const signature = `${buildRowsSignature(nativeRows)}|green:${ownGreenCount}`;
        const now = Date.now();
        if (signature === String(state.mainScanSig || '') && (now - Number(state.mainScanAt || 0)) < 7000) {
          return;
        }
        void extendMainRowsAcrossPages(nativeRows, ownGreenCount, signature);
        return;
      }
    }

    {
      const prevRows = Array.isArray(state.rows) ? state.rows : [];
      const nextRows = mergeMainRowsWithExisting(nativeRows, prevRows, { carryMissing: false });
      syncMainModerationArrivalStateFromRows(nextRows, prevRows);
      state.rows = nextRows;
    }
    renderAll();
    if (!state.remote.kind) {
      refreshModerationCallStatesInBackground(state.rows);
    }
  }

  function ensureMainModerationCallStatesInBackground() {
    if (state.remote.kind) return;
    if (!Array.isArray(state.rows) || !state.rows.length) {
      syncFromNative();
      return;
    }
    const beforeSig = (state.rows || [])
      .map((row) => `${normalizeRequestId(row?.id || '')}:${Number(row?.moderationCallCheckedAt || 0)}:${normalizeText(row?.moderationCallValue || '')}`)
      .join('|');
    state.rows = hydrateModerationCallStates(state.rows);
    const afterSig = (state.rows || [])
      .map((row) => `${normalizeRequestId(row?.id || '')}:${Number(row?.moderationCallCheckedAt || 0)}:${normalizeText(row?.moderationCallValue || '')}`)
      .join('|');
    if (beforeSig !== afterSig) renderAll();
    refreshModerationCallStatesInBackground(state.rows);
  }

  function scheduleSync() {
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(syncFromNative, 120);
  }

  function bindNativeObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    const { tbody } = tableContext();
    if (!tbody) return;
    state.observer = new MutationObserver(() => scheduleSync());
    state.observer.observe(tbody, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }

  function applyFiltersFromUI(section = 'all') {
    const useMain = filterSectionUsesMain(section);
    const useAddress = filterSectionUsesAddress(section);
    state.filters.id = normalizeText(document.getElementById('tmSearchInput')?.value).toLowerCase();
    if (useMain) {
      const citySelect = document.getElementById('tmFilterCity');
      if (citySelect instanceof HTMLSelectElement) {
        const cityOption = citySelect.options[citySelect.selectedIndex];
        const cityText = normalizeText(cityOption?.textContent || '');
        const cityValue = normalizeText(citySelect.value || '');
        state.filters.city = cityValue ? cityText.toLowerCase() : '';
      } else {
        state.filters.city = normalizeText(citySelect?.value).toLowerCase();
      }
      state.filters.status = normalizeText(document.getElementById('tmFilterStatus')?.value).toLowerCase();
      state.filters.type = normalizeText(document.getElementById('tmFilterType')?.value).toLowerCase();
      const filterPhoneValue = document.getElementById('tmFilterPhone')?.value || '';
      state.filters.phone = getFilterPhoneNationalDigits(filterPhoneValue).length
        ? formatFilterPhone(filterPhoneValue).toLowerCase()
        : '';
      const authorSelect = document.getElementById('tmFilterAuthor');
      if (authorSelect instanceof HTMLSelectElement) {
        const authorOption = authorSelect.options[authorSelect.selectedIndex];
        const authorText = normalizeText(authorOption?.textContent || '');
        const authorValue = normalizeText(authorSelect.value || '');
        state.filters.author = authorValue ? authorText.toLowerCase() : '';
      } else {
        state.filters.author = normalizeText(authorSelect?.value).toLowerCase();
      }
    } else {
      state.filters.city = '';
      state.filters.status = '';
      state.filters.type = '';
      state.filters.phone = '';
      state.filters.author = '';
    }

    if (useAddress) {
      state.filters.addressCity = normalizeText(document.getElementById('tmFilterAddressCity')?.value).toLowerCase();
      state.filters.street = normalizeText(document.getElementById('tmFilterStreet')?.value).toLowerCase();
      state.filters.house = normalizeText(document.getElementById('tmFilterHouse')?.value).toLowerCase();
      state.filters.flat = normalizeText(document.getElementById('tmFilterFlat')?.value).toLowerCase();
    } else {
      state.filters.addressCity = '';
      state.filters.street = '';
      state.filters.house = '';
      state.filters.flat = '';
    }
  }

  function resetFilters() {
    [
      'tmSearchInput',
      'tmFilterCity',
      'tmFilterStatus',
      'tmFilterType',
      'tmFilterPhone',
      'tmFilterAuthor',
      'tmFilterAddressCity',
      'tmFilterStreet',
      'tmFilterHouse',
      'tmFilterFlat',
      'tmFilterPageInput'
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'tmFilterPhone' ? '+7' : '';
    });

    state.filters = { id: '', city: '', status: '', type: '', phone: '', author: '', addressCity: '', street: '', house: '', flat: '' };
    state.remote.kind = '';
    state.remote.id = '';
    state.remote.rows = null;
    state.remote.loading = false;
    state.remote.bulkPhoneTotal = 0;
    state.remote.bulkPhoneDone = 0;
    state.remote.filterBaseUrl = '';
    state.remote.filterSection = 'all';
    state.remote.filterPage = 1;
    state.remote.filterTotalPages = 0;
    state.remote.filterTotalLoading = false;
    const badge = document.getElementById('filterBadge');
    if (badge) badge.classList.remove('show');
    requestTopOnNextCardsRender();
    syncAllEnhancedFilterDropdowns();
    renderAll();
  }

  function closeAllFilterDropdowns(exceptWrap = null) {
    document.querySelectorAll(`#${HOST_ID} .tm-dd.open`).forEach((node) => {
      if (exceptWrap && node === exceptWrap) return;
      node.classList.remove('open');
    });
  }

  function syncEnhancedFilterDropdown(selectEl) {
    if (!(selectEl instanceof HTMLSelectElement)) return;
    const wrap = document.querySelector(`#${HOST_ID} .tm-dd[data-for="${selectEl.id}"]`);
    if (!(wrap instanceof HTMLElement)) return;
    const label = wrap.querySelector('.tm-dd-label');
    if (label) {
      const selected = selectEl.options[selectEl.selectedIndex];
      const hasValue = normalizeText(selectEl.value) !== '';
      const placeholder = normalizeText(selectEl.dataset.placeholder || '');
      label.textContent = hasValue
        ? (normalizeText(selected?.textContent) || '—')
        : (placeholder || normalizeText(selected?.textContent) || '—');
      label.classList.toggle('is-ph', !hasValue);
    }
    wrap.querySelectorAll('.tm-dd-item').forEach((item) => {
      const value = normalizeText(item.getAttribute('data-value') || '');
      item.classList.toggle('is-active', value === normalizeText(selectEl.value));
    });
  }

  function syncAllEnhancedFilterDropdowns() {
    document.querySelectorAll(`#${HOST_ID} select.fi-select-native`).forEach((node) => {
      if (node instanceof HTMLSelectElement) syncEnhancedFilterDropdown(node);
    });
  }

  function rebuildEnhancedFilterSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!(select instanceof HTMLSelectElement)) return;
    const oldWrap = document.querySelector(`#${HOST_ID} .tm-dd[data-for="${selectId}"]`);
    if (oldWrap && oldWrap.parentElement) oldWrap.parentElement.removeChild(oldWrap);
    delete select.dataset.enhanced;
    select.classList.remove('fi-select-native');
    enhanceFilterSelect(selectId);
  }

  function normalizeMatchText(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[()]/g, ' ')
      .replace(/[^a-zа-я0-9\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCityFilterText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function toComparableCityFilterText(value) {
    return normalizeCityFilterText(value).toLowerCase().replace(/ё/g, 'е');
  }

  function tokenizeComparableCityFilterText(value) {
    return toComparableCityFilterText(value)
      .split(/[\s\-–—()]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function buildCityFilterSuggestions(select, query) {
    if (!(select instanceof HTMLSelectElement)) return [];
    const normalizedQuery = toComparableCityFilterText(query);
    const queryTokens = normalizedQuery
      ? normalizedQuery.split(/[\s\-–—]+/).map((token) => token.trim()).filter(Boolean)
      : [];

    const options = Array.from(select.options || [])
      .map((option, index) => ({
        value: String(option.value || ''),
        text: normalizeCityFilterText(option.textContent || option.text || ''),
        comparable: toComparableCityFilterText(option.textContent || option.text || ''),
        selected: option.selected,
        index
      }))
      .filter((option) => option.value && option.text && !/^выберите/i.test(option.text));

    const ranked = options
      .map((option) => {
        let score = option.selected ? 50 : 0;
        if (!normalizedQuery) {
          score += option.selected ? 1000 : 100;
          return { ...option, score };
        }

        const bracketMatch = option.comparable.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
        const mainPart = bracketMatch ? bracketMatch[1].trim() : option.comparable;
        const bracketPart = bracketMatch ? bracketMatch[2].trim() : '';

        const scoreTextAgainstQuery = (text) => {
          if (!text) return 0;
          if (text === normalizedQuery) return 3000;
          if (text.startsWith(normalizedQuery)) return 2500;

          const words = tokenizeComparableCityFilterText(text);
          if (!words.length) return 0;
          if (words.some((word) => word === normalizedQuery)) return 2300;
          if (words.some((word) => word.startsWith(normalizedQuery))) return 2000;

          if (queryTokens.length > 1) {
            for (let i = 0; i <= words.length - queryTokens.length; i += 1) {
              let sequenceMatches = true;
              for (let j = 0; j < queryTokens.length; j += 1) {
                if (!words[i + j].startsWith(queryTokens[j])) {
                  sequenceMatches = false;
                  break;
                }
              }
              if (sequenceMatches) return 1800;
            }
          }
          return 0;
        };

        const mainScore = scoreTextAgainstQuery(mainPart);
        const bracketScore = bracketPart ? scoreTextAgainstQuery(bracketPart) : 0;
        if (mainScore > 0) {
          score += mainScore;
        } else if (bracketScore > 0) {
          score += bracketScore - 700;
        } else {
          return null;
        }
        return { ...option, score };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return normalizedQuery ? ranked.slice(0, 80) : ranked.slice(0, 120);
  }

  function selectOptionsMatch(select, options) {
    if (!(select instanceof HTMLSelectElement)) return false;
    if (!Array.isArray(options) || select.options.length !== options.length) return false;
    for (let index = 0; index < options.length; index += 1) {
      const current = select.options[index];
      const next = options[index];
      if (
        String(current?.value || '') !== String(next?.value || '')
        || normalizeText(current?.textContent || '') !== normalizeText(next?.text || '')
      ) {
        return false;
      }
    }
    return true;
  }

  function replaceSelectOptions(select, options, selectedValue) {
    if (!(select instanceof HTMLSelectElement) || !Array.isArray(options)) return;
    const fragment = document.createDocumentFragment();
    options.forEach((option) => {
      const node = document.createElement('option');
      node.value = String(option?.value || '');
      node.textContent = normalizeText(option?.text || '');
      fragment.appendChild(node);
    });
    select.replaceChildren(fragment);
    const normalizedSelectedValue = normalizeText(selectedValue || '');
    select.value = normalizedSelectedValue && options.some((option) => normalizeText(option.value) === normalizedSelectedValue)
      ? normalizedSelectedValue
      : '';
  }

  function hydrateCityFilterSelectFromNative() {
    const custom = document.getElementById('tmFilterCity');
    const native = findNativeCityFilterSelect();
    if (!(custom instanceof HTMLSelectElement) || !(native instanceof HTMLSelectElement)) return;
    const currentValue = normalizeText(custom.value || '');

    const options = Array.from(native.options)
      .map((opt) => ({
        value: String(opt.value || ''),
        text: normalizeText(opt.textContent || '')
      }))
      .filter((option) => option.text && !/^[,.;\s]+$/.test(option.text));
    if (selectOptionsMatch(custom, options)) return;

    replaceSelectOptions(custom, options, currentValue);
    if (custom.dataset.enhanced === '1') {
      rebuildEnhancedFilterSelect('tmFilterCity');
    }
  }

  function hydrateAuthorFilterSelectFromNative() {
    const custom = document.getElementById('tmFilterAuthor');
    const native = findNativeAuthorFilterSelect();
    if (!(custom instanceof HTMLSelectElement) || !(native instanceof HTMLSelectElement)) return;
    const currentValue = normalizeText(custom.value || '');

    const options = Array.from(native.options)
      .map((opt) => ({
        value: String(opt.value || ''),
        text: normalizeText(opt.textContent || '')
      }))
      .filter((option) => option.text);
    if (selectOptionsMatch(custom, options)) return;

    replaceSelectOptions(custom, options, currentValue);
    if (custom.dataset.enhanced === '1') {
      rebuildEnhancedFilterSelect('tmFilterAuthor');
    }
  }

  function enhanceFilterSelect(selectId) {
    const select = document.getElementById(selectId);
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.dataset.enhanced === '1') {
      syncEnhancedFilterDropdown(select);
      return;
    }
    select.dataset.enhanced = '1';
    select.classList.add('fi-select-native');
    const firstEmpty = Array.from(select.options).find((opt) => normalizeText(opt.value) === '');
    if (firstEmpty) {
      select.dataset.placeholder = normalizeText(firstEmpty.textContent) || '';
    }

    const wrap = document.createElement('div');
    wrap.className = 'tm-dd';
    wrap.setAttribute('data-for', selectId);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tm-dd-btn';
    btn.innerHTML = '<span class="tm-dd-label">—</span><i class="ti ti-chevron-down tm-dd-caret" aria-hidden="true"></i>';

    const menu = document.createElement('div');
    menu.className = 'tm-dd-menu';

    let searchInput = null;
    let cityItemsHost = null;
    let cityRenderItems = null;
    if (selectId === 'tmFilterCity' || selectId === 'tmFilterAuthor') {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'tm-dd-search-wrap';
      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'tm-dd-search';
      search.placeholder = selectId === 'tmFilterAuthor' ? 'Поиск автора...' : 'Поиск города...';
      searchWrap.appendChild(search);
      menu.appendChild(searchWrap);
      searchInput = search;
      search.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      cityItemsHost = document.createElement('div');
      cityItemsHost.className = 'tm-dd-items';
      menu.appendChild(cityItemsHost);

      cityRenderItems = (query = '') => {
        if (!(cityItemsHost instanceof HTMLElement)) return;
        cityItemsHost.innerHTML = '';
        const suggestions = buildCityFilterSuggestions(select, query);
        suggestions.forEach((entry) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'tm-dd-item';
          item.setAttribute('data-value', entry.value);
          item.textContent = entry.text;
          item.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentValue = normalizeText(select.value || '');
            const nextValue = normalizeText(entry.value || '');
            select.value = currentValue === nextValue ? '' : entry.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncEnhancedFilterDropdown(select);
            wrap.classList.remove('open');
          });
          cityItemsHost.appendChild(item);
        });
      };
    }

    if (selectId === 'tmFilterCity' || selectId === 'tmFilterAuthor') {
      if (typeof cityRenderItems === 'function') cityRenderItems('');
    } else {
      Array.from(select.options).forEach((opt) => {
        if (normalizeText(opt.value) === '') return;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tm-dd-item';
        item.setAttribute('data-value', opt.value);
        item.textContent = normalizeText(opt.textContent);
        item.setAttribute('data-match', normalizeMatchText(item.textContent || ''));
        item.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const currentValue = normalizeText(select.value || '');
          const nextValue = normalizeText(opt.value || '');
          select.value = currentValue === nextValue ? '' : opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          syncEnhancedFilterDropdown(select);
          wrap.classList.remove('open');
        });
        menu.appendChild(item);
      });
    }

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = wrap.classList.contains('open');
      closeAllFilterDropdowns();
      if (!isOpen) {
        wrap.classList.add('open');
        if (searchInput instanceof HTMLInputElement) {
          searchInput.value = '';
          if (typeof cityRenderItems === 'function') {
            cityRenderItems('');
          } else {
            const allItems = Array.from(menu.querySelectorAll('.tm-dd-item'));
            allItems.forEach((el) => {
              if (el instanceof HTMLElement) el.style.display = '';
            });
          }
          setTimeout(() => {
            searchInput.focus();
          }, 0);
        }
      }
    });

    if (searchInput instanceof HTMLInputElement) {
      searchInput.addEventListener('input', () => {
        if (typeof cityRenderItems === 'function') {
          cityRenderItems(searchInput.value || '');
          return;
        }
        const needle = normalizeMatchText(searchInput.value || '');
        const items = Array.from(menu.querySelectorAll('.tm-dd-item'));
        items.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const hay = normalizeMatchText(node.getAttribute('data-match') || node.textContent || '');
          node.style.display = !needle || hay.includes(needle) ? '' : 'none';
        });
      });
      searchInput.addEventListener('keydown', (event) => {
        event.stopPropagation();
      });
    }

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    select.insertAdjacentElement('afterend', wrap);
    select.addEventListener('change', () => syncEnhancedFilterDropdown(select));
    syncEnhancedFilterDropdown(select);
  }

  function ensureIconFont() {
    if (document.getElementById(ICON_ID)) return;
    const link = document.createElement('link');
    link.id = ICON_ID;
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.31.0/dist/tabler-icons.min.css';
    document.head.appendChild(link);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root{
        --font-sans:"Segoe UI",Tahoma,Arial,sans-serif;
        --color-background-primary:#FFFFFF;
        --color-background-secondary:#F5F5F4;
        --color-background-tertiary:#ECEBE7;
        --color-border-secondary:#E4E2DA;
        --color-border-tertiary:#E4E2DA;
        --color-text-primary:#1C1B18;
        --color-text-secondary:#6B6963;
        --color-text-tertiary:#9B9A95;
      }
      #${HOST_ID}.theme-dark{
        --color-background-primary:#30302E;
        --color-background-secondary:#262624;
        --color-background-tertiary:#141413;
        --color-border-secondary:#4A4A46;
        --color-border-tertiary:#4A4A46;
        --color-text-primary:#f2f2ef;
        --color-text-secondary:#bdbbb5;
        --color-text-tertiary:#96948f;
      }
      .sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
      #${HOST_ID}{position:fixed;inset:0;z-index:2147483000;width:var(--tmv8-vw,100vw);height:var(--tmv8-vh,100vh);max-width:var(--tmv8-vw,100vw);max-height:var(--tmv8-vh,100vh);overflow:hidden}
      #${HOST_ID} *{box-sizing:border-box;margin:0;padding:0}
      #${HOST_ID} .shell{display:flex;height:var(--tmv8-vh,100vh);max-height:var(--tmv8-vh,100vh);width:var(--tmv8-vw,100vw);max-width:var(--tmv8-vw,100vw);font-family:var(--font-sans);background:var(--color-background-tertiary);border-radius:0;overflow:hidden;border:none;position:relative}
      #${HOST_ID} .tm-anim-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646}
      #${HOST_ID} .sb{width:56px;background:var(--color-background-primary);border-right:0.5px solid var(--color-border-tertiary);display:flex;flex-direction:column;flex-shrink:0;position:absolute;top:0;left:0;bottom:0;z-index:20;overflow:hidden;transition:width .22s ease;padding-bottom:68px}
      #${HOST_ID} .sb.open{width:228px}
      #${HOST_ID} .sb-backdrop{position:absolute;inset:0;background:rgba(20,20,20,.22);opacity:0;pointer-events:none;z-index:15;transition:opacity .18s ease}
      #${HOST_ID} .sb-backdrop.show{opacity:1;pointer-events:auto}
      #${HOST_ID} .legacy-settings-backdrop{position:fixed;inset:0;background:rgba(10,10,10,.38);opacity:0;pointer-events:none;z-index:2147483644;transition:opacity .18s ease}
      #${HOST_ID} .legacy-settings-backdrop.show{opacity:1;pointer-events:auto}
      #tm-script-settings-panel.tm-v8-centered{
        left:50%!important;
        top:50%!important;
        right:auto!important;
        bottom:auto!important;
        transform:translate(-50%,-50%)!important;
        transform-origin:center center!important;
        z-index:2147483645!important;
        width:min(360px,calc(100vw - 24px))!important;
        max-height:min(80vh,640px)!important;
        overflow:auto!important;
      }
      #tm-script-settings-panel.tm-v8-centered.tm-v8-forced-open{
        display:block!important;
        opacity:1!important;
        visibility:visible!important;
        pointer-events:auto!important;
      }
      .tm-v8-autoclean-centered{
        position:fixed!important;
        top:50%!important;
        left:50%!important;
        right:auto!important;
        bottom:auto!important;
        transform:translate(-50%,-50%)!important;
        z-index:2147483645!important;
        max-width:min(560px,calc(100vw - 24px))!important;
        width:auto!important;
        margin:0!important;
        background:transparent!important;
        box-shadow:none!important;
        border:0!important;
        padding:0!important;
      }
      #bulk-nf-clarify-friday-panel.tm-v8-autoclean-centered .bulk-nf-clarify-friday__card{box-shadow:none!important}
      #bulk-nf-clarify-warning.is-visible,#bulk-nf-clarify-monthly-warning.is-visible,#bulk-nf-clarify-friday-warning.is-visible{z-index:2147483646!important;display:flex!important}
      #tm-script-settings-btn{display:none!important}
      #${HOST_ID} .sb.collapsed .sb-label,#${HOST_ID} .sb.collapsed .sb-section,#${HOST_ID} .sb.collapsed .sb-user-text,#${HOST_ID} .sb.collapsed .sb-badge{display:none}
      #${HOST_ID} .sb.collapsed .sb-item{justify-content:flex-start;padding:7px 10px;margin:1px 6px}
      #${HOST_ID} .sb.collapsed .sb-settings{margin:0 6px}
      #${HOST_ID} .sb.collapsed .sb-settings{display:none}
      #${HOST_ID} .sb.collapsed .sb-autoclean{display:none}
      #${HOST_ID} .sb.collapsed .sb-user{justify-content:flex-start;align-items:center;padding:10px 12px;min-height:68px;height:68px}
      #${HOST_ID} .sb-logo{height:60px;display:flex;align-items:center;justify-content:center;border-bottom:0.5px solid var(--color-border-tertiary);cursor:pointer;flex-shrink:0}
      #${HOST_ID} .sb-logo-icon{width:30px;height:30px;background:#185FA5;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px;flex-shrink:0}
      #${HOST_ID} .sb-logo-icon:hover{background:#0C447C}
      #${HOST_ID} .sb-item{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:7px 10px;border-radius:7px;margin:1px 6px;min-height:34px;height:34px;font-size:13px;color:var(--color-text-secondary);cursor:pointer;text-decoration:none;white-space:nowrap;overflow:hidden}
      #${HOST_ID} .sb-item:hover{background:var(--color-background-secondary);color:var(--color-text-primary)}
      #${HOST_ID} .sb-item:focus,
      #${HOST_ID} .sb-item:focus-visible{outline:none;box-shadow:none}
      #${HOST_ID} .sb-item.active{background:#E6F1FB;color:#0C447C;font-weight:500}
      #${HOST_ID} .sb-item i{font-size:16px;flex-shrink:0;min-width:17px;width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;line-height:1;font-weight:400!important;transform:translateX(2px)}
      #${HOST_ID} .sb-settings{margin:0 6px;position:absolute;left:0;right:0;bottom:68px;height:34px}
      #${HOST_ID} .sb-autoclean{margin:0 6px;position:absolute;left:0;right:0;bottom:102px;height:34px}
      #${HOST_ID} .sb-theme-switch{position:absolute;left:6px;right:6px;bottom:136px;height:34px;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px}
      #${HOST_ID} .sb-autoclean-dot{position:absolute;left:50%;bottom:78px;width:10px;height:10px;border-radius:50%;transform:translateX(-50%);background:#ffd84a;box-shadow:0 0 0 0 rgba(255,216,74,.55);opacity:0;display:none;pointer-events:none;z-index:2}
      #${HOST_ID}.autoclean-unplanned .sb.collapsed .sb-autoclean-dot{display:block;opacity:1;animation:tm-autoclean-dot-pulse 1.8s ease-in-out infinite}
      #${HOST_ID}.autoclean-unplanned .sb:not(.collapsed) .sb-item.sb-autoclean{animation:tm-autoclean-row-pulse 1.8s ease-in-out infinite}
      #${HOST_ID} .sb-theme-label{font-size:12px;color:var(--color-text-secondary);white-space:nowrap}
      #${HOST_ID} .sb-theme-icon{font-size:16px;min-width:17px;width:17px;height:17px;display:inline-flex;align-items:center;justify-content:center;color:var(--color-text-secondary);transform:translateX(2px)}
      #${HOST_ID} .theme-switch{position:relative;display:inline-block;width:40px;height:22px;margin-left:auto;flex-shrink:0}
      #${HOST_ID} .theme-switch input{opacity:0;width:0;height:0;position:absolute}
      #${HOST_ID} .theme-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#b8c6d8;border:0.5px solid #94a6be;transition:.2s;border-radius:22px}
      #${HOST_ID} .theme-slider:before{position:absolute;content:'';height:16px;width:16px;left:2px;top:2px;background:#fff;transition:.2s;border-radius:50%}
      #${HOST_ID} .theme-switch input:checked + .theme-slider{background:#185FA5;border-color:#185FA5}
      #${HOST_ID} .theme-switch input:checked + .theme-slider:before{transform:translateX(18px)}
      #${HOST_ID} .sb.collapsed .sb-theme-switch{display:none}
      #${HOST_ID} .sb.collapsed .sb-theme-label{display:none}
      #${HOST_ID} .sb-label{overflow:hidden;text-overflow:ellipsis}
      #${HOST_ID} .sb-user{margin-top:0;padding:10px 12px;border-top:0.5px solid var(--color-border-tertiary);display:flex;align-items:center;gap:8px;overflow:hidden;flex-shrink:0;min-height:68px;height:68px;position:absolute;left:0;right:0;bottom:0;background:var(--color-background-primary);z-index:2}
      #${HOST_ID} .sb-user-text{overflow:hidden;min-width:0;flex:1 1 auto}
      #${HOST_ID} .sb-logout{position:absolute;right:10px;top:50%;transform:translateY(-50%);flex-shrink:0;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;color:var(--color-text-secondary);text-decoration:none;cursor:pointer;transition:background .14s,color .14s}
      #${HOST_ID} .sb-logout:hover{background:var(--color-background-secondary);color:#d83340}
      #${HOST_ID} .sb-logout i{font-size:17px}
      #${HOST_ID} .sb.collapsed .sb-logout{display:none}
      #${HOST_ID} .sb-uname{font-size:11px;font-weight:500;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #${HOST_ID} .sb-role{font-size:10px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #${HOST_ID} .sb-contract{font-size:10px;color:var(--color-text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
      #${HOST_ID} .sb-av{width:28px;height:28px;border-radius:50%;background:#E6F1FB;color:#0C447C;font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      #${HOST_ID} .main{flex:1;display:flex;flex-direction:column;min-width:0;margin-left:56px;overflow:hidden}
      #${HOST_ID} .topbar{background:var(--color-background-primary);border-bottom:0.5px solid var(--color-border-tertiary);padding:0 18px;height:60px;display:flex;align-items:center;gap:10px;flex-shrink:0}
      #${HOST_ID} .page-title{font-size:20px;font-weight:600;color:var(--color-text-primary)}
      #${HOST_ID} .sp{flex:1}
      #${HOST_ID} .btn-mod{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#f4d7db;border:0.5px solid #d06b74;border-radius:8px;padding:0 13px;height:36px;font-size:14px;color:#7c1e27;cursor:pointer;font-weight:600;white-space:nowrap;box-sizing:border-box;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 1px 3px rgba(80,20,28,.08)}
      #${HOST_ID} .btn-mod:hover{background:#efc7cd;border-color:#c95e68}
      #${HOST_ID} .mod-n{background:#d83340;color:#fff;border-radius:20px;padding:1px 8px;font-size:12px;font-weight:600;line-height:1.1;min-width:22px;text-align:center}
      #${HOST_ID} .btn-new{background:#185FA5;color:#fff;border:0.5px solid transparent;border-radius:8px;padding:0 14px;height:36px;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px;font-weight:500;white-space:nowrap;box-sizing:border-box}
      #${HOST_ID} .btn-new:hover{background:#0C447C;border-color:#0C447C}
      #${HOST_ID} .btn-new i{font-size:13px}
      #${HOST_ID} .kpi-strip{display:flex;gap:12px;padding:12px 18px;background:var(--color-background-primary);border-bottom:0.5px solid var(--color-border-tertiary);flex-shrink:0}
      #${HOST_ID} .kpi{position:relative;flex:1;background:var(--color-background-secondary);border:0.5px solid #D3D1C7;border-radius:11px;padding:12px 14px;display:flex;align-items:center;gap:11px}
      #${HOST_ID} .kpi.kpi-day{flex:1.35}
      #${HOST_ID} .kpi-main{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;min-width:0}
      #${HOST_ID} .kpi-text{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:3px;min-width:0;padding:0}
      #${HOST_ID} .kpi:not(.kpi-day) .kpi-text{flex:1;align-items:center;text-align:center;gap:5px}
      #${HOST_ID} .kpi:not(.kpi-day) .kpi-label{position:absolute;top:7px;left:0;right:0;text-align:center;pointer-events:none}
      #${HOST_ID} .kpi:not(.kpi-day) .kpi-val{position:absolute;left:0;right:0;top:calc(50% + 8px);transform:translateY(-50%);align-items:baseline;justify-content:center;text-align:center;gap:6px}
      #${HOST_ID} .kpi-ico{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;border:0.5px solid rgba(40,52,67,.07);box-sizing:border-box}
      #${HOST_ID} .ic-blue{background:#E6F1FB;color:#185FA5}
      #${HOST_ID} .ic-red{background:#fde8ea;color:#d83340}
      #${HOST_ID} .ic-green{background:#eaf7ea;color:#2e7d32}
      #${HOST_ID} .ic-amber{background:#fff4d9;color:#9a6b00}
      #${HOST_ID} .kpi-label{font-size:12px;color:var(--color-text-secondary);text-transform:none;letter-spacing:0;margin:0;line-height:1.05;font-weight:600}
      #${HOST_ID} .kpi-val{font-size:19px;font-weight:600;color:var(--color-text-primary);line-height:1.12}
      #${HOST_ID} .kpi-text .kpi-val{display:inline-flex;align-items:baseline;justify-content:center;gap:6px}
      #${HOST_ID} .kpi-sub{display:inline-flex;align-items:baseline;justify-content:center;gap:2px;font-size:13px;font-weight:600;color:#708199;line-height:1.1;white-space:nowrap;text-align:center}
      #${HOST_ID} .kpi-sub-tail{font-size:12px;font-weight:500;color:#8a98ad}
      #${HOST_ID} #tmKpiAcceptedNote{font-size:12px;font-weight:500;color:#8a98ad}
      #${HOST_ID} #tmKpiCanceledPercent{font-weight:500}
      #${HOST_ID} .kpi-day-wrap{position:relative;display:block;align-self:stretch;flex:1;min-width:0;padding-right:0}
      #${HOST_ID} .kpi-day-head{display:block}
      #${HOST_ID} .kpi-day-title{
        position:absolute;
        top:7px;
        left:0;
        right:0;
        margin:0;
        font-size:12px;
        font-weight:600;
        letter-spacing:0;
        text-transform:none;
        color:var(--color-text-secondary);
        line-height:1.05;
        text-align:center;
        pointer-events:none;
      }
      #${HOST_ID} .kpi-day-line{position:absolute;left:0;right:0;top:calc(50% + 8px);transform:translateY(-50%);display:flex;align-items:baseline;justify-content:flex-start;gap:6px;min-width:0;text-align:left;white-space:nowrap}
      #${HOST_ID} .kpi-day .kpi-val{flex-shrink:0}
      #${HOST_ID} .kpi-day-sub{display:inline-flex;align-items:baseline;justify-content:flex-start;gap:2px;font-size:12px;font-weight:500;color:#8a98ad;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;max-width:100%}
      #${HOST_ID} .kpi-report-btn{position:absolute;top:-6px;right:-10px;border:0.5px solid #d8dde7;background:#fff;border-radius:7px;padding:5px 11px;font-size:13px;color:#185FA5;cursor:pointer;font-family:var(--font-sans);line-height:1.1}
      #${HOST_ID} .kpi-report-btn:disabled{opacity:.45;cursor:not-allowed}
      #${HOST_ID} .fbar{padding:12px 18px;display:flex;align-items:center;gap:10px;border-bottom:0.5px solid var(--color-border-tertiary);background:var(--color-background-primary);flex-shrink:0;position:relative}
      #${HOST_ID} .srch{display:flex;align-items:center;gap:8px;background:var(--color-background-secondary);border:0.5px solid #D3D1C7;border-radius:8px;padding:8px 13px;width:290px;box-shadow:0 1px 0 rgba(255,255,255,.65) inset;transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease}
      #${HOST_ID} .srch:focus-within{background:var(--color-background-secondary);border-color:#5C9BD1;box-shadow:0 0 0 3px rgba(24,95,165,.12),0 1px 0 rgba(255,255,255,.65) inset}
      #${HOST_ID} .srch i{font-size:15px;color:var(--color-text-tertiary);flex-shrink:0}
      #${HOST_ID} .srch input{border:none;background:none;font-size:14px;color:var(--color-text-primary);outline:none;width:100%;font-family:var(--font-sans)}
      #${HOST_ID} .srch input::placeholder{color:var(--color-text-tertiary)}
      #${HOST_ID} .btn-filter{display:inline-flex;align-items:center;gap:6px;background:#185FA5;border:0.5px solid #185FA5;border-radius:8px;padding:8px 13px;font-size:14px;color:#fff;cursor:pointer;font-weight:500;white-space:nowrap;transition:all .15s;order:5;margin-left:auto;box-shadow:0 1px 0 rgba(255,255,255,.16) inset,0 1px 3px rgba(24,95,165,.18)}
      #${HOST_ID} .btn-filter i{font-size:14px}
      #${HOST_ID} .btn-filter:hover{background:#0C447C;border-color:#0C447C;color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 4px 12px rgba(24,95,165,.22)}
      #${HOST_ID} .btn-filter.active,
      #${HOST_ID} .btn-filter.has-filters{background:#0C447C;border-color:#0C447C;color:#fff}
      #${HOST_ID} .btn-filter.active:hover,
      #${HOST_ID} .btn-filter.has-filters:hover{background:#093966;border-color:#093966;color:#fff}
      #${HOST_ID} .btn-reset-id{display:none;align-items:center;gap:6px;background:#fff;border:0.5px solid #e6b8bc;border-radius:8px;padding:8px 13px;font-size:13px;color:#a93842;cursor:pointer;font-weight:500;white-space:nowrap;order:2}
      #${HOST_ID} .btn-reset-id.show{display:inline-flex}
      #${HOST_ID} .btn-reset-id:hover{background:#fdeff1}
      #${HOST_ID} .btn-bulk-hide{order:4;margin-left:auto}
      #${HOST_ID} .btn-bulk-restore,
      #${HOST_ID} .btn-bulk-close{order:3;background:var(--color-background-primary);border-color:var(--color-border-secondary);color:var(--color-text-secondary)}
      #${HOST_ID} .btn-bulk-restore.show{margin-left:auto}
      #${HOST_ID} .fbar.has-hidden-bulk-controls .btn-filter,
      #${HOST_ID} .fbar.has-visible-bulk-hide .btn-filter{margin-left:0}
      #${HOST_ID} .btn-bulk-restore:hover,
      #${HOST_ID} .btn-bulk-close:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .bulk-top-progress{display:none;align-items:center;gap:7px;height:36px;padding:0 10px;border:0.5px dashed var(--color-border-secondary);border-radius:8px;background:var(--color-background-secondary);color:var(--color-text-secondary);font-size:13px;font-weight:600;white-space:nowrap;order:2}
      #${HOST_ID} .bulk-top-progress.show{display:flex}
      #${HOST_ID} .bulk-top-spinner{width:18px;height:18px;border-radius:50%;border:2px solid #d6d4cd;border-top-color:#8d918f;animation:tm-cards-loading-spin .8s linear infinite;box-sizing:border-box;flex-shrink:0}
      #${HOST_ID} .btn-bulk-phones{display:inline-flex;align-items:center;justify-content:center;gap:4px;background:#dff1e2;border:0.5px solid #76bc83;border-radius:8px;padding:0 10px;height:36px;width:186px;font-size:14px;color:#1f6b34;cursor:pointer;font-weight:600;white-space:nowrap;box-sizing:border-box;box-shadow:0 1px 0 rgba(255,255,255,.72) inset,0 1px 3px rgba(24,72,36,.09);transition:background-color .28s ease,border-color .28s ease,color .28s ease,opacity .28s ease,filter .28s ease,box-shadow .28s ease}
      #${HOST_ID} .btn-bulk-phones:hover{background:#cfe8d4;border-color:#66ad74}
      #${HOST_ID} .btn-bulk-phones:disabled,
      #${HOST_ID} .btn-bulk-phones.is-disabled{opacity:.72;cursor:not-allowed;filter:saturate(.82);background:#edf3ee;border-color:#b9d0be;color:#6c8b72;box-shadow:0 1px 0 rgba(255,255,255,.62) inset,0 1px 2px rgba(24,72,36,.04)}
      #${HOST_ID} .btn-bulk-phones:disabled:hover,
      #${HOST_ID} .btn-bulk-phones.is-disabled:hover{background:#edf3ee;border-color:#b9d0be}
      #${HOST_ID} .btn-bulk-phones,
      #${HOST_ID} .btn-mod,
      #${HOST_ID} .btn-new,
      #${HOST_ID} .btn-filter,
      #${HOST_ID} .btn-reset-id,
      #${HOST_ID} .btn-bulk-hide,
      #${HOST_ID} .btn-bulk-restore,
      #${HOST_ID} .btn-bulk-close,
      #${HOST_ID} .kpi-report-btn{
        transition:background-color .28s ease,border-color .28s ease,color .28s ease,box-shadow .28s ease,opacity .28s ease,filter .28s ease;
      }
      #${HOST_ID} .btn-bulk-phones .bulk-btn-label-wrap{position:relative;display:block;flex:0 0 124px;height:18px;min-width:124px;overflow:hidden}
      #${HOST_ID} .btn-bulk-phones .bulk-btn-label{position:absolute;left:0;top:0;line-height:18px;transition:opacity .18s ease, transform .18s ease;will-change:opacity,transform}
      #${HOST_ID} .btn-bulk-phones .bulk-btn-label-open{opacity:1;transform:translateY(0)}
      #${HOST_ID} .btn-bulk-phones .bulk-btn-label-add{opacity:0;transform:translateY(6px)}
      #${HOST_ID} .btn-bulk-phones .bulk-btn-label-message{opacity:0;transform:translateY(6px)}
      #${HOST_ID} .btn-bulk-phones.is-add-mode .bulk-btn-label-open{opacity:0;transform:translateY(-6px)}
      #${HOST_ID} .btn-bulk-phones.is-add-mode .bulk-btn-label-add{opacity:1;transform:translateY(0)}
      #${HOST_ID} .btn-bulk-phones.is-message .bulk-btn-label-wrap{flex-basis:154px;min-width:154px;text-align:center}
      #${HOST_ID} .btn-bulk-phones.is-message .bulk-btn-label{left:0;right:0;text-align:center}
      #${HOST_ID} .btn-bulk-phones.is-message .bulk-btn-label-open,
      #${HOST_ID} .btn-bulk-phones.is-message .bulk-btn-label-add{opacity:0;transform:translateY(-6px)}
      #${HOST_ID} .btn-bulk-phones.is-message .bulk-btn-label-message{opacity:1;transform:translateY(0)}
      #${HOST_ID} .bulk-n{display:inline-flex;align-items:center;justify-content:center;background:#46b559;color:#fff;border-radius:20px;padding:0 8px;height:18px;font-size:11px;font-weight:700;line-height:18px;min-width:30px;text-align:center;box-sizing:border-box}
      #${HOST_ID} .filter-page-box{
        display:none;
        align-items:center;
        gap:8px;
        order:2;
        margin-left:4px;
        flex:0 0 auto;
        max-width:240px;
        height:42px;
      }
      #${HOST_ID} .filter-page-box.show{display:flex}
      #${HOST_ID} .filter-page-botline{display:flex;align-items:center;justify-content:center;gap:6px;width:100%}
      #${HOST_ID} .filter-page-nav{display:flex;gap:3px;align-items:center}
      #${HOST_ID} .filter-page-arrow{width:19px;height:16px;display:inline-flex;align-items:center;justify-content:center;border:0.5px solid var(--color-border-secondary);border-radius:5px;background:var(--color-background-primary);color:var(--color-text-primary);cursor:pointer;font-size:11px;line-height:1;padding:0;font-family:var(--font-sans);transition:background-color .15s ease,border-color .15s ease,color .15s ease}
      #${HOST_ID} .filter-page-arrow:hover:not(:disabled){border-color:#185FA5;color:#185FA5;background:rgba(24,95,165,.08)}
      #${HOST_ID} .filter-page-arrow:disabled{opacity:.4;cursor:default}
      #${HOST_ID} .filter-page-col{
        display:flex;
        flex-direction:column;
        gap:0;
        max-width:220px;
        align-items:center;
        justify-content:space-between;
        height:42px;
      }
      #${HOST_ID} .filter-page-row{display:flex;align-items:center;gap:5px;justify-content:center}
      #${HOST_ID} .filter-page-input{
        width:93px;
        height:20px;
        background:var(--color-background-primary);
        border:0.5px solid var(--color-border-secondary);
        border-radius:6px;
        padding:0 8px;
        font-size:11px;
        color:var(--color-text-primary);
        outline:none;
        font-family:var(--font-sans);
      }
      #${HOST_ID} .filter-page-input:focus{border-color:#185FA5;box-shadow:0 0 0 3px rgba(24,95,165,.14)}
      #${HOST_ID} .filter-page-go{
        height:20px;
        border:none;
        border-radius:6px;
        padding:0 9px;
        background:#185FA5;
        color:#fff;
        font-size:10px;
        font-weight:500;
        cursor:pointer;
        font-family:var(--font-sans);
        white-space:nowrap;
      }
      #${HOST_ID} .filter-page-go:hover{background:#0C447C}
      #${HOST_ID} .filter-page-hint{
        font-size:9px;
        color:var(--color-text-tertiary);
        line-height:1;
        padding-left:0;
        max-width:168px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        text-align:center;
      }
      #${HOST_ID} .filter-badge{display:none!important}
      #${HOST_ID} .filter-badge.show{display:none!important}
      #${HOST_ID} .filter-panel{
        position:absolute;
        top:calc(100% + 6px);
        left:12px;
        right:12px;
        background:var(--color-background-primary);
        border:0.5px solid var(--color-border-secondary);
        border-radius:12px;
        padding:16px;
        z-index:30;
        display:block;
        opacity:0;
        visibility:hidden;
        pointer-events:none;
        transform:translateY(-8px) scale(.985);
        transform-origin:top right;
        box-shadow:0 10px 28px rgba(0,0,0,.12);
        transition:opacity .22s ease, transform .24s cubic-bezier(.2,.8,.2,1), visibility .24s step-end;
      }
      #${HOST_ID} .filter-panel.open{
        opacity:1;
        visibility:visible;
        pointer-events:auto;
        transform:translateY(0) scale(1);
        transition:opacity .2s ease, transform .22s cubic-bezier(.2,.8,.2,1), visibility 0s step-start;
      }
      #${HOST_ID} .fp-title{font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px}
      #${HOST_ID} .fp-divider{height:0.5px;background:var(--color-border-tertiary);margin:14px 0}
      #${HOST_ID} .fp-row{display:flex;gap:8px;margin-bottom:10px;align-items:flex-end}
      #${HOST_ID} .fp-row:last-child{margin-bottom:0}
      #${HOST_ID} .fi{display:flex;flex-direction:column;gap:4px}
      #${HOST_ID} .fi-label{
        display:block;
        margin:0 0 5px 0;
        font-size:12px;
        font-weight:600;
        color:var(--color-text-secondary);
        text-transform:none;
        letter-spacing:0;
        line-height:1.2;
      }
      #${HOST_ID} .fi-input,#${HOST_ID} .fi-select{
        background:var(--color-background-secondary);
        border:0.5px solid var(--color-border-secondary);
        border-radius:8px;
        padding:7px 10px;
        font-size:12px;
        color:var(--color-text-primary);
        outline:none;
        width:100%;
        font-family:var(--font-sans);
        appearance:none;
        transition:border-color .18s ease, box-shadow .18s ease, background-color .18s ease, transform .15s ease;
      }
      #${HOST_ID} .fi-select{
        cursor:pointer;
        padding-right:30px;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23828a96' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
        background-repeat:no-repeat;
        background-position:right 9px center;
        background-size:14px 14px;
      }
      #${HOST_ID} .fi-input:hover,#${HOST_ID} .fi-select:hover{border-color:#b5bfd0}
      #${HOST_ID} .fi-input:focus,#${HOST_ID} .fi-select:focus{
        border-color:#185FA5;
        box-shadow:0 0 0 3px rgba(24,95,165,.14);
        background-color:var(--color-background-primary);
      }
      #${HOST_ID} .fi-select option{
        background:var(--color-background-primary);
        color:var(--color-text-primary);
      }
      #${HOST_ID} .fi-select-native{display:none!important}
      #${HOST_ID} .tm-dd{position:relative;width:100%}
      #${HOST_ID} .tm-dd-btn{
        width:100%;
        border:0.5px solid var(--color-border-secondary);
        border-radius:8px;
        background:var(--color-background-secondary);
        color:var(--color-text-primary);
        min-height:33px;
        padding:7px 30px 7px 10px;
        font-size:12px;
        font-family:var(--font-sans);
        display:flex;
        align-items:center;
        justify-content:flex-start;
        text-align:left;
        cursor:pointer;
        transition:border-color .16s ease, box-shadow .16s ease, background-color .16s ease, transform .12s ease;
      }
      #${HOST_ID} .tm-dd-btn:hover{border-color:#b5bfd0}
      #${HOST_ID} .tm-dd-btn:focus{
        outline:none;
        border-color:#185FA5;
        box-shadow:0 0 0 3px rgba(24,95,165,.14);
        background:var(--color-background-primary);
      }
      #${HOST_ID} .tm-dd-caret{
        position:absolute;
        right:9px;
        top:50%;
        transform:translateY(-50%) rotate(0deg);
        font-size:14px;
        color:var(--color-text-tertiary);
        transition:transform .2s ease,color .2s ease;
        pointer-events:none;
      }
      #${HOST_ID} .tm-dd.open .tm-dd-caret{transform:translateY(-50%) rotate(180deg);color:#185FA5}
      #${HOST_ID} .tm-dd-menu{
        position:absolute;
        left:0;
        right:0;
        top:calc(100% + 6px);
        border:0.5px solid var(--color-border-secondary);
        border-radius:10px;
        background:var(--color-background-primary);
        box-shadow:0 10px 26px rgba(0,0,0,.12);
        padding:6px;
        max-height:260px;
        overflow:auto;
        z-index:60;
        opacity:0;
        visibility:hidden;
        pointer-events:none;
        transform:translateY(-10px) scale(.985);
        transform-origin:top center;
        transition:opacity .18s ease, transform .2s cubic-bezier(.2,.8,.2,1), visibility .2s step-end;
      }
      #${HOST_ID} .tm-dd-search-wrap{
        position:sticky;
        top:0;
        z-index:1;
        padding:0 0 6px 0;
        background:var(--color-background-primary);
      }
      #${HOST_ID} .tm-dd-search{
        width:100%;
        height:30px;
        border:0.5px solid var(--color-border-secondary);
        border-radius:7px;
        background:var(--color-background-secondary);
        color:var(--color-text-primary);
        padding:0 10px;
        font-size:12px;
        font-family:var(--font-sans);
        outline:none;
      }
      #${HOST_ID} .tm-dd-search:focus{
        border-color:#185FA5;
        box-shadow:0 0 0 3px rgba(24,95,165,.14);
        background:var(--color-background-primary);
      }
      #${HOST_ID} .tm-dd.open .tm-dd-menu{
        opacity:1;
        visibility:visible;
        pointer-events:auto;
        transform:translateY(0) scale(1);
        transition:opacity .16s ease, transform .18s cubic-bezier(.2,.8,.2,1), visibility 0s step-start;
      }
      #${HOST_ID} .tm-dd-item{
        width:100%;
        border:none;
        background:transparent;
        color:var(--color-text-primary);
        border-radius:7px;
        padding:7px 9px;
        font-size:12px;
        font-family:var(--font-sans);
        text-align:left;
        cursor:pointer;
        line-height:1.25;
        transition:background-color .14s ease,color .14s ease, transform .14s ease;
      }
      #${HOST_ID} .tm-dd-item:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .tm-dd-item.is-active{
        background:#E6F1FB;
        color:#0C447C;
        font-weight:500;
      }
      #${HOST_ID} .tm-dd-label.is-ph{color:var(--color-text-tertiary)}
      #${HOST_ID} .tm-dd.open .tm-dd-item{
        animation:tmDdItemIn .18s ease both;
      }
      #${HOST_ID} .tm-dd.open .tm-dd-item:nth-child(1){animation-delay:.01s}
      #${HOST_ID} .tm-dd.open .tm-dd-item:nth-child(2){animation-delay:.02s}
      #${HOST_ID} .tm-dd.open .tm-dd-item:nth-child(3){animation-delay:.03s}
      #${HOST_ID} .tm-dd.open .tm-dd-item:nth-child(4){animation-delay:.04s}
      #${HOST_ID} .tm-dd.open .tm-dd-item:nth-child(5){animation-delay:.05s}
      #${HOST_ID} .tm-dd.open .tm-dd-item:nth-child(n+6){animation-delay:.06s}
      @keyframes tmDdItemIn{
        from{opacity:0;transform:translateY(-4px)}
        to{opacity:1;transform:translateY(0)}
      }
      @keyframes tm-autoclean-dot-pulse{
        0%,100%{opacity:.6;box-shadow:0 0 0 0 rgba(255,216,74,.15)}
        50%{opacity:1;box-shadow:0 0 0 8px rgba(255,216,74,.35)}
      }
      @keyframes tm-autoclean-row-pulse{
        0%,100%{background:transparent}
        50%{background:rgba(255,216,74,.22)}
      }
      @keyframes tm-cards-loading-spin{
        to{transform:rotate(360deg)}
      }
      #${HOST_ID} .fp-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}
      #${HOST_ID} .fp-reset{background:none;border:0.5px solid var(--color-border-secondary);border-radius:7px;padding:6px 14px;font-size:12px;color:var(--color-text-secondary);cursor:pointer;font-family:var(--font-sans);transition:background-color .28s ease,border-color .28s ease,color .28s ease,box-shadow .28s ease,opacity .28s ease,filter .28s ease}
      #${HOST_ID} .fp-reset:hover{background:var(--color-background-secondary);border-color:#B5D4F4;color:var(--color-text-primary);box-shadow:0 6px 14px rgba(24,95,165,.08)}
      #${HOST_ID} .fp-apply{background:#185FA5;color:#fff;border:none;border-radius:7px;padding:6px 18px;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font-sans);transition:background-color .28s ease,border-color .28s ease,color .28s ease,box-shadow .28s ease,opacity .28s ease,filter .28s ease}
      #${HOST_ID} .fp-apply:hover{background:#0C447C;box-shadow:0 7px 16px rgba(24,95,165,.18)}
      #${HOST_ID} .cards-area{flex:1;min-width:0;width:100%;max-width:100%;min-height:0;overflow-y:auto;padding:8px 14px;display:flex;flex-direction:column;gap:6px;border-top:0.5px solid var(--color-border-tertiary);opacity:1;transform:none;filter:none;scrollbar-width:none;-ms-overflow-style:none;position:relative}
      #${HOST_ID} .cards-area.cards-area-hide-real-cards .card:not(.card-ghost-leave){opacity:0!important}
      #${HOST_ID} .cards-area.cards-area-hide-real-cards .main-split-empty:not(.card-ghost-leave){opacity:0!important}
      #${HOST_ID} .cards-area.cards-area-hide-real-bulk .bulk-phone-group:not(.card-ghost-leave){opacity:0!important}
      #${HOST_ID} .cards-area::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .cards-area.cards-grid-mode{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));align-content:start;align-items:stretch;gap:8px}
      #${HOST_ID} .cards-area.cards-grid-mode .cards-status-note{grid-column:1/-1}
      #${HOST_ID} .cards-area.cards-grid-mode .cards-loading{grid-column:1/-1}
      #${HOST_ID} .cards-area.cards-grid-mode .card.card-status-mod .card-inner{padding-right:265px}
      #${HOST_ID} .cards-area.cards-grid-mode .card.card-status-mod .crow1{flex-wrap:nowrap}
      #${HOST_ID} .cards-area.cards-grid-mode .card.card-status-mod .c-right-col{max-width:255px}
      #${HOST_ID} .cards-area.cards-grid-mode .card.card-status-mod .c-right-col .c-time-right{max-width:255px}
      #${HOST_ID} .cards-area.cards-grid-mode > .main-split{grid-column:1/-1;width:100%;max-width:100%}
      #${HOST_ID} .cards-area.main-split-mode{display:block;overflow:hidden;gap:0;padding:0 14px;width:100%;max-width:100%;scrollbar-width:none;-ms-overflow-style:none}
      #${HOST_ID} .cards-area.main-split-mode::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .main-split{width:100%;max-width:100%;height:100%;max-height:100%;min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);align-items:stretch;gap:8px}
      #${HOST_ID} .main-split-col{width:100%;max-width:100%;min-width:0;min-height:0;height:auto!important;max-height:none!important;overflow-y:auto;overflow-x:hidden;display:block;padding:0;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior:contain;overflow-anchor:none;-webkit-overflow-scrolling:touch}
      #${HOST_ID} .main-split-col::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .main-split-col-flow{display:block;width:100%;max-width:100%;min-width:0;min-height:100%;padding:8px 0 12px}
      #${HOST_ID} .main-split-col-flow > .card{width:100%;min-height:96px;margin:0 0 8px;flex-shrink:0}
      #${HOST_ID} .main-split-col-flow > .card:last-child{margin-bottom:0}
      #${HOST_ID} .main-split-col-flow > .card .card-inner{padding-right:205px}
      #${HOST_ID} .main-split-col-flow > .card .crow1{flex-wrap:nowrap}
      #${HOST_ID} .main-split-col-flow > .card .c-right-col{max-width:255px}
      #${HOST_ID} .main-split-col-flow > .card .c-right-col .c-time-right{max-width:255px}
      #${HOST_ID} .card-ghost-main-split .card-inner{padding-right:205px}
      #${HOST_ID} .card-ghost-main-split .crow1{flex-wrap:nowrap}
      #${HOST_ID} .card-ghost-main-split .c-right-col{max-width:255px}
      #${HOST_ID} .card-ghost-main-split .c-right-col .c-time-right{max-width:255px}
      #${HOST_ID} .main-split-empty{margin:0}
      #${HOST_ID} .cards-area.moderation-split-mode{display:block;overflow:hidden;padding:0 14px;gap:0;width:100%;max-width:100%;min-height:0;box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none}
      #${HOST_ID} .cards-area.moderation-split-mode::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .moderation-split{width:100%;max-width:100%;height:100%;max-height:100%;min-width:0;min-height:0;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:minmax(0,1fr);align-items:stretch;gap:8px}
      #${HOST_ID} .moderation-split-col{width:100%;max-width:100%;min-width:0;min-height:0;height:auto!important;max-height:none!important;overflow-y:auto;overflow-x:hidden;display:block;padding:0;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior:contain;overflow-anchor:none;-webkit-overflow-scrolling:touch}
      #${HOST_ID} .moderation-split-col::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .moderation-split-col-flow{display:block;width:100%;max-width:100%;min-width:0;min-height:100%;padding:8px 0 12px}
      #${HOST_ID} .moderation-split-col-flow > .card{width:100%;min-height:96px;margin:0 0 8px;box-sizing:border-box;flex-shrink:0}
      #${HOST_ID} .moderation-split-col-flow > .card:last-child{margin-bottom:0}
      #${HOST_ID} .moderation-split-col-flow > .card.card-status-mod .card-inner{padding-right:265px}
      #${HOST_ID} .moderation-split-col-flow > .card.card-status-mod .crow1{flex-wrap:nowrap}
      #${HOST_ID} .moderation-split-col-flow > .card.card-status-mod .c-right-col{max-width:255px}
      #${HOST_ID} .moderation-split-col-flow > .card.card-status-mod .c-right-col .c-time-right{max-width:255px}
      #${HOST_ID} .card-ghost-moderation-split .card-inner{padding-right:265px}
      #${HOST_ID} .card-ghost-moderation-split .crow1{flex-wrap:nowrap}
      #${HOST_ID} .card-ghost-moderation-split .c-right-col{max-width:255px}
      #${HOST_ID} .card-ghost-moderation-split .c-right-col .c-time-right{max-width:255px}
      #${HOST_ID} .cards-area.cards-area-swap-leave,
      #${HOST_ID} .cards-area.cards-area-swap-enter,
      #${HOST_ID} .cards-area.cards-area-swap-enter.cards-area-swap-enter-active{opacity:1;transform:none;filter:none}
      #${HOST_ID} .cards-status-note{padding:14px;background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:10px;font-size:12px;color:var(--color-text-secondary)}
      #${HOST_ID} .cards-loading{position:absolute;inset:0;z-index:3;width:auto;height:auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none}
      #${HOST_ID} .cards-loading-spinner{width:88px;height:88px;border-radius:50%;border:7px solid #d6d4cd;border-top-color:#8d918f;animation:tm-cards-loading-spin .8s linear infinite}
      #${HOST_ID} .cards-loading-progress{color:var(--color-text-secondary);font-size:15px;font-weight:600;line-height:1.2;text-align:center;white-space:nowrap}
      #${HOST_ID} .dispatcher-report-wrap{width:100%}
      #${HOST_ID} .dispatcher-report-wrap .card{margin:0}
      #${HOST_ID} .dispatcher-report-wrap .table-responsive{overflow:auto}
      #${HOST_ID} .dispatcher-modern{width:100%;max-width:1180px;margin:0 auto;padding:8px 6px 28px;color:var(--color-text-primary);font-family:var(--font-sans)}
      #${HOST_ID} .cards-area.cards-area-swap-leave .dispatcher-modern{pointer-events:none;animation:drReportPanelLeave .09s cubic-bezier(.4,0,1,1) both}
      #${HOST_ID} .cards-area.cards-area-swap-enter .dispatcher-modern{opacity:0;transform:translateY(8px) scale(.975);filter:blur(1.5px);transition:opacity .19s ease,transform .19s cubic-bezier(.2,.8,.2,1),filter .19s ease}
      #${HOST_ID} .cards-area.cards-area-swap-enter.cards-area-swap-enter-active .dispatcher-modern{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}
      @keyframes drReportPanelLeave{from{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}to{opacity:0;transform:translateY(5px) scale(.982);filter:blur(1px)}}
      #${HOST_ID} .dr-meta-row{display:flex;justify-content:flex-end;align-items:center;margin:0 0 14px}
      #${HOST_ID} .dr-date{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:8px;color:var(--color-text-secondary);font-size:12px;box-shadow:0 1px 3px rgba(30,28,22,.06);white-space:nowrap}
      #${HOST_ID} .dr-date i{font-size:15px;color:var(--color-text-tertiary)}
      #${HOST_ID} .dr-date b{color:var(--color-text-primary);font-weight:600}
      #${HOST_ID} .dr-toolbar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px}
      #${HOST_ID} .dr-search{display:flex;align-items:center;gap:9px;width:245px;height:42px;padding:0 14px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:8px;box-shadow:0 1px 3px rgba(30,28,22,.05);box-sizing:border-box}
      #${HOST_ID} .dr-search i{font-size:16px;color:var(--color-text-tertiary);flex-shrink:0}
      #${HOST_ID} .dr-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:var(--color-text-primary);font:13.5px var(--font-sans)}
      #${HOST_ID} .dr-search input::placeholder{color:var(--color-text-tertiary)}
      #${HOST_ID} .dr-sort{display:flex;align-items:center;gap:2px;padding:3px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:8px;box-shadow:0 1px 3px rgba(30,28,22,.05)}
      #${HOST_ID} .dr-sort button{height:34px;padding:0 15px;border:0;border-radius:6px;background:transparent;color:var(--color-text-secondary);font:500 13px var(--font-sans);cursor:pointer;white-space:nowrap}
      #${HOST_ID} .dr-sort button:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .dr-sort button.active{background:#E6F1FB;color:#0C447C;font-weight:600}
      #${HOST_ID} .dr-period-controls{display:flex;align-items:flex-end;gap:8px;margin-left:auto;min-width:0}
      #${HOST_ID} .dr-period-controls .dr-filter-field{width:145px;gap:5px}
      #${HOST_ID} .dr-period-search{display:none;align-items:center;justify-content:center;box-sizing:border-box;width:40px;height:40px;min-height:0;max-height:40px;line-height:1;-webkit-appearance:none;appearance:none;padding:0;border:0.5px solid #185FA5;border-radius:7px;background:#185FA5;color:#fff;cursor:pointer;animation:drPeriodSearchIn .17s cubic-bezier(.2,.8,.2,1) both}
      #${HOST_ID} .dr-period-search.show{display:inline-flex}
      #${HOST_ID} .dr-period-search:hover{background:#0C447C;border-color:#0C447C}
      #${HOST_ID} .dr-period-search:disabled{cursor:default;opacity:.46}
      #${HOST_ID} .dr-period-search i{font-size:14px}
      @keyframes drPeriodSearchIn{from{opacity:0;transform:translateX(5px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}
      #${HOST_ID} .dr-period-btn,
      #${HOST_ID} .dr-period-controls .dr-filter-reset{box-sizing:border-box;height:40px;min-height:0;max-height:40px;line-height:1;-webkit-appearance:none;appearance:none;padding:0 15px;border:0.5px solid var(--color-border-secondary);border-radius:7px;background:var(--color-background-primary);color:var(--color-text-secondary);font:600 13px var(--font-sans);cursor:pointer;white-space:nowrap;box-shadow:0 1px 3px rgba(30,28,22,.04);transition:background-color .15s ease,border-color .15s ease,color .15s ease}
      #${HOST_ID} .dr-period-btn:hover,
      #${HOST_ID} .dr-period-controls .dr-filter-reset:hover{border-color:#8BBCE8;background:#EAF2FB;color:#0C447C}
      #${HOST_ID} .dr-filter-wrap{position:relative;margin-left:auto;z-index:8}
      #${HOST_ID} .dr-filter-toggle{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:38px;padding:0 13px;border:0.5px solid var(--color-border-secondary);border-radius:8px;background:var(--color-background-primary);color:var(--color-text-secondary);font:600 12px var(--font-sans);box-shadow:0 1px 3px rgba(30,28,22,.05);cursor:pointer;white-space:nowrap;transition:background-color .18s ease,border-color .18s ease,color .18s ease}
      #${HOST_ID} .dr-filter-toggle:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .dr-filter-toggle.active{background:#E6F1FB;border-color:#8BBCE8;color:#0C447C}
      #${HOST_ID} .dr-filter-toggle i{font-size:15px}
      #${HOST_ID} .dr-filter-chevron{font-size:12px!important;transition:transform .18s ease}
      #${HOST_ID} .dr-filter-wrap.open .dr-filter-chevron{transform:rotate(180deg)}
      #${HOST_ID} .dr-filter-panel{position:absolute;right:0;top:46px;width:520px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:12px;box-shadow:0 12px 30px rgba(20,18,14,.14);opacity:0;visibility:hidden;transform:translateY(-5px);pointer-events:none;transition:opacity .18s ease,transform .18s ease,visibility .18s ease;box-sizing:border-box}
      #${HOST_ID} .dr-filter-wrap.open .dr-filter-panel{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}
      #${HOST_ID} .dr-filter-field{display:flex;flex-direction:column;gap:6px;min-width:0;color:var(--color-text-secondary);font-size:11px;font-weight:600}
      #${HOST_ID} .dr-filter-field input,
      #${HOST_ID} .dr-filter-field select{width:100%;height:36px;padding:0 10px;border:0.5px solid var(--color-border-secondary);border-radius:7px;outline:0;background:var(--color-background-primary);color:var(--color-text-primary);font:12px var(--font-sans);box-sizing:border-box}
      #${HOST_ID} .dr-filter-field input:focus,
      #${HOST_ID} .dr-filter-field select:focus{border-color:#5C9BD1;box-shadow:0 0 0 3px rgba(24,95,165,.12)}
      #${HOST_ID} .dr-date-control{position:relative;display:grid;grid-template-columns:40px minmax(0,1fr);align-items:center;width:100%;height:40px;overflow:hidden;border:0.5px solid var(--color-border-secondary);border-radius:7px;background:var(--color-background-primary);color:var(--color-text-tertiary);cursor:pointer;user-select:none;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
      #${HOST_ID} .dr-date-control:hover{border-color:#8BBCE8;box-shadow:0 0 0 2px rgba(24,95,165,.08)}
      #${HOST_ID} .dr-date-control i{display:flex;align-items:center;justify-content:center;width:40px;height:100%;border-right:0.5px solid var(--color-border-secondary);color:var(--color-text-secondary);font-size:15px;box-sizing:border-box}
      #${HOST_ID} .dr-date-text{display:flex;align-items:center;justify-content:center;min-width:0;height:100%;padding:0 9px;font-size:13px;font-weight:400;line-height:1;white-space:nowrap}
      #${HOST_ID} .dr-date-control.has-value .dr-date-text{color:var(--color-text-primary)}
      #${HOST_ID} .dr-filter-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
      #${HOST_ID} .dr-filter-reset,
      #${HOST_ID} .dr-filter-apply{height:34px;padding:0 14px;border-radius:7px;font:600 12px var(--font-sans);cursor:pointer}
      #${HOST_ID} .dr-filter-reset{border:0.5px solid var(--color-border-secondary);background:var(--color-background-primary);color:var(--color-text-secondary)}
      #${HOST_ID} .dr-filter-reset:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .dr-filter-apply{border:0.5px solid #185FA5;background:#185FA5;color:#fff}
      #${HOST_ID} .dr-filter-apply:hover{background:#0C447C;border-color:#0C447C}
      #${HOST_ID} .dr-count{margin:0 0 9px 2px;color:var(--color-text-tertiary);font-size:12px}
      #${HOST_ID} .dr-count b{color:var(--color-text-secondary);font-weight:600}
      #${HOST_ID} .dr-board{width:100%;overflow:hidden;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:12px;box-shadow:0 1px 3px rgba(30,28,22,.06),0 1px 1px rgba(30,28,22,.04);zoom:1.1}
      #${HOST_ID} .dr-board-head{display:grid;grid-template-columns:30px minmax(260px,1fr) 96px minmax(260px,330px);gap:14px;align-items:center;padding:11px 18px;border-bottom:0.5px solid var(--color-border-tertiary);color:var(--color-text-tertiary);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
      #${HOST_ID} .dr-board-head span:nth-child(3){grid-column:4;text-align:right}
      #${HOST_ID} .dr-row{display:grid;grid-template-columns:30px minmax(260px,1fr) 96px minmax(260px,330px);gap:14px;align-items:center;padding:11px 18px;border-bottom:0.5px solid var(--color-border-tertiary);transition:background-color .14s ease}
      #${HOST_ID} .dr-row:last-child{border-bottom:0}
      #${HOST_ID} .dr-row:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .dr-row.is-zero{opacity:.72}
      #${HOST_ID} .dr-rank{color:var(--color-text-tertiary);font:600 11px var(--font-mono);font-variant-numeric:tabular-nums}
      #${HOST_ID} .dr-rank.top{color:#185FA5}
      #${HOST_ID} .dr-person{min-width:0}
      #${HOST_ID} .dr-name-line{display:flex;align-items:center;gap:7px;min-width:0;margin-bottom:6px}
      #${HOST_ID} .dr-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text-primary);font-size:13px;font-weight:600}
      #${HOST_ID} .dr-class{flex-shrink:0;padding:1px 6px;border:0.5px solid var(--color-border-tertiary);border-radius:5px;background:var(--color-background-secondary);color:var(--color-text-tertiary);font-size:10px;font-weight:600;white-space:nowrap}
      #${HOST_ID} .dr-salary{flex-shrink:0;padding:2px 7px;border:0.5px solid rgba(46,125,50,.28);border-radius:999px;background:#EAF7EA;color:#237039;font-size:10px;font-weight:700;white-space:nowrap}
      #${HOST_ID} .dr-progress{position:relative;max-width:420px;height:7px;overflow:hidden;border-radius:5px;background:var(--color-background-tertiary)}
      #${HOST_ID} .dr-progress-fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:5px;background:linear-gradient(90deg,#185FA5,#2F86D6);transition:width .7s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 5px rgba(24,95,165,.12)}
      #${HOST_ID} .dr-progress-fill.ready{width:var(--dr-width)}
      #${HOST_ID} .dr-row.salary-reached .dr-progress-fill{background:linear-gradient(90deg,#218447,#43B767);box-shadow:0 0 8px rgba(46,151,78,.34)}
      #${HOST_ID} .dr-row.is-zero .dr-progress-fill{background:var(--color-text-tertiary);opacity:.3}
      #${HOST_ID} .dr-row.multi-day-period .dr-progress-fill{background:var(--color-text-tertiary);box-shadow:none;opacity:.58}
      #${HOST_ID} .dr-row.pct-inactive> *{opacity:.46}
      #${HOST_ID} .dr-row.pct-inactive:hover{background:transparent}
      #${HOST_ID} .dr-row.pct-inactive .dr-progress-fill{background:var(--color-text-tertiary);box-shadow:none;opacity:.35}
      #${HOST_ID} .dr-row.is-current-dispatcher{background:#F2F7FC;box-shadow:inset 3px 0 0 #2F86D6}
      #${HOST_ID} .dr-row.is-current-dispatcher:hover{background:#EAF2FB}
      #${HOST_ID} .dr-row.is-current-dispatcher .dr-rank{color:#185FA5}
      #${HOST_ID} .dr-accepted{display:flex;align-items:center;justify-content:center;gap:4px;width:100%;font-variant-numeric:tabular-nums;white-space:nowrap}
      #${HOST_ID} .dr-accepted b,#${HOST_ID} .dr-accepted span{color:var(--color-text-primary);font:600 13px var(--font-sans);letter-spacing:0}
      #${HOST_ID} .dr-accepted span:last-child{margin-left:-1px;color:var(--color-text-secondary);font-size:11px;font-weight:500}
      #${HOST_ID} .dr-flags{display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
      #${HOST_ID} .dr-flag{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:90px;padding:3px 7px;border-radius:6px;font-size:11px;font-weight:600;line-height:1.3;white-space:nowrap;box-sizing:border-box}
      #${HOST_ID} .dr-flag b{font-family:var(--font-mono);font-weight:700}
      #${HOST_ID} .dr-flag-red{background:#FDE8EA;color:#A93842}
      #${HOST_ID} .dr-flag-amber{background:#FFF4D9;color:#8A6000}
      #${HOST_ID} .dr-flag-grey{background:var(--color-background-secondary);color:var(--color-text-secondary);border:0.5px solid var(--color-border-tertiary)}
      #${HOST_ID} .dr-clean{color:var(--color-text-tertiary);font-size:11px;font-weight:500}
      #${HOST_ID} .dr-empty{padding:48px 20px;text-align:center;color:var(--color-text-tertiary);font-size:13px}
      #${HOST_ID} .dr-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}
      #${HOST_ID} .dr-kpi{display:flex;flex-direction:row;align-items:center;gap:11px;min-height:68px;padding:12px 14px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:12px;box-shadow:0 1px 3px rgba(30,28,22,.06),0 1px 1px rgba(30,28,22,.04);box-sizing:border-box}
      #${HOST_ID} .dr-kpi-label{min-width:0;flex:1;color:var(--color-text-secondary);font-size:14px;font-weight:600;line-height:1.2}
      #${HOST_ID} .dr-kpi-number{flex-shrink:0;color:var(--color-text-primary);font:600 14px var(--font-sans);font-variant-numeric:tabular-nums;white-space:nowrap}
      #${HOST_ID} .dr-kpi-head{display:flex;align-items:center;gap:9px;color:var(--color-text-tertiary);font-size:11px;font-weight:600}
      #${HOST_ID} .dr-kpi-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;border:0.5px solid rgba(40,52,67,.06);border-radius:8px;font-size:15px}
      #${HOST_ID} .dr-kpi-icon.blue{background:#E6F1FB;color:#185FA5}
      #${HOST_ID} .dr-kpi-icon.red{background:#FDE8EA;color:#D83340}
      #${HOST_ID} .dr-kpi-icon.green{background:#EAF7EA;color:#2E7D32}
      #${HOST_ID} .dr-kpi-icon.amber{background:#FFF4D9;color:#8A6000}
      #${HOST_ID} .dr-kpi-value{display:flex;align-items:baseline;gap:7px;min-width:0}
      #${HOST_ID} .dr-kpi-value b{flex-shrink:0;color:var(--color-text-primary);font:600 20px var(--font-mono);font-variant-numeric:tabular-nums}
      #${HOST_ID} .dr-kpi-value span{min-width:0;color:var(--color-text-tertiary);font-size:11px;font-weight:500}
      #${HOST_ID} .dr-kpi-value span.good{color:#2E7D32}
      #${HOST_ID} .dr-kpi-value span.warn{color:#8A6000}
      #${HOST_ID} .dr-kpi-value span.bad{color:#D83340}
      #${HOST_ID} .dr-footnote{margin-top:14px;text-align:center;color:var(--color-text-tertiary);font-size:11px}
      #${HOST_ID}.theme-dark .dr-sort button.active{background:rgba(24,95,165,.28);color:#B5D4F4}
      #${HOST_ID}.theme-dark .dr-filter-toggle.active{background:rgba(24,95,165,.28);border-color:rgba(91,151,204,.7);color:#B5D4F4}
      #${HOST_ID}.theme-dark .dr-filter-panel{box-shadow:0 12px 30px rgba(0,0,0,.42)}
      #${HOST_ID}.theme-dark .dr-row.is-current-dispatcher{background:rgba(24,95,165,.15);box-shadow:inset 3px 0 0 #5B97CC}
      #${HOST_ID}.theme-dark .dr-row.is-current-dispatcher:hover{background:rgba(24,95,165,.23)}
      #${HOST_ID}.theme-dark .dr-salary{background:rgba(46,125,50,.24);border-color:rgba(79,183,91,.38);color:#BFE8C5}
      #${HOST_ID}.theme-dark .dr-flag-red{background:rgba(216,51,64,.2);color:#FFB8BF}
      #${HOST_ID}.theme-dark .dr-flag-amber{background:rgba(154,107,0,.25);color:#F5D987}
      #${HOST_ID}.theme-dark .dr-kpi-icon.blue{background:rgba(24,95,165,.24);color:#B5D4F4}
      #${HOST_ID}.theme-dark .dr-kpi-icon.red{background:rgba(216,51,64,.2);color:#FFB8BF}
      #${HOST_ID}.theme-dark .dr-kpi-icon.green{background:rgba(46,125,50,.24);color:#BFE8C5}
      #${HOST_ID}.theme-dark .dr-kpi-icon.amber{background:rgba(154,107,0,.25);color:#F5D987}
      .dr-calendar{position:fixed;z-index:2147483647;width:250px;padding:8px;border:0.5px solid #D3D1C7;border-radius:10px;background:#fff;color:#1C1B18;box-shadow:0 10px 26px rgba(0,0,0,.14);box-sizing:border-box;font-family:"Segoe UI",Tahoma,Arial,sans-serif}
      .dr-calendar-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
      .dr-calendar-title{min-width:0;padding:5px 9px;border:0;border-radius:7px;background:transparent;color:#1C1B18;font:600 14px "Segoe UI",Tahoma,Arial,sans-serif;cursor:pointer;transition:background-color .12s ease,color .12s ease}
      .dr-calendar-title:hover{background:#E6F1FB;color:#0C447C}
      .dr-calendar-nav{display:flex;gap:4px}
      .dr-calendar-nav button{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0.5px solid #D3D1C7;border-radius:6px;background:#fff;color:#6B6963;font-size:17px;line-height:1;cursor:pointer;transition:background-color .12s ease,border-color .12s ease,color .12s ease}
      .dr-calendar-nav button:hover{border-color:#B5D4F4;background:#E6F1FB;color:#0C447C}
      .dr-calendar-week,.dr-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
      .dr-calendar-week[hidden]{display:none}
      .dr-calendar-grid.is-picker{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;min-height:210px;align-content:center}
      .dr-calendar-week span{padding:3px 0;text-align:center;color:#6B6963;font-size:11px;font-weight:600}
      .dr-calendar-day{display:flex;align-items:center;justify-content:center;height:30px;padding:0;border:0;border-radius:7px;background:#fff;color:#1C1B18;font:400 13px "Segoe UI",Tahoma,Arial,sans-serif;cursor:pointer;transition:background-color .11s ease,color .11s ease,transform .11s ease}
      .dr-calendar-day:hover{background:#E6F1FB;color:#0C447C;transform:scale(1.04)}
      .dr-calendar-day.muted{color:#9B9A95}
      .dr-calendar-day.today{background:#EAF2FB;color:#0C447C;font-weight:600}
      .dr-calendar-day.selected{background:#185FA5;color:#fff;font-weight:600;box-shadow:0 2px 5px rgba(24,95,165,.22)}
      .dr-calendar-day.today.selected{background:#185FA5;color:#fff}
      .dr-calendar-pick{display:flex;align-items:center;justify-content:center;height:47px;padding:0;border:0;border-radius:7px;background:#fff;color:#1C1B18;font:400 13px "Segoe UI",Tahoma,Arial,sans-serif;cursor:pointer;animation:drCalendarPickIn .16s cubic-bezier(.2,.8,.2,1) both;transition:background-color .11s ease,color .11s ease,transform .11s ease}
      .dr-calendar-pick:hover{background:#E6F1FB;color:#0C447C;transform:scale(1.035)}
      .dr-calendar-pick.muted{color:#9B9A95}
      .dr-calendar-pick.today{background:#EAF2FB;color:#0C447C;font-weight:600}
      .dr-calendar-pick.selected{background:#185FA5;color:#fff;font-weight:600;box-shadow:0 2px 5px rgba(24,95,165,.22)}
      @keyframes drCalendarPickIn{from{opacity:0;transform:translateY(3px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
      .dr-calendar-foot{display:flex;align-items:center;justify-content:space-between;margin-top:6px}
      .dr-calendar-foot button{padding:3px 5px;border:0;border-radius:6px;background:transparent;color:#185FA5;font:500 12px "Segoe UI",Tahoma,Arial,sans-serif;cursor:pointer}
      .dr-calendar-foot button:hover{background:#EAF2FB}
      .dr-calendar.theme-dark{border-color:#56564F;background:#30302E;color:#F2F2EF;box-shadow:0 12px 30px rgba(0,0,0,.46)}
      .dr-calendar.theme-dark .dr-calendar-title{color:#F2F2EF}
      .dr-calendar.theme-dark .dr-calendar-title:hover{background:rgba(24,95,165,.28);color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-nav button{border-color:#56564F;background:#30302E;color:#BDBBB5}
      .dr-calendar.theme-dark .dr-calendar-nav button:hover{border-color:rgba(91,151,204,.7);background:rgba(24,95,165,.28);color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-week span{color:#BDBBB5}
      .dr-calendar.theme-dark .dr-calendar-day{background:#30302E;color:#F2F2EF}
      .dr-calendar.theme-dark .dr-calendar-day:hover{background:rgba(24,95,165,.28);color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-day.muted{color:#77766F}
      .dr-calendar.theme-dark .dr-calendar-day.today{background:rgba(24,95,165,.24);color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-day.selected{background:#2F7FBE;color:#fff}
      .dr-calendar.theme-dark .dr-calendar-pick{background:#30302E;color:#F2F2EF}
      .dr-calendar.theme-dark .dr-calendar-pick:hover{background:rgba(24,95,165,.28);color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-pick.muted{color:#77766F}
      .dr-calendar.theme-dark .dr-calendar-pick.today{background:rgba(24,95,165,.24);color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-pick.selected{background:#2F7FBE;color:#fff}
      .dr-calendar.theme-dark .dr-calendar-foot button{color:#B5D4F4}
      .dr-calendar.theme-dark .dr-calendar-foot button:hover{background:rgba(24,95,165,.28)}
      @media (max-width:920px){
        #${HOST_ID} .dr-board-head{display:none}
        #${HOST_ID} .dr-row{grid-template-columns:30px minmax(0,1fr) 72px;gap:10px}
        #${HOST_ID} .dr-flags{grid-column:2/4;justify-content:flex-start}
        #${HOST_ID} .dr-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
      @media (max-width:560px){
        #${HOST_ID} .dispatcher-modern{padding-left:0;padding-right:0}
        #${HOST_ID} .dr-search{width:100%}
        #${HOST_ID} .dr-sort{width:100%}
        #${HOST_ID} .dr-sort button{flex:1}
        #${HOST_ID} .dr-period-controls{width:100%;margin-left:0;flex-wrap:wrap}
        #${HOST_ID} .dr-period-controls .dr-filter-field{flex:1 1 140px;width:auto}
        #${HOST_ID} .dr-filter-wrap{width:100%;margin-left:0}
        #${HOST_ID} .dr-filter-toggle{width:100%}
        #${HOST_ID} .dr-filter-panel{position:relative;right:auto;top:auto;width:100%;margin-top:8px;grid-template-columns:1fr;display:none;opacity:1;visibility:visible;transform:none;pointer-events:auto;box-shadow:none}
        #${HOST_ID} .dr-filter-wrap.open .dr-filter-panel{display:grid}
        #${HOST_ID} .dr-row{padding:10px 12px;grid-template-columns:24px minmax(0,1fr) 60px}
        #${HOST_ID} .dr-kpi-grid{grid-template-columns:1fr}
      }
      #${HOST_ID} .cards-area.customer-directory-mode{overflow:hidden;display:block;padding-bottom:0}
      #${HOST_ID} .customer-directory-wrap{width:100%;height:100%;min-height:0;overflow:visible}
      #${HOST_ID} .customer-directory-wrap .card{margin:0}
      #${HOST_ID} .customer-directory-wrap .table-responsive{overflow:auto}
      #${HOST_ID} .customer-directory-modern{width:100%;max-width:1180px;height:100%;min-height:0;margin:0 auto;padding:8px 6px 0;color:var(--color-text-primary);font-family:var(--font-sans);transform-origin:center center;backface-visibility:hidden;display:flex;flex-direction:column;overflow:visible;box-sizing:border-box}
      #${HOST_ID} .cards-area.cards-area-swap-leave .customer-directory-modern{pointer-events:none;animation:cdDirectoryPanelLeave .09s cubic-bezier(.4,0,.8,.2) both}
      #${HOST_ID} .cards-area.cards-area-swap-enter .customer-directory-modern{opacity:0;transform:perspective(1100px) translateZ(-150px) scale(.88);filter:blur(3px) saturate(.88);will-change:opacity,transform,filter;transition:opacity .46s ease,transform .46s cubic-bezier(.2,.8,.2,1),filter .46s ease}
      #${HOST_ID} .cards-area.cards-area-swap-enter.cards-area-swap-enter-active .customer-directory-modern{opacity:1;transform:perspective(1100px) translateZ(0) scale(1);filter:blur(0) saturate(1)}
      @keyframes cdDirectoryPanelLeave{from{opacity:1;transform:perspective(1100px) translateZ(0) scale(1);filter:blur(0) saturate(1)}to{opacity:.03;transform:perspective(1100px) translateZ(-150px) scale(.88);filter:blur(3px) saturate(.88)}}
      #${HOST_ID} .cd-search-panel{position:relative;z-index:8;display:grid;grid-template-columns:minmax(245px,285px) auto minmax(160px,1fr);align-items:end;gap:10px;margin:0 0 0;padding:14px 16px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:12px;box-shadow:0 1px 3px rgba(30,28,22,.06);box-sizing:border-box;flex-shrink:0}
      #${HOST_ID} .cd-phone-field{display:flex;flex:0 0 285px;max-width:285px;min-width:245px;flex-direction:column;gap:6px;color:var(--color-text-tertiary);font-size:12px;font-weight:600}
      #${HOST_ID} .cd-phone-input-wrap{display:grid;grid-template-columns:38px minmax(0,1fr);align-items:center;height:40px;border:0.5px solid var(--color-border-secondary);border-radius:8px;background:var(--color-background-secondary);overflow:hidden;transition:border-color .15s ease,box-shadow .15s ease,background-color .15s ease}
      #${HOST_ID} .cd-phone-input-wrap:focus-within{background:var(--color-background-primary);border-color:#5C9BD1;box-shadow:0 0 0 3px rgba(24,95,165,.12)}
      #${HOST_ID} .cd-phone-input-wrap i{display:flex;align-items:center;justify-content:center;width:38px;height:100%;border-right:0.5px solid var(--color-border-secondary);color:var(--color-text-secondary);font-size:15px}
      #${HOST_ID} .cd-phone-input-wrap input{width:100%;min-width:0;height:100%;border:0;outline:0;background:transparent;color:var(--color-text-primary);font:13.5px var(--font-sans);padding:0 11px;box-sizing:border-box}
      #${HOST_ID} .cd-phone-input-wrap input::placeholder{color:var(--color-text-tertiary)}
      #${HOST_ID} .cd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 16px;border-radius:8px;border:0.5px solid transparent;font:600 13px var(--font-sans);cursor:pointer;white-space:nowrap;box-sizing:border-box;transition:background-color .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease}
      #${HOST_ID} .cd-btn i{font-size:15px}
      #${HOST_ID} .cd-btn-primary{background:#185FA5;border-color:#185FA5;color:#fff;box-shadow:0 1px 3px rgba(24,95,165,.14)}
      #${HOST_ID} .cd-btn-primary:hover{background:#0C447C;border-color:#0C447C}
      #${HOST_ID} .cd-btn-ghost{background:var(--color-background-primary);border-color:var(--color-border-secondary);color:var(--color-text-secondary);box-shadow:0 1px 3px rgba(30,28,22,.04)}
      #${HOST_ID} .cd-btn-ghost:hover{border-color:#8BBCE8;background:#EAF2FB;color:#0C447C}
      #${HOST_ID} .cd-btn:disabled{opacity:.48;cursor:not-allowed;filter:saturate(.72);box-shadow:none}
      #${HOST_ID} .cd-btn:disabled:hover{background:var(--color-background-primary);border-color:var(--color-border-secondary);color:var(--color-text-secondary)}
      #${HOST_ID} .cd-result-count{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;padding-left:2px;color:var(--color-text-tertiary);font-size:12.5px}
      #${HOST_ID} .cd-result-count b{color:var(--color-text-secondary);font-weight:600}
      #${HOST_ID} .cd-filter-tag{display:inline-flex;align-items:center;gap:7px;height:24px;padding:0 8px;border-radius:7px;background:#E6F1FB;color:#0C447C;border:0.5px solid #B5D4F4;font-size:12px;font-weight:600}
      #${HOST_ID} .cd-filter-tag button{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:50%;background:transparent;color:#0C447C;font-size:15px;line-height:1;cursor:pointer}
      #${HOST_ID} .cd-filter-tag button:hover{background:rgba(24,95,165,.12)}
      #${HOST_ID} .cd-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-content:start;gap:10px;min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;margin-top:-120px;padding:132px 0 12px;scrollbar-width:none;-ms-overflow-style:none}
      #${HOST_ID} .cd-grid::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .cd-grid.is-empty{align-items:center}
      #${HOST_ID} .cd-client-card{min-width:0;display:flex;flex-direction:column;gap:10px;padding:14px 15px;background:linear-gradient(180deg,#fff 0%,#FFFEFB 100%);border:1px solid #D3CEC3;border-radius:12px;box-shadow:0 1px 3px rgba(45,41,32,.045),0 1px 0 rgba(255,255,255,.92) inset;box-sizing:border-box;transform:perspective(900px) translateZ(0) scale(1);transform-origin:center center;transition:border-color .15s ease,box-shadow .15s ease}
      #${HOST_ID} .cd-client-card.is-clickable{cursor:pointer}
      #${HOST_ID} .cd-client-card:hover{border-color:#8DBFE8;box-shadow:0 7px 22px rgba(30,28,22,.09),0 1px 0 rgba(255,255,255,.92) inset}
      #${HOST_ID} .cd-client-card.is-match{border-color:#5C9BD1}
      #${HOST_ID} .cd-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0}
      #${HOST_ID} .cd-card-title{display:flex;flex-direction:column;gap:3px;min-width:0}
      #${HOST_ID} .cd-name{color:var(--color-text-primary);font-size:15px;font-weight:600;line-height:1.22;text-decoration:none;overflow-wrap:anywhere}
      #${HOST_ID} a.cd-name:hover{color:#185FA5}
      #${HOST_ID} .cd-city{color:var(--color-text-secondary);font-size:12.5px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      #${HOST_ID} .cd-id{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;min-width:0;height:22px;padding:0 7px;border:0.5px solid var(--color-border-secondary);border-radius:6px;background:var(--color-background-secondary);color:#185FA5;text-decoration:none;font-size:12px;font-weight:700;line-height:1;white-space:nowrap}
      #${HOST_ID} a.cd-id:hover{border-color:#8BBCE8;background:#EAF2FB;color:#0C447C}
      #${HOST_ID} .cd-phone{display:flex;align-items:center;gap:7px;color:var(--color-text-primary);font-size:14px;font-weight:600;text-decoration:none;line-height:1.2}
      #${HOST_ID} .cd-phone i{color:#185FA5;font-size:15px}
      #${HOST_ID} .cd-phone.is-empty{color:var(--color-text-tertiary);font-weight:500;font-size:13px}
      #${HOST_ID} .cd-phone.is-empty i{color:var(--color-text-tertiary)}
      #${HOST_ID} .cd-location{display:flex;align-items:flex-start;gap:7px;color:var(--color-text-secondary);font-size:12.5px;line-height:1.35;min-width:0}
      #${HOST_ID} .cd-location i{margin-top:1px;color:var(--color-text-tertiary);font-size:14px;flex-shrink:0}
      #${HOST_ID} .cd-location b{color:var(--color-text-primary);font-weight:600}
      #${HOST_ID} .cd-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:9px;border-top:0.5px solid var(--color-border-tertiary);color:var(--color-text-tertiary);font-size:12px;line-height:1.2}
      #${HOST_ID} .cd-author{display:flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${HOST_ID} .cd-av{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;background:#E6F1FB;color:#0C447C;font-size:9px;font-weight:700;flex-shrink:0}
      #${HOST_ID} .cd-created{display:flex;align-items:center;gap:4px;flex-shrink:0;white-space:nowrap}
      #${HOST_ID} .cd-created i{font-size:12px}
      #${HOST_ID} .cd-empty{grid-column:1/-1;padding:54px 20px;text-align:center;color:var(--color-text-tertiary);font-size:13.5px;background:var(--color-background-primary);border:0.5px dashed var(--color-border-secondary);border-radius:12px}
      #${HOST_ID} .cd-empty i{display:block;margin-bottom:9px;color:var(--color-text-tertiary);font-size:24px}
      #${HOST_ID} .cd-empty-title{margin-bottom:4px;color:var(--color-text-secondary);font-size:14.5px;font-weight:600}
      #${HOST_ID} .cd-empty.cd-empty-phone{display:flex;align-items:center;justify-content:center;min-height:100%;padding:30px 20px;background:transparent;border:0}
      #${HOST_ID} .cd-empty.cd-empty-phone .cd-empty-title{margin:0;color:var(--color-text-secondary);font-size:16px;font-weight:600}
      #${HOST_ID} .cd-search-actions{display:flex;align-items:flex-end;justify-content:flex-start;justify-self:start;gap:8px}
      #${HOST_ID} .cd-page-box{display:flex;flex-direction:column;align-items:center;justify-self:end;align-self:end;gap:3px;margin:0;max-width:190px}
      #${HOST_ID} .cd-page-row{display:flex;align-items:center;justify-content:center;gap:5px}
      #${HOST_ID} .cd-page-input{width:96px;height:24px;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:6px;padding:0 8px;color:var(--color-text-primary);font:12px var(--font-sans);outline:none;box-sizing:border-box}
      #${HOST_ID} .cd-page-input:focus{border-color:#185FA5;box-shadow:0 0 0 3px rgba(24,95,165,.14)}
      #${HOST_ID} .cd-page-go{height:24px;border:none;border-radius:6px;padding:0 10px;background:#185FA5;color:#fff;font:600 11px var(--font-sans);cursor:pointer;white-space:nowrap}
      #${HOST_ID} .cd-page-go:hover{background:#0C447C}
      #${HOST_ID} .cd-page-hint{color:var(--color-text-tertiary);font-size:10px;line-height:1;text-align:center;white-space:nowrap}
      #${HOST_ID} .cd-pagination{display:flex;align-items:center;justify-content:center;gap:5px;flex-wrap:wrap;margin-top:12px}
      #${HOST_ID} .cd-pagination a{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 9px;border:0.5px solid var(--color-border-secondary);border-radius:7px;background:var(--color-background-primary);color:var(--color-text-secondary);font-size:12px;font-weight:600;text-decoration:none}
      #${HOST_ID} .cd-pagination a:hover{border-color:#8BBCE8;background:#EAF2FB;color:#0C447C}
      #${HOST_ID} .cd-pagination a.active{background:#185FA5;border-color:#185FA5;color:#fff}
      #${HOST_ID} .cd-pagination a.disabled{pointer-events:none;opacity:.45}
      @media (max-width:980px){
        #${HOST_ID} .cd-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
      @media (max-width:640px){
        #${HOST_ID} .cd-grid{grid-template-columns:1fr}
        #${HOST_ID} .cd-search-panel{display:flex;flex-wrap:wrap;align-items:stretch}
        #${HOST_ID} .cd-phone-field{min-width:0;max-width:none;flex-basis:100%}
        #${HOST_ID} .cd-search-actions{order:2;flex:1 1 180px}
        #${HOST_ID} .cd-page-box{order:3;flex:1 1 160px}
        #${HOST_ID} .cd-btn{flex:1}
      }
      #${HOST_ID} .bulk-phone-sep{
        background:transparent;
        border:0;
        border-radius:10px;
        padding:4px 6px;
        margin:0;
        display:flex;
        flex-direction:row;
        align-items:center;
        gap:10px;
      }
      #${HOST_ID} .bulk-phone-sep-main{
        flex:1;
        min-width:0;
      }
      #${HOST_ID} .bulk-phone-sep-title{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:6px;
        font-size:14px;
        font-weight:600;
        color:var(--color-text-primary);
        line-height:1.2;
      }
      #${HOST_ID} .bulk-phone-title-main{display:inline-flex;align-items:center;gap:6px;min-width:0}
      #${HOST_ID} .bulk-phone-title-actions{display:inline-flex;align-items:center;gap:8px;flex-shrink:0}
      #${HOST_ID} .bulk-add-top-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        height:24px;
        padding:0 10px;
        border:0.5px solid #3e9f4f;
        background:#46b559;
        color:#fff;
        border-radius:7px;
        font-size:12px;
        font-weight:600;
        line-height:1;
        cursor:pointer;
        white-space:nowrap;
      }
      #${HOST_ID} .bulk-add-top-btn:hover{background:#3f9e4d;border-color:#3f9e4d}
      #${HOST_ID} .bulk-call-wrap{
        display:inline-flex;
        align-items:center;
        position:relative;
      }
      #${HOST_ID} .bulk-call-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        flex-shrink:0;
        width:20px;
        height:20px;
        border-radius:50%;
        background:#46b559;
        color:#fff;
        text-decoration:none;
        transition:background .15s ease, transform .1s ease;
      }
      #${HOST_ID} .bulk-call-btn:hover{background:#3a9e4a;transform:scale(1.1)}
      #${HOST_ID} .bulk-call-btn.is-called{background:#2f8f3f}
      #${HOST_ID} .bulk-call-btn svg{width:10px;height:10px;display:block}
      #${HOST_ID} .bulk-call-check{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:13px;
        height:13px;
        border-radius:50%;
        background:#fff;
        color:#2f8f3f;
        border:1px solid #2f8f3f;
        box-shadow:0 1px 2px rgba(0,0,0,.22);
        font-size:9px;
        font-weight:700;
        line-height:1;
        flex-shrink:0;
        position:absolute;
        top:-3px;
        right:-4px;
        pointer-events:none;
        animation:tmCallCheckPop .2s ease-out;
      }
      @keyframes tmCallCheckPop{
        0%{transform:scale(.7);opacity:.4}
        100%{transform:scale(1);opacity:1}
      }
      #${HOST_ID} .bulk-phone-sep-sub{
        font-size:13px;
        color:var(--color-text-secondary);
        line-height:1.2;
      }
      #${HOST_ID} .bulk-phone-sep-foot{
        margin-top:4px;
        display:flex;
        flex-direction:row;
        align-items:center;
        justify-content:space-between;
        flex-wrap:nowrap;
        gap:10px;
      }
      #${HOST_ID} .bulk-create-btn{
        display:flex;
        align-items:center;
        justify-content:center;
        flex-shrink:0;
        margin:0;
        border:0.5px solid #3e9f4f;
        background:#46b559;
        color:#fff;
        border-radius:7px;
        padding:7px 16px;
        font-size:14px;
        line-height:1;
        font-weight:600;
        cursor:pointer;
        white-space:nowrap;
      }
      #${HOST_ID} .bulk-create-btn:hover{background:#3f9e4d;border-color:#3f9e4d}
      #${HOST_ID} .cards-area.bulk-phone-split-mode{overflow:hidden;display:block;padding:0 14px}
      #${HOST_ID} .cards-area.main-split-mode.bulk-phone-split-mode{padding:0 14px}
      #${HOST_ID} .bulk-phone-groups-wrap{display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0}
      #${HOST_ID} .bulk-phone-groups-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;width:100%;height:auto;min-height:0;align-items:stretch;flex:1}
      #${HOST_ID} .bulk-phone-groups-col{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0;height:100%;overflow-y:auto;overflow-x:hidden;padding:8px 0 12px;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      #${HOST_ID} .bulk-phone-groups-col::-webkit-scrollbar{width:0;height:0;display:none}
      #${HOST_ID} .bulk-phone-group{
        border:0.5px dashed var(--color-border-secondary);
        border-radius:10px;
        background:var(--color-background-secondary);
        padding:10px;
      }
      #${HOST_ID} .bulk-phone-list{margin:8px 0 6px;display:flex;flex-direction:column;gap:8px}
      #${HOST_ID} .bulk-phone-list .card{margin:0;min-height:96px}
      #${HOST_ID} .card{background:#fff;border:1px solid #D3CEC3;border-radius:12px;box-shadow:0 1px 3px rgba(45,41,32,.035);padding:9px 11px 9px 22px;cursor:pointer;transition:border-color .15s;display:flex;gap:8px;align-items:stretch;position:relative;overflow:hidden}
      #${HOST_ID} .card.has-list-index{padding-left:22px}
      #${HOST_ID} .cards-area.cards-grid-mode .card{min-height:96px}
      #${HOST_ID} .card:hover{border-color:#8DBFE8}
      #${HOST_ID} .card.sel{border-color:#185FA5;background:#F0F7FF}
      #${HOST_ID} .card-enter{opacity:0;transform:perspective(900px) translateZ(-120px) scale(.86);transform-origin:center center;filter:saturate(.84) blur(2.5px);will-change:transform,opacity,filter}
      #${HOST_ID} .card-enter.card-enter-active{opacity:1;transform:perspective(900px) translateZ(0) scale(1);filter:saturate(1) blur(0);transition:opacity .5s ease,transform .5s cubic-bezier(.2,.8,.2,1),filter .5s ease}
      #${HOST_ID} .card-move{will-change:transform;transition:transform .56s cubic-bezier(.22,.84,.26,1)}
      #${HOST_ID} .card-ghost-leave{opacity:1;transform:perspective(900px) translateZ(0) scale(1);filter:blur(0);transform-origin:center center;will-change:transform,opacity,filter}
      #${HOST_ID} .card-ghost-leave.card-ghost-leave-active{opacity:.04;transform:perspective(900px) translateZ(-130px) scale(.8);filter:blur(2.5px);transition:opacity .62s ease,transform .62s cubic-bezier(.2,.8,.2,1),filter .62s ease}
      #${HOST_ID} .cards-area.cards-area-panel-real-leave .card[data-id]:not(.card-ghost-leave),
      #${HOST_ID} .cards-area.cards-area-panel-real-leave .main-split-empty:not(.card-ghost-leave){
        pointer-events:none;
        opacity:.04;
        transform:perspective(900px) translateZ(-130px) scale(.8);
        filter:saturate(.84) blur(2.5px);
        transform-origin:center center;
        will-change:transform,opacity,filter;
        transition:opacity .22s ease,transform .22s cubic-bezier(.2,.8,.2,1),filter .22s ease;
      }
      #${HOST_ID} .cards-area.cards-area-panel-real-leave .bulk-phone-group:not(.card-ghost-leave){
        pointer-events:none;
        opacity:.04;
        transform:perspective(900px) translateZ(-130px) scale(.8);
        filter:saturate(.84) blur(2.5px);
        transform-origin:center center;
        will-change:transform,opacity,filter;
        transition:opacity .22s ease,transform .22s cubic-bezier(.2,.8,.2,1),filter .22s ease;
      }
      #${HOST_ID} .card-accent{position:absolute;left:10px;top:8px;bottom:8px;width:4px;border-radius:4px}
      #${HOST_ID} .card.has-list-index .card-accent{left:10px;top:35px;bottom:8px;width:4px;transform:none}
      #${HOST_ID} .ac-mod{background:#d83340}
      #${HOST_ID} .ac-wait{background:#54d350}
      #${HOST_ID} .ac-road{background:#46b559}
      #${HOST_ID} .ac-work{background:#f79236}
      #${HOST_ID} .ac-worksd{background:#d2742e}
      #${HOST_ID} .ac-canceled{background:#46a8a7}
      #${HOST_ID} .ac-reject{background:#e83c3c}
      #${HOST_ID} .ac-ready{background:#45b9f4}
      #${HOST_ID} .ac-notcreated{background:#8b97a8}
      #${HOST_ID} .ac-cl{background:#879697}
      #${HOST_ID} .card-inner{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;position:relative;padding-right:205px}
      #${HOST_ID} .crow1{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-height:19px;min-width:0}
      #${HOST_ID} .cards-area:not(.main-split-mode) .crow1.has-call-pill{flex-wrap:nowrap;width:calc(100% + 88px)}
      #${HOST_ID} .c-list-index{position:absolute;left:12px;top:14px;transform:translateX(-50%);display:block;padding:0;background:transparent;color:var(--color-text-primary);border:0;font-size:12px;font-weight:700;line-height:12px;box-sizing:border-box;z-index:2;pointer-events:none;text-align:center;text-shadow:0 1px 0 rgba(255,255,255,.9)}
      #${HOST_ID} .c-id{font-size:15px;font-weight:600;color:#185FA5;flex-shrink:0;line-height:1}
      #${HOST_ID} .c-id.has-claim{display:inline-flex;align-items:center;gap:5px;color:#D7192A;font-weight:700;line-height:1;text-shadow:0 1px 0 rgba(255,255,255,.75)}
      #${HOST_ID} .c-id.has-claim::after{content:"";width:6px;height:6px;border-radius:50%;background:#E83B3B;box-shadow:0 0 0 2px #FFE3E5;flex:0 0 auto}
      #${HOST_ID} .c-time-right{font-size:11px;color:var(--color-text-tertiary);flex-shrink:0;white-space:nowrap}
      #${HOST_ID} .c-time-right.is-placeholder{visibility:hidden}
      #${HOST_ID} .c-time-right.is-warn,
      #${HOST_ID} .c-time-right.is-danger,
      #${HOST_ID} .c-time-right.is-success{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        height:22px;
        padding:0 14px;
        border-radius:20px;
        line-height:22px;
        font-weight:500;
        box-sizing:border-box;
        position:static;
        vertical-align:middle;
        transform:translateZ(0);
      }
      #${HOST_ID} .c-time-right.is-warn{background:#fff4d9;color:#9a6b00}
      #${HOST_ID} .c-time-right.is-danger{background:#fde8ea;color:#d83340}
      #${HOST_ID} .c-time-right.is-no-answer{padding-left:15px;padding-right:15px}
      #${HOST_ID} .c-time-right.is-success{
        background:#f3fbf3;
        color:#1f7a2e;
        border:1px solid #54d350;
      }
      #${HOST_ID} .c-late{background:#fde8ea;color:#d83340;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:500;margin-left:auto;flex-shrink:0}
      #${HOST_ID} .crow2{display:flex;align-items:baseline;gap:8px;min-height:20px;margin-top:0;min-width:0}
      #${HOST_ID} .c-city{font-size:15px;font-weight:600;color:var(--color-text-primary);line-height:1.15}
      #${HOST_ID} .c-phone{font-size:13px;color:var(--color-text-secondary);line-height:1.1}
      #${HOST_ID} .crow3{display:flex;align-items:center;gap:7px;flex-wrap:nowrap;min-height:19px;min-width:0;width:calc(100% + 72px);max-width:calc(100% + 72px)}
      #${HOST_ID} .c-author{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text-secondary);min-width:0;flex:0 1 auto}
      #${HOST_ID} .c-author-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${HOST_ID} .c-right-col{position:absolute;right:0;top:0;bottom:auto;display:grid;grid-template-rows:19px 20px 19px;row-gap:7px;align-items:center;justify-items:end;min-width:0;max-width:195px}
      #${HOST_ID} .c-av{width:20px;height:20px;border-radius:50%;background:#E6F1FB;color:#0C447C;font-size:9px;font-weight:500;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      #${HOST_ID} .c-meta{font-size:12px;color:var(--color-text-tertiary);display:flex;align-items:center;gap:3px;white-space:nowrap;flex:0 0 auto}
      #${HOST_ID} .c-meta i{font-size:11px}
      #${HOST_ID} .c-right-col .c-time-right{min-width:0;max-width:195px;overflow:hidden;text-overflow:ellipsis;text-align:right}
      #${HOST_ID} .c-right-col .c-time-right:not(.is-neutral):not(.is-warn):not(.is-danger):not(.is-success){display:block}
      #${HOST_ID} .c-address{max-width:195px;font-size:12px;color:var(--color-text-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
      #${HOST_ID} .c-phone-block{display:flex;flex-direction:column;align-items:flex-end;gap:2px;max-width:100%;flex-shrink:0}
      #${HOST_ID} .c-right-col .c-phone-block{transform:translateY(3px)}
      #${HOST_ID} .c-phone-right{font-size:12px;color:var(--color-text-secondary);white-space:nowrap;flex-shrink:0}
      #${HOST_ID} .spill{display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;padding:0 11px;border-radius:20px;white-space:nowrap;min-width:112px;max-width:112px;text-align:center;height:22px;line-height:22px;box-sizing:border-box;position:static;vertical-align:middle;transform:translateZ(0);border:0.5px solid rgba(0,0,0,.08);text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
      #${HOST_ID} .spill.spill-free{min-width:max-content;max-width:none;width:auto;padding:0 12px}
      #${HOST_ID} .work-pill{display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;white-space:nowrap;line-height:1.2;box-sizing:border-box;margin-left:auto}
      #${HOST_ID} .work-pill.wp-inline{margin-left:0}
      #${HOST_ID} .crow1:has(.work-pill){flex-wrap:nowrap}
      #${HOST_ID} .work-pill.wp-busy{background:#f79236;color:#fff}
      #${HOST_ID} .work-pill.wp-mine{background:#44baf2;color:#fff}
      #${HOST_ID} .work-pill.wp-free{background:#fff;color:#000;border:0.5px solid #B4B2A9}
      #${HOST_ID} .call-pill{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:22px;padding:0 9px 0 7px;border-radius:20px;background:#e9f8ee;color:#1f7d39;border:0.5px solid rgba(64,166,85,.48);font-size:10.5px;font-weight:700;line-height:1;white-space:nowrap;box-sizing:border-box;box-shadow:0 1px 0 rgba(255,255,255,.78) inset,0 1px 3px rgba(34,112,52,.08)}
      #${HOST_ID} .call-pill svg{width:12px;height:12px;display:block;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
      #${HOST_ID} .spill:not(.s-notcreated){text-shadow:0 .5px 0 rgba(0,0,0,.06)}
      #${HOST_ID} .s-mod{background:#c71f30;border-color:rgba(159,24,38,.42);color:#fff}
      #${HOST_ID} .s-wait{background:#54d350;border-color:rgba(55,169,52,.42);color:#fff}
      #${HOST_ID} .s-road{background:#46b559;border-color:rgba(50,147,70,.42);color:#fff}
      #${HOST_ID} .s-work{background:#f79236;border-color:rgba(207,112,34,.42);color:#fff}
      #${HOST_ID} .s-worksd{background:#d2742e;border-color:rgba(173,95,37,.42);color:#fff}
      #${HOST_ID} .s-canceled{background:#46a8a7;border-color:rgba(47,137,136,.42);color:#fff}
      #${HOST_ID} .s-reject{background:#e83c3c;border-color:rgba(199,43,43,.42);color:#fff;text-shadow:0 .5px 0 rgba(0,0,0,.06)}
      #${HOST_ID} .s-ready{background:#45b9f4;border-color:rgba(45,151,204,.42);color:#fff}
      #${HOST_ID} .s-notcreated{background:#fff;color:#000;border-color:rgba(216,221,231,.82);text-shadow:none}
      #${HOST_ID} .s-cl{background:#879697;border-color:rgba(104,119,121,.42);color:#fff}
      #${HOST_ID} .tag{display:inline-flex;align-items:center;justify-content:center;font-size:11px;padding:0 10px;border-radius:20px;font-weight:600;background:#fffdf8;color:#4f4a43;border:0.5px solid rgba(207,200,186,.8);line-height:22px;height:22px;box-sizing:border-box;position:static;vertical-align:middle;transform:translateZ(0)}
      #${HOST_ID} .tag-fixed{min-width:70px;max-width:70px;text-align:center;white-space:nowrap}
      #${HOST_ID} .tag-war{background:#fbad00;color:#fff;border-color:rgba(201,135,0,.45);font-weight:500;text-shadow:0 .5px 0 rgba(0,0,0,.06)}
      #${HOST_ID} .tag-rep{background:#7b4a00;color:#fff;border-color:rgba(95,57,0,.45);font-weight:500;text-shadow:0 .5px 0 rgba(0,0,0,.06)}
      @media (max-width:760px){
        #${HOST_ID} .cards-area.cards-grid-mode{grid-template-columns:1fr}
        #${HOST_ID} .cards-area.cards-grid-mode .card{min-height:0}
        #${HOST_ID} .cards-area.bulk-phone-split-mode{overflow-y:auto;display:flex;padding:0 14px}
        #${HOST_ID} .bulk-phone-groups-grid{grid-template-columns:1fr}
        #${HOST_ID} .bulk-phone-groups-col{height:auto;overflow-y:visible}
        #${HOST_ID} .bulk-phone-list .card{min-height:0}
        #${HOST_ID} .cards-area.moderation-split-mode{overflow-y:auto}
        #${HOST_ID} .moderation-split{grid-template-columns:1fr}
        #${HOST_ID} .moderation-split-col{height:auto;overflow-y:visible;padding:8px 0 0}
        #${HOST_ID} .moderation-split-col:last-child{padding-bottom:10px}
        #${HOST_ID} .moderation-split-col-flow > .card{min-height:0}
        #${HOST_ID} .cards-area.main-split-mode{overflow-y:auto}
        #${HOST_ID} .main-split{grid-template-columns:1fr;height:auto}
        #${HOST_ID} .main-split-col{overflow-y:visible}
        #${HOST_ID} .main-split-col-flow{padding:8px 0 10px}
        #${HOST_ID} .main-split-col-flow > .card{min-height:0}
        #${HOST_ID} .card-inner{padding-right:0}
        #${HOST_ID} .cards-area:not(.main-split-mode) .crow1.has-call-pill{width:auto;flex-wrap:wrap}
        #${HOST_ID} .crow3{width:100%;max-width:100%;flex-wrap:wrap}
        #${HOST_ID} .c-right-col{position:static;display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:6px 10px;flex-wrap:wrap;max-width:100%;padding-top:1px}
        #${HOST_ID} .c-right-col .c-time-right,
        #${HOST_ID} .c-address{max-width:100%}
        #${HOST_ID} .c-address{text-align:left}
        #${HOST_ID} .c-phone-block{align-items:flex-start}
        #${HOST_ID} .c-right-col .c-phone-block{transform:none}
      }
      #${HOST_ID} .detail{width:0;background:var(--color-background-primary);border-left:0.5px solid var(--color-border-tertiary);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;transition:width .22s ease}
      #${HOST_ID} .detail.open{width:280px}
      #${HOST_ID} .dh{padding:12px 14px;border-bottom:0.5px solid var(--color-border-tertiary);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
      #${HOST_ID} .dh-title{font-size:13px;font-weight:500;color:var(--color-text-primary)}
      #${HOST_ID} .dh-close{width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--color-text-tertiary);background:none;border:0.5px solid var(--color-border-secondary)}
      #${HOST_ID} .dh-close:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .dbody{flex:1;overflow-y:auto;padding:14px}
      #${HOST_ID} .d-author-card{display:flex;align-items:center;gap:9px;background:#E6F1FB;border-radius:8px;padding:10px 12px;margin-bottom:14px}
      #${HOST_ID} .d-aav{width:32px;height:32px;border-radius:8px;background:#fff;color:#0C447C;font-size:11px;font-weight:500;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      #${HOST_ID} .d-aname{font-size:12px;font-weight:500;color:#0C447C}
      #${HOST_ID} .d-arole{font-size:11px;color:#185FA5}
      #${HOST_ID} .ds-title{font-size:10px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px}
      #${HOST_ID} .dr{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid var(--color-border-tertiary)}
      #${HOST_ID} .dr:last-child{border-bottom:none}
      #${HOST_ID} .dr-k{font-size:12px;color:var(--color-text-tertiary)}
      #${HOST_ID} .dr-v{font-size:12px;color:var(--color-text-primary);font-weight:500;text-align:right}
      #${HOST_ID} .ds-sep{margin:14px 0 10px}
      #${HOST_ID} .tl{display:flex;flex-direction:column}
      #${HOST_ID} .tl-item{display:flex;gap:9px;padding-bottom:13px;position:relative}
      #${HOST_ID} .tl-item:last-child{padding-bottom:0}
      #${HOST_ID} .tl-item:not(:last-child)::before{content:'';position:absolute;left:9px;top:19px;bottom:0;width:1px;background:var(--color-border-tertiary)}
      #${HOST_ID} .tl-dot{width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;flex-shrink:0;border:2px solid var(--color-background-primary)}
      #${HOST_ID} .td-blue{background:#E6F1FB;color:#185FA5}#${HOST_ID} .td-gray{background:var(--color-background-secondary);color:var(--color-text-tertiary)}#${HOST_ID} .td-green{background:#eaf7ea;color:#2e7d32}
      #${HOST_ID} .tl-t{font-size:12px;color:var(--color-text-primary);padding-top:1px}
      #${HOST_ID} .tl-s{font-size:10px;color:var(--color-text-tertiary);margin-top:1px}
      #${HOST_ID} .d-actions{padding:0 14px 14px;display:flex;flex-direction:column;gap:6px;flex-shrink:0}
      #${HOST_ID} .dact{width:100%;padding:8px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;border:0.5px solid var(--color-border-secondary);background:none;color:var(--color-text-primary);font-family:var(--font-sans)}
      #${HOST_ID} .dact:hover{background:var(--color-background-secondary)}
      #${HOST_ID} .dact.primary{background:#185FA5;color:#fff;border-color:transparent}
      #${HOST_ID} .dact.primary:hover{background:#0C447C}
      #${HOST_ID} .dact.danger{color:#d83340;border-color:#fde8ea}
      #${HOST_ID} .dact.danger:hover{background:#fde8ea}
      #${HOST_ID} .dact i{font-size:13px}
      #${HOST_ID}.theme-dark .shell{background:#141413}
      #${HOST_ID}.theme-dark .sb{background:#30302E;border-right-color:#4A4A46}
      #${HOST_ID}.theme-dark .sb-user{background:#30302E}
      #${HOST_ID}.theme-dark .main{background:#30302E}
      #${HOST_ID}.theme-dark .topbar{background:#30302E;border-bottom-color:#4A4A46}
      #${HOST_ID}.theme-dark .kpi-strip{background:#30302E;border-bottom-color:#4A4A46}
      #${HOST_ID}.theme-dark .fbar{background:#30302E;border-bottom-color:#4A4A46}
      #${HOST_ID}.theme-dark .cards-area{
        background:#141413;
        box-shadow:inset 0 9px 22px rgba(0,0,0,.34);
      }
      #${HOST_ID}.theme-dark .cards-loading-spinner{
        border-color:rgba(255,255,255,.24);
        border-top-color:rgba(255,255,255,.72);
        border-right-color:rgba(255,255,255,.42);
        box-shadow:0 0 0 1px rgba(255,255,255,.045);
      }
      #${HOST_ID}.theme-dark .cards-loading-progress{
        color:#cbc9c3;
        text-shadow:none;
      }
      #${HOST_ID}.theme-dark .bulk-top-spinner{
        border-color:rgba(255,255,255,.24);
        border-top-color:rgba(255,255,255,.7);
        box-shadow:0 0 0 1px rgba(255,255,255,.04);
      }
      #${HOST_ID}.theme-dark .kpi{
        background:#262624;
        border:0.5px solid #4A4A46;
      }
      #${HOST_ID}.theme-dark .kpi-ico{
        border-color:rgba(255,255,255,.08);
        box-shadow:inset 0 0 0 .5px rgba(255,255,255,.025);
      }
      #${HOST_ID}.theme-dark .kpi-ico.ic-blue{background:#26384A;color:#9CC9F0;border-color:#405F7A}
      #${HOST_ID}.theme-dark .kpi-ico.ic-red{background:#4A2428;color:#FF9DA6;border-color:#713A41}
      #${HOST_ID}.theme-dark .kpi-ico.ic-green{background:#253D29;color:#8BD696;border-color:#3E6445}
      #${HOST_ID}.theme-dark .kpi-ico.ic-amber{background:#443817;color:#F0CA70;border-color:#6C5926}
      #${HOST_ID}.theme-dark .card{
        background:#30302E;
        border-color:#4A4A46;
        box-shadow:0 1px 0 rgba(255,255,255,.02), 0 6px 14px rgba(0,0,0,.24);
      }
      #${HOST_ID}.theme-dark .card:hover{border-color:#4B83B8}
      #${HOST_ID}.theme-dark .btn-new{background:#185FA5;color:#fff;border:0.5px solid #185FA5}
      #${HOST_ID}.theme-dark .btn-new:hover{background:#0C447C;border-color:#0C447C}
      #${HOST_ID}.theme-dark .btn-filter{background:#185FA5;border-color:#185FA5;color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.035) inset,0 2px 8px rgba(0,0,0,.18)}
      #${HOST_ID}.theme-dark .btn-filter:hover{background:#0C447C;border-color:#0C447C;color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 4px 12px rgba(0,0,0,.22)}
      #${HOST_ID}.theme-dark .btn-filter.active,
      #${HOST_ID}.theme-dark .btn-filter.has-filters{background:#0C447C;border-color:#5f8fbe;color:#fff}
      #${HOST_ID}.theme-dark .btn-filter.active:hover,
      #${HOST_ID}.theme-dark .btn-filter.has-filters:hover{background:#08345F;border-color:#6595BF;color:#fff}
      #${HOST_ID}.theme-dark .srch{background:#262624;border-color:#4A4A46;box-shadow:0 1px 0 rgba(255,255,255,.02) inset}
      #${HOST_ID}.theme-dark .srch:focus-within{background:#262624;border-color:#5f8fbe;box-shadow:0 0 0 3px rgba(95,143,190,.18),0 1px 0 rgba(255,255,255,.02) inset}
      #${HOST_ID}.theme-dark .filter-page-input{background:#30302E;border-color:#666a72;color:#ecece9}
      #${HOST_ID}.theme-dark .filter-page-input:focus{border-color:#5f8fbe;box-shadow:0 0 0 3px rgba(95,143,190,.22)}
      #${HOST_ID}.theme-dark .filter-page-go{background:#185FA5;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 2px 8px rgba(0,0,0,.2)}
      #${HOST_ID}.theme-dark .filter-page-go:hover{background:#0C447C}
      #${HOST_ID}.theme-dark .filter-panel{box-shadow:0 14px 34px rgba(0,0,0,.38)}
      #${HOST_ID}.theme-dark .fi-input:hover,#${HOST_ID}.theme-dark .fi-select:hover{border-color:#7b7b76}
      #${HOST_ID}.theme-dark .fi-input:focus,#${HOST_ID}.theme-dark .fi-select:focus{
        border-color:#5f8fbe;
        box-shadow:0 0 0 3px rgba(95,143,190,.22);
        background-color:#30302E;
      }
      #${HOST_ID}.theme-dark .fi-select{
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23bdbbb5' stroke-width='2.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      }
      #${HOST_ID}.theme-dark .srch i{color:#9a9f9f}
      #${HOST_ID}.theme-dark .srch input{color:#f1f1ee}
      #${HOST_ID}.theme-dark .srch input::placeholder{color:#9a9f9f}
      #${HOST_ID}.theme-dark .filter-panel{background:#30302E;border-color:#5b6068;box-shadow:0 12px 32px rgba(0,0,0,.54)}
      #${HOST_ID}.theme-dark .fi-input,#${HOST_ID}.theme-dark .fi-select{background:#262624;border-color:#575c64;color:#ecece9}
      #${HOST_ID}.theme-dark .fi-label{color:#d5d2cb}
      #${HOST_ID}.theme-dark .tm-dd-btn{background:#262624;border-color:#575c64;color:#ecece9}
      #${HOST_ID}.theme-dark .tm-dd-btn:hover{border-color:#7b7b76}
      #${HOST_ID}.theme-dark .tm-dd-btn:focus{
        border-color:#5f8fbe;
        box-shadow:0 0 0 3px rgba(95,143,190,.22);
        background:#30302E;
      }
      #${HOST_ID}.theme-dark .tm-dd.open .tm-dd-caret{color:#8db7de}
      #${HOST_ID}.theme-dark .tm-dd-menu{
        background:#30302E;
        border-color:#5b6068;
        box-shadow:0 14px 34px rgba(0,0,0,.5);
      }
      #${HOST_ID}.theme-dark .tm-dd-search-wrap{background:#30302E}
      #${HOST_ID}.theme-dark .tm-dd-search{
        background:#262624;
        border-color:#575c64;
        color:#ecece9;
      }
      #${HOST_ID}.theme-dark .tm-dd-search:focus{
        border-color:#5f8fbe;
        box-shadow:0 0 0 3px rgba(95,143,190,.22);
        background:#30302E;
      }
      #${HOST_ID}.theme-dark .tm-dd-item{color:#ecece9}
      #${HOST_ID}.theme-dark .tm-dd-item:hover{background:#3a3a37}
      #${HOST_ID}.theme-dark .tm-dd-item.is-active{
        background:#2a3d52;
        color:#d5e8ff;
      }
      #${HOST_ID}.theme-dark .fp-reset{border-color:#616771;color:#dcdbd7;background:#2f3237}
      #${HOST_ID}.theme-dark .fp-reset:hover{background:#373a3f;border-color:#6ba4df;color:#f3f2ee;box-shadow:0 7px 16px rgba(0,0,0,.22)}
      #${HOST_ID}.theme-dark .fp-apply{background:#185FA5;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 2px 8px rgba(0,0,0,.2)}
      #${HOST_ID}.theme-dark .fp-apply:hover{background:#0C447C;box-shadow:0 7px 16px rgba(0,0,0,.24)}
      #${HOST_ID}.theme-dark .btn-reset-id{background:#3a262b;border-color:#77525b;color:#ffb3bf}
      #${HOST_ID}.theme-dark .btn-reset-id:hover{background:#4a2f36}
      #${HOST_ID}.theme-dark .btn-bulk-restore,
      #${HOST_ID}.theme-dark .btn-bulk-close{background:#30302E;border-color:#666a72;color:#d2d0cb}
      #${HOST_ID}.theme-dark .btn-bulk-restore:hover,
      #${HOST_ID}.theme-dark .btn-bulk-close:hover{background:#363632}
      #${HOST_ID}.theme-dark .btn-mod{background:#4a2c31;border-color:#7b4a54;color:#ffd4d9;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 2px 8px rgba(0,0,0,.22)}
      #${HOST_ID}.theme-dark .btn-mod:hover{background:#553238;border-color:#8b5560}
      #${HOST_ID}.theme-dark .mod-n{background:#e24a57;color:#fff}
      #${HOST_ID}.theme-dark .btn-bulk-phones{background:#2b3f31;border-color:#4e7d57;color:#ccf1d4;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 2px 8px rgba(0,0,0,.22)}
      #${HOST_ID}.theme-dark .btn-bulk-phones:hover{background:#324a39;border-color:#5a8b64}
      #${HOST_ID}.theme-dark .btn-bulk-phones:disabled,
      #${HOST_ID}.theme-dark .btn-bulk-phones.is-disabled{background:#303630;border-color:#536057;color:#9eafa2;box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 1px 4px rgba(0,0,0,.16)}
      #${HOST_ID}.theme-dark .btn-bulk-phones:disabled:hover,
      #${HOST_ID}.theme-dark .btn-bulk-phones.is-disabled:hover{background:#303630;border-color:#536057}
      #${HOST_ID}.theme-dark .bulk-n{background:#46b559;color:#fff}
      #${HOST_ID}.theme-dark .bulk-create-btn{background:#3f9e4d;border-color:#3f9e4d;color:#fff}
      #${HOST_ID}.theme-dark .bulk-create-btn:hover{background:#378745;border-color:#378745}
      #${HOST_ID}.theme-dark .bulk-add-top-btn{background:#3f9e4d;border-color:#3f9e4d;color:#fff}
      #${HOST_ID}.theme-dark .bulk-add-top-btn:hover{background:#378745;border-color:#378745}
      #${HOST_ID}.theme-dark .bulk-call-btn{background:#3f9e4d}
      #${HOST_ID}.theme-dark .bulk-call-btn:hover{background:#378745}
      #${HOST_ID}.theme-dark .bulk-call-btn.is-called{background:#2f8f3f}
      #${HOST_ID}.theme-dark .bulk-call-check{
        background:#1f2a22;
        color:#7be38d;
        border-color:#56c66a;
        box-shadow:0 1px 2px rgba(0,0,0,.35);
      }
      #${HOST_ID}.theme-dark .cd-search-panel,
      #${HOST_ID}.theme-dark .cd-client-card,
      #${HOST_ID}.theme-dark .cd-empty,
      #${HOST_ID}.theme-dark .cd-pagination a{background:#30302E;border-color:#56564f;box-shadow:0 1px 3px rgba(0,0,0,.26)}
      #${HOST_ID}.theme-dark .cd-search-panel{background:#30302E;border-color:#56564f;box-shadow:0 1px 3px rgba(0,0,0,.26)}
      #${HOST_ID}.theme-dark .cd-phone-input-wrap{background:#262624;border-color:#56564f}
      #${HOST_ID}.theme-dark .cd-phone-input-wrap:focus-within{background:#30302E;border-color:#5f8fbe;box-shadow:0 0 0 3px rgba(95,143,190,.22)}
      #${HOST_ID}.theme-dark .cd-phone-input-wrap i{border-color:#56564f}
      #${HOST_ID}.theme-dark .cd-btn-ghost{background:#30302E;border-color:#56564f;color:#d2d0cb}
      #${HOST_ID}.theme-dark .cd-btn-ghost:hover,
      #${HOST_ID}.theme-dark .cd-pagination a:hover{background:#2a3d52;border-color:#5f8fbe;color:#d5e8ff}
      #${HOST_ID}.theme-dark .cd-btn:disabled,
      #${HOST_ID}.theme-dark .cd-btn:disabled:hover{background:#30302E;border-color:#56564f;color:#8f918d;box-shadow:none}
      #${HOST_ID}.theme-dark .cd-filter-tag{background:#2a3d52;border-color:#5f8fbe;color:#d5e8ff}
      #${HOST_ID}.theme-dark .cd-filter-tag button{color:#d5e8ff}
      #${HOST_ID}.theme-dark .cd-client-card{background:linear-gradient(180deg,#30302E 0%,#2B2B29 100%)}
      #${HOST_ID}.theme-dark .cd-client-card:hover{border-color:#5f8fbe;box-shadow:0 7px 22px rgba(0,0,0,.34)}
      #${HOST_ID}.theme-dark .cd-page-input{background:#30302E;border-color:#666a72;color:#ecece9}
      #${HOST_ID}.theme-dark .cd-page-input:focus{border-color:#5f8fbe;box-shadow:0 0 0 3px rgba(95,143,190,.22)}
      #${HOST_ID}.theme-dark .cd-page-go{background:#185FA5;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 2px 8px rgba(0,0,0,.2)}
      #${HOST_ID}.theme-dark .cd-page-go:hover{background:#0C447C}
      #${HOST_ID}.theme-dark .cd-id{background:#262624;border-color:#56564f;color:#8fc1f0}
      #${HOST_ID}.theme-dark a.cd-id:hover{background:#2a3d52;border-color:#5f8fbe;color:#d5e8ff}
      #${HOST_ID}.theme-dark .cd-av{background:#26384A;color:#B5D4F4;border-color:#405F7A}
      #${HOST_ID}.theme-dark .cd-phone i{color:#8fc1f0}
      #${HOST_ID}.theme-dark .cd-foot{border-color:#4A4A46}
      #${HOST_ID}.theme-dark .sb-av{background:#26384A;color:#B5D4F4;border:0.5px solid #405F7A}
      #${HOST_ID}.theme-dark .sb-item.active{background:#26384A;color:#B5D4F4}
      #${HOST_ID}.theme-dark .sb-item.active i{color:#9CC9F0}
      #${HOST_ID}.theme-dark .sb-item:hover{background:#33363b}
      #${HOST_ID}.theme-dark .sb-item{color:#c8c6c1}
      #${HOST_ID}.theme-dark .sb-backdrop{background:rgba(0,0,0,.32)}
      #${HOST_ID}.theme-dark .c-id{color:#1f78bb}
      #${HOST_ID}.theme-dark .c-id.has-claim{
        display:inline-flex;
        align-items:center;
        gap:4px;
        color:#ff6673;
        font-weight:700;
        line-height:15px;
        text-shadow:none;
      }
      #${HOST_ID}.theme-dark .c-id.has-claim::after{
        width:7px;
        height:7px;
        margin:0;
        background:#e83b4b;
        border:0;
        box-shadow:0 0 0 1.5px #612b31;
        flex:0 0 7px;
        align-self:center;
      }
      #${HOST_ID}.theme-dark .c-av{background:#26384A;color:#B5D4F4;border:0.5px solid #405F7A}
      #${HOST_ID}.theme-dark .c-list-index{background:transparent;color:var(--color-text-primary);border-color:transparent;text-shadow:none}
      #${HOST_ID}.theme-dark .c-meta{color:#a9a79f}
      #${HOST_ID}.theme-dark .c-address{color:#b2afa7}
      #${HOST_ID}.theme-dark .c-phone-right{color:#dddad3}
      #${HOST_ID}.theme-dark .c-time-right{color:#b9b6ad}
      #${HOST_ID}.theme-dark .c-time-right.is-danger{background:#b84a55;color:#fff}
      #${HOST_ID}.theme-dark .c-time-right.is-warn{background:#f5cf72;color:#2a1b00}
      #${HOST_ID}.theme-dark .c-time-right.is-success{
        background:rgba(84,211,80,.16);
        color:#d9ffd8;
        border-color:#62dc5f;
      }
      #${HOST_ID}.theme-dark .s-cl{background:#879697;border-color:rgba(104,119,121,.42);color:#fff}
      #${HOST_ID}.theme-dark .s-mod{background:#c71f30;border-color:rgba(159,24,38,.42);color:#fff}
      #${HOST_ID}.theme-dark .s-wait{background:#54d350;border-color:rgba(55,169,52,.42);color:#fff}
      #${HOST_ID}.theme-dark .work-pill.wp-free{background:#fff;color:#16181b;border-color:#c9ced6}
      #${HOST_ID}.theme-dark .call-pill{background:rgba(69,181,89,.18);color:#caffd2;border-color:rgba(99,220,118,.45);box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 1px 4px rgba(0,0,0,.18)}
      #${HOST_ID}.theme-dark .tag{background:#fffdf8;color:#4f4a43;border-color:rgba(207,200,186,.8)}
      #${HOST_ID}.theme-dark .tag-war{background:#fbad00;color:#fff;border-color:rgba(201,135,0,.45)}
      #${HOST_ID}.theme-dark .tag-rep{background:#7b4a00;color:#fff;border-color:rgba(95,57,0,.45)}
      #${HOST_ID}.theme-dark .s-notcreated{background:#fff;color:#16181b;border-color:#d2d6dc}
      #${HOST_ID}.theme-dark .kpi-report-btn{background:#33363b;border-color:#666b73;color:#e4e2dc}
      #${HOST_ID}.theme-dark .theme-slider{background:#686d74;border-color:#7a8088}
      #${HOST_ID}.theme-dark .theme-switch input:checked + .theme-slider{background:#4b89c8;border-color:#4b89c8}
      #${HOST_ID}.theme-dark .ac-cl{background:#7f8c8d}
      #${HOST_ID}.theme-dark .legacy-settings-backdrop{background:rgba(0,0,0,.5)}

      #tmBulkPhonesNoticeHost{position:fixed;right:14px;bottom:14px;z-index:100060;display:flex;flex-direction:column;gap:6px;pointer-events:none}
      .tm-bulk-phone-note{position:relative;overflow:hidden;max-width:min(520px,70vw);padding:10px 12px;background:rgba(34,39,45,.95);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:10px;font-size:12px;line-height:1.3;box-shadow:0 10px 28px rgba(0,0,0,.28);opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}
      .tm-bulk-phone-note.show{opacity:1;transform:translateY(0)}
      .tm-bulk-phone-note-bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:rgba(255,110,60,.85);border-radius:0 0 10px 10px}
    `;
    document.head.appendChild(style);
  }

  function mountUI() {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.innerHTML = `
      <h2 class="sr-only">CRM — заявки</h2>
      <div class="shell">
        <aside class="sb collapsed" id="sb">
          <div class="sb-logo" id="logoBtn"><div class="sb-logo-icon"><i class="ti ti-brand-codesandbox" aria-hidden="true"></i></div></div>
          <a class="sb-item" href="#" data-nav="dispatcher-report"><i class="ti ti-chart-bar" aria-hidden="true"></i><span class="sb-label">Статистика по диспетчерам</span></a>
          <a class="sb-item" href="#" data-nav="customer-directory"><i class="ti ti-users" aria-hidden="true"></i><span class="sb-label">Поиск карточки клиента</span></a>
          <a class="sb-item" href="#" data-nav="my-cancel-kc"><i class="ti ti-clipboard-x" aria-hidden="true"></i><span class="sb-label">Мои отмены КЦ</span></a>
          <a class="sb-item" href="#" data-nav="my-cancel-nf"><i class="ti ti-file-x" aria-hidden="true"></i><span class="sb-label">Мои отмены НФ</span></a>
          <a class="sb-item" href="#" data-nav="my-clarify"><i class="ti ti-help-square-rounded" aria-hidden="true"></i><span class="sb-label">Мои уточнения</span></a>
          <div class="sb-theme-switch" id="tmThemeSwitchRow">
            <i class="ti ti-moon-stars sb-theme-icon" aria-hidden="true"></i>
            <span class="sb-theme-label">Тёмная тема</span>
            <label class="theme-switch" for="tmThemeToggle" aria-label="Переключить тему">
              <input type="checkbox" id="tmThemeToggle">
              <span class="theme-slider"></span>
            </label>
          </div>
          <a class="sb-item sb-autoclean" href="#"><i class="ti ti-reload" aria-hidden="true"></i><span class="sb-label">Автоочистка</span></a>
          <a class="sb-item sb-settings" href="#"><i class="ti ti-settings" aria-hidden="true"></i><span class="sb-label">Настройки</span></a>
          <span class="sb-autoclean-dot" aria-hidden="true"></span>
          <div class="sb-user">
            <div class="sb-av">ПД</div>
            <div class="sb-user-text">
              <div class="sb-uname">—</div>
              <div class="sb-role">—</div>
              <div class="sb-contract">—</div>
            </div>
            <a class="sb-logout" href="/admin/logout" title="Выйти" aria-label="Выйти"><i class="ti ti-logout" aria-hidden="true"></i></a>
          </div>
        </aside>
        <div class="sb-backdrop" id="tmSidebarBackdrop" aria-hidden="true"></div>
        <div class="legacy-settings-backdrop" id="tmLegacySettingsBackdrop" aria-hidden="true"></div>
        <div class="legacy-settings-backdrop" id="tmAutoCleanupBackdrop" aria-hidden="true"></div>
        <div class="main">
          <div class="topbar">
            <span class="page-title">Главная</span>
            <div class="sp"></div>
            <button class="btn-bulk-phones" id="tmBulkPhonesBtn">
              <span class="bulk-btn-label-wrap" aria-hidden="true">
                <span class="bulk-btn-label bulk-btn-label-open">Открыть номера</span>
                <span class="bulk-btn-label bulk-btn-label-add">Добавить номера</span>
                <span class="bulk-btn-label bulk-btn-label-message">Номеров нету</span>
              </span>
              <span class="bulk-n">0</span>
            </button>
            <button class="btn-mod">Модерации<span class="mod-n">5</span></button>
            <button class="btn-new"><i class="ti ti-plus" aria-hidden="true"></i>Создать заявку</button>
          </div>
          <div class="kpi-strip">
            <div class="kpi"><div class="kpi-main"><div class="kpi-ico ic-blue"><i class="ti ti-clipboard-check" aria-hidden="true"></i></div><div class="kpi-text"><div class="kpi-label">Принято заявок</div><div class="kpi-val"><span id="tmKpiAccepted">0</span><span class="kpi-sub" id="tmKpiAcceptedNote">Чистых: 0</span></div></div></div></div>
            <div class="kpi"><div class="kpi-main"><div class="kpi-ico ic-red"><i class="ti ti-clipboard-x" aria-hidden="true"></i></div><div class="kpi-text"><div class="kpi-label">Отмененных заявок</div><div class="kpi-val"><span id="tmKpiCanceled">0</span><span class="kpi-sub"><span id="tmKpiCanceledPercent">0,0%</span><span class="kpi-sub-tail">от принятых</span></span></div></div></div></div>
            <div class="kpi"><div class="kpi-main"><div class="kpi-ico ic-green"><i class="ti ti-wallet" aria-hidden="true"></i></div><div class="kpi-text"><div class="kpi-label">Заработано за месяц</div><div class="kpi-val" id="tmKpiSalary">0 ₽</div></div></div></div>
            <div class="kpi kpi-day">
              <div class="kpi-day-title">Заработано за сегодня</div>
              <div class="kpi-ico ic-amber"><i class="ti ti-chart-dots" aria-hidden="true"></i></div>
              <div class="kpi-day-wrap">
                <button class="kpi-report-btn" id="tmKpiReportBtn" type="button">Отчёт</button>
                <div class="kpi-day-line">
                  <div class="kpi-val" id="tmKpiDay">—</div>
                  <div class="kpi-day-sub" id="tmKpiDaySub">Жду данные Фикс+ахк</div>
                </div>
              </div>
            </div>
          </div>
          <div class="fbar">
            <div class="srch"><i class="ti ti-search" aria-hidden="true"></i><input id="tmSearchInput" type="text" placeholder="Поиск по ID заявки..."></div>
            <button class="btn-filter" id="filterBtn">
              <i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>
              Фильтр
              <span class="filter-badge" id="filterBadge">0</span>
              <i class="ti ti-chevron-down" id="filterChev" style="font-size:12px;transition:transform .2s" aria-hidden="true"></i>
            </button>
            <button class="btn-reset-id" id="tmNativeResetBtn"><i class="ti ti-x" aria-hidden="true"></i>Сбросить</button>
            <div class="bulk-top-progress" id="tmBulkTopProgress">
              <div class="bulk-top-spinner" aria-hidden="true"></div>
              <div class="bulk-top-progress-text">Поиск номеров: 0/0</div>
            </div>
            <button class="btn-reset-id btn-bulk-hide" id="tmBulkHideBtn"><i class="ti ti-eye-off" aria-hidden="true"></i>Скрыть</button>
            <button class="btn-reset-id btn-bulk-restore" id="tmBulkRestoreBtn"><i class="ti ti-eye" aria-hidden="true"></i>Открыть пропущенные</button>
            <button class="btn-reset-id btn-bulk-close" id="tmBulkCloseBtn"><i class="ti ti-x" aria-hidden="true"></i>Закрыть пропущенные</button>
            <div class="filter-page-box" id="tmFilterPageBox">
              <div class="filter-page-col">
                <div class="filter-page-row">
                  <input class="filter-page-input" id="tmFilterPageInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Страница">
                  <button class="filter-page-go" id="tmFilterPageGo" type="button">Перейти</button>
                </div>
                <div class="filter-page-botline">
                  <div class="filter-page-hint" id="tmFilterPageHint">Страницы: —</div>
                  <div class="filter-page-nav">
                    <button class="filter-page-arrow" id="tmFilterPagePrev" type="button" title="Предыдущая страница" aria-label="Предыдущая страница"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
                    <button class="filter-page-arrow" id="tmFilterPageNext" type="button" title="Следующая страница" aria-label="Следующая страница"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
                  </div>
                </div>
              </div>
            </div>
            <div class="filter-panel" id="filterPanel">
              <div class="fp-title">Основные параметры</div>
              <div class="fp-row">
                <div class="fi" style="flex:1"><div class="fi-label">Город</div>
                  <select class="fi-select" id="tmFilterCity">
                    <option value="">Выбрать город</option>
                  </select>
                </div>
                <div class="fi" style="flex:1"><div class="fi-label">Статус</div>
                  <select class="fi-select" id="tmFilterStatus">
                    <option value="">Все статусы</option>
                    <option>Ожидает</option>
                    <option>В пути</option>
                    <option>В работе</option>
                    <option>В работе СД</option>
                    <option>Отмена КЦ</option>
                    <option>Отмена Филиала</option>
                    <option>Отказ</option>
                    <option>Готов</option>
                    <option>Модерация</option>
                    <option>Не оформлена</option>
                    <option>На уточнении</option>
                    <option>Не создана</option>
                  </select>
                </div>
                <div class="fi" style="flex:1"><div class="fi-label">Тип</div>
                  <select class="fi-select" id="tmFilterType">
                    <option value="">Все типы</option><option>Впервые</option><option>Повтор</option><option>Гарантия</option>
                  </select>
                </div>
                <div class="fi" style="flex:1"><div class="fi-label">Автор</div>
                  <select class="fi-select" id="tmFilterAuthor">
                    <option value="">Выбрать автора</option>
                  </select>
                </div>
                <div class="fi" style="flex:0 0 164px"><div class="fi-label">Телефон</div><input class="fi-input" id="tmFilterPhone" type="tel" inputmode="tel" autocomplete="off" maxlength="16" value="+7"></div>
              </div>
              <div class="fp-divider"></div>
              <div class="fp-title">Поиск по адресу</div>
              <div class="fp-row">
                <div class="fi" style="flex:3"><div class="fi-label">Населённый пункт</div><input class="fi-input" id="tmFilterAddressCity" type="text" placeholder="Нас. пункт"></div>
                <div class="fi" style="flex:3"><div class="fi-label">Улица</div><input class="fi-input" id="tmFilterStreet" type="text" placeholder="Улица..."></div>
                <div class="fi" style="flex:1"><div class="fi-label">Дом</div><input class="fi-input" id="tmFilterHouse" type="text" placeholder="№"></div>
                <div class="fi" style="flex:1"><div class="fi-label">Кв/Офис</div><input class="fi-input" id="tmFilterFlat" type="text" placeholder="№"></div>
              </div>
              <div class="fp-actions">
                <button class="fp-reset" id="tmFilterReset">Сбросить</button>
                <button class="fp-apply" id="tmAddressSearch">Поиск</button>
              </div>
            </div>
          </div>
          <div class="cards-area" id="tmCardsArea"></div>
        </div>
        <div class="tm-anim-layer"></div>
      </div>
    `;
    document.body.appendChild(host);
  }

  function syncSidebarActiveState() {
    const items = Array.from(document.querySelectorAll(`#${HOST_ID} .sb-item[data-nav]`));
    if (!items.length) return;
    const key = normalizeText(state.remote.kind || '');
    items.forEach((item) => {
      const navKey = String(item.getAttribute('data-nav') || '');
      item.classList.toggle('active', Boolean(key) && navKey === key);
    });
  }

  function syncV8ViewportVars() {
    try {
      const viewport = window.visualViewport || null;
      let width = Number((viewport && viewport.width) || window.innerWidth || 0);
      let height = Number((viewport && viewport.height) || window.innerHeight || 0);
      if (!(width > 0)) width = Number(document.documentElement?.clientWidth || 0);
      if (!(height > 0)) height = Number(document.documentElement?.clientHeight || 0);
      if (width > 0) document.documentElement.style.setProperty('--tmv8-vw', `${Math.round(width)}px`);
      if (height > 0) document.documentElement.style.setProperty('--tmv8-vh', `${Math.round(height)}px`);
    } catch (_error) {}
  }

  function bindV8ViewportSync() {
    if (window.__tmCrmV8ViewportSyncBound) return;
    window.__tmCrmV8ViewportSyncBound = true;
    const syncNow = () => syncV8ViewportVars();
    try {
      window.addEventListener('resize', syncNow, { passive: true });
      window.addEventListener('orientationchange', syncNow, { passive: true });
      if (window.visualViewport?.addEventListener) {
        window.visualViewport.addEventListener('resize', syncNow, { passive: true });
        window.visualViewport.addEventListener('scroll', syncNow, { passive: true });
      }
    } catch (_error) {}
    syncV8ViewportVars();
  }

  function bindUI() {
    const logoBtn = document.getElementById('logoBtn');
    const sb = document.getElementById('sb');
    const sidebarBackdrop = document.getElementById('tmSidebarBackdrop');
    const filterBtn = document.getElementById('filterBtn');
    const filterPanel = document.getElementById('filterPanel');
    const filterChev = document.getElementById('filterChev');
    const searchInput = document.getElementById('tmSearchInput');
    const bulkPhonesBtn = document.getElementById('tmBulkPhonesBtn');
    const newRequestBtn = document.querySelector(`#${HOST_ID} .btn-new`);
    const modBtn = document.querySelector(`#${HOST_ID} .btn-mod`);
    const resetBtn = document.getElementById('tmFilterReset');
    const filterPhoneInput = document.getElementById('tmFilterPhone');
    const filterStreetInput = document.getElementById('tmFilterStreet');
    const filterHouseInput = document.getElementById('tmFilterHouse');
    const addressSearchBtn = document.getElementById('tmAddressSearch');
    const cardsArea = document.getElementById('tmCardsArea');
    const reportBtn = document.getElementById('tmKpiReportBtn');
    const nativeResetBtn = document.getElementById('tmNativeResetBtn');
    const bulkHideBtn = document.getElementById('tmBulkHideBtn');
    const bulkRestoreBtn = document.getElementById('tmBulkRestoreBtn');
    const bulkCloseBtn = document.getElementById('tmBulkCloseBtn');
    const filterPageInput = document.getElementById('tmFilterPageInput');
    const filterPageGo = document.getElementById('tmFilterPageGo');
    const themeToggle = document.getElementById('tmThemeToggle');
    const themeSwitchRow = document.getElementById('tmThemeSwitchRow');
    const dispatcherNavItem = document.querySelector(`#${HOST_ID} .sb-item[data-nav="dispatcher-report"]`);
    const customerNavItem = document.querySelector(`#${HOST_ID} .sb-item[data-nav="customer-directory"]`);
    const myCancelKcNavItem = document.querySelector(`#${HOST_ID} .sb-item[data-nav="my-cancel-kc"]`);
    const myCancelNfNavItem = document.querySelector(`#${HOST_ID} .sb-item[data-nav="my-cancel-nf"]`);
    const myClarifyNavItem = document.querySelector(`#${HOST_ID} .sb-item[data-nav="my-clarify"]`);
    const autoCleanupNavItem = document.querySelector(`#${HOST_ID} .sb-item.sb-autoclean`);
    const settingsNavItem = document.querySelector(`#${HOST_ID} .sb-item.sb-settings`);
    const legacySettingsBackdrop = document.getElementById('tmLegacySettingsBackdrop');
    const autoCleanupBackdrop = document.getElementById('tmAutoCleanupBackdrop');

    syncSidebarUserProfile();
    state.autoCleanupMenuDay = readAutoCleanupDayFromSettingsPanel();
    syncAutoCleanupMenuLabel();

    hydrateCityFilterSelectFromNative();
    hydrateAuthorFilterSelectFromNative();
    enhanceFilterSelect('tmFilterCity');
    enhanceFilterSelect('tmFilterAuthor');
    enhanceFilterSelect('tmFilterStatus');
    enhanceFilterSelect('tmFilterType');
    bindFilterPhoneMask(filterPhoneInput);
    bindFilterAddressHouseTransfer(filterStreetInput, filterHouseInput);
    bindV8ViewportSync();
    window.addEventListener('resize', () => closeDispatcherCalendar());
    document.addEventListener('scroll', (event) => {
      if (!dispatcherCalendarState.node) return;
      if (dispatcherCalendarState.node.contains(event.target)) return;
      closeDispatcherCalendar();
    }, true);
    // Отмечаем активную прокрутку, чтобы renderAll не перерисовывал список во время скролла.
    document.addEventListener('scroll', markUserScrolling, { capture: true, passive: true });

    const syncSidebarBackdrop = () => {
      if (!sb || !sidebarBackdrop) return;
      const opened = sb.classList.contains('open') && !sb.classList.contains('collapsed');
      sidebarBackdrop.classList.toggle('show', opened);
    };

    const collapseSidebarMenu = () => {
      if (!sb) return;
      sb.classList.add('collapsed');
      sb.classList.remove('open');
      syncSidebarBackdrop();
    };

    if (logoBtn && sb) {
      logoBtn.addEventListener('click', () => {
        sb.classList.toggle('collapsed');
        sb.classList.toggle('open');
        syncSidebarBackdrop();
      });
    }

    if (sidebarBackdrop && sb) {
      sidebarBackdrop.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        sb.classList.add('collapsed');
        sb.classList.remove('open');
        syncSidebarBackdrop();
      });
    }

    syncSidebarBackdrop();

    const syncLegacySettingsUi = () => {
      const settingsPanel = document.getElementById('tm-script-settings-panel');
      const isOpen = settingsPanel instanceof HTMLElement
        && (settingsPanel.classList.contains('tm-v8-forced-open') || settingsPanel.getAttribute('data-open') === '1');
      if (settingsPanel instanceof HTMLElement) {
        settingsPanel.classList.add('tm-v8-centered');
      }
      if (legacySettingsBackdrop) {
        legacySettingsBackdrop.classList.toggle('show', isOpen);
      }
    };

    let autoCleanupOpenTimer = 0;

    const isAutoCleanupModalPanel = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.querySelector('#bulk-nf-clarify-friday-time, #bulk-nf-clarify-friday-date, .bulk-nf-clarify-friday__card')) {
        return true;
      }
      const rect = node.getBoundingClientRect();
      return rect.width >= 260 && rect.height >= 160 && node.querySelector('input, button');
    };

    const getAutoCleanupPanel = () => {
      const fridayPanel = document.getElementById('bulk-nf-clarify-friday-panel');
      if (isAutoCleanupModalPanel(fridayPanel)) return fridayPanel;

      const fallback = document.querySelector('#bulk-nf-clarify-panel, [id*="bulk-nf-clarify"][class*="panel"]');
      if (isAutoCleanupModalPanel(fallback)) return fallback;
      return null;
    };

    const isPanelVisible = (panel) => {
      if (!(panel instanceof HTMLElement)) return false;
      const css = window.getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      if (css.display === 'none' || css.visibility === 'hidden') return false;
      if (Number(css.opacity || '1') <= 0) return false;
      return rect.width > 0 && rect.height > 0;
    };

    const getVisibleAutoCleanupPanel = () => {
      const panel = getAutoCleanupPanel();
      return isPanelVisible(panel) ? panel : null;
    };

    const getAutoCleanupTrigger = () => {
      const direct = document.getElementById('bulk-nf-clarify-panel');
      if (direct instanceof HTMLElement && !isAutoCleanupModalPanel(direct)) {
        const startBtn = direct.querySelector('#bulk-nf-clarify-start');
        if (startBtn instanceof HTMLElement) return startBtn;
      }
      const fallbackSelectors = [
        '#bulk-nf-clarify-start',
        'button[id*="bulk-nf-clarify"]',
        'a[id*="bulk-nf-clarify"]',
        '[role="button"][id*="bulk-nf-clarify"]',
        '.bulk-nf-clarify-trigger',
        '[class*="bulk-nf-clarify"][role="button"]',
        '[class*="bulk-nf-clarify"] button',
        'button[title*="автоочист"]',
        'button[aria-label*="автоочист"]'
      ];
      for (const selector of fallbackSelectors) {
        const node = document.querySelector(selector);
        if (node instanceof HTMLElement && !isAutoCleanupModalPanel(node)) return node;
      }
      const textMatch = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .find((node) => /авто\s*очист|автоочист/i.test(normalizeText(node.textContent || '')));
      return textMatch instanceof HTMLElement ? textMatch : null;
    };

    const clearAutoCleanupCenteringFromWrongNodes = () => {
      document.querySelectorAll('.tm-v8-autoclean-centered').forEach((node) => {
        if (!isAutoCleanupModalPanel(node)) {
          node.classList.remove('tm-v8-autoclean-centered');
        }
      });
    };

    const centerAutoCleanupPanel = (panel) => {
      if (!(panel instanceof HTMLElement)) return;
      panel.classList.add('tm-v8-autoclean-centered');
    };

    const closeAutoCleanupPanel = () => {
      state.autoCleanupPanelOpen = false;
      if (autoCleanupOpenTimer) {
        clearInterval(autoCleanupOpenTimer);
        autoCleanupOpenTimer = 0;
      }
      clearAutoCleanupCenteringFromWrongNodes();
      const panel = getAutoCleanupPanel();
      if (panel) {
        panel.classList.remove('tm-v8-autoclean-centered');
      }
      if (autoCleanupBackdrop) {
        autoCleanupBackdrop.classList.remove('show');
      }
    };

    const openAutoCleanupPanel = () => {
      clearAutoCleanupCenteringFromWrongNodes();
      const panel = getVisibleAutoCleanupPanel();
      if (!(panel instanceof HTMLElement)) return false;
      centerAutoCleanupPanel(panel);

      state.autoCleanupPanelOpen = true;
      if (autoCleanupBackdrop) {
        autoCleanupBackdrop.classList.add('show');
      }
      return true;
    };

    const requestOpenAutoCleanupFromNativeUi = () => {
      const trigger = getAutoCleanupTrigger();
      if (!(trigger instanceof HTMLElement)) return false;
      const fire = (type) => trigger.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      try { fire('pointerdown'); } catch (_error) {}
      try { fire('mousedown'); } catch (_error) {}
      try { fire('mouseup'); } catch (_error) {}
      try { fire('click'); } catch (_error) {}
      try { trigger.click(); } catch (_error) {}
      return true;
    };

    const openAutoCleanupPanelDeferred = () => {
      if (openAutoCleanupPanel()) return true;
      if (autoCleanupOpenTimer) {
        clearInterval(autoCleanupOpenTimer);
        autoCleanupOpenTimer = 0;
      }
      let attempts = 0;
      let requested = false;
      requested = requestOpenAutoCleanupFromNativeUi();
      autoCleanupOpenTimer = setInterval(() => {
        attempts += 1;
        syncAutoCleanupStateFromFixSettings();
        if (!requested) {
          requested = requestOpenAutoCleanupFromNativeUi();
        }
        const opened = openAutoCleanupPanel();
        if (opened || attempts >= 40) {
          clearInterval(autoCleanupOpenTimer);
          autoCleanupOpenTimer = 0;
        }
      }, 50);
      return false;
    };

    const setLegacySettingsOpen = (open) => {
      const settingsButton = document.getElementById('tm-script-settings-btn');
      const settingsPanel = document.getElementById('tm-script-settings-panel');
      if (settingsPanel instanceof HTMLElement) {
        settingsPanel.classList.add('tm-v8-centered');
        settingsPanel.classList.toggle('tm-v8-forced-open', open);
        settingsPanel.setAttribute('data-open', open ? '1' : '0');
        if (settingsButton instanceof HTMLElement) {
          settingsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        syncLegacySettingsUi();
        return true;
      }

      // Panel may be lazily created by Fix+ahk via its own settings button.
      if (settingsButton instanceof HTMLButtonElement) {
        settingsButton.click();
        setTimeout(() => {
          const createdPanel = document.getElementById('tm-script-settings-panel');
          if (createdPanel instanceof HTMLElement) {
            createdPanel.classList.add('tm-v8-centered');
            createdPanel.classList.toggle('tm-v8-forced-open', open);
            createdPanel.setAttribute('data-open', open ? '1' : '0');
            settingsButton.setAttribute('aria-expanded', open ? 'true' : 'false');
            syncLegacySettingsUi();
          }
        }, 40);
        return true;
      }
      syncLegacySettingsUi();
      return false;
    };

    const toggleLegacySettingsFromSidebar = () => {
      const applyToggle = () => {
        const panel = document.getElementById('tm-script-settings-panel');
        if (!(panel instanceof HTMLElement)) return false;
        panel.classList.add('tm-v8-centered');
        const isOpen = panel.getAttribute('data-open') === '1';
        return setLegacySettingsOpen(!isOpen);
      };

      // Settings panel is owned by Fix+ahk script and can appear with a short delay.
      if (applyToggle()) return;
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (applyToggle() || attempts >= 20) {
          clearInterval(timer);
        }
      }, 120);
    };

    const syncAutoCleanupStateFromFixSettings = (detail = null) => {
      const dayFromEvent = detail && Object.prototype.hasOwnProperty.call(detail, 'autoMenuDay')
        ? detail.autoMenuDay
        : null;
      const nextDay = dayFromEvent !== null
        ? normalizeWeekdaySetting(dayFromEvent)
        : normalizeWeekdaySetting(readAutoCleanupDayFromSettingsPanel());
      state.autoCleanupMenuDay = nextDay === null ? SCRIPT_SETTINGS_DEFAULT_AUTO_MENU_DAY : nextDay;
      syncAutoCleanupMenuLabel();
    };

    const bindAutoCleanupPanelWatchers = () => {
      const tryBind = () => {
        const panel = document.getElementById('bulk-nf-clarify-friday-panel');
        if (!(panel instanceof HTMLElement)) return false;
        if (panel.getAttribute('data-tm-ac-watch') === '1') return true;
        panel.setAttribute('data-tm-ac-watch', '1');
        const observer = new MutationObserver(() => syncAutoCleanupAttentionUi());
        observer.observe(panel, { subtree: true, childList: true, attributes: true, characterData: true });
        const timeInput = panel.querySelector('#bulk-nf-clarify-friday-time');
        const dateInput = panel.querySelector('#bulk-nf-clarify-friday-date');
        [timeInput, dateInput].forEach((node) => {
          if (node instanceof HTMLInputElement) {
            node.addEventListener('input', () => syncAutoCleanupAttentionUi());
            node.addEventListener('change', () => syncAutoCleanupAttentionUi());
          }
        });
        return true;
      };

      if (tryBind()) return;
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (tryBind() || attempts >= 40) {
          clearInterval(timer);
        }
      }, 250);
    };
    bindAutoCleanupPanelWatchers();

    if (legacySettingsBackdrop) {
      legacySettingsBackdrop.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setLegacySettingsOpen(false);
      });
    }

    if (autoCleanupBackdrop) {
      autoCleanupBackdrop.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeAutoCleanupPanel();
      });
    }

    document.addEventListener('click', (event) => {
      if (!state.autoCleanupPanelOpen) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const panel = getAutoCleanupPanel();
      if (!(panel instanceof HTMLElement)) return;
      const closeBtn = target.closest(
        '#bulk-nf-clarify-friday-minimize, .bulk-nf-clarify-friday__minimize, .bulk-nf-clarify-friday__close, .bulk-nf-clarify-close, [aria-label*="закры"], [class*="close"]'
      );
      if (closeBtn && panel.contains(closeBtn)) {
        setTimeout(() => closeAutoCleanupPanel(), 0);
      }
    }, true);

    if (autoCleanupNavItem) {
      autoCleanupNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        syncAutoCleanupStateFromFixSettings();
        const autoCleanupActiveNow = isAutoCleanupAvailableNow();

        // When auto-cleanup is inactive, keep sidebar opened.
        if (!autoCleanupActiveNow) {
          if (state.autoCleanupPanelOpen) {
            closeAutoCleanupPanel();
          }
          return;
        }

        if (sb) {
          sb.classList.add('collapsed');
          sb.classList.remove('open');
          syncSidebarBackdrop();
        }
        if (state.autoCleanupPanelOpen) {
          closeAutoCleanupPanel();
          return;
        }
        openAutoCleanupPanelDeferred();
      });
    }

    if (settingsNavItem) {
      settingsNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (sb) {
          sb.classList.add('collapsed');
          sb.classList.remove('open');
          syncSidebarBackdrop();
        }
        toggleLegacySettingsFromSidebar();
      });
    }

    const logoutNavItem = document.querySelector(`#${HOST_ID} .sb-logout`);
    if (logoutNavItem) {
      logoutNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          // Yii logout — POST-only с CSRF. GET по /admin/logout даёт 405, поэтому выход не срабатывал.
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/admin/logout';
          form.style.display = 'none';
          const paramMeta = document.querySelector('meta[name="csrf-param"]');
          const tokenMeta = document.querySelector('meta[name="csrf-token"]');
          const csrfName = (paramMeta && paramMeta.getAttribute('content')) || '_csrf-frontend';
          const csrfToken = (tokenMeta && tokenMeta.getAttribute('content')) || '';
          if (csrfToken) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = csrfName;
            input.value = csrfToken;
            form.appendChild(input);
          }
          document.body.appendChild(form);
          form.submit();
        } catch (_e) {
          window.location.href = '/admin/logout';
        }
      });
    }

    // Наблюдаем за всей страницей (важно ничего не пропустить), но реакцию
    // объединяем в один вызов на кадр — иначе на каждое мелкое изменение во время
    // анимаций дёргается лишняя работа и падает плавность.
    let legacySettingsSyncScheduled = false;
    const scheduleLegacySettingsUiSync = () => {
      if (legacySettingsSyncScheduled) return;
      legacySettingsSyncScheduled = true;
      requestAnimationFrame(() => {
        legacySettingsSyncScheduled = false;
        syncLegacySettingsUi();
      });
    };
    const legacySettingsObserver = new MutationObserver(scheduleLegacySettingsUiSync);
    legacySettingsObserver.observe(document.body, { childList: true, subtree: true });
    syncLegacySettingsUi();
    window.addEventListener('tm-script-settings-updated', (event) => {
      syncAutoCleanupStateFromFixSettings(event?.detail || null);
    });

    if (themeToggle instanceof HTMLInputElement) {
      themeToggle.addEventListener('change', () => {
        const nextTheme = themeToggle.checked ? 'dark' : 'light';
        applyTheme(nextTheme);
        saveTheme(nextTheme);
      });
    }

    if (themeSwitchRow) {
      themeSwitchRow.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement) return;
        if (target instanceof HTMLElement && target.closest('label.theme-switch')) return;
        if (!(themeToggle instanceof HTMLInputElement)) return;
        themeToggle.checked = !themeToggle.checked;
        themeToggle.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    if (!window.__tmV8SharedThemeSyncBound) {
      window.__tmV8SharedThemeSyncBound = true;
      window.addEventListener('storage', (event) => {
        if (event.key !== SHARED_THEME_STORAGE_KEY) return;
        applyTheme(event.newValue === 'dark' ? 'dark' : 'light');
      });
      window.addEventListener(SHARED_THEME_EVENT, (event) => {
        const nextTheme = event?.detail?.theme === 'dark' ? 'dark' : 'light';
        applyTheme(nextTheme);
      });
    }

    if (filterBtn && filterPanel && filterChev) {
      filterBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeAllFilterDropdowns();
        const open = filterPanel.classList.toggle('open');
        filterBtn.classList.toggle('active', open);
        filterChev.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
      });
    }

    let filterPointerStartedInside = false;
    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      filterPointerStartedInside = target instanceof Node
        && Boolean(filterBtn && filterPanel)
        && (filterBtn.contains(target) || filterPanel.contains(target));
    }, true);

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!filterBtn || !filterPanel || !filterChev) return;
      const pointerStartedInside = filterPointerStartedInside;
      filterPointerStartedInside = false;
      if (!filterBtn.contains(target) && !filterPanel.contains(target)) {
        if (pointerStartedInside) return;
        closeAllFilterDropdowns();
        filterPanel.classList.remove('open');
        filterBtn.classList.remove('active');
        filterChev.style.transform = 'rotate(0deg)';
        return;
      }
      if (!(target instanceof Element) || !target.closest('.tm-dd')) {
        closeAllFilterDropdowns();
      }
    });

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const raw = normalizeText(searchInput.value);
        state.filters.id = raw.toLowerCase();
        scheduleBackgroundIdLookup(raw, false);
        renderAll();
      });

      searchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        const raw = normalizeText(searchInput.value);
        state.filters.id = raw.toLowerCase();
        scheduleBackgroundIdLookup(raw, true);
      });
    }

    if (bulkPhonesBtn) {
      try { sessionStorage.removeItem(BULK_SAVED_NUMBERS_KEY); } catch (_error) {}
      bulkPhoneUiState.savedPhones = readSavedBulkPhones();
      bulkPhoneUiState.clipboardPhones = [];
      bulkPhoneUiState.ctrlDown = false;
      updateBulkPhonesButtonUi();

      bulkPhonesBtn.addEventListener('mouseenter', () => {
        void refreshBulkClipboardPhones(false);
      });
      bulkPhonesBtn.addEventListener('focus', () => {
        void refreshBulkClipboardPhones(false);
      });

      bulkPhonesBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (hasHiddenBulkPhones() && !state.remote.kind) return;
        if (state.remote.kind === 'bulk-phones' && state.remote.loading) return;
        const ctrlMode = Boolean(event.ctrlKey || bulkPhoneUiState.ctrlDown);
        const savedPhones = normalizeBulkPhonesList(bulkPhoneUiState.savedPhones);
        const clipboardPhones = await refreshBulkClipboardPhones(true);
        const alreadyOpenPhones = getCurrentBulkSearchPhones();

        if (ctrlMode) {
          if (!clipboardPhones.length) {
            flashBulkPhonesButtonMessage('Номеров нету');
            return;
          }
          const phonesToRemember = clipboardPhones.filter((phone) => !savedPhones.includes(phone) && !alreadyOpenPhones.includes(phone));
          const duplicatePhones = clipboardPhones.filter((phone) => savedPhones.includes(phone) || alreadyOpenPhones.includes(phone));
          if (!phonesToRemember.length) {
            if (duplicatePhones.length > 0) showDuplicateNotice(duplicatePhones);
            return;
          }
          const merged = mergeUniquePhones(savedPhones, phonesToRemember);
          writeSavedBulkPhones(merged);
          updateBulkPhonesButtonUi();
          if (duplicatePhones.length > 0) showDuplicateNotice(duplicatePhones);
          return;
        }

        const appendMode = state.remote.kind === 'bulk-phones' && Array.isArray(state.remote.rows);
        const sourcePhones = savedPhones.length ? savedPhones.slice() : clipboardPhones.slice();
        if (!sourcePhones.length) {
          flashBulkPhonesButtonMessage('Номеров нету');
          return;
        }
        const duplicatePhones = sourcePhones.filter((phone) => alreadyOpenPhones.includes(phone));
        const phonesToSearch = sourcePhones.filter((phone) => !alreadyOpenPhones.includes(phone));
        if (duplicatePhones.length > 0) showDuplicateNotice(duplicatePhones);
        if (!phonesToSearch.length) return;

        // После запуска очищаем "память Ctrl", как в Фикс+AHK.
        writeSavedBulkPhones([]);
        bulkPhoneUiState.clipboardPhones = [];
        updateBulkPhonesButtonUi();
        try { GM_setClipboard(''); } catch (_e) {}

        const search = document.getElementById('tmSearchInput');
        if (search) search.value = '';
        [
          'tmFilterCity',
          'tmFilterStatus',
          'tmFilterType',
          'tmFilterPhone',
          'tmFilterAuthor',
          'tmFilterAddressCity',
          'tmFilterStreet',
          'tmFilterHouse',
          'tmFilterFlat'
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = id === 'tmFilterPhone' ? '+7' : '';
        });
        state.filters = { id: '', city: '', status: '', type: '', phone: '', author: '', addressCity: '', street: '', house: '', flat: '' };
        syncAllEnhancedFilterDropdowns();
        await loadRowsByBulkPhonesInBackground(phonesToSearch, { append: appendMode });
      });
    }

    if (bulkHideBtn) {
      bulkHideBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideBulkPhonesToMain();
      });
    }

    if (bulkRestoreBtn) {
      bulkRestoreBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        restoreHiddenBulkPhones();
      });
    }

    if (bulkCloseBtn) {
      bulkCloseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeHiddenBulkPhones();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Control') return;
      if (bulkPhoneUiState.ctrlDown) return;
      bulkPhoneUiState.ctrlDown = true;
      updateBulkPhonesButtonUi();
      void refreshBulkClipboardPhones(true);
    }, true);

    document.addEventListener('keyup', (event) => {
      if (event.key !== 'Control') return;
      bulkPhoneUiState.ctrlDown = false;
      updateBulkPhonesButtonUi();
    }, true);

    window.addEventListener('blur', () => {
      if (!bulkPhoneUiState.ctrlDown) return;
      bulkPhoneUiState.ctrlDown = false;
      updateBulkPhonesButtonUi();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Control') reportHotkeyState.ctrlDown = true;
      if (event.key === 'Meta') reportHotkeyState.metaDown = true;
    }, true);

    document.addEventListener('keyup', (event) => {
      if (event.key === 'Control') reportHotkeyState.ctrlDown = false;
      if (event.key === 'Meta') reportHotkeyState.metaDown = false;
    }, true);

    window.addEventListener('blur', () => {
      reportHotkeyState.ctrlDown = false;
      reportHotkeyState.metaDown = false;
    });

    if (newRequestBtn) {
      newRequestBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openCreateRequestBlank();
      }, true);
    }

    if (modBtn) {
      modBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.remote.kind === 'moderation' && !state.remote.loading) {
          const search = document.getElementById('tmSearchInput');
          if (search) search.value = '';
          state.filters.id = '';
          state.remote.kind = '';
          state.remote.id = '';
          state.remote.rows = null;
          state.remote.loading = false;
          state.remote.personalModeError = '';
          state.mainScanSeq += 1;
          scrollCardsAreaToTop();
          syncFromNative();
          return;
        }
        const search = document.getElementById('tmSearchInput');
        if (search) search.value = '';
        state.filters.id = '';
        state.remote.personalModeError = '';
        clearTimeout(state.remote.timer);
        loadModerationRowsInBackground(true);
      });
    }

    if (dispatcherNavItem) {
      dispatcherNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseSidebarMenu();
        activateDispatcherReportMode(true);
      });
    }

    if (customerNavItem) {
      customerNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseSidebarMenu();
        activateCustomerDirectoryMode(true);
      });
    }

    if (myCancelKcNavItem) {
      myCancelKcNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseSidebarMenu();
        const search = document.getElementById('tmSearchInput');
        if (search) search.value = '';
        state.filters.id = '';
        if (state.remote.kind === 'my-cancel-kc' && !state.remote.loading) {
          state.remote.kind = '';
          state.remote.rows = null;
          state.remote.id = '';
          state.remote.personalModeError = '';
          state.remote.filterBaseUrl = '';
          state.remote.filterSection = 'all';
          state.remote.filterPage = 1;
          state.remote.filterTotalPages = 0;
          state.remote.filterTotalLoading = false;
          requestTopOnNextCardsRender();
          renderAll();
          return;
        }
        activatePersonalRequestsMode('my-cancel-kc', true);
      });
    }

    if (myCancelNfNavItem) {
      myCancelNfNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseSidebarMenu();
        const search = document.getElementById('tmSearchInput');
        if (search) search.value = '';
        state.filters.id = '';
        if (state.remote.kind === 'my-cancel-nf' && !state.remote.loading) {
          state.remote.kind = '';
          state.remote.rows = null;
          state.remote.id = '';
          state.remote.personalModeError = '';
          state.remote.filterBaseUrl = '';
          state.remote.filterSection = 'all';
          state.remote.filterPage = 1;
          state.remote.filterTotalPages = 0;
          state.remote.filterTotalLoading = false;
          requestTopOnNextCardsRender();
          renderAll();
          return;
        }
        activatePersonalRequestsMode('my-cancel-nf', true);
      });
    }

    if (myClarifyNavItem) {
      myClarifyNavItem.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        collapseSidebarMenu();
        const search = document.getElementById('tmSearchInput');
        if (search) search.value = '';
        state.filters.id = '';
        if (state.remote.kind === 'my-clarify' && !state.remote.loading) {
          state.remote.kind = '';
          state.remote.rows = null;
          state.remote.id = '';
          state.remote.personalModeError = '';
          state.remote.filterBaseUrl = '';
          state.remote.filterSection = 'all';
          state.remote.filterPage = 1;
          state.remote.filterTotalPages = 0;
          state.remote.filterTotalLoading = false;
          requestTopOnNextCardsRender();
          renderAll();
          return;
        }
        activatePersonalRequestsMode('my-clarify', true);
      });
    }

    if (nativeResetBtn) {
      nativeResetBtn.addEventListener('click', () => {
        resetDispatcherReportToCurrentShift();
        if (state.remote.kind === 'bulk-phones') {
          closeCurrentBulkPhones();
          return;
        }
        const hasFilterCriteria = hasServerFilterCriteria()
          || Boolean(normalizeText(document.getElementById('tmFilterCity')?.value || ''))
          || Boolean(getFilterPhoneNationalDigits(document.getElementById('tmFilterPhone')?.value || ''))
          || Boolean(normalizeText(document.getElementById('tmFilterAuthor')?.value || ''))
          || Boolean(normalizeText(document.getElementById('tmFilterAddressCity')?.value || ''))
          || Boolean(normalizeText(document.getElementById('tmFilterStreet')?.value || ''))
          || Boolean(normalizeText(document.getElementById('tmFilterHouse')?.value || ''))
          || Boolean(normalizeText(document.getElementById('tmFilterFlat')?.value || ''));
        if (state.remote.kind === 'filter' || hasFilterCriteria) {
          closeAllFilterDropdowns();
          triggerNativeResetFilter();
          resetFilters();
          if (filterPanel && filterBtn && filterChev) {
            filterPanel.classList.remove('open');
            filterBtn.classList.remove('active');
            filterChev.style.transform = 'rotate(0deg)';
          }
          return;
        }

        const wasPersonalMode = isPersonalRequestsMode(state.remote.kind);
        const search = document.getElementById('tmSearchInput');
        if (search) search.value = '';
        state.filters.id = '';
        state.remote.kind = '';
        state.remote.id = '';
        state.remote.rows = null;
        state.remote.loading = false;
        state.remote.personalModeError = '';
        state.remote.filterBaseUrl = '';
        state.remote.filterSection = 'all';
        state.remote.filterPage = 1;
        state.remote.filterTotalPages = 0;
        state.remote.filterTotalLoading = false;
        const filterPageInput = document.getElementById('tmFilterPageInput');
        if (filterPageInput instanceof HTMLInputElement) {
          filterPageInput.value = '';
        }
        state.mainScanSeq += 1;
        if (wasPersonalMode) {
          requestTopOnNextCardsRender();
        } else {
          scrollCardsAreaToTop();
        }
        syncFromNative();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        closeAllFilterDropdowns();
        const fired = triggerNativeResetFilter();
        if (!fired) {
          resetFilters();
          if (filterPanel && filterBtn && filterChev) {
            filterPanel.classList.remove('open');
            filterBtn.classList.remove('active');
            filterChev.style.transform = 'rotate(0deg)';
          }
          return;
        }
        resetFilters();
        if (filterPanel && filterBtn && filterChev) {
          filterPanel.classList.remove('open');
          filterBtn.classList.remove('active');
          filterChev.style.transform = 'rotate(0deg)';
        }
      });
    }

    const closeFilterPanelUi = () => {
      if (!filterPanel || !filterBtn || !filterChev) return;
      filterPanel.classList.remove('open');
      filterBtn.classList.remove('active');
      filterChev.style.transform = 'rotate(0deg)';
    };

    const runServerFilterSection = (section) => {
      const filterSection = normalizeFilterSection(section);
      closeAllFilterDropdowns();
      const hasCriteria = hasServerFilterCriteria(filterSection);
      if (!hasCriteria && state.remote.kind !== 'filter') return;
      applyFiltersFromUI(filterSection);
      syncCustomFiltersToNativeControls(filterSection);
      if (hasCriteria) {
        applyServerFilterMode(true, filterSection);
      } else if (state.remote.kind === 'filter') {
        state.remote.kind = '';
        state.remote.rows = null;
        state.remote.id = '';
        state.remote.loading = false;
        state.remote.filterBaseUrl = '';
        state.remote.filterSection = 'all';
        state.remote.filterPage = 1;
        state.remote.filterTotalPages = 0;
        state.remote.filterTotalLoading = false;
      }
      renderAll();
      closeFilterPanelUi();
    };

    // Кнопка «Поиск»: обе секции ищутся ОДНИМ запросом — база принимает адрес + основные
    // параметры в одном URL (CRSearch[status][0]=код, [type]=код, [city_id]/[author_id]=id,
    // [address][...]=текст). runServerFilterSection('all') строит этот URL из родных контролов.
    const runFilterSearch = () => {
      const hasMain = hasServerFilterCriteria('main');
      const hasAddr = hasServerFilterCriteria('address');
      if (hasMain && hasAddr) {
        runServerFilterSection('all');
      } else if (hasAddr) {
        runServerFilterSection('address');
      } else {
        runServerFilterSection('main');
      }
    };

    if (addressSearchBtn && filterPanel && filterBtn && filterChev) {
      addressSearchBtn.addEventListener('click', () => {
        runFilterSearch();
      });
    }

    // Панель — overlay над скроллящейся .cards-area; колесо над ней НЕ должно крутить
    // карточки под ней. Пропускаем только внутренний скролл списков дропдаунов.
    if (filterPanel) {
      filterPanel.addEventListener('wheel', (event) => {
        const menu = event.target instanceof Element ? event.target.closest('.tm-dd-menu') : null;
        if (menu && menu.scrollHeight > menu.clientHeight) return;
        event.preventDefault();
        event.stopPropagation();
      }, { passive: false });
    }


    const goFilterPage = () => {
      const raw = normalizeText(filterPageInput?.value || '');
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 1) return;
      const max = state.remote.filterTotalLoading ? 0 : Number(state.remote.filterTotalPages || 0);
      const nextPage = max > 0 ? Math.min(Math.floor(num), max) : Math.floor(num);
      if (filterPageInput instanceof HTMLInputElement) {
        filterPageInput.value = String(nextPage);
      }
      if (state.remote.kind === 'filter') {
        void loadRowsByServerFilterPage(nextPage, true, false);
      } else if (isPersonalRequestsMode(state.remote.kind)) {
        void loadRowsByPersonalRequestsPage(state.remote.kind, nextPage, true, false);
      }
    };

    if (filterPageGo) {
      filterPageGo.addEventListener('click', () => {
        goFilterPage();
      });
    }

    if (filterPageInput instanceof HTMLInputElement) {
      filterPageInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        goFilterPage();
      });
      filterPageInput.addEventListener('input', () => {
        const digits = filterPageInput.value.replace(/[^\d]/g, '');
        if (digits !== filterPageInput.value) filterPageInput.value = digits;
      });
    }

    const filterPagePrev = document.getElementById('tmFilterPagePrev');
    const filterPageNext = document.getElementById('tmFilterPageNext');
    const stepFilterPage = (delta) => {
      const cur = Math.max(1, Number(state.remote.filterPage || 1));
      // Пока идёт фоновый поиск последней страницы, общее число ещё неизвестно —
      // не ограничиваем навигацию «вперёд» временным значением (иначе застреваем).
      const max = state.remote.filterTotalLoading ? 0 : Number(state.remote.filterTotalPages || 0);
      let next = cur + delta;
      if (next < 1) next = 1;
      if (max > 0 && next > max) next = max;
      if (next === cur) return;
      if (state.remote.kind === 'filter') {
        void loadRowsByServerFilterPage(next, true, false);
      } else if (isPersonalRequestsMode(state.remote.kind)) {
        void loadRowsByPersonalRequestsPage(state.remote.kind, next, true, false);
      }
    };
    if (filterPagePrev) filterPagePrev.addEventListener('click', () => stepFilterPage(-1));
    if (filterPageNext) filterPageNext.addEventListener('click', () => stepFilterPage(1));

    if (cardsArea) {
      cardsArea.addEventListener('keydown', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains('cd-page-input')) return;
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        openCustomerDirectoryPage(target.value);
      });

      cardsArea.addEventListener('paste', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains('customer-directory-phone-input')) return;
        const pasted = event.clipboardData?.getData('text') || '';
        if (!pasted) return;
        event.preventDefault();
        target.value = formatCustomerDirectoryPhoneInput(pasted);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        requestAnimationFrame(() => {
          try {
            target.setSelectionRange(target.value.length, target.value.length);
          } catch (_error) {}
        });
      });

      cardsArea.addEventListener('input', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.classList.contains('customer-directory-phone-input')) {
          const nextValue = formatCustomerDirectoryPhoneInput(target.value);
          if (target.value !== nextValue) {
            target.value = nextValue;
            requestAnimationFrame(() => {
              try {
                target.setSelectionRange(target.value.length, target.value.length);
              } catch (_error) {}
            });
          }
          return;
        }
        if (target.classList.contains('cd-page-input')) {
          const digits = target.value.replace(/[^\d]/g, '');
          if (digits !== target.value) target.value = digits;
          return;
        }
        if (!target.classList.contains('dispatcher-report-search')) return;
        dispatcherReportViewState.query = target.value;
        refreshDispatcherReportView(cardsArea);
      });

      cardsArea.addEventListener('change', (event) => {
        const isDispatcherMode = state.remote.kind === 'dispatcher-report';
        const isCustomerMode = state.remote.kind === 'customer-directory';
        if (!isDispatcherMode && !isCustomerMode) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const wrapSelector = isDispatcherMode ? '.dispatcher-report-wrap' : '.customer-directory-wrap';
        if (!target.closest(wrapSelector)) return;
        const form = target.closest('form');
        if (!(form instanceof HTMLFormElement)) return;
        if (isCustomerMode && form.classList.contains('customer-directory-search-form')) return;

        // Prevent native onchange navigation/submit; keep everything inside the redesign.
        event.preventDefault();
        event.stopPropagation();

        try {
          const action = normalizeText(form.getAttribute('action') || '');
          const base = isDispatcherMode
            ? (state.remote.dispatcherReportUrl || findDispatcherReportUrl())
            : (state.remote.customerDirectoryUrl || findCustomerDirectoryUrl());
          const url = new URL(action || base, base);
          const formData = new FormData(form);
          url.search = '';
          formData.forEach((value, key) => {
            if (value == null) return;
            url.searchParams.append(key, String(value));
          });
          if (isDispatcherMode) {
            void fetchDispatcherReportCardInBackground(true, url.toString());
          } else {
            void fetchCustomerDirectoryCardInBackground(true, url.toString());
          }
        } catch (_error) {
          // ignore parsing errors
        }
      }, true);

      cardsArea.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const dispatcherDateControl = target.closest('[data-action="dispatcher-date-open"]');
        if (dispatcherDateControl instanceof HTMLElement) {
          event.preventDefault();
          event.stopPropagation();
          openDispatcherCalendar(dispatcherDateControl);
          return;
        }
        const dispatcherFilterAction = target.closest('[data-action^="dispatcher-filter-"]');
        if (dispatcherFilterAction instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          const action = dispatcherFilterAction.getAttribute('data-action');
          const filterWrap = dispatcherFilterAction.closest('.dr-period-controls');
          if (!(filterWrap instanceof HTMLElement)) return;
          if (action === 'dispatcher-filter-search') {
            applyDispatcherPeriod(filterWrap);
            return;
          }
          if (action === 'dispatcher-filter-reset') {
            const shift = getDispatcherShiftPeriod();
            void fetchDispatcherReportCardInBackground(true, buildDispatcherPeriodUrl(shift.dateFrom, shift.dateTill));
            return;
          }
          if (action === 'dispatcher-filter-month') {
            const month = getDispatcherMonthPeriod();
            void fetchDispatcherReportCardInBackground(true, buildDispatcherPeriodUrl(month.dateFrom, month.dateTill));
            return;
          }
          if (action === 'dispatcher-filter-yesterday') {
            const yesterday = getDispatcherCalendarDayPeriod(-1);
            void fetchDispatcherReportCardInBackground(true, buildDispatcherPeriodUrl(yesterday.dateFrom, yesterday.dateTill));
            return;
          }
        }
        const dispatcherSortButton = target.closest('button[data-dispatcher-sort]');
        if (dispatcherSortButton instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          const rawSort = dispatcherSortButton.getAttribute('data-dispatcher-sort');
          const nextSort = rawSort === 'pct' ? 'pct' : rawSort === 'net' ? 'net' : 'accepted';
          dispatcherReportViewState.sort = dispatcherReportViewState.sort === nextSort ? 'accepted' : nextSort;
          refreshDispatcherReportView(cardsArea);
          return;
        }
        const callBtn = target.closest('a.bulk-call-btn');
        if (callBtn instanceof HTMLAnchorElement) {
          const phoneFromData = normalizeBulkPhone(callBtn.getAttribute('data-phone') || '');
          const phoneFromHref = extractCallPhoneFromHref(callBtn.getAttribute('href') || '');
          markBulkPhoneAsCalled(phoneFromData || phoneFromHref);
          return;
        }
        const addRequestBtn = target.closest('button[data-action="bulk-add-request"]');
        if (addRequestBtn instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          const preparedCreateUrl = normalizeText(addRequestBtn.getAttribute('data-create-url') || '');
          if (preparedCreateUrl) {
            window.open(addV8TypeLookupMarker(appendBulkSourceToUrl(preparedCreateUrl, normalizeText(addRequestBtn.getAttribute('data-phone') || ''))), '_blank', 'noopener');
            return;
          }
          let requestUrl = normalizeText(addRequestBtn.getAttribute('data-request-url') || '');
          let requestId = normalizeRequestId(addRequestBtn.getAttribute('data-request-id') || '');
          if (!requestId && requestUrl) {
            requestId = extractRequestIdFromUpdateUrl(requestUrl);
          }
          if (!requestUrl || !requestId) {
            const group = addRequestBtn.closest('.bulk-phone-group');
            const firstCard = group?.querySelector('.card[data-url]') || null;
            if (!requestUrl) {
              requestUrl = normalizeText(firstCard?.getAttribute('data-url') || '');
            }
            if (!requestId) {
              requestId = extractRequestIdFromUpdateUrl(requestUrl)
                || normalizeRequestId(firstCard?.getAttribute('data-id') || '');
            }
          }
          (async () => {
            const links = await resolveBulkCustomerLinksFromRequest(requestUrl, requestId);
            if (links.createRequestUrl) {
              addRequestBtn.setAttribute('data-create-url', links.createRequestUrl);
              window.open(addV8TypeLookupMarker(appendBulkSourceToUrl(links.createRequestUrl, normalizeText(addRequestBtn.getAttribute('data-phone') || ''))), '_blank', 'noopener');
              return;
            }
            const details = normalizeText(links?.debugReason || '');
            showBulkPhonesNotice(details
              ? `Не удалось подготовить ссылку: ${details}`
              : 'Не удалось подготовить ссылку "Добавить заявку" из карточки клиента');
          })();
          return;
        }
        const createBtn = target.closest('button[data-action="bulk-create"]');
        if (createBtn instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          const phone = normalizeText(createBtn.getAttribute('data-phone') || '');
          openCreateRequestForPhone(phone);
          return;
        }
        const customerResetBtn = target.closest('[data-action="customer-directory-reset"]');
        if (state.remote.kind === 'customer-directory' && customerResetBtn instanceof HTMLElement) {
          event.preventDefault();
          event.stopPropagation();
          state.remote.customerDirectoryUrl = findCustomerDirectoryUrl();
          void fetchCustomerDirectoryCardInBackground(true, state.remote.customerDirectoryUrl);
          return;
        }
        const customerPageGoBtn = target.closest('[data-action="customer-directory-page-go"]');
        if (state.remote.kind === 'customer-directory' && customerPageGoBtn instanceof HTMLElement) {
          event.preventDefault();
          event.stopPropagation();
          const pageBox = customerPageGoBtn.closest('.cd-page-box');
          const pageInput = pageBox?.querySelector('.cd-page-input');
          if (pageInput instanceof HTMLInputElement) {
            openCustomerDirectoryPage(pageInput.value);
          }
          return;
        }
        const customerCard = target.closest('.cd-client-card[data-customer-url]');
        if (state.remote.kind === 'customer-directory' && customerCard instanceof HTMLElement) {
          const url = normalizeText(customerCard.getAttribute('data-customer-url') || '');
          if (url) {
            event.preventDefault();
            event.stopPropagation();
            window.open(url, '_blank', 'noopener');
          }
          return;
        }
        const isDispatcherMode = state.remote.kind === 'dispatcher-report';
        const isCustomerMode = state.remote.kind === 'customer-directory';
        if (isDispatcherMode || isCustomerMode) {
          const wrapSelector = isDispatcherMode ? '.dispatcher-report-wrap' : '.customer-directory-wrap';
          const link = target.closest(`${wrapSelector} a[href]`);
          if (link instanceof HTMLAnchorElement) {
            const href = normalizeText(link.getAttribute('href') || '');
            const hrefLower = href.toLowerCase();
            if (
              link.hasAttribute('data-native-link')
              || link.target
              || hrefLower.startsWith('tel:')
              || hrefLower.startsWith('callto:')
              || hrefLower.startsWith('mailto:')
            ) {
              return;
            }
            if (href && !href.startsWith('#') && !href.toLowerCase().startsWith('javascript:')) {
              event.preventDefault();
              event.stopPropagation();
              try {
                const base = isDispatcherMode
                  ? (state.remote.dispatcherReportUrl || findDispatcherReportUrl())
                  : (state.remote.customerDirectoryUrl || findCustomerDirectoryUrl());
                const nextUrl = new URL(href, base).toString();
                if (isDispatcherMode) {
                  void fetchDispatcherReportCardInBackground(true, nextUrl);
                } else {
                  void fetchCustomerDirectoryCardInBackground(true, nextUrl);
                }
              } catch (_error) {
                // ignore malformed hrefs
              }
            }
            return;
          }
        }
        const card = target.closest('.card[data-action="open-request"]');
        if (!card) return;
        const url = card.getAttribute('data-url') || '';
        if (!url) return;
        // PERF-FIX (как в старой быстрой версии): открываем заявку с 'noopener' → у вкладки нет
        // opener-связи с базой → Chrome даёт ей ОТДЕЛЬНЫЙ процесс → пачка грузится параллельно/быстро.
        // Только этот путь (карточка) — noopener; чужие window.open (Фикс+ахк) НЕ трогаем (им нужен opener).
        window.open(url, '_blank', 'noopener');
      });

      cardsArea.addEventListener('submit', (event) => {
        const isDispatcherMode = state.remote.kind === 'dispatcher-report';
        const isCustomerMode = state.remote.kind === 'customer-directory';
        if (!isDispatcherMode && !isCustomerMode) return;
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const wrapSelector = isDispatcherMode ? '.dispatcher-report-wrap' : '.customer-directory-wrap';
        if (!form.closest(wrapSelector)) return;
        event.preventDefault();
        event.stopPropagation();
        if (isCustomerMode && form.classList.contains('customer-directory-search-form')) {
          const phoneInput = form.querySelector('.customer-directory-phone-input');
          const phoneValue = phoneInput instanceof HTMLInputElement ? phoneInput.value : '';
          const url = buildCustomerDirectoryPhoneSearchUrl(phoneValue);
          state.remote.customerDirectoryUrl = url;
          void fetchCustomerDirectoryCardInBackground(true, url);
          return;
        }
        try {
          const method = normalizeText(form.getAttribute('method') || 'GET').toUpperCase();
          const action = normalizeText(form.getAttribute('action') || '');
          const base = isDispatcherMode
            ? (state.remote.dispatcherReportUrl || findDispatcherReportUrl())
            : (state.remote.customerDirectoryUrl || findCustomerDirectoryUrl());
          const url = new URL(action || base, base);
          if (method === 'GET') {
            const formData = new FormData(form);
            url.search = '';
            formData.forEach((value, key) => {
              if (value == null) return;
              const val = normalizeText(String(value));
              if (!val) return;
              url.searchParams.set(key, val);
            });
            if (isDispatcherMode) {
              void fetchDispatcherReportCardInBackground(true, url.toString());
            } else {
              void fetchCustomerDirectoryCardInBackground(true, url.toString());
            }
          } else {
            // For non-GET forms keep default page stable: just reload current report URL.
            if (isDispatcherMode) {
              void fetchDispatcherReportCardInBackground(true, url.toString());
            } else {
              void fetchCustomerDirectoryCardInBackground(true, url.toString());
            }
          }
        } catch (_error) {
          // ignore submit parsing errors
        }
      });
    }

    if (reportBtn) {
      reportBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ctrlLike = Boolean(event.ctrlKey || reportHotkeyState.ctrlDown);
        const metaLike = Boolean(event.metaKey || reportHotkeyState.metaDown);
        const wantNight = Boolean(ctrlLike || metaLike);

        const initial = reportBtn.textContent;
        reportBtn.textContent = 'В процессе';
        reportBtn.disabled = true;
        reportSendInProgress = true;
        // Точки появляются по одной — видно, что процесс живой, а не завис.
        let progressDots = 0;
        const progressTimer = window.setInterval(() => {
          progressDots = (progressDots + 1) % 4;
          reportBtn.textContent = `В процессе${'.'.repeat(progressDots)}`;
        }, 400);
        (async () => {
          let ok = false;
          let awaited = false;
          try {
            // ОБА режима — через мост: он резолвится только после ответа АХК. Дневной раньше шёл
            // через triggerFixAhkReport — синтетический клик, который возвращает true сразу после
            // диспатча события, НЕ дожидаясь АХК. Отсюда и было «Отправлено», когда ничего ещё не
            // ушло, и мгновенная разблокировка кнопки.
            const bridge = window.__tmDispatcherReportBridge;
            if (typeof bridge === 'function') {
              awaited = true;
              try {
                ok = Boolean(await bridge({ night: wantNight, source: 'tm-v8' }));
              } catch (_error) {
                ok = false;
              }
            } else {
              // Моста нет — дождаться АХК нечем. Кликаем по кнопке Фикса, но «Отправлено»
              // не пишем: подтвердить отправку мы не можем, а врать нельзя.
              triggerFixAhkReport({ ctrlKey: wantNight, metaKey: wantNight, wantNight });
            }
          } finally {
            window.clearInterval(progressTimer);
          }

          // Сюда попадаем только после ответа моста, т.е. когда сигнал уже ушёл в АХК
          // (или честно провалился). Раньше этого кнопку не оживляем.
          reportBtn.textContent = awaited ? (ok ? 'Отправлено' : 'Не ушло') : 'Нет Фикс+ахк';
          setTimeout(() => {
            reportSendInProgress = false;
            reportBtn.disabled = false;
            reportBtn.textContent = initial || 'Отчёт';
            renderAll();
          }, 1100);
        })();
      });
    }

    document.addEventListener('pjax:end', () => {
      bindNativeObserver();
      scheduleSync();
      hideNativePage();
      if (state.filters.id) scheduleBackgroundIdLookup(state.filters.id, true);
      ensureModerationBackgroundMode(true);
    });

    syncSidebarActiveState();
  }

  function bootstrap() {
    if (!window.__tmV8ClarifyRouteBridgeBound) {
      window.__tmV8ClarifyRouteBridgeBound = true;
      const applySharedRouteUpdate = (detail) => {
        const requestId = normalizeRequestId(detail?.requestId || '');
        if (!requestId) return;
        clarifyRouteCacheMemo.readAt = 0;
        clarifyRouteCacheMemo.data = {};
        const updatedAt = Number(detail?.updatedAt || Date.now());
        applyClarifyRouteState(requestId, {
          hasFarTrip: Boolean(detail?.hasFarTrip)
        }, updatedAt);
        renderAll();
      };
      window.addEventListener('tm-clarify-route-flags-updated', (event) => {
        applySharedRouteUpdate(event?.detail || {});
      });
      window.addEventListener('storage', (event) => {
        if (event.key === CLARIFY_ROUTE_CACHE_KEY) {
          clarifyRouteCacheMemo.readAt = 0;
          clarifyRouteCacheMemo.data = {};
          renderAll();
        }
      });
    }
    if (!window.__tmV8ModerationLiveBridgeBound) {
      window.__tmV8ModerationLiveBridgeBound = true;
      markCopyFileDebug('index-moderation-bridge-bound');
      if (moderationSyncChannel) {
        moderationSyncChannel.addEventListener('message', (event) => {
          const data = event?.data || {};
          if (data?.type !== 'moderation-call-state') return;
          const requestId = normalizeRequestId(data?.requestId || '');
          if (!requestId) return;
          if (state.remote.kind) return;
          markCopyFileDebug('index-broadcast-received', {
            requestId,
            value: normalizeText(data?.value || '')
          });
          applyModerationLiveSignal({
            stamp: `${Number(data?.updatedAt || Date.now())}:${requestId}:${normalizeText(data?.value || '')}`,
            requestId,
            value: normalizeText(data?.value || ''),
            updatedAt: Number(data?.updatedAt || Date.now())
          }, 'broadcast-channel');
        });
      }
      window.addEventListener('storage', (event) => {
        if (event.key === MODERATION_NO_ANSWER_CACHE_KEY) {
          if (state.remote.kind) return;
          markCopyFileDebug('index-cache-storage', {
            requestId: normalizeText(state.rows?.find?.((row) => row?.statusKey === 'mod')?.id || ''),
            value: normalizeText(event.newValue || '').slice(0, 120)
          });
          moderationNoAnswerCacheMemo.readAt = 0;
          moderationNoAnswerCacheMemo.data = {};
          moderationCallStateById.clear();
          state.rows = hydrateModerationCallStates(state.rows);
          if (Array.isArray(state.remote.rows)) {
            state.remote.rows = hydrateModerationCallStates(state.remote.rows);
          }
          markCopyFileDebug('index-cache-hydrated');
          scheduleModerationCallRender();
        }
        if (event.key === MODERATION_LIVE_SIGNAL_KEY && event.newValue) {
          const detail = readModerationLiveSignal();
          if (detail) {
            applyModerationLiveSignal(detail, 'storage-signal');
          }
        }
      });
    }
    const cachedModerationCount = readModerationCountCache();
    if (Number.isFinite(cachedModerationCount) && cachedModerationCount >= 0) {
      state.moderationCount = Math.floor(cachedModerationCount);
    }
    bindV8ViewportSync();
    ensureIconFont();
    ensureStyle();
    mountUI();
    applyTheme(readSavedTheme());
    bindUI();
    hideNativePage();
    bindNativeObserver();
    syncFromNative();
    [350, 1000, 2200, 4200].forEach((delay) => {
      setTimeout(ensureMainModerationCallStatesInBackground, delay);
    });
    ensureModerationBackgroundMode(true);
    refreshModerationCountInBackground();
    if (state.filters.id) scheduleBackgroundIdLookup(state.filters.id, true);

    setInterval(() => {
      bindNativeObserver();
      scheduleSync();
      hideNativePage();
      syncAutoCleanupMenuLabel();
      refreshModerationCountInBackground();
      ensureModerationBackgroundMode(false);
      ensureMainModerationCallStatesInBackground();
      refreshPersonalModeInBackground(false);
      void refreshBulkClipboardPhones(false);
      const liveSignal = readModerationLiveSignal();
      if (liveSignal) {
        applyModerationLiveSignal(liveSignal, 'interval-poll');
      }
    }, 3000);

    // Keep "minutes ago" and severity colors fresh even without table mutations.
    setInterval(() => {
      if (state.remote.kind === 'dispatcher-report' || state.remote.kind === 'customer-directory') return;
      // Нет смысла перерисовывать скрытую вкладку.
      if (typeof document !== 'undefined' && document.hidden) return;
      // Выполняем в момент отрисовки кадра, чтобы не спотыкать анимации.
      requestAnimationFrame(() => renderAll());
    }, 5000);

    // Когда возвращаемся на вкладку — досинкиваемся, если пропустили обновления в фоне.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      // Вернулись на вкладку — досинк + один досчёт бейджа (в фоне не считали).
      if (state.syncPendingWhileHidden) scheduleSync();
      try { void refreshModerationCountInBackground(); } catch (_e) {}
      if (state.remote.kind === 'moderation') { try { void loadModerationRowsInBackground(false); } catch (_e2) {} }
    });

    // Refresh the complete moderation list through authenticated CRM fetches.
    setInterval(() => {
      if (state.remote.kind !== 'moderation') return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadModerationRowsInBackground(false);
    }, MODERATION_VIEW_REFRESH_MS);

    // «Открыть номера»: раз в минуту дотягиваем заявки, добавленные по этим номерам другими диспетчерами.
    setInterval(() => {
      if (state.remote.kind !== 'bulk-phones') return;
      void refreshBulkPhonesInBackground();
    }, BULK_PHONES_REFRESH_MS);

  }


  bootstrap();
})();

// Лёгкий v8-синк страницы заявки: обновляет только собственный кэш времени звонка.
(() => {
  'use strict';

  const COPY_UPDATE_DIAG_BUILD = 'copy-file-update-2026-06-28-003';
  function markCopyUpdateDebug(stage, extra = {}) {
    const payload = {
      build: COPY_UPDATE_DIAG_BUILD,
      stage,
      path: location.pathname,
      search: location.search,
      at: Date.now(),
      ...extra
    };
    try { window.__tmCrmV8CopyUpdateDebug = payload; } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-update-build', COPY_UPDATE_DIAG_BUILD); } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-update-stage', String(stage || '')); } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-update-request-id', String(extra.requestId || '')); } catch (_error) {}
    try { document.documentElement.setAttribute('data-tm-crm-v8-copy-update-value', String(extra.parsedValue || extra.value || '')); } catch (_error) {}
    try { localStorage.setItem('tm-crm-v8-copy-update-build', JSON.stringify(payload)); } catch (_error) {}
  }
  markCopyUpdateDebug('update-entry');

  if (window.top !== window.self) return;
  if (!location.pathname.includes('/customer-request/update')) {
    markCopyUpdateDebug('update-skip-non-update');
    return;
  }
  markCopyUpdateDebug('update-activated');

  const MODERATION_NO_ANSWER_CACHE_KEY = 'tm-crm-v8-moderation-no-answer-time-cache-v1';
  const MODERATION_NO_ANSWER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MODERATION_UPDATE_CHANNEL_NAME = 'tm-crm-v8-moderation-sync-v1';
  const MODERATION_LIVE_SIGNAL_KEY = 'tm-crm-v8-moderation-live-sync-signal-v1';
  const CLARIFY_AWAIT_CACHE_KEY = 'tm-clarify-await-click-time-cache-v1';
  const CLARIFY_AWAIT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  let syncTimer = 0;
  let serviceCommentSnapshot = '';
  let moderationUpdateChannel = null;
  let moderationNotifyTimer = 0;

  try {
    moderationUpdateChannel = new BroadcastChannel(MODERATION_UPDATE_CHANNEL_NAME);
  } catch (_error) {
    moderationUpdateChannel = null;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function broadcastModerationCallState(requestId, value, updatedAt = Date.now(), source = '') {
    const id = normalizeText(requestId);
    if (!id || !moderationUpdateChannel) return;
    try {
      moderationUpdateChannel.postMessage({
        type: 'moderation-call-state',
        requestId: id,
        value: normalizeText(value || ''),
        updatedAt: Number(updatedAt || Date.now()),
        source: normalizeText(source || '')
      });
    } catch (_error) {}
  }

  function getRequestId() {
    return new URLSearchParams(location.search).get('id') || '';
  }

  function getServiceCommentField() {
    return document.querySelector('textarea[name="CustomerRequest[comments_service]"]')
      || document.querySelector('#customerrequest-comments_service')
      || document.querySelector('textarea[name*="comments_service"]');
  }

  function getServiceCommentText() {
    const field = getServiceCommentField();
    if (!field) return null;
    return String(field.value || field.textContent || '');
  }

  function formatNowRuDateTime(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear() % 100).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  }

  function readClarifyAwaitCacheRaw() {
    try {
      const raw = localStorage.getItem(CLARIFY_AWAIT_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

      const now = Date.now();
      let changed = false;
      const normalized = {};
      Object.entries(parsed).forEach(([requestId, entry]) => {
        const id = normalizeText(requestId);
        const value = normalizeText(entry?.value || '');
        const updatedAt = Number(entry?.updatedAt || 0);
        if (!id || !value || !updatedAt || (now - updatedAt) > CLARIFY_AWAIT_CACHE_TTL_MS) {
          changed = true;
          return;
        }
        normalized[id] = { value, updatedAt };
      });
      if (changed) {
        localStorage.setItem(CLARIFY_AWAIT_CACHE_KEY, JSON.stringify(normalized));
      }
      return normalized;
    } catch (_error) {
      return {};
    }
  }

  function writeClarifyAwaitCacheRaw(cache) {
    try {
      localStorage.setItem(CLARIFY_AWAIT_CACHE_KEY, JSON.stringify(cache && typeof cache === 'object' ? cache : {}));
    } catch (_error) {}
  }

  function saveClarifyAwaitClickTime(requestId, dateTimeText, source = '') {
    const id = normalizeText(requestId);
    const value = normalizeText(dateTimeText);
    if (!id || !value) return;
    const cache = readClarifyAwaitCacheRaw();
    cache[id] = {
      value,
      updatedAt: Date.now()
    };
    writeClarifyAwaitCacheRaw(cache);
    markCopyUpdateDebug('clarify-await-cache-write', {
      requestId: id,
      parsedValue: value,
      source: normalizeText(source || '')
    });
  }

  function isClarifyStatusButton(element) {
    if (!element) return false;
    const node = element.closest('button, a, input[type="submit"], input[type="button"]');
    if (!node) return false;
    const text = normalizeText(node.textContent || node.value || '').toLowerCase();
    if (text === 'на уточнение' || text.includes('на уточнен')) return true;
    const onclickText = String(node.getAttribute('onclick') || '').toLowerCase();
    return onclickText.includes('saveandclose(this, 3)') || onclickText.includes('saveandclose(this,3)');
  }

  function bindClarifyAwaitClickTracker() {
    if (document.documentElement.dataset.tmCrmV8ClarifyAwaitTrackerBound === '1') return;
    document.documentElement.dataset.tmCrmV8ClarifyAwaitTrackerBound = '1';
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !isClarifyStatusButton(target)) return;
      if (event.ctrlKey || event.metaKey) return;
      const requestId = normalizeText(getRequestId());
      if (!requestId) return;
      const dateTimeText = formatNowRuDateTime(new Date());
      saveClarifyAwaitClickTime(requestId, dateTimeText, 'clarify-click');
    }, true);
  }

  function extractLastModerationCallDateTime(commentText) {
    const text = String(commentText || '').replace(/\r/g, '\n');
    const parseRuDateTimeToMillisLocal = (value) => {
      const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
      if (!match) return NaN;
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = 2000 + Number(match[3]);
      const hours = Number(match[4]);
      const minutes = Number(match[5]);
      const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
      if (!Number.isFinite(date.getTime())) return NaN;
      if (date.getFullYear() !== year || (date.getMonth() + 1) !== month || date.getDate() !== day) return NaN;
      return date.getTime();
    };
    const pickLatest = (matches) => {
      let bestValue = '';
      let bestTs = NaN;
      matches.forEach((match) => {
        const value = normalizeText(match?.[1] || '');
        const ts = parseRuDateTimeToMillisLocal(value);
        if (!value) return;
        if (!Number.isFinite(bestTs) || (Number.isFinite(ts) && ts >= bestTs)) {
          bestValue = value;
          bestTs = ts;
        }
      });
      return bestValue;
    };
    const notAnswerMatches = Array.from(text.matchAll(/(\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2})\s*не\s*отвечает/gi));
    if (notAnswerMatches.length) {
      return pickLatest(notAnswerMatches);
    }
    const dateTimeMatches = Array.from(text.matchAll(/(\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2})/g));
    return pickLatest(dateTimeMatches);
  }

  function extractServiceCommentFromDoc(doc) {
    const field = doc?.querySelector('textarea[name="CustomerRequest[comments_service]"]')
      || doc?.querySelector('#customerrequest-comments_service')
      || doc?.querySelector('textarea[name*="comments_service"]');
    return String(field?.value || field?.textContent || '');
  }

  function parseModerationCallStampMs(value) {
    const match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) return NaN;
    const year = 2000 + Number(match[3]);
    const month = Number(match[2]);
    const day = Number(match[1]);
    const date = new Date(year, month - 1, day, Number(match[4]), Number(match[5]), 0, 0);
    if (!Number.isFinite(date.getTime())) return NaN;
    if (date.getFullYear() !== year || (date.getMonth() + 1) !== month || date.getDate() !== day) return NaN;
    return date.getTime();
  }

  // Значение звонка может только «идти вперёд»: не затираем известный «не отвечает» пустым
  // или более старым результатом (напр. ранний refresh-фетч со ещё не обновлённым комментарием).
  function shouldReplaceModerationCallValue(prevValue, nextValue) {
    const prev = normalizeText(prevValue || '');
    const next = normalizeText(nextValue || '');
    if (!prev) return true;
    if (!next) return false;
    const prevTs = parseModerationCallStampMs(prev);
    const nextTs = parseModerationCallStampMs(next);
    if (Number.isFinite(prevTs) && Number.isFinite(nextTs)) return nextTs >= prevTs;
    return true;
  }

  function writeModerationNoAnswerCacheEntry(requestId, value) {
    const id = normalizeText(requestId);
    if (!id) return;
    const now = Date.now();
    let cache = {};
    try {
      const raw = localStorage.getItem(MODERATION_NO_ANSWER_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        cache = parsed;
      }
    } catch (_error) {}

    Object.keys(cache).forEach((key) => {
      const updatedAt = Number(cache[key]?.updatedAt || 0);
      if (!updatedAt || (now - updatedAt) > MODERATION_NO_ANSWER_CACHE_TTL_MS) {
        delete cache[key];
      }
    });

    const prevCachedValue = normalizeText(cache[id]?.value || '');
    const effectiveValue = shouldReplaceModerationCallValue(prevCachedValue, value)
      ? normalizeText(value || '')
      : prevCachedValue;
    cache[id] = {
      value: effectiveValue,
      updatedAt: now
    };
    try {
      localStorage.setItem(MODERATION_NO_ANSWER_CACHE_KEY, JSON.stringify(cache));
    } catch (_error) {}
    markCopyUpdateDebug('cache-write', {
      requestId: id,
      value: normalizeText(value || ''),
      cacheSize: Object.keys(cache).length
    });
    broadcastModerationCallState(id, effectiveValue, now, 'update-page-write');
    try {
      localStorage.setItem(MODERATION_LIVE_SIGNAL_KEY, JSON.stringify({
        stamp: `${now}:${id}:${effectiveValue}`,
        requestId: id,
        value: effectiveValue,
        updatedAt: now,
        source: 'update-page-write'
      }));
    } catch (_error) {}
    markCopyUpdateDebug('cache-write-complete', {
      requestId: id,
      value: normalizeText(value || ''),
      cacheSize: Object.keys(cache).length
    });
  }

  function notifyModerationUpdateNow(source = 'direct') {
    const requestId = normalizeText(getRequestId());
    if (!requestId) return;
    const rawComment = getServiceCommentText();
    if (rawComment === null) return;
    const value = extractLastModerationCallDateTime(rawComment);
    writeModerationNoAnswerCacheEntry(requestId, value);
    markCopyUpdateDebug('notify-now', {
      requestId,
      parsedValue: normalizeText(value || ''),
      source
    });
  }

  function scheduleModerationUpdateNotify(delay = 0, source = 'scheduled') {
    if (moderationNotifyTimer) clearTimeout(moderationNotifyTimer);
    moderationNotifyTimer = setTimeout(() => {
      moderationNotifyTimer = 0;
      notifyModerationUpdateNow(source);
    }, delay);
  }

  function syncCurrentRequestModerationCallState() {
    const requestId = getRequestId();
    if (!requestId) return;
    const rawComment = getServiceCommentText();
    if (rawComment === null) return;
    const value = extractLastModerationCallDateTime(rawComment);
    markCopyUpdateDebug('sync-current', {
      requestId,
      parsedValue: normalizeText(value || ''),
      commentLength: String(rawComment || '').length
    });
    writeModerationNoAnswerCacheEntry(requestId, value);
  }

  async function refreshCurrentRequestModerationCallStateFromServer() {
    const requestId = getRequestId();
    if (!requestId) return;
    try {
      const response = await fetch(location.href, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rawComment = extractServiceCommentFromDoc(doc);
      const value = extractLastModerationCallDateTime(rawComment);
      markCopyUpdateDebug('sync-server', {
        requestId,
        parsedValue: normalizeText(value || ''),
        commentLength: String(rawComment || '').length
      });
      writeModerationNoAnswerCacheEntry(requestId, value);
    } catch (_error) {}
  }

  function scheduleSync(delay = 0) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncTimer = 0;
      syncCurrentRequestModerationCallState();
    }, delay);
  }

  function bindServiceCommentField() {
    const field = getServiceCommentField();
    if (!field || field.dataset.tmCrmV8ModerationCallSyncBound === '1') return;
    field.dataset.tmCrmV8ModerationCallSyncBound = '1';
    field.addEventListener('input', () => {
      scheduleSync(0);
      scheduleModerationUpdateNotify(0, 'field-input');
    });
    field.addEventListener('change', () => {
      scheduleSync(0);
      scheduleModerationUpdateNotify(0, 'field-change');
    });
    field.addEventListener('blur', () => {
      scheduleSync(0);
      scheduleModerationUpdateNotify(0, 'field-blur');
    });
  }

  function bindNoAnswerButtons() {
    const buttons = Array.from(document.querySelectorAll('#actSaveServiceComment, a#actSaveServiceComment, button#actSaveServiceComment, a.btn, button.btn'));
    buttons.forEach((button) => {
      if (!(button instanceof HTMLElement) || button.dataset.tmCrmV8NoAnswerSyncBound === '1') return;
      const text = normalizeText(button.textContent || '').toLowerCase();
      const id = String(button.id || '').trim();
      if (id !== 'actSaveServiceComment' && !text.includes('не отвечает')) return;
      button.dataset.tmCrmV8NoAnswerSyncBound = '1';
      button.addEventListener('click', () => {
        [0, 90, 220, 500, 1000, 1700, 2600, 3800].forEach((delay) => {
          setTimeout(() => {
            syncCurrentRequestModerationCallState();
            notifyModerationUpdateNow(`click-sync-${delay}`);
          }, delay);
        });
        [700, 1800, 3200, 4800].forEach((delay) => {
          setTimeout(() => {
            void refreshCurrentRequestModerationCallStateFromServer();
            notifyModerationUpdateNow(`click-refresh-${delay}`);
          }, delay);
        });
      }, true);
    });
  }

  function watchServiceCommentChanges() {
    const raw = getServiceCommentText();
    if (raw === null) return;
    if (raw !== serviceCommentSnapshot) {
      serviceCommentSnapshot = raw;
      syncCurrentRequestModerationCallState();
      scheduleModerationUpdateNotify(0, 'watch-change');
    }
  }

  function start() {
    bindClarifyAwaitClickTracker();
    bindServiceCommentField();
    bindNoAnswerButtons();
    watchServiceCommentChanges();
    const observer = new MutationObserver(() => scheduleModerationUpdateNotify(30, 'mutation'));
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
    scheduleModerationUpdateNotify(0, 'start');
    setInterval(() => {
      bindServiceCommentField();
      bindNoAnswerButtons();
      watchServiceCommentChanges();
    }, 350);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

// Блок для страницы создания заявки — открывает "новый клиент" без вставки номера
(() => {
  if (window.top !== window.self) return;
  if (!location.pathname.includes('/customer-request/create')) return;

  const isOpenAllNumbersReferrer = (() => {
    try {
      const ref = new URL(document.referrer || '', location.origin);
      return ref.pathname.includes('/customer-request/index') && ref.searchParams.get('tm_open_all_numbers') === '1';
    } catch (_e) { return false; }
  })();

  if (!isOpenAllNumbersReferrer) return;

  const findToggler = () => {
    const byId = document.querySelector('#newCustomerToggler');
    if (byId instanceof HTMLElement) return byId;
    return Array.from(document.querySelectorAll('button, a, div, span, label, [role="button"]')).find((el) => {
      return String(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase().includes('добавить нового клиента');
    }) || null;
  };

  const triggerToggler = (toggler) => {
    const jq = window.jQuery || window.$;
    const targetSel = toggler.getAttribute('data-target') || toggler.getAttribute('href') || '#newCustomer';
    const targetEl = document.querySelector(targetSel);
    if (typeof jq === 'function') {
      try { jq(targetSel).collapse('show'); } catch (_e) {}
    }
    if (targetEl instanceof HTMLElement) {
      targetEl.classList.remove('collapse');
      targetEl.classList.add('show');
      targetEl.style.display = '';
    }
    if (typeof jq === 'function') {
      try { jq(toggler).trigger('click'); } catch (_e) {}
    }
    toggler.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    toggler.click();
  };

  const isOpened = () => {
    const target = document.querySelector('#newCustomer');
    return target instanceof HTMLElement && target.classList.contains('show');
  };

  let attempts = 0;
  let lastAttemptAt = 0;
  const id = setInterval(() => {
    attempts++;
    if (isOpened() || attempts >= 40) { clearInterval(id); return; }
    const toggler = findToggler();
    if (toggler instanceof HTMLElement && (Date.now() - lastAttemptAt) >= 500) {
      lastAttemptAt = Date.now();
      triggerToggler(toggler);
    }
  }, 250);
})();


