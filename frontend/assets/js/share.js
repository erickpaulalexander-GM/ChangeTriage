/* Change Triage shareable filter state: URL codec + restore + live URL +
 * active-filter chips + copy-link.
 *
 * - Pure codec: buildParams(criteria) <-> parseParams(searchString) over the
 *   schema ?q=&ticket=A&ticket=B&app=HI49&tipo=Mayor&desde=YYYY-MM-DDTHH:MM&
 *   hasta=YYYY-MM-DDTHH:MM (repeated keys via getAll semantics, wall Lima,
 *   encodeURIComponent, tolerant parse ignoring unknown/blank params).
 * - Restore: location.search is parsed at init into a pending state, then
 *   applied ONCE inside the TriageSearch.refresh chain (same __shareHooked
 *   pattern as filters/daypick/presets) AFTER data.json loads, followed by
 *   applyFilters (auto-search).
 * - Live URL: afterApply (called from search.js applyFilters, matching
 *   untouched) refreshes history.replaceState + the #active-filters chips.
 * - Copy-link builds the URL from state (never from location) with the
 *   copyTeams clipboard + fallback pattern.
 * - Bundle-safe: stdlib-free, no imports, no closing-tag literals.
 */
"use strict";

window.TriageShare = (function () {
  function text(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function enc(value) {
    return encodeURIComponent(text(value));
  }

  function dec(value) {
    try {
      return decodeURIComponent(text(value).replace(/\+/g, " "));
    } catch (e) {
      return text(value);
    }
  }

  function cleanList(values) {
    var out = [];
    (Array.isArray(values) ? values : []).forEach(function (entry) {
      var clean = text(entry).trim();
      if (clean) out.push(clean);
    });
    return out;
  }

  function isWallMinute(value) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text(value).trim());
  }

  // Criteria shape mirrors TriageSearch.getCriteria(): { q, ticket[], app[],
  // tipo, desde, hasta } where desde/hasta are Lima wall full stamps
  // ("YYYY-MM-DDTHH:MM:SS" or "") — truncated here to YYYY-MM-DDTHH:MM.
  function buildParams(criteria) {
    criteria = criteria || {};
    var parts = [];
    var q = text(criteria.q).trim();
    if (q) parts.push("q=" + enc(q));
    cleanList(criteria.ticket).forEach(function (value) {
      parts.push("ticket=" + enc(value));
    });
    cleanList(criteria.app).forEach(function (value) {
      parts.push("app=" + enc(value));
    });
    var tipo = text(criteria.tipo).trim();
    if (tipo) parts.push("tipo=" + enc(tipo));
    var desde = text(criteria.desde).trim().slice(0, 16);
    if (isWallMinute(desde)) parts.push("desde=" + enc(desde));
    var hasta = text(criteria.hasta).trim().slice(0, 16);
    if (isWallMinute(hasta)) parts.push("hasta=" + enc(hasta));
    return parts.join("&");
  }

  // Tolerant: unknown keys and blank values are ignored; first q/tipo/
  // desde/hasta wins; ticket/app accumulate in order.
  function parseParams(searchString) {
    var out = { q: "", ticket: [], app: [], tipo: "", desde: "", hasta: "" };
    var query = text(searchString);
    if (query.charAt(0) === "?") query = query.slice(1);
    if (!query) return out;
    var pairs = query.split("&");
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i];
      if (!pair) continue;
      var cut = pair.indexOf("=");
      var key = cut < 0 ? dec(pair).trim() : dec(pair.slice(0, cut)).trim();
      var value = cut < 0 ? "" : dec(pair.slice(cut + 1)).trim();
      if (!value) continue;
      if (key === "q") { if (!out.q) out.q = value; }
      else if (key === "ticket") { out.ticket.push(value); }
      else if (key === "app") { out.app.push(value); }
      else if (key === "tipo") { if (!out.tipo) out.tipo = value; }
      else if (key === "desde") { if (!out.desde && isWallMinute(value)) out.desde = value; }
      else if (key === "hasta") { if (!out.hasta && isWallMinute(value)) out.hasta = value; }
    }
    return out;
  }

  function el(id) {
    if (typeof document === "undefined" || !document.getElementById) return null;
    return document.getElementById(id);
  }

  function setVal(id, value) {
    var node = el(id);
    if (node) node.value = value;
  }

  function currentCriteria() {
    if (window.TriageSearch && typeof window.TriageSearch.getCriteria === "function") {
      try {
        return window.TriageSearch.getCriteria();
      } catch (e) { /* fall through to the empty shape below */ }
    }
    return { q: "", ticket: [], app: [], tipo: "", desde: "", hasta: "" };
  }

  function apply() {
    if (window.TriageSearch && typeof window.TriageSearch.applyFilters === "function") {
      window.TriageSearch.applyFilters();
    }
  }

  function syncDaypickAndHints() {
    if (window.TriageDaypick && typeof window.TriageDaypick.syncFromInputs === "function") {
      try { window.TriageDaypick.syncFromInputs(); } catch (e) { /* advisory */ }
    }
    if (window.TriageSearch && typeof window.TriageSearch.syncTimeHints === "function") {
      try { window.TriageSearch.syncTimeHints(); } catch (e) { /* advisory */ }
    }
  }

  function clearPreset() {
    if (window.TriagePresets && typeof window.TriagePresets.clearActive === "function") {
      try { window.TriagePresets.clearActive(); } catch (e) { /* advisory */ }
    }
  }

  // Live URL: same-document replace (no history spam), silent when file://
  // or any other context rejects it.
  function syncUrl(criteria) {
    try {
      if (!window.history || typeof window.history.replaceState !== "function") return;
      if (!window.location || typeof window.location.href !== "string") return;
      var params = buildParams(criteria || currentCriteria());
      var base = window.location.href.split("#")[0].split("?")[0];
      window.history.replaceState(null, "", params ? base + "?" + params : base);
    } catch (e) { /* file:// and friends: omit silently */ }
  }

  // Short operational window label for chips + Teams header. Both bounds ->
  // shared daypick short form; single bound -> partial label. Local fallback
  // when TriageDaypick is unavailable (smoke/standalone).
  function fallbackDay(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(day));
    return m ? m[3] + "/" + m[2] : text(day);
  }

  function formatDay(day) {
    if (window.TriageDaypick && typeof window.TriageDaypick.formatDay === "function") {
      try {
        var label = window.TriageDaypick.formatDay(day);
        if (label) return label;
      } catch (e) { /* fall through to the local fallback */ }
    }
    return fallbackDay(day);
  }

  function windowLabel(desde, hasta) {
    desde = text(desde);
    hasta = text(hasta);
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
      if (dDay === hDay) return formatDay(dDay) + " · " + dTime + "-" + hTime;
      return formatDay(dDay) + " " + dTime + " → " + formatDay(hDay) + " " + hTime;
    }
    if (desde) return formatDay(desde.slice(0, 10)) + " · desde " + desde.slice(11, 16);
    return formatDay(hasta.slice(0, 10)) + " · hasta " + hasta.slice(11, 16);
  }

  // ---- Active-filter chips (#active-filters over #results) ----

  function clearWindow() {
    ["f-desde-date", "f-desde-time", "f-hasta-date", "f-hasta-time"].forEach(function (id) {
      setVal(id, "");
    });
    syncDaypickAndHints();
    clearPreset();
  }

  function clearAll() {
    if (window.TriageSearch && typeof window.TriageSearch.resetFilters === "function") {
      window.TriageSearch.resetFilters();
    }
    clearPreset();
    apply();
  }

  function removeChip(filter) {
    if ((filter.kind === "ticket" || filter.kind === "app") &&
        window.TriageFilters && typeof window.TriageFilters.removeValue === "function") {
      // removeValue repaints its chips + re-applies centrally by itself.
      window.TriageFilters.removeValue(filter.kind, filter.value);
      return;
    }
    if (filter.kind === "tipo") setVal("f-tipo", "");
    else if (filter.kind === "q") setVal("q", "");
    else if (filter.kind === "window") clearWindow();
    else return;
    apply();
  }

  function collectChips(criteria) {
    var chips = [];
    var q = text(criteria.q).trim();
    if (q) chips.push({ kind: "q", value: q, label: "Búsqueda: " + q });
    cleanList(criteria.ticket).forEach(function (value) {
      chips.push({ kind: "ticket", value: value, label: "Ticket: " + value });
    });
    cleanList(criteria.app).forEach(function (value) {
      chips.push({ kind: "app", value: value, label: "App: " + value });
    });
    var tipo = text(criteria.tipo).trim();
    if (tipo) chips.push({ kind: "tipo", value: tipo, label: "Tipo: " + tipo });
    var win = windowLabel(criteria.desde, criteria.hasta);
    if (win) chips.push({ kind: "window", value: win, label: "Ventana: " + win });
    return chips;
  }

  function renderActive(criteria) {
    var bar = el("active-filters");
    if (!bar) return;
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    var chips = collectChips(criteria || {});
    if (chips.length === 0) {
      bar.setAttribute("hidden", "");
      return;
    }
    bar.removeAttribute("hidden");
    var doc = document;
    chips.forEach(function (filter) {
      var chip = doc.createElement("span");
      chip.className = "active-chip";
      var label = doc.createElement("span");
      label.className = "active-chip-label";
      label.textContent = filter.label;
      chip.appendChild(label);
      var btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "active-chip-x";
      btn.setAttribute("aria-label", "Quitar filtro " + filter.label);
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        removeChip(filter);
      });
      chip.appendChild(btn);
      bar.appendChild(chip);
    });
    var clear = doc.createElement("button");
    clear.type = "button";
    clear.className = "active-clear";
    clear.setAttribute("aria-label", "Limpiar todos los filtros");
    clear.textContent = "Limpiar todo";
    clear.addEventListener("click", clearAll);
    bar.appendChild(clear);
  }

  // Post-apply entry point (wired from search.js applyFilters): live URL +
  // active chips, never touching matching.
  function afterApply(criteria) {
    syncUrl(criteria);
    renderActive(criteria);
  }

  // ---- Copy link ----

  function showFallback(textValue) {
    var box = el("teams-fallback");
    if (!box) return;
    box.value = textValue;
    box.hidden = false;
    if (box.focus) box.focus();
    if (box.select) box.select();
  }

  function copyLink() {
    var params = buildParams(currentCriteria());
    var href = (window.location && typeof window.location.href === "string")
      ? window.location.href : "";
    var base = href.split("#")[0].split("?")[0];
    var url = params ? base + "?" + params : base;
    if (!url) return;
    function done() {
      // opbar eliminada (Compact Layout v1): el confirm vive en results-count.
      var statusEl = el("results-count") || el("status");
      if (statusEl) statusEl.textContent = "Enlace filtrado copiado.";
    }
    function failed() {
      showFallback(url);
    }
    try {
      if (window.navigator && window.navigator.clipboard &&
          typeof window.navigator.clipboard.writeText === "function") {
        window.navigator.clipboard.writeText(url).then(done, failed);
      } else {
        failed();
      }
    } catch (e) {
      failed();
    }
  }

  // ---- Restore (pending parse + one-shot refresh hook) ----

  var pending = null;

  function hasPending(state) {
    return !!(state.q || state.ticket.length || state.app.length ||
      state.tipo || state.desde || state.hasta);
  }

  function splitWall(value) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text(value));
    return m ? [m[1], m[2]] : ["", ""];
  }

  function restoreOnce() {
    if (!pending) return;
    var state = pending;
    pending = null;
    if (!hasPending(state)) return;
    setVal("q", state.q || "");
    if (window.TriageFilters) {
      if (typeof window.TriageFilters.setSelected === "function") {
        try {
          window.TriageFilters.setSelected("ticket", state.ticket);
          window.TriageFilters.setSelected("app", state.app);
        } catch (e) { /* advisory: text inputs below still apply */ }
      }
      if (typeof window.TriageFilters.closeAll === "function") {
        try { window.TriageFilters.closeAll(); } catch (e) { /* advisory */ }
      }
    }
    setVal("f-tipo", state.tipo || "");
    var d = splitWall(state.desde);
    var h = splitWall(state.hasta);
    setVal("f-desde-date", d[0]);
    setVal("f-desde-time", d[1]);
    setVal("f-hasta-date", h[0]);
    setVal("f-hasta-time", h[1]);
    syncDaypickAndHints();
    clearPreset();
    apply();
  }

  function init() {
    if (typeof document === "undefined" || !document.getElementById) return;
    try {
      var raw = (window.location && typeof window.location.search === "string")
        ? window.location.search : "";
      var parsed = parseParams(raw);
      pending = hasPending(parsed) ? parsed : null;
    } catch (e) {
      pending = null;
    }
    var copyBtn = el("copy-link");
    if (copyBtn && copyBtn.addEventListener) {
      copyBtn.addEventListener("click", copyLink);
    }
    // One-shot restore chained AFTER data.json loads (options derive from
    // rows): same hook pattern as filters/daypick/presets. Placed after
    // daypick.js so this wrapper runs outermost — base() refreshes options,
    // days and labels first, then the pending state lands on real controls.
    if (window.TriageSearch && !window.TriageSearch.__shareHooked) {
      window.TriageSearch.__shareHooked = true;
      var base = window.TriageSearch.refresh;
      window.TriageSearch.refresh = function () {
        var out = base();
        try {
          restoreOnce();
        } catch (e) { /* advisory: unfiltered view still renders */ }
        return out;
      };
    }
  }

  if (typeof document !== "undefined" && document.readyState !== "loading") init();
  else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", init);

  return {
    buildParams: buildParams,
    parseParams: parseParams,
    afterApply: afterApply,
    copyLink: copyLink,
    windowLabel: windowLabel,
  };
})();
