/* Change Triage filter controls: ticket/app comboboxes + tipo select.
 *
 * - Options are derived DYNAMICALLY from the loaded data.json rows (via
 *   window.Triage.getRows()); nothing is hardcoded here.
 * - Filtering itself is NOT reimplemented: every control only sets the value
 *   of its field (#f-ticket, #f-app, #f-tipo) and delegates to the central
 *   window.TriageSearch.applyFilters() from search.js (AND semantics, Lima
 *   incident-range logic, and export wiring stay untouched).
 * - Free text stays allowed in both comboboxes (partial substring search);
 *   picking a suggestion just fills the input. "Todas" clears the app field.
 * - Bundle-safe: stdlib-free, no imports, no closing-tag literals.
 */
"use strict";

window.TriageFilters = (function () {
  // Cap on visible suggestions so the dropdown scrolls instead of growing.
  var MAX_OPTIONS = 50;
  var ALL_APPS = "Todas";
  var EMPTY_STATE = "Sin coincidencias";

  var state = { tickets: [], apps: [], tipos: [] };

  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function compare(a, b) {
    var x = text(a).toLowerCase();
    var y = text(b).toLowerCase();
    if (x < y) return -1;
    if (x > y) return 1;
    return 0;
  }

  // Unique non-blank values for one row key, sorted alphabetically.
  function uniqSorted(rows, key) {
    var seen = {};
    var out = [];
    rows.forEach(function (row) {
      var value = text(row[key]).trim();
      if (!value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    });
    out.sort(compare);
    return out;
  }

  // Pure derivation from rows: { tickets, apps, tipos }.
  function deriveOptions(rows) {
    var list = Array.isArray(rows) ? rows : [];
    return {
      tickets: uniqSorted(list, "ticket"),
      apps: uniqSorted(list, "nombre_app"),
      tipos: uniqSorted(list, "tipo_cambio"),
    };
  }

  // Case-insensitive substring match (digits typed in the ticket box match
  // the full ticket code), capped so the listbox scrolls. Blank query
  // returns the head of the list.
  function filterOptions(options, query, limit) {
    var list = Array.isArray(options) ? options : [];
    var needle = text(query).trim().toLowerCase();
    var max = typeof limit === "number" ? limit : MAX_OPTIONS;
    if (!needle) return list.slice(0, max);
    var out = [];
    for (var i = 0; i < list.length && out.length < max; i++) {
      if (text(list[i]).toLowerCase().indexOf(needle) !== -1) out.push(list[i]);
    }
    return out;
  }

  function getRows() {
    if (window.Triage && typeof window.Triage.getRows === "function") {
      return window.Triage.getRows();
    }
    return [];
  }

  function apply() {
    if (window.TriageSearch && typeof window.TriageSearch.applyFilters === "function") {
      window.TriageSearch.applyFilters();
    }
  }

  // Rebuilds option state from the current rows + repopulates the tipo
  // <select> (keeping the "TIPO CAMBIO" default first and preserving selection).
  function refreshOptions() {
    state = deriveOptions(getRows());
    populateTipo();
    return state;
  }

  function populateTipo() {
    if (typeof document === "undefined" || !document.getElementById) return;
    var select = document.getElementById("f-tipo");
    if (!select || typeof select.appendChild !== "function") return;
    var current = select.value || "";
    while (select.firstChild) select.removeChild(select.firstChild);
    var doc = document;
    var all = doc.createElement("option");
    all.value = "";
    all.textContent = "TIPO CAMBIO";
    select.appendChild(all);
    state.tipos.forEach(function (tipo) {
      var opt = doc.createElement("option");
      opt.value = tipo;
      opt.textContent = tipo;
      select.appendChild(opt);
    });
    select.value = current;
  }

  function setExpanded(input, list, open) {
    if (input && input.setAttribute) {
      input.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (list) {
      if (open) list.removeAttribute("hidden");
      else list.setAttribute("hidden", "");
    }
  }

  function isOpen(list) {
    return !!(list && list.hasAttribute && !list.hasAttribute("hidden"));
  }

  // Renders suggestion <li> items for one combobox; wires mouse/touch
  // selection (mousedown fires before input blur). Keyboard nav is handled
  // on the input's keydown listener via moveActive/chooseActive.
  function renderList(kind, input, list, matches) {
    if (!list || typeof document === "undefined" || !document.createElement) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    list.setAttribute("data-active", "-1");
    var items = matches.slice();
    if (items.length === 0) {
      var empty = document.createElement("li");
      empty.className = "combo-empty";
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-selected", "false");
      empty.setAttribute("aria-disabled", "true");
      empty.textContent = EMPTY_STATE;
      list.appendChild(empty);
    } else {
      items.forEach(function (value) {
        var item = document.createElement("li");
        item.className = "combo-option";
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", "false");
        item.setAttribute("data-value", value);
        item.textContent = value;
        item.addEventListener("mousedown", function (event) {
          event.preventDefault();
          chooseValue(kind, input, list, value);
        });
        list.appendChild(item);
      });
    }
    setExpanded(input, list, true);
  }

  function optionsFor(kind) {
    return kind === "app" ? state.apps : state.tickets;
  }

  function openList(kind, input, list) {
    var matches = filterOptions(optionsFor(kind), input.value, MAX_OPTIONS);
    // "Todas" heads the app list only when unfiltered; a query with zero
    // hits shows the "Sin coincidencias" empty state instead.
    if (kind === "app" && !text(input.value).trim()) matches.unshift(ALL_APPS);
    renderList(kind, input, list, matches);
  }

  function closeList(input, list) {
    list.setAttribute("data-active", "-1");
    setExpanded(input, list, false);
  }

  function closeAll() {
    if (typeof document === "undefined" || !document.getElementById) return;
    [["f-ticket", "f-ticket-list"], ["f-app", "f-app-list"]].forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      var list = document.getElementById(pair[1]);
      if (input && list) closeList(input, list);
    });
  }

  // A pick fills the field ("Todas" clears the app field) and delegates to
  // the central filter; free text typed without picking filters as-is.
  function chooseValue(kind, input, list, value) {
    if (!input) return;
    if (kind === "app" && value === ALL_APPS) input.value = "";
    else input.value = value;
    closeList(input, list);
    input.focus();
    apply();
  }

  function childOptions(list) {
    if (!list || !list.children) return [];
    return Array.prototype.filter.call(list.children, function (child) {
      return child.className === "combo-option";
    });
  }

  function markActive(list, index) {
    var items = childOptions(list);
    list.setAttribute("data-active", String(index));
    items.forEach(function (item, i) {
      item.classList.toggle("active", i === index);
      item.setAttribute("aria-selected", i === index ? "true" : "false");
    });
    var current = items[index];
    if (current && typeof current.scrollIntoView === "function") {
      current.scrollIntoView({ block: "nearest" });
    }
  }

  function moveActive(kind, input, list, delta) {
    var items = childOptions(list);
    if (items.length === 0) return;
    var active = parseInt(list.getAttribute("data-active") || "-1", 10);
    if (isNaN(active)) active = -1;
    var next = (active + delta + items.length) % items.length;
    if (!isOpen(list)) {
      openList(kind, input, list);
      items = childOptions(list);
      next = delta > 0 ? 0 : items.length - 1;
    }
    markActive(list, next);
  }

  function chooseActive(kind, input, list) {
    var items = childOptions(list);
    var active = parseInt(list.getAttribute("data-active") || "-1", 10);
    if (!isNaN(active) && items[active]) {
      chooseValue(kind, input, list, items[active].getAttribute("data-value"));
      return true;
    }
    return false;
  }

  function wireCombo(kind, inputId, listId) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var input = document.getElementById(inputId);
    var list = document.getElementById(listId);
    if (!input || !list || !input.addEventListener) return;
    input.addEventListener("input", function () {
      openList(kind, input, list);
    });
    input.addEventListener("focus", function () {
      openList(kind, input, list);
    });
    input.addEventListener("blur", function () {
      closeList(input, list);
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(kind, input, list, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(kind, input, list, -1);
      } else if (event.key === "Enter") {
        if (isOpen(list) && chooseActive(kind, input, list)) event.preventDefault();
      } else if (event.key === "Escape") {
        if (isOpen(list)) {
          event.preventDefault();
          event.stopPropagation();
          closeList(input, list);
        }
      }
    });
  }

  function init() {
    if (typeof document === "undefined" || !document.getElementById) return;
    wireCombo("ticket", "f-ticket", "f-ticket-list");
    wireCombo("app", "f-app", "f-app-list");
    refreshOptions();
    if (document.addEventListener) {
      // Outside click closes any open dropdown (drawer Escape stays owned
      // by drawer.js; this only reacts while a suggestion list is open).
      document.addEventListener("mousedown", function (event) {
        var target = event.target;
        var inside = target && typeof target.closest === "function"
          ? target.closest(".combo")
          : null;
        if (!inside) closeAll();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeAll();
      });
    }
    // Rebuild dynamic options right after data.json loads (app.js calls
    // TriageSearch.refresh() once rows arrive); keep initial full count.
    if (window.TriageSearch && !window.TriageSearch.__filtersHooked) {
      window.TriageSearch.__filtersHooked = true;
      var base = window.TriageSearch.refresh;
      window.TriageSearch.refresh = function () {
        refreshOptions();
        return base();
      };
      var resetBase = window.TriageSearch.resetFilters;
      window.TriageSearch.resetFilters = function () {
        var out = resetBase();
        closeAll();
        return out;
      };
    }
  }

  if (typeof document !== "undefined" && document.readyState !== "loading") init();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", init);

  return {
    deriveOptions: deriveOptions,
    filterOptions: filterOptions,
    refreshOptions: refreshOptions,
    closeAll: closeAll,
    getState: function () { return state; },
    MAX_OPTIONS: MAX_OPTIONS,
    ALL_APPS: ALL_APPS,
    EMPTY_STATE: EMPTY_STATE,
  };
})();
