/* Change Triage search: instant global substring across all row fields,
 * field filters, and implementation-window (Desde/Hasta) overlap mode.
 * and implementation-window (Desde/Hasta) overlap mode. Filters feed the
 * list through the window.Triage hookup surface — no list rendering logic
 * is duplicated here.
 */
"use strict";

window.TriageSearch = (function () {
  // America/Lima wall-clock handling: data.json ISO strings are already Lima
  // wall time (fixed -05:00, no DST), and date/time inputs carry no timezone.
  // All parsing and comparison below stays in Lima wall-clock STRING space
  // ("YYYY-MM-DDTHH:MM:SS", lexicographically comparable) — never
  // `new Date(str)` on naive strings, never toISOString()/UTC conversion —
  // so 15/09/2026 00:00 stays Lima midnight and never slides to the previous
  // day in browsers running other timezones.

  function norm(value) {
    return (value === null || value === undefined ? "" : String(value)).toLowerCase();
  }

  function contains(field, needle) {
    return norm(field).indexOf(needle) !== -1;
  }

  // Instant search: one substring matched against every meaningful row
  // field (all HEADER_MAP columns: ticket, app, recurso, description,
  // tribu, squad, dates, contacts, etc.). Runtime-only underscore keys
  // (e.g. row._overlap) are skipped. Case-insensitive; null/undefined,
  // numbers, and dates flow safely through norm()/contains. Empty query
  // means no filter. Trivial cost at ~457 rows x ~34 fields per keystroke,
  // so no debounce is needed.
  function matchesQuery(row, q) {
    if (!q) return true;
    var needle = q.trim().toLowerCase();
    if (!needle) return true;
    if (!row || typeof row !== "object") return false;
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key.charAt(0) === "_") continue;
      if (contains(row[key], needle)) return true;
    }
    return false;
  }

  // Normalizes a data.json datetime (full Lima ISO with offset, or a bare
  // "YYYY-MM-DD HH:MM[:SS]" wall time) to "YYYY-MM-DDTHH:MM:SS" Lima
  // wall-clock text. Returns "" when the value is missing or unparsable so
  // callers degrade gracefully instead of throwing or false-matching.
  function toLimaWall(value) {
    if (typeof value !== "string") return "";
    var text = value.trim();
    if (!text) return "";
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
    if (!m) return "";
    return m[1] + "T" + m[2] + ":" + m[3] + ":" + (m[4] || "00");
  }

  // Builds one inclusive window bound from a date input ("YYYY-MM-DD") plus
  // an optional time input ("HH:MM[:SS]"). A date without time covers the
  // whole day (Desde -> 00:00:00, Hasta -> 23:59:59), so Desde=Hasta=
  // 15/09/2026 queries the full day. Returns "" when no date is set, which
  // means the bound is inactive.
  function parseWindowBound(dateValue, timeValue, isEnd) {
    var date = typeof dateValue === "string" ? dateValue.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
    var time = typeof timeValue === "string" ? timeValue.trim() : "";
    var t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    var clock = t ? t[1] + ":" + t[2] + ":" + (t[3] || "00")
      : (isEnd ? "23:59:59" : "00:00:00");
    return date + "T" + clock;
  }

  // Overlap verdict for one row against the active window (inclusive):
  // Desde set -> keep rows with fin >= Desde; Hasta set -> keep rows with
  // inicio <= Hasta; both set -> inicio <= Hasta AND fin >= Desde. A row
  // missing either impl date cannot overlap (excluded while a bound is
  // active); with no bounds set every row passes.
  function matchesWindow(row, desde, hasta) {
    if (!desde && !hasta) return true;
    if (!row) return false;
    var ini = toLimaWall(row.fec_hora_ini_impl);
    var fin = toLimaWall(row.fec_hora_fin_impl);
    if (!ini || !fin) return false;
    if (desde && fin < desde) return false;
    if (hasta && ini > hasta) return false;
    return true;
  }

  // Field filters combine with AND semantics; blank filters are ignored.
  function matchesFilters(row, criteria) {
    criteria = criteria || {};
    if (criteria.ticket && !contains(row.ticket, criteria.ticket.trim().toLowerCase())) return false;
    if (criteria.app && !contains(row.nombre_app, criteria.app.trim().toLowerCase())) return false;
    if (criteria.tipo && !contains(row.tipo_cambio, criteria.tipo.trim().toLowerCase())) return false;
    if (!matchesWindow(row, criteria.desde || "", criteria.hasta || "")) return false;
    return true;
  }

  function val(id) {
    var el = document.getElementById(id);
    return el && typeof el.value === "string" ? el.value : "";
  }

  // T4 visual-only 00:00/23:59 hint: toggles data-empty on the .time-wrap so
  // CSS shows the assumed bound while the input VALUE stays "" (vacío = día
  // completo in parseWindowBound). Never writes a value — filters untouched.
  function syncTimeHints() {
    ["f-desde-time", "f-hasta-time"].forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      var wrap = null;
      if (input.closest) wrap = input.closest(".time-wrap");
      if (!wrap && input.parentNode) wrap = input.parentNode;
      if (!wrap || !wrap.setAttribute) return;
      if (!input.value) wrap.setAttribute("data-empty", "true");
      else wrap.removeAttribute("data-empty");
    });
  }

  function getCriteria() {
    return {
      q: val("q"),
      ticket: val("f-ticket"),
      app: val("f-app"),
      tipo: val("f-tipo"),
      desde: parseWindowBound(val("f-desde-date"), val("f-desde-time"), false),
      hasta: parseWindowBound(val("f-hasta-date"), val("f-hasta-time"), true),
    };
  }

  function applyFilters() {
    if (!window.Triage) return;
    var rows = window.Triage.getRows();
    var criteria = getCriteria();
    var windowActive = !!(criteria.desde || criteria.hasta);
    var filtered = rows.filter(function (row) {
      return matchesQuery(row, criteria.q) && matchesFilters(row, criteria);
    });
    filtered.forEach(function (row) {
      row._overlap = null;
    });
    window.Triage.render(filtered, {
      total: rows.length,
      windowActive: windowActive,
    });
  }

  function resetFilters() {
    ["q", "f-ticket", "f-app", "f-tipo",
     "f-desde-date", "f-desde-time", "f-hasta-date", "f-hasta-time"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
    syncTimeHints();
  }

  // Re-applies the current criteria (e.g. right after data.json loads).
  function refresh() {
    applyFilters();
    syncTimeHints();
  }

  function init() {
    ["q", "f-ticket", "f-app"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", applyFilters);
    });
    // #f-tipo is a native <select> fed by filters.js: change (not input).
    ["f-tipo", "f-desde-date", "f-desde-time", "f-hasta-date", "f-hasta-time"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function () {
        syncTimeHints();
        applyFilters();
      });
    });
    // Live hint toggle while typing a time (change fires only on commit).
    ["f-desde-time", "f-hasta-time"].forEach(function (id) {
      var input = document.getElementById(id);
      if (input && input.addEventListener) {
        input.addEventListener("input", syncTimeHints);
      }
    });
    syncTimeHints();
    // Toolbar reset action: back to the empty initial state, then re-apply.
    var clear = document.getElementById("clear-filters");
    if (clear && clear.addEventListener) {
      clear.addEventListener("click", function () {
        resetFilters();
        applyFilters();
      });
    }
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  return {
    applyFilters: applyFilters,
    resetFilters: resetFilters,
    refresh: refresh,
    matchesQuery: matchesQuery,
    matchesFilters: matchesFilters,
    parseWindowBound: parseWindowBound,
    matchesWindow: matchesWindow,
    toLimaWall: toLimaWall,
    syncTimeHints: syncTimeHints,
  };
})();
