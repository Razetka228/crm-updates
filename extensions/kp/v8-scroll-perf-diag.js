// v8-scroll-perf-diag.js
// Диагностика просадок FPS при СКРОЛЛЕ в CRM v8.
// Записывает каждую "сессию прокрутки" и отделяет затраты на отрисовку (paint/layout = CSS)
// от затрат на JS. Внизу слева — панель с кнопкой Copy: жми, кидай JSON.
(() => {
  'use strict';
  if (window.__v8ScrollPerfDiag) return;
  window.__v8ScrollPerfDiag = true;

  const now = () => performance.now();
  const MAX_SESSIONS = 25;
  const IDLE_MS = 350;      // прокрутка считается законченной после паузы
  const SLOW_MS = 16.7;     // кадр медленнее = потерян (ниже 60fps)
  const VERY_SLOW_MS = 33.4;// ниже 30fps

  const sessions = [];
  let cur = null;           // активная сессия
  let rafId = 0;
  let lastFrameAt = 0;
  let idleTimer = 0;

  // ---- счётчики форсированных reflow во время скролла (только когда активно) ----
  let counting = false;
  let gbcrCount = 0;        // getBoundingClientRect
  let gcsCount = 0;         // getComputedStyle
  let layoutReads = 0;      // offset*/client*/scroll*/getClientRects — тоже форсируют раскладку

  // Агрегируем стеки вызовов, чтобы понять КТО дёргает геометрию во время скролла.
  const stackAgg = Object.create(null); // key -> { count, kind }
  let stackSamples = 0;
  const STACK_SAMPLE_LIMIT = 6000; // предохранитель от оверхеда
  function sampleStack(kind) {
    if (stackSamples >= STACK_SAMPLE_LIMIT) return;
    stackSamples++;
    let stack = '';
    try { stack = new Error().stack || ''; } catch (_e) { return; }
    const lines = stack.split('\n');
    // пропускаем строки самого диагностического скрипта и заголовок Error
    const clean = [];
    for (let i = 1; i < lines.length && clean.length < 4; i++) {
      const ln = lines[i].trim();
      if (!ln) continue;
      if (ln.indexOf('v8-scroll-perf-diag') !== -1) continue;
      if (ln.indexOf('sampleStack') !== -1) continue;
      // нормализуем: убираем всё до имени файла расширения/сайта
      clean.push(ln.replace(/^at\s+/, '').replace(/^\s+/, ''));
    }
    const key = kind + ' | ' + (clean.join('  <<  ') || 'unknown');
    if (!stackAgg[key]) stackAgg[key] = { count: 0 };
    stackAgg[key].count++;
  }

  try {
    const proto = Element.prototype;
    const origGBCR = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      if (counting) { gbcrCount++; sampleStack('getBoundingClientRect'); }
      return origGBCR.apply(this, arguments);
    };
    const origGCS = window.getComputedStyle;
    window.getComputedStyle = function () {
      if (counting) { gcsCount++; sampleStack('getComputedStyle'); }
      return origGCS.apply(this, arguments);
    };
  } catch (_e) {}

  // Другие чтения, форсирующие пересчёт раскладки (layout).
  try {
    const wrapGetter = (proto, name) => {
      if (!proto) return;
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || typeof d.get !== 'function') return;
      const orig = d.get;
      Object.defineProperty(proto, name, {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          if (counting) { layoutReads++; sampleStack(name); }
          return orig.call(this);
        },
        set: d.set,
      });
    };
    ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent'].forEach((n) => wrapGetter(HTMLElement.prototype, n));
    ['clientWidth', 'clientHeight', 'clientTop', 'clientLeft', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft'].forEach((n) => wrapGetter(Element.prototype, n));
    const origGCR = Element.prototype.getClientRects;
    if (typeof origGCR === 'function') {
      Element.prototype.getClientRects = function () {
        if (counting) { layoutReads++; sampleStack('getClientRects'); }
        return origGCR.apply(this, arguments);
      };
    }
  } catch (_e) {}

  // ---- LongAnimationFrame: главный источник "paint vs js" ----
  const loafBuf = [];
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) loafBuf.push(e);
      if (loafBuf.length > 400) loafBuf.splice(0, loafBuf.length - 400);
    });
    po.observe({ type: 'long-animation-frame', buffered: true });
  } catch (_e) {}

  const longtaskBuf = [];
  try {
    const po2 = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longtaskBuf.push(e);
      if (longtaskBuf.length > 400) longtaskBuf.splice(0, longtaskBuf.length - 400);
    });
    po2.observe({ type: 'longtask', buffered: true });
  } catch (_e) {}

  function selectorOf(el) {
    if (!el || el === document || el === window) return String(el === window ? 'window' : 'document');
    if (!(el instanceof Element)) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const c = el.className.trim().split(/\s+/).slice(0, 3).join('.');
      if (c) s += '.' + c;
    }
    return s;
  }

  function styleProfile(el) {
    if (!(el instanceof Element)) return null;
    try {
      const cs = getComputedStyle(el);
      return {
        selector: selectorOf(el),
        overflowY: cs.overflowY,
        boxShadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 80) : 'none',
        filter: cs.filter,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        willChange: cs.willChange,
        transform: cs.transform === 'none' ? 'none' : 'set',
        contain: cs.contain,
        borderRadius: cs.borderTopLeftRadius,
        background: (cs.backgroundColor || '').slice(0, 40),
        rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
      };
    } catch (_e) { return { selector: selectorOf(el), error: true }; }
  }

  // Профиль прокручиваемого элемента + предков + подсчёт "дорогих" потомков
  function scrollTargetProfile(el) {
    const chain = [];
    let node = el instanceof Element ? el : null;
    let hops = 0;
    while (node && hops < 8) {
      const p = styleProfile(node);
      // отмечаем потенциально дорогие для paint свойства
      p.expensive = [];
      if (p.backdropFilter && p.backdropFilter !== 'none') p.expensive.push('backdrop-filter');
      if (p.filter && p.filter !== 'none') p.expensive.push('filter');
      if (p.boxShadow !== 'none') p.expensive.push('box-shadow');
      if (p.borderRadius && p.borderRadius !== '0px' && p.overflowY !== 'visible') p.expensive.push('radius+overflow');
      chain.push(p);
      node = node.parentElement;
      hops++;
    }
    // считаем потомков с тенями/фильтрами внутри прокручиваемого элемента
    let shadowKids = 0, filterKids = 0, imgKids = 0, total = 0;
    try {
      const scope = el instanceof Element ? el : document.body;
      const all = scope.querySelectorAll('*');
      const limit = Math.min(all.length, 2500);
      for (let i = 0; i < limit; i++) {
        total++;
        const cs = getComputedStyle(all[i]);
        if (cs.boxShadow && cs.boxShadow !== 'none') shadowKids++;
        if (cs.filter && cs.filter !== 'none') filterKids++;
        if (all[i].tagName === 'IMG' || (cs.backgroundImage && cs.backgroundImage !== 'none')) imgKids++;
      }
      return { chain, descendants: { sampled: total, ofTotal: all.length, boxShadow: shadowKids, filter: filterKids, bgImageOrImg: imgKids } };
    } catch (_e) {
      return { chain, descendants: { error: true } };
    }
  }

  function startSession(target) {
    counting = true;
    gbcrCount = 0; gcsCount = 0; layoutReads = 0;
    cur = {
      startedAt: now(),
      startWallClock: new Date().toISOString(),
      target: selectorOf(target),
      targetEl: target instanceof Element ? target : null,
      frames: 0,
      frameGaps: [],
      slowFrames: 0,
      verySlowFrames: 0,
      maxGapMs: 0,
      loafStartLen: loafBuf.length,
      longtaskStartLen: longtaskBuf.length,
    };
    lastFrameAt = now();
    loop();
  }

  function loop() {
    rafId = requestAnimationFrame(() => {
      const t = now();
      const gap = t - lastFrameAt;
      lastFrameAt = t;
      if (cur) {
        cur.frames++;
        cur.frameGaps.push(Math.round(gap * 10) / 10);
        if (gap > cur.maxGapMs) cur.maxGapMs = Math.round(gap * 10) / 10;
        if (gap > VERY_SLOW_MS) cur.verySlowFrames++;
        else if (gap > SLOW_MS) cur.slowFrames++;
      }
      loop();
    });
  }

  function endSession() {
    if (!cur) return;
    counting = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    const durMs = now() - cur.startedAt;

    // Разбор LongAnimationFrame за окно сессии
    const loafs = loafBuf.slice(cur.loafStartLen);
    let loafTotal = 0, loafScript = 0, loafForced = 0, loafRender = 0, loafBlocking = 0;
    const scriptAgg = {};
    for (const e of loafs) {
      loafTotal += e.duration;
      loafBlocking += (e.blockingDuration || 0);
      // время style+layout+paint (рендер) = от styleAndLayoutStart до конца кадра
      if (e.styleAndLayoutStart) loafRender += (e.startTime + e.duration) - e.styleAndLayoutStart;
      const scripts = e.scripts || [];
      for (const s of scripts) {
        loafScript += (s.duration || 0);
        loafForced += (s.forcedStyleAndLayoutDuration || 0);
        const key = (s.sourceURL || s.invoker || 'unknown') + ' :: ' + (s.sourceFunctionName || s.invokerType || '');
        if (!scriptAgg[key]) scriptAgg[key] = { count: 0, ms: 0, forcedMs: 0 };
        scriptAgg[key].count++;
        scriptAgg[key].ms += (s.duration || 0);
        scriptAgg[key].forcedMs += (s.forcedStyleAndLayoutDuration || 0);
      }
    }
    const topScripts = Object.entries(scriptAgg)
      .map(([k, v]) => ({ src: k, count: v.count, ms: Math.round(v.ms * 10) / 10, forcedMs: Math.round(v.forcedMs * 10) / 10 }))
      .sort((a, b) => b.ms - a.ms).slice(0, 8);

    const longtasks = longtaskBuf.slice(cur.longtaskStartLen);
    const longtaskMs = longtasks.reduce((a, e) => a + e.duration, 0);

    const rendered = cur.frames || 1;
    const avgFps = Math.round((rendered / (durMs / 1000)) * 10) / 10;
    const minFps = cur.maxGapMs > 0 ? Math.round((1000 / cur.maxGapMs) * 10) / 10 : 60;

    // Вердикт: paint(CSS) или JS?
    let verdict = 'нет данных LoAF';
    if (loafs.length) {
      const renderMs = Math.round(loafRender * 10) / 10;
      const scriptMs = Math.round(loafScript * 10) / 10;
      const forcedMs = Math.round(loafForced * 10) / 10;
      if (forcedMs > scriptMs * 0.5 && forcedMs > 2) verdict = 'JS форсирует reflow (см. topScripts.forcedMs)';
      else if (renderMs > scriptMs * 1.5) verdict = 'ОТРИСОВКА/PAINT (CSS): время в style+layout+paint, а не в JS';
      else if (scriptMs > renderMs) verdict = 'JS (см. topScripts)';
      else verdict = 'смешанно (paint ≈ js)';
    }

    const rec = {
      startedAt: cur.startWallClock,
      target: cur.target,
      durationMs: Math.round(durMs),
      frames: cur.frames,
      avgFps,
      minFps,
      maxFrameGapMs: cur.maxGapMs,
      slowFrames_below60: cur.slowFrames,
      verySlowFrames_below30: cur.verySlowFrames,
      verdict,
      loaf: {
        count: loafs.length,
        totalMs: Math.round(loafTotal * 10) / 10,
        renderMs_styleLayoutPaint: Math.round(loafRender * 10) / 10,
        scriptMs: Math.round(loafScript * 10) / 10,
        forcedReflowMs: Math.round(loafForced * 10) / 10,
        blockingMs: Math.round(loafBlocking * 10) / 10,
        topScripts,
      },
      longtasks: { count: longtasks.length, totalMs: Math.round(longtaskMs) },
      forcedReads: { getBoundingClientRect: gbcrCount, getComputedStyle: gcsCount, otherLayoutReads: layoutReads },
      worstFrames: cur.frameGaps.filter((g) => g > VERY_SLOW_MS).slice(0, 20),
      styleProfile: scrollTargetProfile(cur.targetEl),
    };
    sessions.push(rec);
    if (sessions.length > MAX_SESSIONS) sessions.shift();
    cur = null;
    render();
  }

  // ---- ловим скролл на ЛЮБОМ контейнере (capture) ----
  function onScroll(event) {
    const target = event.target === document ? (document.scrollingElement || document.documentElement) : event.target;
    if (!cur) startSession(target);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(endSession, IDLE_MS);
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('wheel', () => { if (!cur) { /* rAF стартует при первом scroll */ } }, { capture: true, passive: true });

  // ---- панель ----
  let box = null, body = null;
  function buildText() {
    const env = {
      generatedAt: new Date().toISOString(),
      url: location.href,
      viewport: `${innerWidth}x${innerHeight}`,
      dpr: devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      loafSupported: (() => { try { return PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'); } catch (_e) { return false; } })(),
    };
    const topForcedLayoutCallers = Object.entries(stackAgg)
      .map(([k, v]) => ({ caller: k, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25);
    return JSON.stringify({ tool: 'v8-scroll-perf-diag', env, topForcedLayoutCallers, sessions }, null, 2);
  }

  function summaryLines() {
    const lines = [];
    lines.push('SCROLL-PERF  сессий: ' + sessions.length + (cur ? '  (идёт запись…)' : ''));
    const last = sessions.slice(-6).reverse();
    for (const s of last) {
      lines.push('— ' + s.target);
      lines.push('   avg ' + s.avgFps + 'fps  min ' + s.minFps + 'fps  провалов<30: ' + s.verySlowFrames_below30 +
        '  gap ' + s.maxFrameGapMs + 'ms');
      lines.push('   render ' + s.loaf.renderMs_styleLayoutPaint + 'ms  js ' + s.loaf.scriptMs +
        'ms  forced ' + s.loaf.forcedReflowMs + 'ms');
      lines.push('   ⇒ ' + s.verdict);
    }
    if (!sessions.length) lines.push('Покрути колонку/список — здесь появится разбор.');
    return lines.join('\n');
  }

  function render() {
    try {
      const mount = document.documentElement || document.body;
      if (!mount) return;
      // Панель могла быть удалена/перекрыта при перерисовке страницы расширением —
      // возвращаем её и держим последним элементом (поверх всего).
      if (box && !box.isConnected) { try { mount.appendChild(box); } catch (_e) {} }
      if (box && box.isConnected && box.parentElement && box.parentElement.lastElementChild !== box) {
        try { box.parentElement.appendChild(box); } catch (_e) {}
      }
      if (!box) {
        box = document.createElement('div');
        box.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;width:440px;max-width:calc(100vw - 16px);max-height:56vh;overflow:auto;background:#101a12;color:#d6eede;border:1px solid #2b4a35;border-radius:8px;box-shadow:0 10px 34px rgba(0,0,0,.55);padding:8px 10px;font:11px/1.45 Consolas,monospace;white-space:pre-wrap;word-break:break-word';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;gap:8px';
        const ttl = document.createElement('b');
        ttl.textContent = 'SCROLL-PERF';
        ttl.style.cssText = 'color:#7ee7a0;font-size:12px';
        const btns = document.createElement('div');
        const copy = document.createElement('button');
        copy.textContent = 'Copy';
        copy.style.cssText = 'cursor:pointer;background:#238636;color:#fff;border:0;border-radius:5px;padding:2px 9px;margin-left:6px;font:inherit';
        copy.onclick = () => {
          const txt = buildText();
          const fb = () => { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (_e) {} ta.remove(); };
          try { if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).catch(fb); else fb(); } catch (_e) { fb(); }
          copy.textContent = 'Copied!'; setTimeout(() => { copy.textContent = 'Copy'; }, 1000);
        };
        const dl = document.createElement('button');
        dl.textContent = 'Download';
        dl.style.cssText = 'cursor:pointer;background:#1f6feb;color:#fff;border:0;border-radius:5px;padding:2px 9px;margin-left:6px;font:inherit';
        dl.onclick = () => {
          try {
            const blob = new Blob([buildText()], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'v8-scroll-perf.json';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (_e) {} }, 1000);
            dl.textContent = 'Saved!'; setTimeout(() => { dl.textContent = 'Download'; }, 1000);
          } catch (_e) { dl.textContent = 'err'; }
        };
        const clr = document.createElement('button');
        clr.textContent = 'Clear';
        clr.style.cssText = 'cursor:pointer;background:#8a6d1a;color:#fff;border:0;border-radius:5px;padding:2px 9px;margin-left:6px;font:inherit';
        clr.onclick = () => { sessions.length = 0; render(); };
        const hide = document.createElement('button');
        hide.textContent = '×';
        hide.style.cssText = 'cursor:pointer;background:#30363d;color:#fff;border:0;border-radius:5px;padding:2px 9px;margin-left:6px;font:inherit';
        hide.onclick = () => { box.style.display = 'none'; };
        btns.appendChild(copy); btns.appendChild(dl); btns.appendChild(clr); btns.appendChild(hide);
        head.appendChild(ttl); head.appendChild(btns);
        body = document.createElement('div');
        box.appendChild(head); box.appendChild(body);
        mount.appendChild(box);
      }
      body.textContent = summaryLines();
    } catch (_e) {}
  }

  // первичная отрисовка панели + лёгкое обновление во время записи
  const bootRender = () => { render(); };
  if (document.body) bootRender(); else document.addEventListener('DOMContentLoaded', bootRender, { once: true });
  // Всегда держим панель на месте: страница/расширение может перерисовать body и стереть её.
  setInterval(render, 500);
})();
