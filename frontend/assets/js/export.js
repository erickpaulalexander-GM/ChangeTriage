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

  // One Ticket/App/window line per row.
  function toTeamsSummary(rows) {
    return rows.map(function (row) {
      return (row.ticket || "?") + " — " + (row.nombre_app || "?") + " (" + windowLabel(row) + ")";
    }).join("\n");
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
    if (rows.length === 0) {
      showFallback("");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        // Operational header bar owns #status now: confirm in its count slot
        // when present, else fall back to the legacy status element.
        var statusEl = document.getElementById("op-count") || document.getElementById("status");
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
