/* Theme controller: Light/Dark palettes for the Change Triage SPA.
 *
 * - Applies `data-theme` ("light" | "dark") on <html> as early as possible
 *   (this file loads synchronously in <head>) to avoid a first-paint flash.
 * - Persists the choice in localStorage ("triage-theme"); with no saved
 *   preference it respects `prefers-color-scheme` (dark is the default).
 * - Pure presentation: no search/filter/drawer/export logic lives here.
 * - Bundle-safe: avoids any closing-tag literal, stdlib-free, no imports.
 */
"use strict";

(function () {
  var STORAGE_KEY = "triage-theme";
  var DARK = "dark";
  var LIGHT = "light";

  function isTheme(value) {
    return value === DARK || value === LIGHT;
  }

  function systemTheme() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
        return LIGHT;
      }
    } catch (err) {
      /* matchMedia unavailable (old WebView, smoke stubs): fall through. */
    }
    return DARK;
  }

  function storedTheme() {
    try {
      if (window.localStorage) {
        var saved = window.localStorage.getItem(STORAGE_KEY);
        if (isTheme(saved)) return saved;
      }
    } catch (err) {
      /* Storage blocked (private mode): fall through to system default. */
    }
    return null;
  }

  function labelFor(theme) {
    return theme === LIGHT ? "Claro" : "Oscuro";
  }

  function iconFor(theme) {
    return theme === LIGHT ? "\u2600" : "\u263E";
  }

  /* Reflects the active theme on the toggle button (icon only + ARIA state).
   * The accessible name carries the Claro/Oscuro wording via aria-label. */
  function paintButton(btn, theme) {
    if (!btn) return;
    var next = theme === LIGHT ? DARK : LIGHT;
    btn.textContent = iconFor(theme);
    btn.setAttribute("aria-pressed", theme === DARK ? "true" : "false");
    btn.setAttribute("aria-label", "Tema actual: " + labelFor(theme).toLowerCase() +
      ". Cambiar a tema " + labelFor(next).toLowerCase() + ".");
  }

  function current() {
    var theme = document.documentElement.getAttribute("data-theme");
    return isTheme(theme) ? theme : DARK;
  }

  function apply(theme, options) {
    if (!isTheme(theme)) return current();
    document.documentElement.setAttribute("data-theme", theme);
    try {
      if (window.localStorage && !(options && options.persist === false)) {
        window.localStorage.setItem(STORAGE_KEY, theme);
      }
    } catch (err) {
      /* Storage blocked: theme still applies for this session. */
    }
    paintButton(document.getElementById("theme-toggle"), theme);
    return theme;
  }

  function toggle() {
    return apply(current() === DARK ? LIGHT : DARK);
  }

  function wire() {
    var btn = document.getElementById("theme-toggle");
    if (btn && !btn.__triageThemeWired) {
      btn.__triageThemeWired = true;
      btn.addEventListener("click", toggle);
    }
    paintButton(btn, current());
  }

  window.TriageTheme = {
    get: current,
    set: apply,
    toggle: toggle,
    system: systemTheme,
    stored: storedTheme,
  };

  /* First paint: stored choice wins, otherwise follow the OS. */
  apply(storedTheme() || systemTheme(), { persist: false });
  /* Persist only explicit user choices, not the inferred default. */
  try {
    if (window.localStorage && storedTheme() === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    /* Ignore storage errors during init. */
  }

  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
