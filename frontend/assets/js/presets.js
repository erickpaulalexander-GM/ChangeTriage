/* Change Triage quick-range presets: Hoy | Ayer | Toda la ventana (N dias).
 *
 * Presentation-only: each preset just fills the Desde/Hasta date values
 * (hidden #f-desde-date / #f-hasta-date fed by the day dropdowns) plus the
 * time inputs (#f-desde-time / #f-hasta-time) and delegates to the
 * central window.TriageSearch.applyFilters() from search.js. No overlap,
 * matching, or export logic is reimplemented here.
 * - "Toda la ventana (N dias)" derives N from the loaded rows (never
 *   hardcoded) and refreshes its label right after data.json loads.
 * - Full-day presets leave the time inputs blank: parseWindowBound already
 *   maps a blank Desde time to 00:00:00 and a blank Hasta time to 23:59:59.
 * - Any manual edit to the four inputs clears the active preset; the
 *   "Limpiar filtros" button (owned by search.js) also clears it.
 */
"use strict";

window.TriagePresets = (function () {
  var WINDOW_IDS = ["f-desde-date", "f-desde-time", "f-hasta-date", "f-hasta-time"];
  var active = null;

  function el(id) {
    return document.getElementById(id);
  }

  function getRows() {
    if (window.Triage && typeof window.Triage.getRows === "function") {
      return window.Triage.getRows();
    }
    return [];
  }

  function wallOf(value) {
    if (window.TriageSearch && typeof window.TriageSearch.toLimaWall === "function") {
      return window.TriageSearch.toLimaWall(value);
    }
    return "";
  }

  // Current calendar day in America/Lima as "YYYY-MM-DD" (Intl en-CA yields
  // exactly that shape). Fallback is UTC-5 wall arithmetic, matching the
  // fixed Lima offset used across the data pipeline.
  function limaToday() {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
    } catch (e) { /* fall through to the UTC-5 fallback below */ }
    return new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  }

  function addDays(ymd, delta) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!p) return "";
    var t = Date.UTC(+p[1], +p[2] - 1, +p[3]) + delta * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  function dayCount(minDate, maxDate) {
    var a = minDate.split("-"), b = maxDate.split("-");
    var da = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var db = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    return Math.round((db - da) / 86400000) + 1;
  }

  // "2026-09-20" -> "20 Sep" via daypick helper when available, else raw.
  function fmtDayMon(ymd) {
    if (window.TriageDaypick && typeof window.TriageDaypick.formatDay === "function") {
      return window.TriageDaypick.formatDay(ymd);
    }
    return ymd || "";
  }

  function windowBounds() {
    var min = "", max = "";
    getRows().forEach(function (row) {
      var ini = wallOf(row.fec_hora_ini_impl);
      var fin = wallOf(row.fec_hora_fin_impl);
      if (ini && (!min || ini < min)) min = ini.slice(0, 10);
      if (fin && (!max || fin > max)) max = fin.slice(0, 10);
    });
    return { min: min, max: max };
  }

  function apply() {
    if (window.TriageSearch && typeof window.TriageSearch.applyFilters === "function") {
      window.TriageSearch.applyFilters();
    }
  }

  function setWindow(desdeDate, hastaDate) {
    el("f-desde-date").value = desdeDate || "";
    el("f-desde-time").value = "";
    el("f-hasta-date").value = hastaDate || "";
    el("f-hasta-time").value = "";
    // Day dropdowns mirror the hidden YYYY-MM-DD inputs silently (no events,
    // so the markActive(name) below still applies to this preset pick).
    if (window.TriageDaypick && typeof window.TriageDaypick.syncFromInputs === "function") {
      window.TriageDaypick.syncFromInputs();
    }
    // Programmatic .value sets fire no events either: refresh the T4 empty-
    // time hint overlay explicitly (values stay "" = día completo).
    if (window.TriageSearch && typeof window.TriageSearch.syncTimeHints === "function") {
      window.TriageSearch.syncTimeHints();
    }
    apply();
  }

  function markActive(name) {
    active = name || null;
    var btns = document.querySelectorAll("[data-preset]");
    Array.prototype.forEach.call(btns, function (btn) {
      if (btn.getAttribute("data-preset") === active) btn.setAttribute("aria-pressed", "true");
      else btn.removeAttribute("aria-pressed");
    });
  }

  function syncAllLabel() {
    var btn = document.querySelector('[data-preset="all"]');
    if (!btn) return;
    var bounds = windowBounds();
    if (bounds.min && bounds.max) {
      // Ops density: short visible label; full range stays in the tooltip.
      btn.textContent = "Toda la ventana";
      if (btn.setAttribute) {
        btn.setAttribute("title", fmtDayMon(bounds.min) + " → " +
          fmtDayMon(bounds.max) + " (" +
          dayCount(bounds.min, bounds.max) + " días)");
      }
    } else {
      btn.textContent = "Toda la ventana";
    }
  }

  function onPreset(name) {
    if (name === "today") {
      var today = limaToday();
      setWindow(today, today);
    } else if (name === "yesterday") {
      var yesterday = addDays(limaToday(), -1);
      setWindow(yesterday, yesterday);
    } else if (name === "all") {
      var bounds = windowBounds();
      setWindow(bounds.min, bounds.max);
    } else {
      return;
    }
    markActive(name);
  }

  function init() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var btns = document.querySelectorAll("[data-preset]");
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener("click", function () {
        onPreset(btn.getAttribute("data-preset"));
      });
    });
    // Programmatic .value sets above fire no events, so these listeners only
    // react to real user edits — each one drops the active preset.
    WINDOW_IDS.forEach(function (id) {
      var input = el(id);
      if (input && input.addEventListener) {
        input.addEventListener("input", function () { markActive(null); });
        input.addEventListener("change", function () { markActive(null); });
      }
    });
    var clear = el("clear-filters");
    if (clear && clear.addEventListener) {
      clear.addEventListener("click", function () { markActive(null); });
    }
    syncAllLabel();
    // Re-derive the "Toda la ventana (N dias)" label right after data.json
    // loads (app.js calls TriageSearch.refresh() once rows arrive); chains
    // with the filters.js refresh hook regardless of script order.
    if (window.TriageSearch && !window.TriageSearch.__presetsHooked) {
      window.TriageSearch.__presetsHooked = true;
      var base = window.TriageSearch.refresh;
      window.TriageSearch.refresh = function () {
        var out = base();
        syncAllLabel();
        return out;
      };
    }
  }

  if (typeof document !== "undefined" && document.readyState !== "loading") init();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", init);

  return {
    onPreset: onPreset,
    clearActive: function () { markActive(null); },
    syncAllLabel: syncAllLabel,
    getActive: function () { return active; },
    limaToday: limaToday,
    addDays: addDays,
  };
})();
