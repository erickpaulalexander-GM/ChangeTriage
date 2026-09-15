/* Change Triage list view: loads data.json (relative paths only, never the
 * Excel workbook) and renders the results list with empty-state + reset.
 * Search, overlap flags, and exports arrive in Phase 3 (search.js/export.js).
 */
"use strict";

(function () {
  // Repo checkout layout first, then published-bundle layouts (co-located JSON).
  var SOURCES = [
    "../workspace/output/data.json",
    "./data.json",
    "./data/data.json",
  ];

  var state = { rows: [], visible: [] };
  var els = {};

  function setStatus(text) {
    els.status.textContent = text;
  }

  function windowLabel(row) {
    var ini = window.Drawer ? window.Drawer.formatDate(row.fec_hora_ini_impl) : row.fec_hora_ini_impl;
    var fin = window.Drawer ? window.Drawer.formatDate(row.fec_hora_fin_impl) : row.fec_hora_fin_impl;
    return ini + " → " + fin;
  }

  function renderList(rows) {
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
      stateEl.className = "state";
      stateEl.textContent = row.estado_actual;
      btn.append(ticket, meta, stateEl);
      btn.addEventListener("click", function () {
        window.Drawer.open(row, btn);
      });
      item.append(btn);
      els.results.append(item);
    });
    var empty = rows.length === 0;
    els.empty.hidden = !empty;
    els.results.hidden = empty;
  }

  function reset() {
    renderList(state.rows);
    setStatus(state.rows.length + " changes loaded");
    els.status.setAttribute("tabindex", "-1");
    els.status.focus({ preventScroll: true });
  }

  function load() {
    els = {
      status: document.getElementById("status"),
      results: document.getElementById("results"),
      empty: document.getElementById("empty"),
    };
    document.getElementById("reset").addEventListener("click", reset);
    document.getElementById("overlay").addEventListener("click", window.Drawer.close);

    var chain = Promise.reject(new Error("start"));
    SOURCES.forEach(function (src) {
      chain = chain.catch(function () {
        return fetch(src).then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status + " for " + src);
          return res.json();
        });
      });
    });
    chain.then(function (data) {
      state.rows = Array.isArray(data.rows) ? data.rows : [];
      // Counts only — never log row values (production-data caution).
      console.info("[triage] data.json loaded: count=" + state.rows.length);
      setStatus(state.rows.length + " changes loaded");
      renderList(state.rows);
    }).catch(function (err) {
      console.error("[triage] data.json load failed: " + err.message);
      setStatus("Could not load change data. Re-run the pipeline to publish data.json.");
      renderList([]);
    });
  }

  window.Triage = { reset: reset, state: state };
  if (document.readyState !== "loading") load();
  else document.addEventListener("DOMContentLoaded", load);
})();
