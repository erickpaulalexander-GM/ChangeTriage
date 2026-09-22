/* Change Triage list view: loads data.json (relative paths only, never the
 * Excel workbook) and renders the results list with empty-state + reset.
 * Search, overlap flags, and exports plug in via search.js/export.js through
 * the window.Triage hookup surface ({ render, getRows, getVisible }).
 */
"use strict";

(function () {
  // Repo checkout layout first, then published-bundle layouts (co-located JSON).
  var SOURCES = [
    "../workspace/output/data.json",
    "./data.json",
    "./data/data.json",
  ];

  var state = {
    rows: [],
    visible: [],
    meta: { generatedAt: "", sourceModifiedAt: "", sourceFile: "", minStart: "", maxEnd: "" },
  };
  var els = {};

  // Compact-layout header slots (C1): three live indicators fed from
  // data.json only (row count, generated_at/source_modified_at, min/max
  // implementation window), rendered into #results-count, #kyndryl-updated
  // and #window-range since the opbar was removed. Lima wall-clock
  // formatting slices the "YYYY-MM-DDTHH:MM:SS" wall text directly — never
  // `new Date(str)` on naive strings, never UTC conversion — so the slots
  // can never shift a day against the search.js overlap logic.
  function wallParts(wall) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall || "");
    if (!m) return null;
    return { y: m[1], mo: m[2], d: m[3], h: m[4], mi: m[5] };
  }

  function fmtFull(wall) {
    var p = wallParts(wall);
    return p ? p.d + "/" + p.mo + "/" + p.y + " " + p.h + ":" + p.mi : "—";
  }

  // Compact-layout slots (C1): short Spanish month table for the "D Mon"
  // form ("21 Sep", "20 Sep"). TriageDaypick.formatDay adds the weekday
  // ("Lun 14 Sep"), which these slots don't want, and MONTHS isn't exported
  // there — so this minimal local table is the documented fallback.
  var MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  // "2026-09-21T15:55:00" -> "21 Sep". Wall-string only (Lima wall text via
  // toWall upstream), never `new Date` on naive strings.
  function fmtDayMon(wall) {
    var p = wallParts(wall);
    if (!p) return "—";
    return p.d.replace(/^0/, "") + " " + (MONTHS_ES[+p.mo - 1] || p.mo);
  }

  // Source-workbook timestamp for the header slot: "🕒 21 Sep · 15:55"
  // (no "Actualizado" word per spec). Source date wins; legacy payloads
  // fall back to the build time; "🕒 —" while unknown.
  function fmtUpdated(wall) {
    var p = wallParts(wall);
    if (!p) return "🕒 —";
    return "🕒 " + p.d.replace(/^0/, "") + " " +
      (MONTHS_ES[+p.mo - 1] || p.mo) + " · " + p.h + ":" + p.mi;
  }

  function toWall(value) {
    if (window.TriageSearch && typeof window.TriageSearch.toLimaWall === "function") {
      return window.TriageSearch.toLimaWall(value);
    }
    return "";
  }

  function computeRange(rows) {
    var min = "", max = "";
    rows.forEach(function (row) {
      var ini = toWall(row.fec_hora_ini_impl);
      var fin = toWall(row.fec_hora_fin_impl);
      if (ini && (!min || ini < min)) min = ini;
      if (fin && (!max || fin > max)) max = fin;
    });
    return { min: min, max: max };
  }

  // Window-module subtitle from the dataset range (computeRange min/max):
  // "20 Sep → 21 Sep", single day "20 Sep", "—" unknown. Day counts live in
  // the "Toda la ventana" preset tooltip (ops density: no duplicated counts).
  function rangeText() {
    var min = state.meta.minStart, max = state.meta.maxEnd;
    if (!min || !max) return "—";
    if (min.slice(0, 10) === max.slice(0, 10)) {
      return fmtDayMon(min);
    }
    return fmtDayMon(min) + " → " + fmtDayMon(max);
  }

  // Provenance tooltip: always states the build time so it is not lost, and
  // names the source workbook when known. The header date describes the
  // SOURCE workbook, not the build, so a rebuild without a new workbook
  // cannot claim fresh data (false confidence); the tooltip keeps the build
  // time discoverable without letting it masquerade as the data date.
  function provenanceTitle(buildWall) {
    var parts = [];
    if (state.meta.sourceFile) parts.push("Fuente: " + state.meta.sourceFile);
    if (buildWall) parts.push("Build: " + fmtFull(buildWall) + " (Lima)");
    return parts.join(" · ");
  }

  // Compact-layout slots (C1): the opbar is gone. Count lives in
  // #results-count above the list ("12 resultados de 913 cambios"; always
  // visible/total — unfiltered that's "913 resultados de 913 cambios"),
  // the source date under the Kyndryl logo, the range in #window-range.
  function updateOpbar(visible) {
    var total = state.rows.length;
    var shown = (typeof visible === "number") ? visible : total;
    if (els.count) els.count.textContent =
      shown + " resultados de " + total + " cambios";
    if (els.updated) {
      // Source workbook date wins; legacy payloads fall back to the build time.
      var buildWall = toWall(state.meta.generatedAt);
      var shownWall = toWall(state.meta.sourceModifiedAt) || buildWall;
      els.updated.textContent = fmtUpdated(shownWall);
      els.updated.title = provenanceTitle(buildWall);
    }
    if (els.range) els.range.textContent = rangeText();
  }

  // Badge color by estado_actual: red (Cancelado/Rechazado), amber
// (Coordinado), green (Pase en curso), gray default for the rest.
  var STATE_RED = ["cancelado", "rechazado"];
  var STATE_AMBER = ["coordinado"];
  var STATE_GREEN = ["pase en curso"];

  function stateClass(value) {
    var key = String(value || "").trim().toLowerCase();
    if (STATE_RED.indexOf(key) !== -1) return "state--red";
    if (STATE_AMBER.indexOf(key) !== -1) return "state--amber";
    if (STATE_GREEN.indexOf(key) !== -1) return "state--green";
    return "";
  }

  // Card (meta) label only (T1): short operational format
  // ("Lun 14 Sep · 00:00–00:30" same-day, "Lun 14 Sep 22:00 → Mar 15 Sep
  // 01:00" multi-day) via the shared TriageDaypick.formatWindowShort helper.
  // Drawer (drawer.js:formatDate) and Teams (export.js:windowLabel) keep the
  // long "DD/MM/YYYY HH:MM" form. Falls back to long when short is
  // unavailable/unparsable.
  function windowLabel(row) {
    if (window.TriageDaypick && typeof window.TriageDaypick.formatWindowShort === "function") {
      var short = window.TriageDaypick.formatWindowShort(
        row.fec_hora_ini_impl, row.fec_hora_fin_impl);
      if (short) return short;
    }
    var ini = window.Drawer ? window.Drawer.formatDate(row.fec_hora_ini_impl) : row.fec_hora_ini_impl;
    var fin = window.Drawer ? window.Drawer.formatDate(row.fec_hora_fin_impl) : row.fec_hora_fin_impl;
    return ini + " → " + fin;
  }

  // Channel capsules (canales): squad vs ratificar token lists ("APIG",
  // "TPWL, MBBK", newline-separated in the workbook). Rendered as a
  // two-column grid (label over chips per column) so both fields use the
  // card's empty horizontal space instead of growing the row downward.
  // Empty lists render nothing, leaving the compact card shape untouched.
  // Visible chips cap at 4 per column with a "+N" overflow chip; the full
  // list stays in the column title tooltip.
  var CANALES_MAX = 4;

  function channelTokens(value) {
    var seen = {}, out = [];
    String(value == null ? "" : value).split(/[,;\n]+/).forEach(function (t) {
      var token = t.trim();
      if (token && !seen[token]) { seen[token] = true; out.push(token); }
    });
    return out;
  }

  function canalGroup(label, tokens, full) {
    var group = document.createElement("div");
    group.className = "canal-group";
    var name = document.createElement("div");
    name.className = "canales-label";
    name.textContent = label;
    group.append(name);
    var chips = document.createElement("div");
    chips.className = "canal-chips";
    chips.title = full;
    tokens.slice(0, CANALES_MAX).forEach(function (token) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = token;
      chips.append(chip);
    });
    if (tokens.length > CANALES_MAX) {
      var more = document.createElement("span");
      more.className = "chip chip-more";
      more.textContent = "+" + (tokens.length - CANALES_MAX);
      chips.append(more);
    }
    group.append(chips);
    return group;
  }

  function renderList(rows, options) {
    state.visible = rows;
    els.results.innerHTML = "";
    rows.forEach(function (row, index) {
      var item = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "row";
      btn.dataset.index = String(index);
      btn.innerHTML = "";
      var ticket = document.createElement("span");
      ticket.className = "ticket";
      ticket.textContent = row.ticket + " — " + row.nombre_app;
      var meta = document.createElement("div");
      meta.className = "meta";
      // Recurso visible en tarjeta (AUTOMATIZADO, INFRAESTRUCTURA, YAPE…):
      // identifica de un vistazo el origen del cambio. Se omite si vacío.
      var recurso = row.recurso === null || row.recurso === undefined
        ? "" : String(row.recurso).trim();
      meta.textContent = row.tipo_cambio + " · " + windowLabel(row)
        + (recurso ? " · " + recurso : "");
      var stateEl = document.createElement("span");
      stateEl.className = "state " + stateClass(row.estado_actual);
      stateEl.textContent = row.estado_actual;
      btn.append(ticket, meta);
      // Channel capsules: omitted when both lists are empty so the card
      // keeps its two-line compact shape on rows without channel data.
      var squad = channelTokens(row.canales_app_impactadas_segun_squad);
      var ratif = channelTokens(row.canales_app_a_ratificar);
      if (squad.length || ratif.length) {
        var grid = document.createElement("div");
        grid.className = "canales";
        if (squad.length) {
          grid.append(canalGroup("CANALES APP IMPACTADAS SEGÚN SQUAD", squad,
            String(row.canales_app_impactadas_segun_squad).trim()));
        }
        if (ratif.length) {
          grid.append(canalGroup("CANALES APP A RATIFICAR", ratif,
            String(row.canales_app_a_ratificar).trim()));
        }
        btn.append(grid);
      }
      btn.append(stateEl);
      if (row._overlap === true || row._overlap === false) {
        var flag = document.createElement("span");
        flag.className = row._overlap ? "overlap" : "overlap-no";
        flag.textContent = row._overlap ? "incident overlap" : "no overlap";
        btn.append(flag);
      }
      btn.addEventListener("click", function () {
        window.Drawer.open(row, btn);
      });
      item.append(btn);
      els.results.append(item);
    });
    var empty = rows.length === 0;
    els.empty.hidden = !empty;
    els.results.hidden = empty;
    updateOpbar(rows.length);
  }

  function reset() {
    if (window.TriageSearch) window.TriageSearch.resetFilters();
    state.rows.forEach(function (row) { row._overlap = null; });
    renderList(state.rows);
    updateOpbar(state.rows.length);
    els.status.setAttribute("tabindex", "-1");
    els.status.focus({ preventScroll: true });
  }

  function load() {
    els = {
      // els.status keeps the reset() focus target: the count line doubles
      // as the live region since the opbar was removed (C1).
      status: document.getElementById("results-count"),
      count: document.getElementById("results-count"),
      updated: document.getElementById("kyndryl-updated"),
      range: document.getElementById("window-range"),
      results: document.getElementById("results"),
      empty: document.getElementById("empty"),
    };
    document.getElementById("reset").addEventListener("click", reset);
    document.getElementById("overlay").addEventListener("click", window.Drawer.close);

    // Single-file bundle (SharePoint library or file://): prefer the inlined
    // payload so the page renders with zero fetch/XHR. The fetch fallback
    // chain below stays untouched for dev/SharePoint-folder mode.
    if (window.TRIAGE_DATA && Array.isArray(window.TRIAGE_DATA.rows)) {
      onData(window.TRIAGE_DATA);
      return;
    }

    var chain = Promise.reject(new Error("start"));
    SOURCES.forEach(function (src) {
      chain = chain.catch(function () {
        return fetch(src).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status + " for " + src);
          return res.json();
        });
      });
    });
    chain.then(onData).catch(function (err) {
      console.error("[triage] data.json load failed: " + err.message);
      if (els.count) els.count.textContent = "No se pudieron cargar los cambios";
      renderList([]);
    });
  }

  function onData(data) {
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    state.meta.generatedAt = typeof data.generated_at === "string" ? data.generated_at : "";
    state.meta.sourceModifiedAt = typeof data.source_modified_at === "string" ? data.source_modified_at : "";
    state.meta.sourceFile = typeof data.source_file === "string" ? data.source_file : "";
    var range = computeRange(state.rows);
    state.meta.minStart = range.min;
    state.meta.maxEnd = range.max;
    // Counts only — never log row values (production-data caution).
    console.info("[triage] data.json loaded: count=" + state.rows.length);
    updateOpbar(state.rows.length);
    if (window.TriageSearch) window.TriageSearch.refresh();
    else renderList(state.rows);
  }

  window.Triage = {
    reset: reset,
    render: renderList,
    getRows: function () { return state.rows; },
    getVisible: function () { return state.visible; },
    getMeta: function () { return state.meta; },
    state: state,
  };
  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);
})();
