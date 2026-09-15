/* Checked-in smoke script: executes the REAL search.js/export.js against
 * synthetic rows (no production data) with minimal DOM stubs.
 * Covers: query, AND filters, incident overlap incl. null-window rows,
 * CSV (headers-only + escaping), Teams one-line-per-row.
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
// Filters: AND semantics, blank ignored.
check("filters-and", search.matchesFilters(ROWS[0],
  { ticket: "T-1001", app: "synthetic", tipo: "normal", fecha: "2026-09-14" }), true);
check("filters-and-miss", search.matchesFilters(ROWS[0], { ticket: "T-1003" }), false);
// Incident overlap: inclusive edges; null window never matches; NaN -> null.
const inside = search.parseIncident("2026-09-14T03:00");
check("incident-stamp", new Date(inside).toISOString(), "2026-09-14T08:00:00.000Z");
check("overlap-inside", search.isOverlap(ROWS[0], inside), true);
check("overlap-ini-edge", search.isOverlap(ROWS[0], Date.parse(ROWS[0].fec_hora_ini_impl)), true);
check("overlap-outside", search.isOverlap(ROWS[0], Date.parse(ROWS[2].fec_hora_ini_impl)), false);
check("overlap-null-window", search.isOverlap(ROWS[1], inside), false);
check("overlap-nan", search.isOverlap(ROWS[0], NaN), null);
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
