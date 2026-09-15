/* Change Triage search: instant Ticket/App/Recurso substring, field filters,
 * and incident-overlap mode. Filters feed the list through the window.Triage
 * hookup surface — no list rendering logic is duplicated here.
 */
"use strict";

window.TriageSearch = (function () {
  // Lima wall time has a fixed -05:00 offset (no DST), so a datetime-local
  // value can be stamped directly instead of going through the browser TZ.
  var LIMA_OFFSET = "-05:00";

  function norm(value) {
    return (value === null || value === undefined ? "" : String(value)).toLowerCase();
  }

  function contains(field, needle) {
    return norm(field).indexOf(needle) !== -1;
  }

  // Instant search: one substring matched against Ticket, App, and Recurso.
  function matchesQuery(row, q) {
    if (!q) return true;
    var needle = q.trim().toLowerCase();
    if (!needle) return true;
    return contains(row.ticket, needle)
      || contains(row.nombre_app, needle)
      || contains(row.recurso, needle);
  }

  // Field filters combine with AND semantics; blank filters are ignored.
  function matchesFilters(row, criteria) {
    if (criteria.ticket && !contains(row.ticket, criteria.ticket.trim().toLowerCase())) return false;
    if (criteria.app && !contains(row.nombre_app, criteria.app.trim().toLowerCase())) return false;
    if (criteria.tipo && !contains(row.tipo_cambio, criteria.tipo.trim().toLowerCase())) return false;
    if (criteria.fecha) {
      var ini = typeof row.fec_hora_ini_impl === "string" ? row.fec_hora_ini_impl : "";
      if (ini.slice(0, 10) !== criteria.fecha) return false;
    }
    return true;
  }

  // Accepts datetime-local ("YYYY-MM-DDTHH:MM"), full Lima ISO, or a bare
  // "YYYY-MM-DD HH:MM" wall time. Returns millis since epoch, or NaN.
  function parseIncident(value) {
    if (!value) return NaN;
    var text = String(value).trim();
    if (!text) return NaN;
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?$/.exec(text);
    var iso = m ? m[1] + "T" + m[2] + ":" + (m[3] || "00") + LIMA_OFFSET : text;
    var ms = Date.parse(iso);
    return isNaN(ms) ? NaN : ms;
  }

  // Inclusive Lima-window verdict: impl_ini <= incident <= impl_fin.
  // Rows with a null (or unparsable) window edge never match.
  function isOverlap(row, incidentMs) {
    if (isNaN(incidentMs)) return null;
    if (typeof row.fec_hora_ini_impl !== "string" || typeof row.fec_hora_fin_impl !== "string") return false;
    var ini = Date.parse(row.fec_hora_ini_impl);
    var fin = Date.parse(row.fec_hora_fin_impl);
    if (isNaN(ini) || isNaN(fin)) return false;
    return ini <= incidentMs && incidentMs <= fin;
  }

  function getCriteria() {
    return {
      q: document.getElementById("q").value,
      ticket: document.getElementById("f-ticket").value,
      app: document.getElementById("f-app").value,
      tipo: document.getElementById("f-tipo").value,
      fecha: document.getElementById("f-fecha").value,
      incident: document.getElementById("f-incident").value,
    };
  }

  function applyFilters() {
    if (!window.Triage) return;
    var rows = window.Triage.getRows();
    var criteria = getCriteria();
    var incidentMs = parseIncident(criteria.incident);
    var incidentActive = !isNaN(incidentMs);
    var filtered = rows.filter(function (row) {
      return matchesQuery(row, criteria.q) && matchesFilters(row, criteria);
    });
    filtered.forEach(function (row) {
      row._overlap = incidentActive ? isOverlap(row, incidentMs) : null;
    });
    window.Triage.render(filtered, {
      total: rows.length,
      incidentActive: incidentActive,
    });
  }

  function resetFilters() {
    ["q", "f-ticket", "f-app", "f-tipo", "f-fecha", "f-incident"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });
  }

  // Re-applies the current criteria (e.g. right after data.json loads).
  function refresh() {
    applyFilters();
  }

  function init() {
    ["q", "f-ticket", "f-app", "f-tipo"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", applyFilters);
    });
    ["f-fecha", "f-incident"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", applyFilters);
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  return {
    applyFilters: applyFilters,
    resetFilters: resetFilters,
    refresh: refresh,
    matchesQuery: matchesQuery,
    matchesFilters: matchesFilters,
    parseIncident: parseIncident,
    isOverlap: isOverlap,
  };
})();
