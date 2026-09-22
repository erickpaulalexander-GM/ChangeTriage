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
 * - Ops-density single bar: selection COUNT lives in the input placeholders
 *   ("App (2)" / "Ticket (1)"); the only chip source is #active-filters.
 * - Bundle-safe: stdlib-free, no imports, no closing-tag literals.
 */
"use strict";

window.TriageFilters = (function () {
  // Cap on visible suggestions so the dropdown scrolls instead of growing.
  var MAX_OPTIONS = 50;
  var ALL_APPS = "Todas";
  var EMPTY_STATE = "Sin coincidencias";

  var state = { tickets: [], apps: [], tipos: [] };

  // Multi-select value store: the real filter value lives here, inputs stay
  // as query boxes (input.value === "" after each pick).
  var selected = { ticket: [], app: [] };

  function kindKey(kind) {
    return kind === "app" ? "app" : "ticket";
  }

  function cleanVal(value) {
    return text(value).trim();
  }

  // Copy of the current selection for one combo (search.js/reset read this).
  function getSelected(kind) {
    return selected[kindKey(kind)].slice();
  }

  function isSelected(kind, value) {
    var needle = cleanVal(value).toLowerCase();
    if (!needle) return false;
    var list = selected[kindKey(kind)];
    for (var i = 0; i < list.length; i++) {
      if (text(list[i]).toLowerCase() === needle) return true;
    }
    return false;
  }

  function renderChips(kind) {
    if (typeof document === "undefined" || !document.getElementById) return;
    // Single chip source is #active-filters (share.js): the combo inputs show
    // the selection COUNT in their placeholder instead (App (Todas) -> App (2)).
    // renderChips stays exported + functional as a defensive no-op when the
    // legacy in-combo boxes are absent from the markup.
    syncPlaceholder(kind);
    var key = kindKey(kind);
    var box = document.getElementById(key === "app" ? "f-app-chips" : "f-ticket-chips");
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    selected[key].forEach(function (value) {
      var chip = document.createElement("span");
      chip.className = "chip";
      var label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = value;
      chip.appendChild(label);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip-x";
      btn.setAttribute("aria-label", "Quitar " + value);
      btn.textContent = "\u00d7";
      btn.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      btn.addEventListener("click", function () {
        removeValue(key, value);
      });
      chip.appendChild(btn);
      box.appendChild(chip);
    });
  }

  function renderAllChips() {
    renderChips("ticket");
    renderChips("app");
  }

  // Placeholder text carrying the selection count for one combo:
  // app empty -> "App (Todas)", app N -> "App (N)";
  // ticket empty -> "Ticket", ticket N -> "Ticket (N)". Pure (no DOM) so it
  // is unit-testable; syncPlaceholder applies it to the live inputs.
  function placeholderFor(kind, count) {
    var key = kindKey(kind);
    var n = typeof count === "number" ? count : selected[key].length;
    if (key === "app") return n > 0 ? "App (" + n + ")" : "App (Todas)";
    return n > 0 ? "Ticket (" + n + ")" : "Ticket";
  }

  function syncPlaceholder(kind) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var keys = kind === "app" || kind === "ticket"
      ? [kindKey(kind)]
      : ["ticket", "app"];
    keys.forEach(function (key) {
      var input = document.getElementById(key === "app" ? "f-app" : "f-ticket");
      if (input && input.setAttribute) {
        input.setAttribute("placeholder", placeholderFor(key));
      }
    });
  }

  // Toggle insert/remove; returns true when the value ends up selected.
  function toggleValue(kind, value) {
    var key = kindKey(kind);
    var clean = cleanVal(value);
    if (!clean) return false;
    var list = selected[key];
    var needle = clean.toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (text(list[i]).toLowerCase() === needle) {
        list.splice(i, 1);
        renderChips(key);
        return false;
      }
    }
    list.push(clean);
    renderChips(key);
    return true;
  }

  function removeValue(kind, value) {
    var key = kindKey(kind);
    var needle = cleanVal(value).toLowerCase();
    var list = selected[key];
    for (var i = 0; i < list.length; i++) {
      if (text(list[i]).toLowerCase() === needle) list.splice(i, 1);
    }
    renderChips(key);
    refreshOpenList(key);
    apply();
  }

  // Exposed for search.js reset: empties one combo (or both) + repaints.
  function clearSelected(kind) {    if (kind === "ticket" || kind === "app") {
      selected[kindKey(kind)] = [];
      renderChips(kind);
    } else {
      selected.ticket = [];
      selected.app = [];
      renderAllChips();
    }
  }

  // Shareable-state restore (share.js): replaces one combo's selection with
  // an explicit value list (deduped, blanks dropped) + repaints chips and the
  // open dropdown. Does NOT apply filters — the caller applies once after
  // setting every control.
  function setSelected(kind, values) {
    var key = kindKey(kind);
    var list = Array.isArray(values) ? values : [];
    var out = [];
    list.forEach(function (entry) {
      var clean = cleanVal(entry);
      if (!clean) return;
      var needle = clean.toLowerCase();
      for (var i = 0; i < out.length; i++) {
        if (text(out[i]).toLowerCase() === needle) return;
      }
      out.push(clean);
    });
    selected[key] = out;
    renderChips(key);
    refreshOpenList(key);
  }

  // After a chip removal, repaint the open dropdown so checks stay in sync.
  function refreshOpenList(kind) {
    if (typeof document === "undefined" || !document.getElementById) return;
    var key = kindKey(kind);
    var input = document.getElementById(key === "app" ? "f-app" : "f-ticket");
    var list = document.getElementById(key === "app" ? "f-app-list" : "f-ticket-list");
    if (input && list && isOpen(list)) openList(key, input, list);
  }

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
        var picked = isSelected(kind, value);
        item.setAttribute("aria-selected", picked ? "true" : "false");
        item.setAttribute("data-value", value);
        var mark = document.createElement("span");
        mark.className = "tick";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = picked ? "\u2713" : "";
        item.appendChild(mark);
        var label = document.createElement("span");
        label.className = "combo-label";
        label.textContent = value;
        item.appendChild(label);
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

  // A pick toggles the value in `selected` ("Todas" clears the app combo);
  // the input stays a query box (""). Free text typed without picking is
  // added on Enter by the keydown handler below.
  function chooseValue(kind, input, list, value) {
    if (!input) return;
    var key = kindKey(kind);
    if (key === "app" && cleanVal(value) === ALL_APPS) {
      clearSelected("app");
      input.value = "";
      closeList(input, list);
      input.focus();
      apply();
      return;
    }
    toggleValue(key, value);
    input.value = "";
    // Keep the dropdown open for multi-pick, repainted with fresh checks.
    openList(key, input, list);
    input.focus();
    apply();
  }

  // Enter on free text adds it as a chip (no suggestion chosen).
  function addFreeText(kind, input, list) {
    var clean = cleanVal(input.value);
    if (!clean) return false;
    if (kindKey(kind) === "app" && clean === ALL_APPS) {
      clearSelected("app");
    } else if (!isSelected(kind, clean)) {
      toggleValue(kind, clean);
    }
    input.value = "";
    openList(kindKey(kind), input, list);
    apply();
    return true;
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
    // Highlight only: aria-selected reflects the multi-select check state
    // set in renderList and must not be overwritten by keyboard focus.
    items.forEach(function (item, i) {
      item.classList.toggle("active", i === index);
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
        if (isOpen(list) && chooseActive(kind, input, list)) {
          event.preventDefault();
        } else if (cleanVal(input.value)) {
          event.preventDefault();
          addFreeText(kind, input, list);
        }
      } else if (event.key === "Backspace") {
        if (!cleanVal(input.value)) {
          var current = getSelected(kind);
          if (current.length > 0) {
            event.preventDefault();
            removeValue(kind, current[current.length - 1]);
          }
        }
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
    renderAllChips();
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
    getSelected: getSelected,
    setSelected: setSelected,
    removeValue: removeValue,
    clearSelected: clearSelected,
    renderChips: renderChips,
    placeholderFor: placeholderFor,
    syncPlaceholder: syncPlaceholder,
    getState: function () { return state; },
    MAX_OPTIONS: MAX_OPTIONS,
    ALL_APPS: ALL_APPS,
    EMPTY_STATE: EMPTY_STATE,
  };
})();
