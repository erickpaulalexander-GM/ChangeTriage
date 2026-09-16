/* Change Triage available-days dropdowns for the implementation window.
 *
 * Replaces the native month-calendar date inputs: each Desde/Hasta card gets
 * a day dropdown listing ONLY the unique days present in data.json between
 * FEC HORA INI IMPL and FEC HORA FIN IMPL (inclusive per-row range expansion,
 * sorted chronologically — never a fixed count, so 3-day and 5-day windows
 * both work). Day labels carry a Spanish short weekday derived per date in
 * America/Lima ("Lun 14 Sep"), matching the Lima wall-clock space used by
 * search.js.
 *
 * Date sourcing only: the picked day is stored as "YYYY-MM-DD" in the hidden
 * #f-desde-date / #f-hasta-date inputs — the exact values the filter logic
 * consumed from the old date inputs — and input/change events are dispatched
 * so search.js (applyFilters) and presets.js (active-preset deactivation)
 * keep working untouched. Overlap math and Lima handling are not
 * reimplemented here.
 */
"use strict";

window.TriageDaypick = (function () {
  var SIDES = ["desde", "hasta"];
  var PLACEHOLDER = "Seleccionar día";
  // Guard against pathological multi-year spans when expanding ranges.
  var MAX_SPAN = 370;

  // Fixed Spanish short months so labels never vary by browser locale data.
  var MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  // Fallback weekday table (Dom=0), used only when Intl is unavailable.
  var WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  var state = { days: [] };

  function el(id) {
    return document.getElementById(id);
  }

  function hiddenId(side) {
    return side === "hasta" ? "f-hasta-date" : "f-desde-date";
  }

  function btnId(side) {
    return side === "hasta" ? "f-hasta-day" : "f-desde-day";
  }

  function listId(side) {
    return side === "hasta" ? "f-hasta-day-list" : "f-desde-day-list";
  }

  function getRows() {
    if (window.Triage && typeof window.Triage.getRows === "function") {
      return window.Triage.getRows();
    }
    return [];
  }

  function wallOf(value) {
    if (window.TriageSearch && typeof window.TriageSearch.toLimaWall === "function") {
      return window.TriageSearch.toLimaWall(value);
    }
    return "";
  }

  function isDay(text) {
    return /^\d{4}-\d{2}-\d{2}$/.test(text || "");
  }

  function addDays(ymd, delta) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!p) return "";
    var t = Date.UTC(+p[1], +p[2] - 1, +p[3]) + delta * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  // Unique days covered by the loaded rows: each row contributes every day
  // from its ini date through its fin date (inclusive), so a row spanning
  // 14->16 also covers the 15th even if no row starts on it. Sorted
  // chronologically (ISO strings sort lexicographically).
  function deriveDays(rows) {
    var seen = {};
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      var ini = wallOf(row.fec_hora_ini_impl).slice(0, 10);
      var fin = wallOf(row.fec_hora_fin_impl).slice(0, 10);
      if (!isDay(ini) && !isDay(fin)) return;
      var start = isDay(ini) ? ini : fin;
      var end = isDay(fin) ? fin : ini;
      if (end < start) { var swap = start; start = end; end = swap; }
      var day = start;
      var guard = 0;
      while (day <= end && guard < MAX_SPAN) {
        if (!seen[day]) { seen[day] = true; out.push(day); }
        if (day === end) break;
        day = addDays(day, 1);
        guard += 1;
      }
    });
    out.sort();
    return out;
  }

  // Spanish short weekday for one YYYY-MM-DD, derived in America/Lima.
  // Noon UTC is 07:00 in Lima (fixed -05:00, no DST), so the Lima date always
  // matches the input day; Intl output is normalized to a capitalized
  // 3-letter form ("lun"/"lun." -> "Lun", "mié" -> "Mié").
  function weekdayShort(ymd) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!p) return "";
    var noon = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], 12));
    try {
      var raw = new Intl.DateTimeFormat("es", {
        timeZone: "America/Lima", weekday: "short",
      }).format(noon);
      var letters = raw.replace(/[^a-záéíóúüñ]/gi, "").slice(0, 3);
      if (letters) {
        return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
      }
    } catch (e) { /* fall through to the table below */ }
    return WEEKDAYS[noon.getUTCDay()];
  }

  // "2026-09-14" -> "Lun 14 Sep"; unparsable input passes through as-is.
  function formatDay(ymd) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!p) return ymd || "";
    var month = MONTHS[+p[2] - 1] || p[2];
    return weekdayShort(ymd) + " " + p[3] + " " + month;
  }

  // Short operational window label for result cards (T1, card only).
  // Same-day -> "Lun 14 Sep · 00:00–00:30" (en-dash between times);
  // multi-day -> "Lun 14 Sep 22:00 → Mar 15 Sep 01:00".
  // Wall-string only: inputs are raw data.json datetimes normalized via
  // wallOf (Lima wall text), sliced to day + HH:MM — never `new Date` on
  // naive strings. Returns "" when either bound is missing/unparsable so
  // callers can fall back to the long drawer format.
  function toWallText(value) {
    var wall = wallOf(value);
    if (wall) return wall;
    if (typeof value !== "string") return "";
    var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
    return m ? m[1] + "T" + m[2] + ":" + m[3] + ":" + (m[4] || "00") : "";
  }

  function formatWindowShort(iniValue, finValue) {
    var ini = toWallText(iniValue);
    var fin = toWallText(finValue);
    if (!ini || !fin) return "";
    var iniDay = ini.slice(0, 10);
    var finDay = fin.slice(0, 10);
    var iniTime = ini.slice(11, 16);
    var finTime = fin.slice(11, 16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iniDay) || !/^\d{4}-\d{2}-\d{2}$/.test(finDay)) return "";
    if (!/^\d{2}:\d{2}$/.test(iniTime) || !/^\d{2}:\d{2}$/.test(finTime)) return "";
    if (iniDay === finDay) {
      return formatDay(iniDay) + " · " + iniTime + "–" + finTime;
    }
    return formatDay(iniDay) + " " + iniTime + " → " + formatDay(finDay) + " " + finTime;
  }

  function selectedOf(side) {
    var hidden = el(hiddenId(side));
    var value = hidden && typeof hidden.value === "string" ? hidden.value.trim() : "";
    return isDay(value) ? value : "";
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
    var value = selectedOf(side);
    var label = value ? formatDay(value) : PLACEHOLDER;
    if (text) text.textContent = label;
    else btn.textContent = label;
    if (btn.setAttribute) {
      btn.setAttribute("aria-label",
        (side === "hasta" ? "Hasta implementación: día (hora de Lima), " :
          "Desde implementación: día (hora de Lima), ") + label);
    }
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

  // Silent UI sync from the hidden YYYY-MM-DD inputs (no events): used after
  // presets, Limpiar, and data reloads so button labels + checkmarks match.
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
      var on = item.getAttribute("data-value") === value;
      item.setAttribute("aria-selected", on ? "true" : "false");
      var tick = item.querySelector ? item.querySelector(".tick") : null;
      if (tick) tick.hidden = !on;
    });
  }

  function renderList(side) {
    var list = el(listId(side));
    if (!list || typeof document === "undefined" || !document.createElement) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    list.setAttribute("data-active", "-1");
    state.days.forEach(function (day) {
      var item = document.createElement("li");
      item.className = "daypick-option";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.setAttribute("data-value", day);
      item.setAttribute("tabindex", "-1");
      item.textContent = formatDay(day);
      var tick = document.createElement("span");
      tick.className = "tick";
      tick.setAttribute("aria-hidden", "true");
      tick.textContent = "✓";
      tick.hidden = true;
      item.appendChild(tick);
      item.addEventListener("mousedown", function (event) {
        event.preventDefault();
        choose(side, day);
      });
      list.appendChild(item);
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

  // User pick: store the same YYYY-MM-DD the old date input produced, refresh
  // the label + checkmark, then notify via input/change on the hidden field
  // (manual edits deactivate the active preset; search.js re-applies).
  function choose(side, value) {
    var hidden = el(hiddenId(side));
    var btn = el(btnId(side));
    if (!hidden || !isDay(value)) return;
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

  // Rebuilds the day lists from the current rows; keeps a still-available
  // selection, drops one that vanished (button falls back to the
  // placeholder, filter bound goes inactive).
  function refreshDays() {
    state.days = deriveDays(getRows());
    SIDES.forEach(function (side) {
      var value = selectedOf(side);
      var hidden = el(hiddenId(side));
      if (value && state.days.indexOf(value) === -1 && hidden) hidden.value = "";
      renderList(side);
      syncButton(side);
    });
    return state.days;
  }

  function wireSide(side) {
    var btn = el(btnId(side));
    var list = el(listId(side));
    if (!btn || !list || !btn.addEventListener) return;
    btn.addEventListener("click", function (event) {
      event.stopPropagation();
      toggle(side);
    });
    btn.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // Keyboard regression fix (T6): with the list open and an option
        // highlighted via ArrowDown/ArrowUp, Enter/Space must pick it —
        // plain toggle() would just close and drop the highlight, leaving
        // keyboard-only users with no way to choose a day.
        if (isOpen(list)) {
          var items = childOptions(list);
          var picked = parseInt(list.getAttribute("data-active") || "-1", 10);
          if (!isNaN(picked) && items[picked]) {
            choose(side, items[picked].getAttribute("data-value"));
            return;
          }
        }
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
        var items = childOptions(list);
        var active = parseInt(list.getAttribute("data-active") || "-1", 10);
        if (!isNaN(active) && items[active]) {
          choose(side, items[active].getAttribute("data-value"));
        }
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
    // Whole-card click opens the card's dropdown (time-input interaction is
    // left alone so the clock stays editable).
    Array.prototype.forEach.call(
      document.querySelectorAll ? document.querySelectorAll(".window-block") : [],
      function (block) {
        block.addEventListener("click", function (event) {
          var target = event.target;
          var interactive = target && typeof target.closest === "function"
            ? target.closest("input, select, textarea, a, .daypick-list")
            : null;
          if (interactive) return;
          var pick = block.getAttribute("data-window") || "desde";
          toggle(pick);
        });
      });
    refreshDays();
    if (document.addEventListener) {
      document.addEventListener("mousedown", function (event) {
        var target = event.target;
        var inside = target && typeof target.closest === "function"
          ? target.closest(".daypick")
          : null;
        if (!inside) closeAll();
      });
      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeAll();
      });
    }
    // Rebuild day lists right after data.json loads (app.js calls
    // TriageSearch.refresh() once rows arrive); chains with the filters.js /
    // presets.js refresh hooks regardless of script order.
    if (window.TriageSearch && !window.TriageSearch.__daypickHooked) {
      window.TriageSearch.__daypickHooked = true;
      var base = window.TriageSearch.refresh;
      window.TriageSearch.refresh = function () {
        var out = base();
        refreshDays();
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
    deriveDays: deriveDays,
    formatDay: formatDay,
    formatWindowShort: formatWindowShort,
    weekdayShort: weekdayShort,
    refreshDays: refreshDays,
    syncFromInputs: syncFromInputs,
    getDays: function () { return state.days.slice(); },
  };
})();
