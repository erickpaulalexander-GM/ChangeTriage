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

  var state = { rows: [], visible: [], meta: { generatedAt: "", minStart: "", maxEnd: "" } };
  var els = {};

  // Operational header bar: three live indicators fed from data.json only
  // (row count, generated_at, min/max implementation window). Lima wall-clock
  // formatting slices the "YYYY-MM-DDTHH:MM:SS" wall text directly — never
  // `new Date(str)` on naive strings, never UTC conversion — so the header
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

  function fmtShort(wall) {
    var p = wallParts(wall);
    return p ? p.d + "/" + p.mo : "—";
  }

  function dayCount(minWall, maxWall) {
    var a = wallParts(minWall), b = wallParts(maxWall);
    if (!a || !b) return 0;
    var da = Date.UTC(+a.y, +a.mo - 1, +a.d);
    var db = Date.UTC(+b.y, +b.mo - 1, +b.d);
    return Math.round((db - da) / 86400000) + 1;
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

  function rangeText() {
    var min = state.meta.minStart, max = state.meta.maxEnd;
    if (!min || !max) return "📅 Disponible: —";
    if (min.slice(0, 10) === max.slice(0, 10)) {
      var today = "";
      try { today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) {}
      if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
      if (min.slice(0, 10) === today) return "📅 Disponible: Hoy";
      return "📅 Disponible: " + fmtShort(min) + " (1 día)";
    }
    return "📅 Disponible: " + fmtShort(min) + " → " + fmtShort(max) +
      " (" + dayCount(min, max) + " días)";
  }

  function updateOpbar(visible) {
    var total = state.rows.length;
    var count = (typeof visible === "number" && visible !== total)
      ? visible + " de " + total : String(total);
    if (els.count) els.count.textContent = "📦 " + count + " cambios cargados";
    if (els.updated) {
      els.updated.textContent = state.meta.generatedAt
        ? "🕒 Actualizado: " + fmtFull(toWall(state.meta.generatedAt)) + " (Lima)"
        : "🕒 Actualizado: —";
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
      meta.textContent = row.tipo_cambio + " · " + windowLabel(row);
      var stateEl = document.createElement("span");
      stateEl.className = "state " + stateClass(row.estado_actual);
      stateEl.textContent = row.estado_actual;
      btn.append(ticket, meta, stateEl);
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
      status: document.getElementById("status"),
      count: document.getElementById("op-count"),
      updated: document.getElementById("op-updated"),
      range: document.getElementById("op-range"),
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
      if (els.count) els.count.textContent = "📦 No se pudieron cargar los cambios";
      renderList([]);
    });
  }

  function onData(data) {
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    state.meta.generatedAt = typeof data.generated_at === "string" ? data.generated_at : "";
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
