// Null-safe guard for the native CRM bootstrap-select.
// When v11 replaces the page it clears <head> and moves the native form into a
// hidden holder, so a selectpicker's UI DOM becomes detached. When the native
// base later pops its "Причина изменения времени" modal and a `change` fires,
// Selectpicker.render() throws "Cannot set properties of null (setting
// 'innerHTML')", which aborts v11's auto-handling and leaves the raw modal stuck
// at the bottom of the page. We wrap render() in try/catch so the value/change
// still propagate but the (hidden) redraw can't crash the flow.
// Runs in the MAIN world so it patches the page's own jQuery plugin (shared by
// v11 and, if present, the Tampermonkey "Фикс" script).
(function guardBootstrapSelectRender() {
  "use strict";

  var done = false;

  function patch() {
    if (done) return true;
    var $ = window.jQuery || window.$;
    if (!$ || !$.fn || !$.fn.selectpicker || !$.fn.selectpicker.Constructor) {
      return false;
    }
    var proto = $.fn.selectpicker.Constructor.prototype;
    if (!proto || typeof proto.render !== "function") {
      return false;
    }
    if (proto.__crmRenderGuarded) {
      done = true;
      return true;
    }
    var original = proto.render;
    proto.render = function guardedRender() {
      try {
        return original.apply(this, arguments);
      } catch (error) {
        try {
          console.warn("[CRM] bootstrap-select.render skipped (detached UI):",
            error && error.message ? error.message : error);
        } catch (_logError) {}
        return undefined;
      }
    };
    proto.__crmRenderGuarded = true;
    done = true;
    return true;
  }

  if (patch()) return;

  // bootstrap-select loads from page assets, possibly after document_start.
  var ticks = 0;
  var timer = setInterval(function () {
    if (patch() || ++ticks > 120) {
      clearInterval(timer);
    }
  }, 50);
})();
