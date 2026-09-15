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
// Teams: one Ticket/App/window line per row.
check("teams-lines", window.TriageExport.toTeamsSummary(ROWS).split("\n").length, 3);
check("teams-first-line", window.TriageExport.toTeamsSummary([ROWS[0]]).startsWith("T-1001"), true);

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
check("theme-btn-text-light", env.button.textContent.includes("Claro"), true);
env.button.click();
check("theme-toggle-back-dark", themeGet(env), "dark");
check("theme-btn-pressed-dark", env.button.getAttribute("aria-pressed"), "true");
check("theme-btn-text-dark", env.button.textContent.includes("Oscuro"), true);

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
check("theme-toggle-visible-label", />[^<]*(Claro|Oscuro)[^<]*<\/button>/i.test(html.split('id="theme-toggle"')[1] || ""), true);

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
check("filters-tipo-todos-first", /<select\b[^>]*id="f-tipo"[^>]*>\s*<option value="">Tipo \(Todos\)<\/option>/.test(html), true);
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
    fire(ev, e) { (node.handlers[ev] || []).forEach((fn) => fn(e || {})); } };
  Object.defineProperty(node, "firstChild", { get() { return node.children[0] || null; } });
  return node;
}

function makeFilterDocument() {
  const els = new Map();
  ["f-ticket", "f-ticket-list", "f-app", "f-app-list", "f-tipo"].forEach((id) => els.set(id, fakeNode()));
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

// Tipo select populated dynamically with "Todos" default preserved.
const tipoSel = filterDoc.__els.get("f-tipo");
check("filters-tipo-populated", tipoSel.children.map((o) => o.textContent),
  ["Tipo (Todos)", "Cambio Mayor", "Cambio Menor", "Emergencia"]);
check("filters-tipo-default-value", tipoSel.value, "");

// Combobox open/select/close behavior on the ticket field.
const ticketInput = filterDoc.__els.get("f-ticket");
const ticketList = filterDoc.__els.get("f-ticket-list");
ticketInput.fire("focus");
check("filters-open-on-focus", ticketList.hasAttribute("hidden"), false);
check("filters-aria-expanded", ticketInput.getAttribute("aria-expanded"), "true");
ticketInput.value = "2583450";
ticketInput.fire("input");
check("filters-narrows", ticketList.children.length, 1);
const opt = ticketList.children[0];
opt.fire("mousedown", { preventDefault() {} });
check("filters-select-fills", ticketInput.value, "ITSM-2583450");
check("filters-close-on-select", ticketList.hasAttribute("hidden"), true);
check("filters-select-applies-central", applyCalls > 0, true);

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
check("filters-app-todas-first", appList.children[0].textContent, "Todas");
appList.children[0].fire("mousedown", { preventDefault() {} });
check("filters-todas-clears", appInput.value, "");
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
