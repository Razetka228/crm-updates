// Диагностика (встроена в расширение). Главное: КОНВЕЙЕР НОМЕРА на первичной create — почему номер
// из ?phone= не попадает в поле (баг машинно-зависимый, гонка загрузки). Трассирует по таймингам:
//   ?phone= из URL → нативное #customer-phone → window.__crmCreateInitData.phone → UI-поле #phList,
// и на 8с выдаёт ★ВЕРДИКТ с указанием звена, где рвётся. Плюс: пропажа номера/истории (исчезновение),
// нативный грид, JS-ошибки, среда (cores/тайминги загрузки — для корреляции со «слабой машиной»).
// Свёрнута в кнопку «🩺 диаг» (внизу слева), при баге краснеет; панель с логом и «копировать».
// ВРЕМЕННАЯ — убрать из manifest.json, когда причина найдена.
(function () {
  'use strict';

  var EVENTS = [];
  var BUG_COUNT = 0;
  var T0 = Date.now();

  function now() { return ((Date.now() - T0) / 1000).toFixed(1) + 'с'; }
  function clock() { var d = new Date(); return d.toLocaleTimeString('ru-RU') + '.' + String(d.getMilliseconds()).padStart(3, '0'); }

  function stackShort() {
    try {
      var s = new Error().stack || '';
      var lines = s.split('\n').slice(3, 9).map(function (x) { return x.trim(); });
      return lines.join(' | ');
    } catch (_) { return ''; }
  }

  function ctxInfo() {
    var p = location.pathname || '';
    var params = new URLSearchParams(location.search || '');
    var kind = /\/customer-request\/create/.test(p) ? 'create'
      : /\/customer-request\/update/.test(p) ? 'request-update'
      : /\/customer\/update/.test(p) ? 'customer-card'
      : 'other';
    return {
      kind: kind,
      customerId: params.get('customer_id') || '',
      id: params.get('id') || '',
      primaryNoCard: kind === 'create' && !params.get('customer_id')
    };
  }

  function addEvent(tag, msg, detail, isBug) {
    EVENTS.push({ t: clock(), rel: now(), tag: tag, msg: msg, detail: detail || '', ctx: ctxInfo() });
    if (EVENTS.length > 400) EVENTS.splice(0, 150);
    if (isBug) { BUG_COUNT++; flashBug(); }
    updatePanel();
    try { console.log('[disappear-diag]', tag, msg, detail || ''); } catch (_) {}
  }

  // ── (1) Номер телефона ──────────────────────────────────────────────────────
  var PHONE_SEL = '#phList input.phone-short, #customer-phone, input[name="Customer[phone]"], input[name^="Customer[contact_phones]"]';
  var nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var lastPrimaryPhone = '';

  function isVisiblePhone(el) { return el && !(el.classList && el.classList.contains('phone-hidden')); }

  function primaryPhoneEl() {
    var list = document.querySelectorAll('#phList input.phone-short');
    for (var i = 0; i < list.length; i++) { if (isVisiblePhone(list[i])) return list[i]; }
    return document.querySelector('#customer-phone, input[name="Customer[phone]"]');
  }

  function hookPhoneInput(el) {
    if (!el || el.__tmDisappearHooked) return;
    el.__tmDisappearHooked = true;
    try {
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: function () { return nativeValueDesc.get.call(this); },
        set: function (v) {
          var prev = '';
          try { prev = nativeValueDesc.get.call(this); } catch (_) {}
          nativeValueDesc.set.call(this, v);
          try {
            if (prev && String(prev).trim() && !String(v).trim()) {
              addEvent('НОМЕР', 'Номер ОЧИЩЕН (value = ""), был "' + prev + '"', 'setter | ' + stackShort(), true);
            }
          } catch (_) {}
        }
      });
    } catch (_) {}
  }

  function hookAllPhones() { try { document.querySelectorAll(PHONE_SEL).forEach(hookPhoneInput); } catch (_) {} }

  function pollPhone() {
    try {
      var el = primaryPhoneEl();
      var cur = el ? String(el.value || '').trim() : '';
      if (lastPrimaryPhone && !cur) {
        var reason = el ? 'поле есть, значение пустое' : 'ИНПУТ ПРОПАЛ из DOM';
        addEvent('НОМЕР', 'Номер ПРОПАЛ из поля (было "' + lastPrimaryPhone + '") — ' + reason,
          'poll | phones-в-DOM=' + document.querySelectorAll('#phList input.phone-short').length, true);
      }
      if (cur) lastPrimaryPhone = cur;
    } catch (_) {}
  }

  // ── (1b) КОНВЕЙЕР НОМЕРА: почему номер НЕ ПОЯВИЛСЯ на первичной create ───────
  // Баг машинно-зависимый (гонка загрузки). Пишем всю цепочку с таймингами:
  //   ?phone= из URL → нативное #customer-phone → window.__crmCreateInitData.phone
  //   (что схватил collectInitialData) → UI-поле #phList. На сломанной машине копия
  //   покажет, на КАКОМ звене рвётся (натив пуст на момент захвата? init.phone пуст?
  //   init есть, но в UI не доехал?).
  var PH = { urlPhone: '', urlRaw: '', nativeFirst: null, nativeLast: null, nativeAttrLast: null,
             initSeen: null, initPhone: null, initPhones: '', initNativeAtCapture: null, initAttrAtCapture: null,
             uiFirst: null, uiLast: null, bootSeen: null, verdictDone: false };
  function phDigits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function phNorm(s) { var d = phDigits(s); if (d.length === 10) d = '7' + d; if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1); return (d.length === 11 && d.charAt(0) === '7') ? ('+' + d) : ''; }
  function phReadUrl() { try { var raw = new URLSearchParams(location.search || '').get('phone') || ''; PH.urlRaw = raw; PH.urlPhone = phNorm(raw); } catch (_) {} }
  function phNative() { try { var el = document.querySelector('#customer-phone, input[name="Customer[phone]"]'); return el ? String(el.value || '') : null; } catch (_) { return null; } }
  function phUi() { try { var el = document.querySelector('#phList input.phone-short:not(.phone-hidden)'); return el ? String(el.value || '') : null; } catch (_) { return null; } }
  function phNativeEl() { try { return document.querySelector('#customer-phone, input[name="Customer[phone]"]'); } catch (_) { return null; } }
  function phNativeAttr() { try { var el = phNativeEl(); return el ? el.getAttribute('value') : null; } catch (_) { return null; } }
  function phNativeCount() { try { return document.querySelectorAll('#customer-phone, input[name="Customer[phone]"]').length; } catch (_) { return 0; } }
  function phNativeHtml() { try { var el = phNativeEl(); return el ? String(el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 240) : ''; } catch (_) { return ''; } }
  // Ищем цифры номера из URL в ЛЮБОМ input/textarea (и в .value, и в атрибуте value) — понять,
  // положил ли сервер/натив номер куда-то, куда collectInitialData не смотрит.
  function phScanInputs() {
    try {
      var want = phDigits(PH.urlPhone).slice(-10); if (!want) return '(нет urlPhone)';
      var found = []; var all = document.querySelectorAll('input,textarea');
      for (var i = 0; i < all.length; i++) {
        var id = all[i].id || all[i].name || all[i].tagName;
        if (phDigits(all[i].value).indexOf(want) >= 0) found.push('val:' + id);
        else { var a = all[i].getAttribute && all[i].getAttribute('value'); if (a && phDigits(a).indexOf(want) >= 0) found.push('attr:' + id); }
      }
      return found.length ? found.join(',') : 'НИГДЕ (' + all.length + ' инпутов)';
    } catch (_) { return '?'; }
  }
  // Перечисляем ВСЕ #customer-phone / Customer[phone] поэлементно (порядок в DOM = порядок, в котором
  // querySelector их находит). Покажет: [0]=наш пустой мираж, [1]=нативный с номером (или наоборот).
  function phEnumNatives() {
    try {
      var els = document.querySelectorAll('#customer-phone, input[name="Customer[phone]"]');
      if (!els.length) return '(нет)';
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        out.push('[' + i + '] id=' + (e.id || '—') + ' name=' + (e.getAttribute('name') || '—') +
          ' .value="' + String(e.value || '') + '" attr="' + e.getAttribute('value') + '"' +
          ' disp=' + ((e.style && e.style.display) || '') + ' conn=' + e.isConnected +
          ' cls=' + (e.className || '—'));
      }
      return out.join('   ||   ');
    } catch (_) { return '?'; }
  }
  function navTiming() {
    try {
      var e = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (e) return 'domInteractive=' + Math.round(e.domInteractive) + 'ms domContentLoaded=' + Math.round(e.domContentLoadedEventEnd) + 'ms domComplete=' + Math.round(e.domComplete) + 'ms';
      var t = performance.timing; if (t && t.navigationStart) return 'domInteractive=' + (t.domInteractive - t.navigationStart) + 'ms';
    } catch (_) {}
    return '';
  }
  function trackPhonePipeline() {
    try {
      if (ctxInfo().kind !== 'create') return;
      // Момент replacePage: наш UI заменяет страницу, оригинальный натив #customer-phone уничтожается.
      if (PH.bootSeen === null && window.__tmCreateBootDone) {
        PH.bootSeen = now();
        addEvent('НОМЕР·boot', 'replacePage ВЫПОЛНЕН t=' + PH.bootSeen + ' reason=' + String(window.__tmCreateBootReason || '?') + ' readyState=' + document.readyState,
          'натив на момент replace: .value="' + phNative() + '" attr(value)="' + phNativeAttr() + '" | urlPhone где: ' + phScanInputs());
      }
      var nv = phNative();
      if (nv !== null) {
        if (PH.nativeFirst === null) {
          PH.nativeFirst = now(); PH.nativeLast = nv; PH.nativeAttrLast = phNativeAttr();
          addEvent('НОМЕР·натив', '#customer-phone ПОЯВИЛСЯ: .value="' + nv + '"  attr(value)="' + PH.nativeAttrLast + '"  count=' + phNativeCount() + '  readyState=' + document.readyState,
            'urlPhone где-либо: ' + phScanInputs() + '  ||  outerHTML: ' + phNativeHtml());
        } else {
          var a2 = phNativeAttr();
          if (nv !== PH.nativeLast) { addEvent('НОМЕР·натив', '#customer-phone .value: "' + PH.nativeLast + '"→"' + nv + '"', ''); PH.nativeLast = nv; }
          if (a2 !== PH.nativeAttrLast) { addEvent('НОМЕР·натив', '#customer-phone attr(value): "' + PH.nativeAttrLast + '"→"' + a2 + '"', ''); PH.nativeAttrLast = a2; }
        }
      }
      if (PH.initSeen === null && window.__crmCreateInitData) {
        PH.initSeen = now();
        var d = window.__crmCreateInitData || {};
        PH.initPhone = String(d.phone == null ? '' : d.phone);
        try { PH.initPhones = JSON.stringify(d.phones || []); } catch (_e) { PH.initPhones = '?'; }
        PH.initNativeAtCapture = phNative();
        PH.initAttrAtCapture = phNativeAttr();
        var noInit = !phDigits(PH.initPhone).length;
        addEvent('НОМЕР·init', '__crmCreateInitData: phone="' + PH.initPhone + '" phones=' + PH.initPhones,
          'на момент захвата: count=' + phNativeCount() + ' bootReason=' + String(window.__tmCreateBootReason || '?') + ' readyState=' + document.readyState + ' | urlPhone где: ' + phScanInputs() +
          '\n        ВСЕ customer-phone: ' + phEnumNatives(),
          noInit && !!PH.urlPhone);
      }
      var uv = phUi();
      if (uv !== null) {
        if (PH.uiFirst === null) { PH.uiFirst = now(); PH.uiLast = uv; addEvent('НОМЕР·UI', 'поле #phList создано value="' + uv + '"', ''); }
        else if (uv !== PH.uiLast) { addEvent('НОМЕР·UI', 'UI-поле: "' + PH.uiLast + '"→"' + uv + '"', ''); PH.uiLast = uv; }
      }
    } catch (_) {}
  }
  function phoneVerdict() {
    try {
      if (PH.verdictDone) return;
      if (ctxInfo().kind !== 'create') return;
      if ((Date.now() - T0) < 8000) return;
      PH.verdictDone = true;
      phReadUrl();
      var uv = phUi(); var ok = !!uv && phDigits(uv).length >= 10;
      var summary = 'urlPhone="' + PH.urlPhone + '" (raw="' + PH.urlRaw + '")\n' +
        '        натив #customer-phone: ' + (PH.nativeFirst ? ('появ ' + PH.nativeFirst + ', .value="' + PH.nativeLast + '", attr(value)="' + PH.nativeAttrLast + '"') : 'НЕ БЫЛО в DOM') + '\n' +
        '        replacePage: ' + (PH.bootSeen ? ('t=' + PH.bootSeen + ' reason=' + String(window.__tmCreateBootReason || '?')) : 'НЕ ВИДЕЛ') + '\n' +
        '        __crmCreateInitData: ' + (PH.initSeen ? ('видел ' + PH.initSeen + ', phone="' + PH.initPhone + '", натив@захват .value="' + PH.initNativeAtCapture + '" attr="' + PH.initAttrAtCapture + '"') : 'НЕ ВИДЕЛ') + '\n' +
        '        UI-поле #phList: ' + (PH.uiFirst ? ('созд ' + PH.uiFirst + ', посл="' + PH.uiLast + '"') : 'НЕ БЫЛО') + '\n' +
        '        urlPhone сейчас на странице: ' + phScanInputs() + '\n' +
        '        ВСЕ customer-phone СЕЙЧАС: ' + phEnumNatives();
      var diag;
      if (ok) diag = 'OK: номер в UI-поле ("' + uv + '")';
      else if (PH.urlPhone && PH.initSeen && !phDigits(PH.initPhone).length)
        diag = '★ БАГ: init.phone ПУСТ, хотя в URL ?phone="' + PH.urlPhone + '". collectInitialData прочёл #customer-phone="' + PH.initNativeAtCapture + '" (нативное поле пусто на момент захвата). ?phone= из URL как источник НЕ используется → номер потерян.';
      else if (PH.urlPhone && phDigits(PH.initPhone).length && !ok)
        diag = '★ БАГ: init.phone="' + PH.initPhone + '" был, но в UI-поле не доехал (applyInitData не поставил или поле пересоздано после).';
      else if (PH.urlPhone && !PH.initSeen)
        diag = '★ БАГ: __crmCreateInitData так и не появился за 8с (replacePage/boot не отработал?), urlPhone="' + PH.urlPhone + '".';
      else if (!PH.urlPhone) diag = 'нет ?phone= в URL — не наш кейс (номер мог прийти иначе)';
      else diag = '★ БАГ: номер не в поле (нераспознанная причина)';
      addEvent('★ВЕРДИКТ·НОМЕР', diag, summary, !ok && !!PH.urlPhone);
    } catch (_) {}
  }

  // ── (1c) КНОПКА «Перевести в Не оформлена» (модерация/закрытые статусы) ──────
  // Иногда не появляется (гонка). userscript публикует входы решения в window.__tmNfDiag; здесь
  // показываем их + DOM (бар/кнопка/натив-футер) и на 8с — вердикт: какой гейт не прошёл.
  var NF = { seen: false, barFirst: null, btnFirst: null, verdictDone: false };
  function nfNativeFooterBtns() {
    try {
      var els = document.querySelectorAll('form#customerRequestForm .card-footer button, form#customerRequestForm .card-footer a.btn');
      if (!els.length) return '(нет .card-footer кнопок)';
      var out = [];
      for (var i = 0; i < els.length; i++) {
        var t = String(els[i].textContent || els[i].value || '').replace(/\s+/g, ' ').trim().slice(0, 26);
        var href = String((els[i].getAttribute && els[i].getAttribute('href')) || els[i].href || '');
        var mark = href.indexOf('cancel-to-not-taken') >= 0 ? '[cancel-to-not-taken]' : ((/перевести/i.test(t) && /оформлен/i.test(t)) ? '[перевести-нф]' : '');
        out.push('"' + t + '"' + mark);
      }
      return out.join(', ');
    } catch (_) { return '?'; }
  }
  function nfBtnVisible(el) { try { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); } catch (_) { return false; } }
  // v11-кнопка «Не оформлена» = видимая кнопка с этим текстом ВНЕ нативного .card-footer.
  function nfBtnPresent() {
    try {
      var b = document.querySelectorAll('button, a.btn');
      for (var i = 0; i < b.length; i++) {
        if (!/не\s*оформлен/i.test(b[i].textContent || '')) continue;
        if (b[i].closest && b[i].closest('form#customerRequestForm .card-footer')) continue;
        if (nfBtnVisible(b[i])) return true;
      }
      return false;
    } catch (_) { return false; }
  }
  function trackNf() {
    try {
      if (ctxInfo().kind !== 'request-update') return;
      var d = window.__tmNfModDiag;
      if (d && !NF.seen) {
        NF.seen = true;
        addEvent('НФ·build', 'блок кнопок: saveBtn=' + d.saveBtn + ' isClosedRO=' + d.isClosedReadonlyMode + ' isNotFormActive=' + d.isNotFormalizedActiveMode + ' isModeration=' + d.isModerationMode,
          'nativeNotFormalizedBtn(скан нашёл)=' + d.nativeNotFormalizedBtn + ' | футер@build: кнопок=' + d.footerBtnCount + ' есть-НФ=' + d.footerHasNf + ' | willBuildBtn=' + d.willBuildBtn + ' | rs=' + d.rs);
      }
      if (nfBtnPresent() && NF.btnFirst === null) { NF.btnFirst = now(); addEvent('НФ·кнопка', 'v11-кнопка «Не оформлена» ПОЯВИЛАСЬ', ''); }
    } catch (_) {}
  }
  function nfVerdict() {
    try {
      if (NF.verdictDone) return;
      if (ctxInfo().kind !== 'request-update') return;
      if ((Date.now() - T0) < 8000) return;
      NF.verdictDone = true;
      var btn = nfBtnPresent();
      var d = window.__tmNfModDiag || null;
      var footerNow = nfNativeFooterBtns();
      var footerHasNfNow = /не\s*оформлен/i.test(footerNow);
      var summary = 'v11-кнопка «Не оформлена» на странице=' + btn + '\n' +
        '        натив .card-footer СЕЙЧАС: ' + footerNow + '\n' +
        '        __tmNfModDiag (момент build): ' + (d ? ('saveBtn=' + d.saveBtn + ' isClosedRO=' + d.isClosedReadonlyMode + ' isNotFormActive=' + d.isNotFormalizedActiveMode + ' nativeNotFormalizedBtn=' + d.nativeNotFormalizedBtn + ' footerBtnCount=' + d.footerBtnCount + ' footerHasNf=' + d.footerHasNf + ' willBuildBtn=' + d.willBuildBtn + ' rs=' + d.rs) : 'НЕ ПУБЛИКОВАЛСЯ (build не дошёл до блока кнопок)');
      var diag;
      if (btn) diag = 'OK: кнопка есть';
      else if (!d) diag = '★ build не дошёл до блока кнопок (saveBtn не найден / UI заявки не построился).';
      else if (d.isNotFormalizedActiveMode) diag = 'кнопки нет намеренно: заявка уже в статусе НФ-актив.';
      else if (d.isClosedReadonlyMode) diag = 'заявка в закрытом статусе — кнопки модерации тут не строятся.';
      else if (!d.saveBtn) diag = '★ БАГ: saveBtn («Создать») не найдена на момент build → блок кнопок пропущен (гонка формы).';
      else if (!d.nativeNotFormalizedBtn && d.footerHasNf) diag = '★ БАГ(редкий): футер СОДЕРЖАЛ «Не оформлена» на build, но скан её не поймал (tmRefreshNativeFooterReasonButtons).';
      else if (!d.nativeNotFormalizedBtn && !d.footerHasNf) diag = '★ БАГ(ГОНКА): на build футер ещё НЕ содержал «Не оформлена» (footerHasNf=false, кнопок в футере=' + d.footerBtnCount + ') → nativeNotFormalizedBtn=null → кнопку не создали. СЕЙЧАС футер её ' + (footerHasNfNow ? 'СОДЕРЖИТ → распарсился ПОСЛЕ build, ретрая нет.' : 'не содержит → серверный/статусный кейс.');
      else if (d.willBuildBtn && !btn) diag = '★ кнопку построили (willBuildBtn=true), но её нет — удалена/перекрыта после build.';
      else diag = '★ кнопки нет при нераспознанных входах — см. __tmNfModDiag.';
      addEvent('★ВЕРДИКТ·НФ', diag, summary, !btn);
    } catch (_) {}
  }

  // ── (2) Блок «История заказов клиента» ──────────────────────────────────────
  // Контейнер истории заказов может быть под разными классами (customer-card = .tm-cu-order-list,
  // create = .tm-create-order-history) + навигация .tm-order-history-nav. Считаем блок ЕСТЬ, если есть любой.
  // Реальный блок истории (не CSS/nav): customer-card = .tm-cu-order-list/.tm-cu-order-card, create = .tm-create-order-history.
  var HIST_SEL = '.tm-cu-order-list, .tm-cu-order-card, .tm-create-order-history';
  var histWasPresent = false;
  var gridWasPresent = false;

  function histEl() { return document.querySelector(HIST_SEL); }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    var st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function checkHistory() {
    try {
      var el = histEl();
      var present = isVisible(el);
      if (present && !histWasPresent) {
        histWasPresent = true;
        addEvent('ИСТОРИЯ', 'Блок «История заказов» ПОЯВИЛСЯ', '');
      } else if (!present && histWasPresent) {
        histWasPresent = false;
        var why = !el ? 'удалён из DOM' : (!el.isConnected ? 'отсоединён' : 'скрыт (display/visibility/размер 0)');
        addEvent('ИСТОРИЯ', 'Блок «История заказов» ПРОПАЛ — ' + why, 'stack: ' + stackShort(), true);
      }
    } catch (_) {}
  }

  // Снимок ключевых узлов — чтобы понять, почему блока нет.
  function domSnapshot() {
    function c(sel) { try { return document.querySelectorAll(sel).length; } catch (_) { return '?'; } }
    return 'cu-order-list=' + c('.tm-cu-order-list') + ' create-order-history=' + c('.tm-create-order-history') +
      ' order-history=' + c('.tm-order-history') + ' nav=' + c('.tm-order-history-nav') +
      ' tm-cu-layout=' + c('.tm-cu-layout') + ' pagination=' + c('ul.pagination') +
      ' tables=' + c('table') + ' tr=' + c('table tr') + ' grid-view=' + c('.grid-view') + ' form=' + c('form');
  }

  // Детект «блок истории так и не появился» на карточке клиента.
  var histNeverLogged = false;
  function checkHistoryNeverAppeared() {
    try {
      if (histNeverLogged || histWasPresent) return;
      if (ctxInfo().kind !== 'customer-card') return;
      if ((Date.now() - T0) < 6000) return;
      histNeverLogged = true;
      addEvent('ИСТОРИЯ', 'Блок «История заказов» НЕ ПОЯВИЛСЯ за 6с (у клиента могут быть заказы, а блока нет)',
        domSnapshot(), true);
    } catch (_) {}
  }

  // Слежение за НАТИВНЫМ гридом #customer-requests-grid во времени: появился/пропал(удалён).
  // Так поймём — грид грузится поздно (ajax) или его удаляют, или его вообще нет.
  function nativeGridEl() { return document.querySelector('#customer-requests-grid'); }
  function checkGrid() {
    try {
      if (ctxInfo().kind !== 'customer-card') return;
      var g = nativeGridEl();
      var present = !!(g && g.isConnected);
      if (present && !gridWasPresent) {
        gridWasPresent = true;
        var rows = 0; try { rows = g.querySelectorAll('tbody tr').length; } catch (_) {}
        addEvent('ГРИД', 'Нативный #customer-requests-grid ПОЯВИЛСЯ (tbody tr=' + rows + ', видим=' + isVisible(g) + ')', '');
      } else if (!present && gridWasPresent) {
        gridWasPresent = false;
        addEvent('ГРИД', 'Нативный #customer-requests-grid ПРОПАЛ/УДАЛЁН из DOM', 'stack: ' + stackShort(), true);
      }
    } catch (_) {}
  }

  // Итоговый снимок на 15с (грид мог подгрузиться после 6с).
  var snap15Logged = false;
  function snapshot15() {
    try {
      if (snap15Logged) return;
      if (ctxInfo().kind !== 'customer-card') return;
      if ((Date.now() - T0) < 15000) return;
      snap15Logged = true;
      addEvent('СНИМОК-15с', (histWasPresent ? 'блок истории ЕСТЬ' : 'блока истории НЕТ') + ' | грид-появлялся=' + gridWasPresent, domSnapshot());
    } catch (_) {}
  }

  // Перехват JS-ошибок (вероятная причина — ошибка в рендере рушит блок). С дедупом.
  var errSeen = Object.create(null);
  function installErrorHook() {
    try {
      window.addEventListener('error', function (ev) {
        try {
          var msg = String((ev && ev.message) || (ev && ev.error && ev.error.message) || 'error');
          var file = ev && ev.filename ? String(ev.filename).split(/[\\/]/).pop().split('?')[0] : '';
          var loc = file + ':' + ((ev && ev.lineno) || 0) + ':' + ((ev && ev.colno) || 0);
          var key = msg + '@' + loc;
          if (errSeen[key]) { errSeen[key]++; return; }
          errSeen[key] = 1;
          var st = ev && ev.error && ev.error.stack ? ' | ' + String(ev.error.stack).split('\n').slice(0, 5).map(function (x) { return x.trim(); }).join(' | ') : '';
          addEvent('ОШИБКА', msg + '  @' + loc, st, true);
        } catch (_) {}
      }, true);
      window.addEventListener('unhandledrejection', function (ev) {
        try {
          var r = ev && ev.reason;
          var msg = 'promise: ' + String((r && r.message) || r);
          if (errSeen[msg]) { errSeen[msg]++; return; }
          errSeen[msg] = 1;
          addEvent('ОШИБКА', msg, r && r.stack ? String(r.stack).split('\n').slice(0, 5).map(function (x) { return x.trim(); }).join(' | ') : '', true);
        } catch (_) {}
      }, true);
    } catch (_) {}
  }

  // Перехват console.error/console.warn — ловим ошибки рендера, проглоченные try/catch (не доходят до window.onerror).
  function hookConsole() {
    try {
      ['error', 'warn'].forEach(function (m) {
        var orig = console[m];
        if (!orig || orig.__tmDiagHooked) return;
        var wrapped = function () {
          try {
            var parts = Array.prototype.map.call(arguments, function (a) {
              try {
                if (a && a.stack) return String(a.message || a) + ' | ' + String(a.stack).split('\n').slice(0, 5).map(function (x) { return x.trim(); }).join(' | ');
                if (a && typeof a === 'object') { try { return JSON.stringify(a).slice(0, 200); } catch (_) { return String(a); } }
                return String(a);
              } catch (_) { return String(a); }
            });
            var msg = parts.join(' ');
            if (msg && msg.indexOf('disappear-diag') === -1 && msg.indexOf('[disappear-diag]') === -1) {
              var key = 'CON:' + msg.slice(0, 120);
              if (!errSeen[key]) { errSeen[key] = 1; addEvent('CONSOLE.' + m, msg.slice(0, 400), '', m === 'error'); }
              else errSeen[key]++;
            }
          } catch (_) {}
          return orig.apply(console, arguments);
        };
        wrapped.__tmDiagHooked = true;
        console[m] = wrapped;
      });
    } catch (_) {}
  }

  var __obsStarted = false;
  function startObservers() {
    if (__obsStarted) return; __obsStarted = true;
    try {
      var mo = new MutationObserver(function () { hookAllPhones(); checkHistory(); checkGrid(); });
      mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    } catch (_) {}
    try { setInterval(function () { hookAllPhones(); pollPhone(); trackPhonePipeline(); phoneVerdict(); trackNf(); nfVerdict(); checkHistory(); checkGrid(); checkHistoryNeverAppeared(); snapshot15(); }, 250); } catch (_) {}
    // Быстрый тик первые ~5с — поймать точный тайминг гонки (init/натив/UI) на медленной машине.
    try { var __phFast = setInterval(function () { trackPhonePipeline(); }, 60); setTimeout(function () { try { clearInterval(__phFast); } catch (_) {} }, 5000); } catch (_) {}
  }

  // ── UI ──────────────────────────────────────────────────────────────────────
  var btn = null, panel = null, body = null, badge = null;

  function report() {
    var lines = [];
    lines.push('=== ДИАГ: КОНВЕЙЕР НОМЕРА / пропажа номера / история ===');
    var c = ctxInfo();
    lines.push('Страница: ' + c.kind + (c.primaryNoCard ? '  [ПЕРВИЧНАЯ БЕЗ КАРТОЧКИ]' : '') +
      '  customer_id=' + (c.customerId || '—') + '  id=' + (c.id || '—'));
    lines.push('Багов поймано: ' + BUG_COUNT + '   всего событий: ' + EVENTS.length);
    lines.push('URL: ' + location.href);
    lines.push('Среда: cores=' + (navigator.hardwareConcurrency || '?') + '  readyState=' + document.readyState + '  ' + navTiming());
    if (c.kind === 'create') {
      lines.push('НОМЕР: url="' + PH.urlPhone + '" | натив=' + (PH.nativeFirst ? PH.nativeFirst + '/"' + PH.nativeLast + '"' : '—') +
        ' | init=' + (PH.initSeen ? PH.initSeen + '/"' + PH.initPhone + '"(натив@захват="' + PH.initNativeAtCapture + '")' : '—') +
        ' | UI=' + (PH.uiFirst ? PH.uiFirst + '/"' + PH.uiLast + '"' : '—'));
    }
    if (c.kind === 'request-update') {
      var _d = window.__tmNfModDiag || null;
      lines.push('НФ-кнопка: v11-есть=' + nfBtnPresent() +
        ' | build: ' + (_d ? ('saveBtn=' + _d.saveBtn + ' nativeNF=' + _d.nativeNotFormalizedBtn + ' footerHasNf=' + _d.footerHasNf + ' footerCnt=' + _d.footerBtnCount + ' willBuild=' + _d.willBuildBtn + ' isNotFormActive=' + _d.isNotFormalizedActiveMode + ' isClosedRO=' + _d.isClosedReadonlyMode) : 'не публиковался'));
    }
    lines.push('');
    EVENTS.slice(-120).forEach(function (e) {
      lines.push('[' + e.t + ' | ' + e.rel + '] (' + e.tag + ') ' + e.msg);
      if (e.detail) lines.push('        ' + e.detail);
    });
    return lines.join('\n');
  }

  function flashBug() {
    if (!btn) return;
    try {
      btn.style.background = '#e5484d'; btn.style.color = '#fff';
      if (badge) badge.textContent = String(BUG_COUNT);
      if (btn.animate) btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 260 });
    } catch (_) {}
  }

  function ensureUI() {
    if (btn || !document.body) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = '__tmDisappearDiagBtn';
    btn.textContent = '🩺 диаг';
    btn.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;height:26px;padding:0 9px;border-radius:8px;border:1px solid #3a3a3a;background:#222;color:#ddd;font:600 11px/1 ui-monospace,Consolas,monospace;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.35);display:inline-flex;align-items:center;gap:6px';
    badge = document.createElement('span');
    badge.textContent = '0';
    badge.style.cssText = 'min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:#555;color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center';
    btn.appendChild(badge);

    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:10px;bottom:44px;z-index:2147483647;width:560px;max-width:94vw;display:none;background:#141414;color:#eee;border:1px solid #3a3a3a;border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.5);overflow:hidden;font:11px/1.45 ui-monospace,Consolas,monospace';
    panel.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;padding:7px 10px;background:#20304a;border-bottom:1px solid #33456a">' +
      '<b style="color:#9ecbff">Пропажа номера / истории — диаг</b><span style="flex:1"></span>' +
      '<a href="#" id="__ddCopy" style="color:#8fdfd0;text-decoration:none">копировать</a>' +
      '<a href="#" id="__ddClear" style="color:#f0b6b6;text-decoration:none">очистить</a>' +
      '<a href="#" id="__ddHide" style="color:#8fdfd0;text-decoration:none">свернуть</a></div>' +
      '<pre id="__ddBody" style="margin:0;padding:8px 10px;max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-word"></pre>';
    document.body.appendChild(panel);
    document.body.appendChild(btn);
    body = panel.querySelector('#__ddBody');

    btn.addEventListener('click', function () {
      var open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (!open) { btn.style.background = '#222'; btn.style.color = '#ddd'; updatePanel(); }
    });
    panel.querySelector('#__ddHide').addEventListener('click', function (e) { e.preventDefault(); panel.style.display = 'none'; });
    panel.querySelector('#__ddClear').addEventListener('click', function (e) { e.preventDefault(); EVENTS = []; BUG_COUNT = 0; if (badge) badge.textContent = '0'; updatePanel(); });
    panel.querySelector('#__ddCopy').addEventListener('click', function (e) {
      e.preventDefault();
      var t = report();
      try { if (navigator.clipboard && navigator.clipboard.writeText) { var _p = navigator.clipboard.writeText(t); if (_p && _p.catch) _p.catch(function () {}); } } catch (_) {}
      try { var ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (_) {}
      var a = this, old = a.textContent; a.textContent = 'скопировано'; setTimeout(function () { a.textContent = old; }, 1200);
    });
    try { setInterval(function () { if (btn && document.body && document.body.lastElementChild !== btn) { document.body.appendChild(panel); document.body.appendChild(btn); } }, 900); } catch (_) {}
  }

  function updatePanel() {
    try { ensureUI(); if (badge) badge.textContent = String(BUG_COUNT); if (body && panel && panel.style.display !== 'none') body.textContent = report(); } catch (_) {}
  }

  function boot() {
    ensureUI();
    hookAllPhones();
    try { var el = primaryPhoneEl(); if (el && el.value) lastPrimaryPhone = String(el.value).trim(); } catch (_) {}
    histWasPresent = isVisible(histEl());
    phReadUrl();
    trackPhonePipeline();
    startObservers();
    addEvent('start', 'Диагностика запущена  (номер из URL="' + PH.urlPhone + '", cores=' + (navigator.hardwareConcurrency || '?') + ')', navTiming());
  }

  installErrorHook(); // как можно раньше — ловим ошибки рендера ещё до DOMContentLoaded
  hookConsole();
  phReadUrl(); // читаем ?phone= из URL сразу (источник истины для конвейера номера)
  startObservers(); // с document_start: ловим полный цикл нативного грида (появился в парсинге / убран расширением)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    var early = setInterval(function () { if (document.body) { ensureUI(); hookAllPhones(); } }, 120);
    setTimeout(function () { clearInterval(early); }, 6000);
  } else {
    boot();
  }
})();
