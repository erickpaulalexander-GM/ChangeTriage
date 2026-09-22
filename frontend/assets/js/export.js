/* Change Triage export: CSV download of the current result set and a
 * Teams-summary clipboard copy, both reading window.Triage.getVisible().
 */
"use strict";

window.TriageExport = (function () {
  // Canonical data.json columns in drawer-group order; also the headers-only
  // fallback when the result set is empty.
  var COLUMNS = [
    "tribu", "squad", "ticket", "nombre_app", "tipo_cambio", "tipo_cambio2",
    "estado_actual", "descripcion_cambio",
    "fec_hora_ini_impl", "fec_hora_fin_impl", "fec_hora_ini_rati",
    "fec_hora_fin_rati", "fec_hora_fin_rati_total",
    "tiempo_reversion", "fec_hor_ini_reversion", "fec_hor_fin_reversion",
    "tiempo_ratificacion_reversion", "fec_hor_ini_rati_reve", "fec_hor_fin_rati_reve",
    "canales_app_impactadas_segun_cvt", "componentes_impactados",
    "canales_app_impactadas_segun_squad", "canales_app_a_ratificar",
    "visor_incidente", "impacta_oor",
    "nomb_cell_contacto_impl", "nomb_cell_contacto_rati",
    "recurso", "recurso_asignado",
    "fecha_registro", "formatos_eje", "torres_requeridas",
    "torres_coordinadas", "requiere_usuario_root",
  ];

  function cell(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function csvEscape(value) {
    var text = cell(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCSV(rows) {
    var lines = [COLUMNS.map(csvEscape).join(",")];
    rows.forEach(function (row) {
      lines.push(COLUMNS.map(function (key) { return csvEscape(row[key]); }).join(","));
    });
    return lines.join("\r\n") + "\r\n";
  }

  function downloadCSV() {
    var rows = window.Triage ? window.Triage.getVisible() : [];
    // Counts only — never log row values (production-data caution).
    console.info("[triage] CSV export: rows=" + rows.length);
    var blob = new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "change-triage-export.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function windowLabel(row) {
    var fmt = window.Drawer ? window.Drawer.formatDate : function (v) { return v; };
    return fmt(row.fec_hora_ini_impl) + " → " + fmt(row.fec_hora_fin_impl);
  }

  // Normative shareable-state header for the Teams summary (client format):
  // only sections with an active filter are listed (+Tickets/+Búsqueda when
  // they apply); with no filters a single "Sin filtros" line is used. Reads
  // the live criteria from TriageSearch so the summary always describes the
  // visible rows; count = rows.length (visible rows).
  function criteriaOf() {
    if (window.TriageSearch && typeof window.TriageSearch.getCriteria === "function") {
      try {
        return window.TriageSearch.getCriteria();
      } catch (e) { /* fall through to the empty shape below */ }
    }
    return { q: "", ticket: [], app: [], tipo: "", desde: "", hasta: "" };
  }

  function cleanValues(values) {
    var out = [];
    (Array.isArray(values) ? values : []).forEach(function (entry) {
      var clean = cell(entry).trim();
      if (clean) out.push(clean);
    });
    return out;
  }

  function fallbackDay(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell(day));
    return m ? m[3] + "/" + m[2] : cell(day);
  }

  function formatDayOf(day) {
    if (window.TriageDaypick && typeof window.TriageDaypick.formatDay === "function") {
      try {
        var label = window.TriageDaypick.formatDay(day);
        if (label) return label;
      } catch (e) { /* fall through to the local fallback */ }
    }
    return fallbackDay(day);
  }

  function windowLabelShort(desde, hasta) {
    desde = cell(desde);
    hasta = cell(hasta);
    if (!desde && !hasta) return "";
    if (desde && hasta) {
      if (window.TriageDaypick && typeof window.TriageDaypick.formatWindowShort === "function") {
        try {
          var short = window.TriageDaypick.formatWindowShort(desde, hasta);
          if (short) return short;
        } catch (e) { /* fall through to the local fallback */ }
      }
      var dDay = desde.slice(0, 10);
      var hDay = hasta.slice(0, 10);
      var dTime = desde.slice(11, 16);
      var hTime = hasta.slice(11, 16);
      if (dDay === hDay) return formatDayOf(dDay) + " · " + dTime + "-" + hTime;
      return formatDayOf(dDay) + " " + dTime + " → " + formatDayOf(hDay) + " " + hTime;
    }
    if (desde) return formatDayOf(desde.slice(0, 10)) + " · desde " + desde.slice(11, 16);
    return formatDayOf(hasta.slice(0, 10)) + " · hasta " + hasta.slice(11, 16);
  }

  function headerLines(count) {
    var criteria = criteriaOf();
    var tickets = cleanValues(criteria.ticket);
    var apps = cleanValues(criteria.app);
    var tipo = cell(criteria.tipo).trim();
    var query = cell(criteria.q).trim();
    var win = windowLabelShort(criteria.desde, criteria.hasta);
    var lines = ["Change Triage"];
    if (!tickets.length && !apps.length && !tipo && !query && !win) {
      lines.push("Sin filtros (vista completa).");
    } else {
      lines.push("Filtros aplicados:");
      if (tickets.length) lines.push("• Tickets: " + tickets.join(", "));
      if (apps.length) lines.push("• Apps: " + apps.join(", "));
      if (tipo) lines.push("• Tipo: " + tipo);
      if (win) lines.push("• Ventana: " + win);
      if (query) lines.push("• Búsqueda: " + query);
    }
    lines.push("Resultados: " + count + " cambios encontrados.");
    return lines;
  }

  // Header + one Ticket/App/window line per row.
  function toTeamsSummary(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var lines = headerLines(list.length);
    list.forEach(function (row) {
      lines.push((row.ticket || "?") + " — " + (row.nombre_app || "?") + " (" + windowLabel(row) + ")");
    });
    return lines.join("\n");
  }

  function showFallback(text) {
    var box = document.getElementById("teams-fallback");
    box.value = text;
    box.hidden = false;
    box.focus();
    box.select();
  }

  function copyTeams() {
    var rows = window.Triage ? window.Triage.getVisible() : [];
    var text = toTeamsSummary(rows);
    var box = document.getElementById("teams-fallback");
    box.hidden = true;
    // Counts only — never log row values (production-data caution).
    console.info("[triage] Teams summary copy: rows=" + rows.length);
    // The header always carries the filter context + count, so even an empty
    // result set is worth copying (no early return).
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        // Compact layout (C1): the opbar count slot is gone — confirm on
        // the #results-count line above the list. Copy logic untouched.
        var statusEl = document.getElementById("results-count");
        if (statusEl) {
          statusEl.textContent =
            "Copied " + rows.length + " change summaries for Teams.";
        }
      }, function () {
        showFallback(text);
      });
    } else {
      showFallback(text);
    }
  }

  function init() {
    document.getElementById("export-csv").addEventListener("click", downloadCSV);
    document.getElementById("export-teams").addEventListener("click", copyTeams);
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  return {
    toCSV: toCSV,
    toTeamsSummary: toTeamsSummary,
    downloadCSV: downloadCSV,
    copyTeams: copyTeams,
  };
})();
