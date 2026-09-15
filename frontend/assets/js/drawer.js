/* Change Triage detail drawer: renders the 6 change groups for a selected row.
 * Closing (button, overlay, or Escape) returns focus to the invoking row.
 */
"use strict";

window.Drawer = (function () {
  // Group taxonomy from DATA_DICTIONARY.md; keys are data.json canonical fields.
  var GROUPS = [
    ["Resumen", ["tribu", "squad", "ticket", "nombre_app", "tipo_cambio",
      "tipo_cambio2", "estado_actual", "descripcion_cambio"]],
    ["Implementacion", ["fec_hora_ini_impl", "fec_hora_fin_impl", "fec_hora_ini_rati",
      "fec_hora_fin_rati", "fec_hora_fin_rati_total"]],
    ["Reversion", ["tiempo_reversion", "fec_hor_ini_reversion", "fec_hor_fin_reversion",
      "tiempo_ratificacion_reversion", "fec_hor_ini_rati_reve", "fec_hor_fin_rati_reve"]],
    ["Impacto", ["canales_app_impactadas_segun_cvt", "componentes_impactados",
      "canales_app_impactadas_segun_squad", "canales_app_a_ratificar",
      "visor_incidente", "impacta_oor"]],
    ["Responsables", ["nomb_cell_contacto_impl", "nomb_cell_contacto_rati",
      "recurso", "recurso_asignado"]],
    ["Gobernanza", ["fecha_registro", "formatos_eje", "torres_requeridas",
      "torres_coordinadas", "requiere_usuario_root"]],
  ];

  var lastTrigger = null;

  function label(key) {
    return key.replace(/_/g, " ").toUpperCase();
  }

  // data.json dates are already America/Lima ISO; display as DD/MM/YYYY HH:MM.
  function formatDate(value) {
    if (typeof value !== "string") return value;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    return m ? m[3] + "/" + m[2] + "/" + m[1] + " " + m[4] + ":" + m[5] : value;
  }

  function formatValue(key, value) {
    if (value === null || value === undefined || value === "") return "—";
    if (/^fec_|fecha_registro/.test(key)) return formatDate(value);
    return String(value);
  }

  function groupId(name) {
    return "grp-" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function setExpanded(section, expanded) {
    var button = section.querySelector(".group-header");
    var list = section.querySelector(".group-list");
    if (!button || !list) return;
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (expanded) list.removeAttribute("hidden");
    else list.setAttribute("hidden", "");
  }

  function open(row, triggerEl) {
    lastTrigger = triggerEl || null;
    var body = document.getElementById("drawer-body");
    body.innerHTML = "";
    document.getElementById("drawer-title").textContent =
      (row.ticket || "Change") + " — " + (row.nombre_app || "");
    // Compact internal nav: anchor chips linking to each group section.
    var nav = document.createElement("nav");
    nav.className = "drawer-nav";
    nav.setAttribute("aria-label", "Change detail sections");
    var sections = [];
    GROUPS.forEach(function ([name, keys], index) {
      var sectionId = groupId(name);
      var listId = sectionId + "-list";
      var headerId = sectionId + "-header";
      var chip = document.createElement("a");
      chip.className = "chip";
      chip.href = "#" + sectionId;
      chip.textContent = name;
      chip.addEventListener("click", function (event) {
        event.preventDefault();
        setExpanded(sections[index], true);
        sections[index].scrollIntoView({ block: "start", behavior: "smooth" });
      });
      nav.append(chip);
      var section = document.createElement("section");
      section.className = "group";
      section.id = sectionId;
      var header = document.createElement("button");
      header.type = "button";
      header.className = "group-header";
      header.id = headerId;
      header.setAttribute("aria-expanded", index === 0 ? "true" : "false");
      header.setAttribute("aria-controls", listId);
      var nameSpan = document.createElement("span");
      nameSpan.className = "group-name";
      nameSpan.textContent = name;
      var countSpan = document.createElement("span");
      countSpan.className = "group-count";
      countSpan.textContent = String(keys.length);
      var chevron = document.createElement("span");
      chevron.className = "group-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "▾";
      header.append(nameSpan, countSpan, chevron);
      header.addEventListener("click", function () {
        var expanded = header.getAttribute("aria-expanded") !== "true";
        setExpanded(section, expanded);
      });
      var list = document.createElement("dl");
      list.className = "group-list";
      list.id = listId;
      list.setAttribute("role", "region");
      list.setAttribute("aria-labelledby", headerId);
      if (index !== 0) list.setAttribute("hidden", "");
      keys.forEach(function (key) {
        var dt = document.createElement("dt");
        dt.textContent = label(key);
        var dd = document.createElement("dd");
        dd.textContent = formatValue(key, row[key]);
        var wrap = document.createElement("div");
        wrap.className = "field";
        wrap.append(dt, dd);
        list.append(wrap);
      });
      section.append(header, list);
      sections.push(section);
    });
    body.append(nav);
    sections.forEach(function (section) { body.append(section); });
    document.getElementById("drawer").hidden = false;
    document.getElementById("overlay").hidden = false;
    document.getElementById("drawer-close").focus();
  }

  function close() {
    document.getElementById("drawer").hidden = true;
    document.getElementById("overlay").hidden = true;
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    lastTrigger = null;
  }

  function init() {
    document.getElementById("drawer-close").addEventListener("click", close);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !document.getElementById("drawer").hidden) close();
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  return { open: open, close: close, formatDate: formatDate };
})();
