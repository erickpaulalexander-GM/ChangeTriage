/* Change Triage hourly time dropdowns for the implementation window.
 *
 * Replaces the native <input type="time"> clocks (whose picker indicator is
 * near-invisible in dark theme and varies by browser) with a custom button +
 * listbox mirroring daypick.js: a clock-icon button per Desde/Hasta side
 * offering "Día completo" plus the 24 exact hours 00:00-23:00.
 *
 * Compat: the picked hour is stored as "HH:MM" in the SAME hidden inputs the
 * native clocks used (#f-desde-time / #f-hasta-time), and input/change events
 * are dispatched so search.js (parseWindowBound via applyFilters),
 * presets.js and share.js keep working untouched. No hour picked keeps the
 * legacy whole-day semantics (desde = from 00:00, hasta = until 23:59), so
 * the list carries only the 24 hours — no "whole day" row needed.
 */
"use strict";

window.TriageTimepick = (function () {
  var SIDES = ["desde", "hasta"];
  var PLACEHOLDER = "Hora";

  var HOURS = [];
  (function () {
    for (var h = 0; h < 24; h++) {
      HOURS.push((h < 10 ? "0" + h : "" + h) + ":00");
    }
  })();

  function el(id) {
    return document.getElementById(id);
  }

  function hiddenId(side) {
    return side === "hasta" ? "f-hasta-time" : "f-desde-time";
  }

  function btnId(side) {
    return side === "hasta" ? "f-hasta-hour" : "f-desde-hour";
  }

  function listId(side) {
    return side === "hasta" ? "f-hasta-hour-list" : "f-desde-hour-list";
  }

  function isHour(text) {
    return /^([01]\d|2[0-3]):00$/.test(text || "");
  }

  function selectedOf(side) {
    var hidden = el(hiddenId(side));
    var value = hidden && typeof hidden.value === "string" ? hidden.value.trim() : "";
    if (isHour(value)) return value;
    // Legacy half-hour values (old native step=1800 UI) still filter
    // correctly downstream; the button just shows the placeholder until
    // the user picks an exact hour.
    return "";
  }

  function labelOf(side) {
    var value = selectedOf(side);
    return value || PLACEHOLDER;
  }

  function setExpanded(btn, list, open) {
    if (btn && btn.setAttribute) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (list) {
      if (open) list.removeAttribute("hidden");
      else list.setAttribute("hidden", "");
    }
  }

  function isOpen(list) {
    return !!(list && list.hasAttribute && !list.hasAttribute("hidden"));
  }

  function childOptions(list) {
    if (!list || !list.children) return [];
    return Array.prototype.filter.call(list.children, function (child) {
      return child.className === "daypick-option";
    });
  }

  function syncButton(side) {
    var btn = el(btnId(side));
    if (!btn) return;
    var text = btn.querySelector ? btn.querySelector(".daypick-text") : null;
    var label = labelOf(side);
    if (text) text.textContent = label;
    else btn.textContent = label;
    if (btn.setAttribute) {
      btn.setAttribute("aria-label",
        (side === "hasta" ? "Hasta implementación: hora (hora de Lima), " :
          "Desde implementación: hora (hora de Lima), ") + label);
    }
  }

  // Silent UI sync from the hidden HH:MM inputs (no events): used after
  // presets, Limpiar, URL restore and data reloads so button labels +
  // checkmarks match.
  function syncFromInputs() {
    SIDES.forEach(function (side) {
      syncButton(side);
      var list = el(listId(side));
      if (list) paintSelection(side, list);
    });
  }

  function paintSelection(side, list) {
    var value = selectedOf(side);
    childOptions(list).forEach(function (item) {
      var on = (item.getAttribute("data-value") || "") === value && !!value;
      item.setAttribute("aria-selected", on ? "true" : "false");
      var tick = item.querySelector ? item.querySelector(".tick") : null;
      if (tick) tick.hidden = !on;
    });
  }

  function optionRow(value, label) {
    var item = document.createElement("li");
    item.className = "daypick-option";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    item.setAttribute("data-value", value);
    item.setAttribute("tabindex", "-1");
    item.textContent = label;
    var tick = document.createElement("span");
    tick.className = "tick";
    tick.setAttribute("aria-hidden", "true");
    tick.textContent = "✓";
    tick.hidden = true;
    item.appendChild(tick);
    return item;
  }

  function renderList(side) {
    var list = el(listId(side));
    if (!list || typeof document === "undefined" || !document.createElement) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    list.setAttribute("data-active", "-1");
    HOURS.forEach(function (hour) {
      var node = optionRow(hour, hour);
      (function (sideCopy, value, row) {
        row.addEventListener("mousedown", function (event) {
          event.preventDefault();
          choose(sideCopy, value);
        });
      })(side, hour, node);
      list.appendChild(node);
    });
    paintSelection(side, list);
  }

  function open(side) {
    var btn = el(btnId(side));
    var list = el(listId(side));
    if (!btn || !list) return;
    closeAll(btn);
    renderList(side);
    setExpanded(btn, list, true);
  }

  function close(side) {
    var btn = el(btnId(side));
    var list = el(listId(side));
    if (!btn || !list) return;
    list.setAttribute("data-active", "-1");
    setExpanded(btn, list, false);
  }

  function closeAll(exceptBtn) {
    SIDES.forEach(function (side) {
      var btn = el(btnId(side));
      if (exceptBtn && btn === exceptBtn) return;
      close(side);
    });
  }

  function toggle(side) {
    var list = el(listId(side));
    if (isOpen(list)) close(side);
    else open(side);
  }

  function markActive(list, index) {
    var items = childOptions(list);
    list.setAttribute("data-active", String(index));
    items.forEach(function (item, i) {
      var on = i === index;
      if (item.classList && item.classList.toggle) item.classList.toggle("active", on);
      item.setAttribute("aria-selected", on ? "true" : "false");
    });
    var current = items[index];
    if (current && typeof current.scrollIntoView === "function") {
      current.scrollIntoView({ block: "nearest" });
    }
  }

  function moveActive(list, delta) {
    var items = childOptions(list);
    if (items.length === 0) return;
    var active = parseInt(list.getAttribute("data-active") || "-1", 10);
    if (isNaN(active)) active = -1;
    markActive(list, (active + delta + items.length) % items.length);
  }

  // User pick: store "HH:MM" (or "" for whole-day) in the hidden input the
  // native clock used, refresh the label + checkmark, then notify via
  // input/change (search.js re-applies; presets deactivate).
  function choose(side, value) {
    var hidden = el(hiddenId(side));
    var btn = el(btnId(side));
    if (!hidden || (value !== "" && !isHour(value))) return;
    // Re-picking the marked hour clears back to whole-day.
    if (value !== "" && value === selectedOf(side)) value = "";
    hidden.value = value;
    close(side);
    syncFromInputs();
    if (btn && btn.focus) btn.focus();
    notify(hidden);
  }

  function notify(hidden) {
    if (typeof Event === "function") {
      try {
        hidden.dispatchEvent(new Event("input", { bubbles: true }));
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      } catch (e) { /* fall through to the legacy path below */ }
    }
    if (typeof document !== "undefined" && document.createEvent) {
      var inputEvent = document.createEvent("Event");
      inputEvent.initEvent("input", true, true);
      hidden.dispatchEvent(inputEvent);
      var changeEvent = document.createEvent("Event");
      changeEvent.initEvent("change", true, true);
      hidden.dispatchEvent(changeEvent);
    }
  }

  function pickActive(list, side) {
    var items = childOptions(list);
    var active = parseInt(list.getAttribute("data-active") || "-1", 10);
    if (!isNaN(active) && items[active]) {
      choose(side, items[active].getAttribute("data-value") || "");
      return true;
    }
    return false;
  }

  function wireSide(side) {
    var btn = el(btnId(side));
    var list = el(listId(side));
    var hidden = el(hiddenId(side));
    if (hidden && hidden.addEventListener) {
      hidden.addEventListener("input", function () { syncButton(side); });
      hidden.addEventListener("change", function () { syncButton(side); });
    }
    if (!btn || !list || !btn.addEventListener) return;
    btn.addEventListener("click", function (event) {
      event.stopPropagation();
      toggle(side);
    });
    btn.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // Same keyboard contract as daypick (T6): an arrow-highlighted
        // option wins over plain toggle when the list is open.
        if (isOpen(list) && pickActive(list, side)) return;
        toggle(side);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!isOpen(list)) open(side);
        moveActive(list, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen(list)) open(side);
        moveActive(list, -1);
      } else if (event.key === "Escape") {
        if (isOpen(list)) {
          event.preventDefault();
          event.stopPropagation();
          close(side);
        }
      }
    });
    list.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(list, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(list, -1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pickActive(list, side);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(side);
        if (btn && btn.focus) btn.focus();
      }
    });
  }

  function init() {
    if (typeof document === "undefined" || !document.getElementById) return;
    SIDES.forEach(wireSide);
    closeAll();
    syncFromInputs();
    if (document.addEventListener) {
      document.addEventListener("mousedown", function (event) {
        var target = event.target;
        var inside = target && typeof target.closest === "function"
          ? target.closest(".timepick")
          : null;
        if (!inside) closeAll();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeAll();
      });
    }
    // Keep button labels in sync after Limpiar / data reloads: same hook
    // pattern as filters/daypick/presets on TriageSearch.refresh.
    if (window.TriageSearch && !window.TriageSearch.__timepickHooked) {
      window.TriageSearch.__timepickHooked = true;
      var base = window.TriageSearch.refresh;
      window.TriageSearch.refresh = function () {
        var out = base();
        syncFromInputs();
        return out;
      };
      var resetBase = window.TriageSearch.resetFilters;
      window.TriageSearch.resetFilters = function () {
        var out = resetBase();
        closeAll();
        syncFromInputs();
        return out;
      };
    }
  }

  if (typeof document !== "undefined" && document.readyState !== "loading") init();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", init);

  return {
    HOURS: HOURS,
    syncFromInputs: syncFromInputs,
  };
})();
