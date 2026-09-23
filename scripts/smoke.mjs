/* Checked-in smoke script: executes the REAL search.js/export.js against
 * synthetic rows (no production data) with minimal DOM stubs.
 * Covers: query, AND filters, implementation-window (Desde/Hasta) overlap
 * incl. null-window rows, CSV (headers-only + escaping), Teams
 * one-line-per-row.
 * Run: node scripts/smoke.mjs (exit non-zero on any failure).
 */
"use strict";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsDir = join(root, "frontend", "assets", "js");

function makeDocument() {
  const elements = new Map();
  return {
    readyState: "complete",
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, { value: "", hidden: true, textContent: "",
          addEventListener() {}, focus() {}, select() {} });
      }
      return elements.get(id);
    },
  };
}

// Synthetic rows mirror backend/tests/fixtures.py (T-1001 window 00:00-06:00,
// T-1002 null window, T-1003 window 10:00-12:00 on 14/09/2026 Lima time).
function row(ticket, ini, fin) {
  return { ticket, nombre_app: "Synthetic App", recurso: "synthetic.user",
    tipo_cambio: "NORMAL", fec_hora_ini_impl: ini, fec_hora_fin_impl: fin };
}
const ROWS = [
  row("T-1001", "2026-09-14T00:00:00-05:00", "2026-09-14T06:00:00-05:00"),
  row("T-1002", null, null),
  row("T-1003", "2026-09-14T10:00:00-05:00", "2026-09-14T12:00:00-05:00"),
];

function loadModule(name, window) {
  const code = readFileSync(join(jsDir, name), "utf8");
  const factory = new Function("window", "document",
    `${code}; return { search: window.TriageSearch, exp: window.TriageExport };`);
  return factory(window, makeDocument());
}

let pass = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass += 1;
  else { console.error(`FAIL ${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`); process.exitCode = 1; }
}

const window = { Triage: { getRows: () => ROWS, getVisible: () => ROWS,
    render: (rows, hint) => { window.__rendered = { rows, hint }; } },
  Drawer: { formatDate: (v) => (typeof v === "string" ? v.slice(0, 16).replace("T", " ") : "—") } };
const { search } = loadModule("search.js", window);
const { exp } = loadModule("export.js", window);
window.TriageExport = exp;

// Query: instant substring across Ticket/App/Recurso, blank passes.
check("query-ticket", search.matchesQuery(ROWS[0], "t-1001"), true);
check("query-app", search.matchesQuery(ROWS[2], "synthetic app"), true);
check("query-miss", search.matchesQuery(ROWS[0], "zzz"), false);
check("query-blank", search.matchesQuery(ROWS[0], ""), true);
// Filters: AND semantics, blank ignored (window bounds combine centrally).
check("filters-and", search.matchesFilters(ROWS[0],
  { ticket: "T-1001", app: "synthetic", tipo: "normal",
    desde: "2026-09-14T00:00:00", hasta: "2026-09-14T23:59:59" }), true);
check("filters-and-miss", search.matchesFilters(ROWS[0], { ticket: "T-1003" }), false);
// Window bounds: date+time composition, date-only whole-day defaults,
// Lima-midnight no-slide, empty window passes everything.
check("window-desde-stamp", search.parseWindowBound("2026-09-14", "03:00", false), "2026-09-14T03:00:00");
check("window-hasta-stamp", search.parseWindowBound("2026-09-14", "03:00", true), "2026-09-14T03:00:00");
check("window-date-only-desde", search.parseWindowBound("2026-09-15", "", false), "2026-09-15T00:00:00");
check("window-date-only-hasta", search.parseWindowBound("2026-09-15", "", true), "2026-09-15T23:59:59");
check("window-midnight-no-slide", search.parseWindowBound("2026-09-15", "00:00", false).slice(0, 10), "2026-09-15");
check("window-no-bounds-pass", search.matchesFilters(ROWS[1], { desde: "", hasta: "" }), true);
// CSV: 34-column header line when empty; escaping for quote/comma/newline.
const emptyCsv = window.TriageExport.toCSV([]);
check("csv-headers-only", emptyCsv.split("\r\n").length, 2); // header + trailing
check("csv-col-count", emptyCsv.split("\r\n")[0].split(",").length, 34);
const tricky = { ...ROWS[0], descripcion_cambio: 'a"b,c\nd' };
check("csv-escape", window.TriageExport.toCSV([tricky]).includes('"a""b,c\nd"'), true);
// Teams: normative header (Change Triage + filter context + count) + one
// Ticket/App/window line per row.
const plainSummary = window.TriageExport.toTeamsSummary(ROWS);
check("teams-lines", plainSummary.split("\n").length, 6); // 3 header + 3 rows
check("teams-first-line", plainSummary.split("\n")[0], "Change Triage");
check("teams-nofilters-line", plainSummary.split("\n")[1], "Sin filtros (vista completa).");
check("teams-count-line", plainSummary.split("\n")[2], "Resultados: 3 cambios encontrados.");

console.log(`SMOKE_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);

/* ---- Theme checks (Light/Dark): data-theme + localStorage behavior,
 * palette variables in both themes, drawer light separation, no pure
 * black in dark inputs, bundle-safe script tag. Runs without a browser. */

function makeThemeEnv({ stored = null, preferLight = false } = {}) {
  const store = new Map(stored ? [["triage-theme", stored]] : []);
  const attrs = new Map([["data-theme", "dark"]]); // index.html default
  let clickHandler = null;
  const button = {
    textContent: "",
    attrs: new Map(),
    setAttribute(k, v) { this.attrs.set(k, String(v)); },
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
    addEventListener(ev, fn) { if (ev === "click") clickHandler = fn; },
    click() { if (clickHandler) clickHandler(); },
  };
  const document = {
    readyState: "complete",
    addEventListener() {},
    documentElement: {
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      setAttribute(k, v) { attrs.set(k, String(v)); },
    },
    getElementById(id) { return id === "theme-toggle" ? button : null; },
  };
  const win = {
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
    },
    matchMedia(q) { return { matches: preferLight && String(q).includes("light") }; },
  };
  return { win, document, button, store, attrs };
}

function loadTheme(env) {
  const code = readFileSync(join(jsDir, "theme.js"), "utf8");
  const factory = new Function("window", "document", `${code}; return window.TriageTheme;`);
  return factory(env.win, env.document);
}

function themeGet(env) { return env.attrs.get("data-theme"); }

// Behavior: stored choice wins; otherwise prefers-color-scheme; dark default.
let env = makeThemeEnv();
loadTheme(env);
check("theme-default-dark", themeGet(env), "dark");
check("theme-default-no-persist", env.store.has("triage-theme"), false);
env = makeThemeEnv({ preferLight: true });
loadTheme(env);
check("theme-system-light", themeGet(env), "light");
env = makeThemeEnv({ stored: "light" });
loadTheme(env);
check("theme-stored-wins", themeGet(env), "light");
// Toggle flips data-theme, persists, and keeps button ARIA/text in sync.
env = makeThemeEnv();
loadTheme(env);
env.button.click();
check("theme-toggle-to-light", themeGet(env), "light");
check("theme-toggle-persist", env.store.get("triage-theme"), "light");
check("theme-btn-pressed-light", env.button.getAttribute("aria-pressed"), "false");
check("theme-btn-label-light", (env.button.getAttribute("aria-label") || "").includes("claro"), true);
check("theme-btn-text-light", env.button.textContent, "☀");
env.button.click();
check("theme-toggle-back-dark", themeGet(env), "dark");
check("theme-btn-pressed-dark", env.button.getAttribute("aria-pressed"), "true");
check("theme-btn-text-dark", env.button.textContent, "☾");

// Palettes: both themes define every required variable with spec values.
const css = readFileSync(join(root, "frontend", "assets", "css", "app.css"), "utf8");
const html = readFileSync(join(root, "frontend", "index.html"), "utf8");
function cssVars(block) {
  const vars = new Map();
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  return vars;
}
const darkBlock = (css.match(/:root\s*\{([^}]*)\}/) || [])[1] || "";
const lightBlock = (css.match(/html\[data-theme="light"\]\s*\{([^}]*)\}/) || [])[1] || "";
const darkVars = cssVars(darkBlock);
const lightVars = cssVars(lightBlock);
const REQUIRED = ["bg", "surface", "surface-alt", "border", "primary",
  "success", "warning", "danger", "text", "muted"];
for (const name of REQUIRED) {
  check(`theme-dark-var-${name}`, darkVars.has(name), true);
  check(`theme-light-var-${name}`, lightVars.has(name), true);
}
const EXPECTED = {
  dark: { bg: "#151B2B", surface: "#202A3D", "surface-alt": "#1A2233",
    border: "#3A465C", text: "#E7ECF4", muted: "#AAB6C8", primary: "#2563eb" },
  light: { bg: "#F4F6F9", surface: "#FFFFFF", "surface-alt": "#FFFFFF",
    border: "#D8DEE8", text: "#172033", muted: "#5B6678", primary: "#2563eb" },
};
for (const [name, want] of Object.entries(EXPECTED.dark)) check(`theme-dark-val-${name}`, (darkVars.get(name) || "").toLowerCase(), want.toLowerCase());
for (const [name, want] of Object.entries(EXPECTED.light)) check(`theme-light-val-${name}`, (lightVars.get(name) || "").toLowerCase(), want.toLowerCase());
// Dark inputs must not be pure black: scan every hex in the dark palette.
const darkHexes = [...darkBlock.matchAll(/#([0-9a-fA-F]{3,8})\b/g)].map((m) => m[0].toLowerCase());
check("theme-dark-no-pure-black", darkHexes.some((h) => h === "#000" || h === "#000000"), false);
// Drawer separation in both themes: visible border + shadow hook on .drawer,
// plus a real (non-none) shadow token for the white light drawer.
check("theme-drawer-border", /\.drawer\s*\{[^}]*border-left[^}]*\}/s.test(css), true);
check("theme-drawer-shadow-hook", /\.drawer\s*\{[^}]*box-shadow[^}]*\}/s.test(css), true);
check("theme-drawer-light-shadow", /--shadow-drawer:\s*[^;]*rgba\(/i.test(lightBlock), true);
// Header markup: synchronous theme script (pre-paint) + keyboard-accessible toggle.
check("theme-script-early", /<script\s+src="assets\/js\/theme\.js"\s*>\s*<\/script>/.test(html), true);
check("theme-script-bundlable", /<script\b[^>]*\bsrc="assets\/js\/theme\.js"[^>]*>\s*<\/script>/i.test(html), true);
check("theme-script-no-closing-tag", /<\/script/i.test(readFileSync(join(jsDir, "theme.js"), "utf8")), false);
check("theme-toggle-button", /<button\b[^>]*id="theme-toggle"[^>]*>/i.test(html), true);
check("theme-toggle-aria", /id="theme-toggle"[^>]*aria-(pressed|label)/i.test(html), true);
check("theme-toggle-visible-label", />[^<]*(&#9789;|&#9790;|☀|☾)[^<]*<\/button>/i.test(html.split('id="theme-toggle"')[1] || ""), true);
// Icon-only: no Claro/Oscuro text inside the button element itself
// (the aria-label on the opening tag still carries the wording).
const toggleInner = ((html.split('id="theme-toggle"')[1] || "").split("</button>")[0] || "").split(">").slice(1).join(">");
check("theme-toggle-icon-only", /Claro|Oscuro/i.test(toggleInner), false);

console.log(`SMOKE_THEME_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);

/* ---- Filter-control checks: ticket/app comboboxes + tipo select.
 * Dynamic options from rows (no hardcoded data), "Todas"/"Todos" defaults,
 * empty initial state showing the full count, combined Ticket+App+Tipo+window
 * filtering through the central search.js logic, window overlap preserved,
 * Escape/outside-close behavior, theme-safe styling. Runs without a browser. */

const filtersCode = readFileSync(join(jsDir, "filters.js"), "utf8");

// No hardcoded data lists: options must come from getRows() at runtime.
check("filters-no-hardcoded-tickets", /ITSM-/.test(filtersCode), false);
check("filters-no-hardcoded-apps", /HI49/.test(filtersCode), false);
check("filters-no-hardcoded-tipos", /Cambio Mayor/.test(filtersCode), false);
check("filters-dynamic-source", /getRows\(\)/.test(filtersCode), true);
check("filters-delegates-central", /TriageSearch\.applyFilters\(\)/.test(filtersCode), true);
check("filters-no-parallel-logic", /matchesFilters|isOverlap|parseIncident/.test(filtersCode), false);
check("filters-empty-state", filtersCode.includes("Sin coincidencias"), true);

// Markup: combobox roles + native tipo select with "Todos" default.
check("filters-ticket-combobox", /id="f-ticket"[^>]*role="combobox"/.test(html), true);
check("filters-app-combobox", /id="f-app"[^>]*role="combobox"/.test(html), true);
check("filters-combobox-aria", /aria-expanded/.test(html) && /aria-controls/.test(html) && /aria-autocomplete="list"/.test(html), true);
check("filters-listbox-roles", /role="listbox"/.test(html), true);
check("filters-tipo-select", /<select\b[^>]*id="f-tipo"/.test(html), true);
check("filters-tipo-todos-first", /<select\b[^>]*id="f-tipo"[^>]*>\s*<option value="">TIPO CAMBIO<\/option>/.test(html), true);
check("filters-no-tipo-preselect", /<option[^>]*selected/.test(html.split('id="f-tipo"')[1].split("</select>")[0]), false);
check("filters-ticket-empty-default", /id="f-ticket"[^>]*value="[^"]+"/.test(html), false);
check("filters-window-empty-default", /id="f-desde-date"[^>]*value="[^"]+"/.test(html) || /id="f-hasta-date"[^>]*value="[^"]+"/.test(html), false);

// Styling: theme variables (both palettes), capped scroll, z-index above
// cards/drawer (drawer + overlay carry no z-index), distinct incident mode.
const comboBlock = (css.match(/\.combo-list\s*\{([^}]*)\}/) || [])[1] || "";
check("filters-combo-theme-vars", /var\(--(surface|text|border)\)/.test(comboBlock), true);
check("filters-combo-capped", /max-height:\s*\d+px/.test(comboBlock) && /overflow-y:\s*auto/.test(comboBlock), true);
check("filters-combo-z-index", (() => { const m = comboBlock.match(/z-index:\s*(\d+)/); return m ? Number(m[1]) >= 10 : false; })(), true);
check("filters-combo-focus", /\.combo-option\.active/.test(css) && /aria-selected/.test(filtersCode), true);
const windowBlock = (css.match(/\.window-block\s*\{([^}]*)\}/) || [])[1] || "";
check("filters-window-grouped", /var\(--(surface-alt|surface)\)/.test(windowBlock) && /var\(--border\)/.test(windowBlock), true);
check("filters-window-theme-safe", /#[0-9a-fA-F]{3,8}/.test(windowBlock), false);

// Minimal fake DOM for behavioral checks (no browser needed).
function fakeNode() {
  const node = { children: [], attrs: new Map(), handlers: {},
    value: "", textContent: "", className: "", __focused: false,
    classList: { _s: new Set(),
      toggle(c, force) { if (force === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (force) this._s.add(c); else this._s.delete(c); } },
    addEventListener(ev, fn) { (node.handlers[ev] = node.handlers[ev] || []).push(fn); },
    setAttribute(k, v) { node.attrs.set(k, String(v)); },
    getAttribute(k) { return node.attrs.has(k) ? node.attrs.get(k) : null; },
    hasAttribute(k) { return node.attrs.has(k); },
    removeAttribute(k) { node.attrs.delete(k); },
    appendChild(c) { node.children.push(c); return c; },
    removeChild(c) { const i = node.children.indexOf(c); if (i >= 0) node.children.splice(i, 1); return c; },
    focus() { node.__focused = true; },
    closest() { return null; },
    querySelector() { return null; },
    fire(ev, e) { (node.handlers[ev] || []).forEach((fn) => fn(e || {})); } };
  Object.defineProperty(node, "firstChild", { get() { return node.children[0] || null; } });
  return node;
}

function makeFilterDocument() {
  const els = new Map();
  ["f-ticket", "f-ticket-list", "f-ticket-chips", "f-app", "f-app-list", "f-app-chips", "f-tipo"].forEach((id) => els.set(id, fakeNode()));
  const docHandlers = {};
  return { readyState: "complete",
    getElementById(id) { return els.get(id) || null; },
    createElement() { return fakeNode(); },
    addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
    fire(ev, e) { (docHandlers[ev] || []).forEach((fn) => fn(e || {})); },
    __els: els };
}

function frow(ticket, app, tipo) {
  return { ticket, nombre_app: app, tipo_cambio: tipo, recurso: "r",
    fec_hora_ini_impl: "2026-09-14T00:00:00-05:00", fec_hora_fin_impl: "2026-09-14T06:00:00-05:00" };
}
const FROWS = [frow("ITSM-2583450", "HI49", "Cambio Mayor"),
  frow("ITSM-2525538", "AACC", "Cambio Menor"),
  frow("ITSM-2598785", "HI49", "Emergencia")];

let applyCalls = 0;
const fakeSearch = { refresh() {}, resetFilters() {}, applyFilters() { applyCalls += 1; } };
const filterDoc = makeFilterDocument();
const filterFactory = new Function("window", "document", `${filtersCode}; return window.TriageFilters;`);
const triageFilters = filterFactory({ Triage: { getRows: () => FROWS }, TriageSearch: fakeSearch }, filterDoc);
check("filters-module-loads", !!triageFilters, true);

// Dynamic derivation: unique + alphabetically sorted from rows.
const derived = triageFilters.deriveOptions(FROWS);
check("filters-tickets-dynamic", derived.tickets, ["ITSM-2525538", "ITSM-2583450", "ITSM-2598785"]);
check("filters-apps-dynamic", derived.apps, ["AACC", "HI49"]);
check("filters-tipos-dynamic", derived.tipos, ["Cambio Mayor", "Cambio Menor", "Emergencia"]);
// Suggestion matching: partial digits hit the full ticket; capped output.
check("filters-partial-ticket", triageFilters.filterOptions(derived.tickets, "2583450"), ["ITSM-2583450"]);
check("filters-case-insensitive", triageFilters.filterOptions(derived.apps, "hi49"), ["HI49"]);
check("filters-cap", triageFilters.filterOptions(Array.from({ length: 60 }, (_, i) => "T-" + i), "", 50).length, 50);
check("filters-blank-head", triageFilters.filterOptions(derived.apps, "").length, 2);

// Tipo select populated dynamically with "TIPO CAMBIO" default preserved.
const tipoSel = filterDoc.__els.get("f-tipo");
check("filters-tipo-populated", tipoSel.children.map((o) => o.textContent),
  ["TIPO CAMBIO", "Cambio Mayor", "Cambio Menor", "Emergencia"]);
check("filters-tipo-default-value", tipoSel.value, "");

// Combobox multi-select: a pick toggles a chip, clears the query box, keeps
// the dropdown open for the next pick, and notifies the central filter.
const ticketInput = filterDoc.__els.get("f-ticket");
const ticketList = filterDoc.__els.get("f-ticket-list");
const ticketChips = filterDoc.__els.get("f-ticket-chips");
ticketInput.fire("focus");
check("filters-open-on-focus", ticketList.hasAttribute("hidden"), false);
check("filters-aria-expanded", ticketInput.getAttribute("aria-expanded"), "true");
ticketInput.value = "2583450";
ticketInput.fire("input");
check("filters-narrows", ticketList.children.length, 1);
const opt = ticketList.children[0];
opt.fire("mousedown", { preventDefault() {} });
check("filters-select-adds-chip", triageFilters.getSelected("ticket"), ["ITSM-2583450"]);
check("filters-select-clears-query", ticketInput.value, "");
check("filters-stays-open-on-select", ticketList.hasAttribute("hidden"), false);
check("filters-select-applies-central", applyCalls > 0, true);
const repainted = ticketList.children.filter((c) =>
  c.getAttribute && c.getAttribute("data-value") === "ITSM-2583450")[0];
check("filters-picked-check", repainted.getAttribute("aria-selected"), "true");
// Ops-density single bar: the ONLY chip source is #active-filters below the
// toolbar — combos carry the selection COUNT in their input placeholder
// (Ticket -> Ticket (1), App (Todas) -> App (2)) and render no chips inside.
check("filters-chip-rendered", triageFilters.getSelected("ticket"), ["ITSM-2583450"]);
check("filters-no-chips-in-combo-markup", /id="f-ticket-chips"|id="f-app-chips"/.test(html), false);
check("filters-placeholder-count", ticketInput.getAttribute("placeholder"), "Ticket (1)");
check("filters-placeholder-shapes",
  [triageFilters.placeholderFor("ticket", 0), triageFilters.placeholderFor("ticket", 2),
   triageFilters.placeholderFor("app", 0), triageFilters.placeholderFor("app", 2)],
  ["Ticket", "Ticket (2)", "App (Todas)", "App (2)"]);
// Second pick accumulates; picking again toggles off.
ticketInput.value = "2525538";
ticketInput.fire("input");
ticketList.children[0].fire("mousedown", { preventDefault() {} });
check("filters-second-pick-accumulates", triageFilters.getSelected("ticket"),
  ["ITSM-2583450", "ITSM-2525538"]);
ticketInput.value = "2583450";
ticketInput.fire("input");
ticketList.children[0].fire("mousedown", { preventDefault() {} });
check("filters-toggle-removes", triageFilters.getSelected("ticket"), ["ITSM-2525538"]);
// Enter on free text adds a chip; Backspace on empty input removes last.
ticketInput.value = "LIBRE-1";
ticketInput.fire("keydown", { key: "Enter", preventDefault() {} });
check("filters-enter-adds-free-text", triageFilters.getSelected("ticket"),
  ["ITSM-2525538", "LIBRE-1"]);
ticketInput.value = "";
ticketInput.fire("keydown", { key: "Backspace", preventDefault() {} });
check("filters-backspace-removes-last", triageFilters.getSelected("ticket"), ["ITSM-2525538"]);

// Empty state + Escape + outside-click close on the app field.
const appInput = filterDoc.__els.get("f-app");
const appList = filterDoc.__els.get("f-app-list");
appInput.value = "zzz-no-match";
appInput.fire("input");
check("filters-empty-state-shown", appList.children.length === 1 && appList.children[0].textContent === "Sin coincidencias", true);
filterDoc.fire("keydown", { key: "Escape" });
check("filters-escape-closes", appList.hasAttribute("hidden") && ticketList.hasAttribute("hidden"), true);
appInput.value = "";
appInput.fire("focus");
check("filters-app-todas-first", appList.children[0].getAttribute("data-value"), "Todas");
appList.children[0].fire("mousedown", { preventDefault() {} });
check("filters-todas-clears", appInput.value, "");
check("filters-placeholder-cleared", appInput.getAttribute("placeholder"), "App (Todas)");
// App multi-select accumulates chips the same way ticket does.
appInput.value = "HI49";
appInput.fire("input");
appList.children[0].fire("mousedown", { preventDefault() {} });
check("filters-app-chip", triageFilters.getSelected("app"), ["HI49"]);
check("filters-placeholder-count-app", appInput.getAttribute("placeholder"), "App (1)");
appInput.fire("focus");
check("filters-reopen", appList.hasAttribute("hidden"), false);
filterDoc.fire("mousedown", { target: {} });
check("filters-outside-closes", appList.hasAttribute("hidden"), true);

// Combined Ticket+App+Tipo+window through the CENTRAL filter (no duplication).
check("filters-combined-central", search.matchesFilters(FROWS[0],
  { ticket: "2583450", app: "HI49", tipo: "Cambio Mayor",
    desde: "2026-09-14T00:00:00", hasta: "2026-09-14T23:59:59" }), true);
check("filters-combined-central-miss", search.matchesFilters(FROWS[0],
  { ticket: "2583450", app: "HI49", tipo: "Emergencia", desde: "", hasta: "" }), false);
// Multi-select criteria: OR within a field, AND across fields.
check("filters-multi-or-app", search.matchesFilters(FROWS[0],
  { app: ["ZZZ", "HI49"], desde: "", hasta: "" }), true);
check("filters-multi-or-app-miss", search.matchesFilters(FROWS[1],
  { app: ["HI49"], desde: "", hasta: "" }), false);
check("filters-multi-and-across", search.matchesFilters(FROWS[0],
  { ticket: ["ITSM-2583450"], app: ["HI49"], desde: "", hasta: "" }), true);
check("filters-multi-and-across-miss", search.matchesFilters(FROWS[0],
  { ticket: ["ITSM-2583450"], app: ["AACC"], desde: "", hasta: "" }), false);
check("filters-multi-ticket-or", search.matchesFilters(FROWS[1],
  { ticket: ["ITSM-2583450", "ITSM-2525538"], desde: "", hasta: "" }), true);

// Empty initial state shows the full count via the central applyFilters.
search.applyFilters();
check("filters-initial-full-count", window.__rendered.rows.length, ROWS.length);
check("filters-initial-total", window.__rendered.hint.total, ROWS.length);
check("filters-initial-no-window", window.__rendered.hint.windowActive, false);

// Window logic preserved end to end (Lima wall time, inclusive overlap).
function makeWindowDoc(desdeDate, desdeTime, hastaDate, hastaTime) {
  const values = { "f-desde-date": desdeDate, "f-desde-time": desdeTime,
    "f-hasta-date": hastaDate, "f-hasta-time": hastaTime };
  const elements = new Map();
  return { readyState: "complete", addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: values[id] !== undefined ? values[id] : "",
        hidden: true, textContent: "", addEventListener() {}, focus() {}, select() {} });
      return elements.get(id);
    } };
}
const wwin = { Triage: { getRows: () => ROWS, getVisible: () => ROWS,
    render: (rows, hint) => { wwin.__rendered = { rows, hint }; } },
  Drawer: { formatDate: (v) => v } };
const wfactory = new Function("window", "document",
  `${readFileSync(join(jsDir, "search.js"), "utf8")}; return window.TriageSearch;`);
const wsearch = wfactory(wwin, makeWindowDoc("2026-09-14", "02:00", "2026-09-14", "04:00"));
wsearch.applyFilters();
check("filters-window-preserved", wwin.__rendered.rows.map((r) => r.ticket), ["T-1001"]);

console.log(`SMOKE_FILTERS_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);

/* ---- Implementation-window checks: Desde/Hasta overlap over
 * fec_hora_ini_impl/fec_hora_fin_impl in Lima wall-clock space (no browser-TZ
 * shifts), date-only whole-day defaults, Lima-midnight no-slide, missing
 * impl dates excluded only while a bound is active, legacy incident markup
 * gone, both window blocks present + themed, combined Ticket+App+Tipo+window.
 * Runs without a browser. */

const searchCode = readFileSync(join(jsDir, "search.js"), "utf8");

// Overlap: a row spanning the query window is included; a row ending before
// Desde is excluded; a row starting after Hasta is excluded.
check("window-overlap-span", search.matchesFilters(ROWS[0],
  { desde: "2026-09-14T02:00:00", hasta: "2026-09-14T04:00:00" }), true);
check("window-exclude-ends-before", search.matchesFilters(ROWS[0],
  { desde: "2026-09-14T07:00:00", hasta: "" }), false);
check("window-exclude-starts-after", search.matchesFilters(ROWS[2],
  { desde: "", hasta: "2026-09-14T09:00:00" }), false);
// Date-only bounds default to the whole day; Lima midnight never slides.
check("window-date-only-desde-default", search.parseWindowBound("2026-09-15", "", false), "2026-09-15T00:00:00");
check("window-date-only-hasta-default", search.parseWindowBound("2026-09-15", "", true), "2026-09-15T23:59:59");
check("window-lima-midnight-no-slide",
  search.parseWindowBound("2026-09-15", "00:00", false).slice(0, 10), "2026-09-15");
// Missing impl dates: excluded while a bound is active, included with none;
// field-less rows degrade gracefully (no crash, no false matches).
check("window-null-excluded", search.matchesFilters(ROWS[1],
  { desde: "2026-09-14T00:00:00", hasta: "" }), false);
check("window-null-included", search.matchesFilters(ROWS[1], { desde: "", hasta: "" }), true);
check("window-no-fields-excluded", search.matchesFilters({},
  { desde: "2026-09-14T00:00:00", hasta: "" }), false);
check("window-no-fields-included", search.matchesFilters({}, { desde: "", hasta: "" }), true);
// Combined Ticket+App+Tipo+window through the central filter.
check("window-combined", search.matchesFilters(
  { ticket: "ITSM-1", nombre_app: "HI49", tipo_cambio: "Cambio Mayor", recurso: "r",
    fec_hora_ini_impl: "2026-09-15T10:00:00-05:00", fec_hora_fin_impl: "2026-09-15T12:00:00-05:00" },
  { ticket: "itsm-1", app: "hi49", tipo: "mayor",
    desde: "2026-09-15T00:00:00", hasta: "2026-09-15T23:59:59" }), true);
check("window-combined-miss", search.matchesFilters(ROWS[0],
  { ticket: "T-1001", app: "Synthetic App", tipo: "NORMAL",
    desde: "2026-09-15T00:00:00", hasta: "2026-09-15T23:59:59" }), false);
// Legacy incident/date-equality markup gone; both window blocks present with
// labels plus the toolbar reset action.
check("window-incident-gone",
  /f-incident/.test(html) || /incident-wrap/.test(html)
  || /parseIncident/.test(searchCode) || /isOverlap/.test(searchCode), false);
check("window-fecha-gone", /id="f-fecha"/.test(html), false);
check("window-blocks-present",
  ["f-desde-date", "f-desde-time", "f-hasta-date", "f-hasta-time"]
    .every((id) => html.includes('id="' + id + '"')), true);
check("window-labels",
  html.includes("Fec. Hora. Ini. Impl") && html.includes("Fec. Hora. Fin. Impl"), true);
check("window-clear-action", /id="clear-filters"/.test(html) && /Limpiar filtros/.test(html), true);
// New blocks themed via CSS vars only (no hardcoded hex); wiring present.
const winCssBlock = (css.match(/\.window-block\s*\{([^}]*)\}/) || [])[1] || "";
check("window-themed", /var\(--(surface-alt|surface|border|muted)\)/.test(winCssBlock), true);
check("window-theme-safe", /#[0-9a-fA-F]{3,8}/.test(winCssBlock), false);
check("window-wired", /clear-filters/.test(searchCode)
  && /parseWindowBound/.test(searchCode) && /matchesWindow/.test(searchCode), true);

console.log(`SMOKE_WINDOW_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);

/* ---- Daypick checks: Desde/Hasta dropdowns derive their days per column
 * (Desde <- fec_hora_ini_impl, Hasta <- fec_hora_fin_impl) with no ini->fin
 * range expansion; omitted/unknown side keeps the legacy union. Runs on the
 * REAL daypick.js with a fake DOM in the style of the filters section. */

const daypickCode = readFileSync(join(jsDir, "daypick.js"), "utf8");

// One row crossing days (ini 14th 10:00 -> fin 16th 12:00 Lima); plus rows
// deliberately out of order to prove per-side sorting.
const DCROSS = row("T-9001", "2026-09-14T10:00:00-05:00", "2026-09-16T12:00:00-05:00");
const DROWS = [
  row("T-9002", "2026-09-16T10:00:00-05:00", "2026-09-17T12:00:00-05:00"),
  DCROSS,
  row("T-9003", "2026-09-15T08:00:00-05:00", "2026-09-15T09:00:00-05:00"),
];

function makeDaypickDocument() {
  const els = new Map();
  ["f-desde-date", "f-hasta-date", "f-desde-day", "f-hasta-day",
    "f-desde-day-list", "f-hasta-day-list"].forEach((id) => els.set(id, fakeNode()));
  return { readyState: "complete",
    getElementById(id) { return els.get(id) || null; },
    createElement() { return fakeNode(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    __els: els };
}

const dayDoc = makeDaypickDocument();
const dayFactory = new Function("window", "document",
  `${daypickCode}; return window.TriageDaypick;`);
const daypick = dayFactory(
  { Triage: { getRows: () => DROWS }, TriageSearch: search }, dayDoc);
check("daypick-module-loads", !!daypick, true);

// No expansion: the crossing row alone yields only its own column day.
check("daypick-no-expand-desde", daypick.deriveDays([DCROSS], "desde"), ["2026-09-14"]);
check("daypick-no-expand-hasta", daypick.deriveDays([DCROSS], "hasta"), ["2026-09-16"]);
// Per-side derivation, sorted despite unordered input.
check("daypick-desde-ordered", daypick.deriveDays(DROWS, "desde"),
  ["2026-09-14", "2026-09-15", "2026-09-16"]);
check("daypick-hasta-ordered", daypick.deriveDays(DROWS, "hasta"),
  ["2026-09-15", "2026-09-16", "2026-09-17"]);
// Legacy union without a side (compat) + unknown side behaves the same.
check("daypick-union-legacy", daypick.deriveDays(DROWS),
  ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]);
check("daypick-union-legacy-unknown-side", daypick.deriveDays(DROWS, "otro"),
  ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]);
check("daypick-union-legacy-getdays", daypick.getDays(),
  ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]);

// refreshDays validates each hidden input against ITS side list: 09-17 is a
// Hasta day but not a Desde day (and 09-14 vice versa), so both clear — a
// shared union list would have kept them.
dayDoc.__els.get("f-desde-date").value = "2026-09-17";
dayDoc.__els.get("f-hasta-date").value = "2026-09-14";
daypick.refreshDays();
check("daypick-desde-refresh-clears-foreign", dayDoc.__els.get("f-desde-date").value, "");
check("daypick-hasta-refresh-clears-foreign", dayDoc.__els.get("f-hasta-date").value, "");
// Days present on their own side survive a refresh.
dayDoc.__els.get("f-desde-date").value = "2026-09-15";
dayDoc.__els.get("f-hasta-date").value = "2026-09-16";
daypick.refreshDays();
check("daypick-desde-refresh-keeps-valid", dayDoc.__els.get("f-desde-date").value, "2026-09-15");
check("daypick-hasta-refresh-keeps-valid", dayDoc.__els.get("f-hasta-date").value, "2026-09-16");
// Rendered option counts match the per-side lists (3 desde, 3 hasta).
check("daypick-desde-list-count", dayDoc.__els.get("f-desde-day-list").children.length, 3);
check("daypick-hasta-list-count", dayDoc.__els.get("f-hasta-day-list").children.length, 3);
// Bundle-safe: no literal closing tag inside the JS.
check("daypick-bundle-safe", /<\/script/i.test(daypickCode), false);

console.log(`SMOKE_DAYPICK_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);

/* ---- Timepick checks: Desde/Hasta hour dropdowns offer "Día completo" +
 * the 24 exact hours on the REAL timepick.js with a fake DOM; the picked
 * hour lands in the same hidden #f-desde-time / #f-hasta-time inputs the
 * native clocks used, so search/presets/share keep working untouched. */

const timepickCode = readFileSync(join(jsDir, "timepick.js"), "utf8");

function makeTimepickDocument() {
  const els = new Map();
  ["f-desde-time", "f-hasta-time", "f-desde-hour", "f-hasta-hour",
    "f-desde-hour-list", "f-hasta-hour-list"].forEach((id) => els.set(id, fakeNode()));
  return { readyState: "complete",
    getElementById(id) { return els.get(id) || null; },
    createElement() { return fakeNode(); },
    addEventListener() {},
    __els: els };
}

const timeDoc = makeTimepickDocument();
const timeFactory = new Function("window", "document",
  `${timepickCode}; return window.TriageTimepick;`);
const timepick = timeFactory({}, timeDoc);
check("timepick-module-loads", !!timepick, true);
check("timepick-hours-count", timepick.HOURS.length, 24);
check("timepick-hours-first", timepick.HOURS[0], "00:00");
check("timepick-hours-last", timepick.HOURS[23], "23:00");
// Button label mirrors the hidden input; empty shows the placeholder.
timeDoc.__els.get("f-desde-time").value = "14:00";
timepick.syncFromInputs();
check("timepick-label-picked", timeDoc.__els.get("f-desde-hour").textContent, "14:00");
timeDoc.__els.get("f-desde-time").value = "";
timepick.syncFromInputs();
check("timepick-label-empty", timeDoc.__els.get("f-desde-hour").textContent, "Hora");
// Markup: clock buttons + lists + hidden inputs, no native time inputs left.
check("timepick-script-tag", /src="assets\/js\/timepick\.js"/.test(html), true);
check("timepick-markup-desde", /id="f-desde-hour"/.test(html) && /id="f-desde-hour-list"/.test(html)
  && /id="f-desde-time" type="hidden"/.test(html), true);
check("timepick-markup-hasta", /id="f-hasta-hour"/.test(html) && /id="f-hasta-hour-list"/.test(html)
  && /id="f-hasta-time" type="hidden"/.test(html), true);
check("timepick-no-native-time", /type="time"/.test(html), false);
check("timepick-bundle-safe", /<\/script/i.test(timepickCode), false);

console.log(`SMOKE_TIMEPICK_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);

/* ---- Shareable-filter-state checks: URL codec roundtrip (build/parse),
 * repeated-key getAll, tolerant parse, markup (copy-link, active-filters,
 * chips below inputs, script tag), Teams header with active filters, and
 * the filters.js value-removal/setter surface. Runs without a browser. */

const shareCode = readFileSync(join(jsDir, "share.js"), "utf8");
check("share-bundle-safe", /<\/script/i.test(shareCode), false);
check("share-script-tag", /src="assets\/js\/share\.js"/.test(html), true);
const brandSide = /<div class="brand-side">[\s\S]*?<\/div>/.exec(html);
check("updated-slot-in-results-bar", /id="kyndryl-updated"/.test(html)
  && !(brandSide && /kyndryl-updated/.test(brandSide[0])), true);
check("share-copy-link-btn", /id="copy-link"/.test(html) && /Copiar enlace filtrado/.test(html), true);
check("share-active-filters-div", /id="active-filters"/.test(html), true);
check("share-active-filters-hidden-empty", /id="active-filters"[^>]*hidden/.test(html), true);
// Ops-density single bar: combos carry counts in their placeholders and
// render no chips inside — the only chip source is #active-filters.
check("share-no-chips-in-ticket-combo", /id="f-ticket-chips"/.test(html), false);
check("share-no-chips-in-app-combo", /id="f-app-chips"/.test(html), false);
check("share-hooks-refresh", /__shareHooked/.test(shareCode), true);
check("share-no-matching-touch", /matchesFilters|matchesWindow|matchesQuery/.test(shareCode), false);

// Codec runs standalone: stub DOM (codec needs none) + location/history.
function makeShareDocument() {
  return { readyState: "complete",
    getElementById() { return null; },
    createElement() { return fakeNode(); },
    addEventListener() {} };
}
const shareWin = { location: { search: "", href: "http://localhost/triage.html" },
  history: { replaceState() {} }, navigator: {} };
const shareFactory = new Function("window", "document",
  `${shareCode}; return window.TriageShare;`);
const share = shareFactory(shareWin, makeShareDocument());
check("share-module-loads", !!share && typeof share.buildParams === "function"
  && typeof share.parseParams === "function"
  && typeof share.afterApply === "function"
  && typeof share.copyLink === "function", true);

const SHARE_CRIT = { q: "hi49 outage", ticket: ["ITSM-1", "ITSM-2"],
  app: ["HI49", "YAPE"], tipo: "Cambio Mayor",
  desde: "2026-09-20T00:00:00", hasta: "2026-09-20T01:00:00" };
const built = share.buildParams(SHARE_CRIT);
check("share-roundtrip", share.parseParams("?" + built),
  { q: "hi49 outage", ticket: ["ITSM-1", "ITSM-2"], app: ["HI49", "YAPE"],
    tipo: "Cambio Mayor", desde: "2026-09-20T00:00", hasta: "2026-09-20T01:00" });
check("share-multi-app", share.parseParams("?app=HI49&app=YAPE").app, ["HI49", "YAPE"]);
check("share-multi-ticket", share.parseParams("?ticket=A&ticket=B").ticket, ["A", "B"]);
check("share-tolerant", share.parseParams("?foo=1&app=&tipo=&q=&desde=nope"),
  { q: "", ticket: [], app: [], tipo: "", desde: "", hasta: "" });
check("share-encode", share.parseParams("?" + share.buildParams(
  { q: "a/b c?", ticket: [], app: [], tipo: "", desde: "", hasta: "" })).q, "a/b c?");
check("share-desde-shape", /(^|&)desde=2026-09-20T00%3A00(&|$)/.test(built), true);
check("share-empty-build", share.buildParams(
  { q: " ", ticket: [], app: [], tipo: "", desde: "", hasta: "" }), "");

// Teams header with active filters (stubbed criteria + daypick short form).
const expCode = readFileSync(join(jsDir, "export.js"), "utf8");
const expWin = { TriageSearch: { getCriteria: () => SHARE_CRIT },
  TriageDaypick: { formatDay: (d) => d, formatWindowShort: () => "20 Sep · 00:00–01:00" },
  Drawer: { formatDate: (v) => v } };
const expFactory = new Function("window", "document",
  `${expCode}; return window.TriageExport;`);
const expFiltered = expFactory(expWin, makeDocument());
const header = expFiltered.toTeamsSummary([ROWS[0]]);
check("teams-header-title", header.split("\n")[0], "Change Triage");
check("teams-header-active", header.split("\n")[1], "Filtros aplicados:");
check("teams-header-tickets", header.includes("• Tickets: ITSM-1, ITSM-2"), true);
check("teams-header-apps", header.includes("• Apps: HI49, YAPE"), true);
check("teams-header-tipo", header.includes("• Tipo: Cambio Mayor"), true);
check("teams-header-window", header.includes("• Ventana: 20 Sep · 00:00–01:00"), true);
check("teams-header-query", header.includes("• Búsqueda: hi49 outage"), true);
check("teams-header-count", header.includes("Resultados: 1 cambios encontrados."), true);
check("teams-header-row-kept", header.split("\n").length, 9); // 8 header + 1 row

// filters.js value surface used by chips/restore.
check("filters-remove-value-exposed", typeof triageFilters.removeValue, "function");
check("filters-set-selected-exposed", typeof triageFilters.setSelected, "function");
triageFilters.setSelected("app", ["HI49", "YAPE"]);
check("filters-set-selected-roundtrip", triageFilters.getSelected("app"), ["HI49", "YAPE"]);
triageFilters.removeValue("app", "HI49");
check("filters-remove-value-drops-one", triageFilters.getSelected("app"), ["YAPE"]);

console.log(`SMOKE_SHARE_DONE pass=${pass} fail=${process.exitCode ? 1 : 0}`);
