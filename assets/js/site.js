window.MSK_API_URL = "https://script.google.com/macros/s/AKfycbx56NY8Z9U_kw4E2F_6pjsWSmATgheLC43QgH1rHO7atFoWNg_pqyi5XwQEkKdgqQSt/exec";
// Static snapshot synced periodically from the Sheet by a GitHub Action
// (see .github/workflows/sync-data.yml). Every visitor hits this static
// file first — cheap and served by GitHub Pages — instead of hitting the
// Apps Script endpoint directly, which has a low simultaneous-execution quota.
window.MSK_STATIC_URL = "assets/data/msk-data.json";
window.MSK_CACHE_KEY = "miskat-data-cache-v1";
window.MSK_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

window.mskFetchData = function () {
  if (window._mskP)
    return window._mskP;

  function readCache() {
    try {
      var raw = localStorage.getItem(window.MSK_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (!cached || typeof cached.t !== "number" || !cached.d) return null;
      if (Date.now() - cached.t > window.MSK_CACHE_TTL_MS) return null;
      return cached.d;
    } catch (e) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(window.MSK_CACHE_KEY, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) {
      // localStorage full or disabled (private mode) — safe to ignore, we just skip caching
    }
  }

  var cached = readCache();
  if (cached) {
    window._mskP = Promise.resolve(cached);
    return window._mskP;
  }

  window._mskP = fetch(window.MSK_STATIC_URL, { cache: "no-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("static HTTP " + res.status);
      return res.json();
    })
    .catch(function () {
      // Static snapshot missing or not synced yet — fall back to the live
      // Apps Script endpoint so the site still works.
      return fetch(window.MSK_API_URL).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      });
    })
    .then(function (data) {
      writeCache(data);
      return data;
    })
    .catch(function (err) {
      window._mskP = null; // allow retry on next call instead of caching a permanent failure
      throw err;
    });

  return window._mskP;
};
(function () {
  var STORAGE_KEY = "miskat-theme";
  function applyStoredTheme() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }
  applyStoredTheme();
  document.addEventListener("DOMContentLoaded", function () {
    var themeBtn = document.getElementById("themeToggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        var current = document.documentElement.getAttribute("data-theme");
        var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        var isDark = current ? current === "dark" : prefersDark;
        var next = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem(STORAGE_KEY, next);
      });
    }
    var navToggle = document.getElementById("navToggle");
    var sidebar = document.getElementById("sidebar");
    var backdrop = document.getElementById("sidebarBackdrop");
    function openSidebar() {
      if (sidebar)
        sidebar.classList.add("open");
      if (backdrop)
        backdrop.classList.add("open");
      if (navToggle)
        navToggle.setAttribute("aria-expanded", "true");
    }
    function closeSidebar() {
      if (sidebar)
        sidebar.classList.remove("open");
      if (backdrop)
        backdrop.classList.remove("open");
      if (navToggle)
        navToggle.setAttribute("aria-expanded", "false");
    }
    if (navToggle) {
      navToggle.addEventListener("click", function () {
        var isOpen = sidebar && sidebar.classList.contains("open");
        if (isOpen)
          closeSidebar();
        else
          openSidebar();
      });
    }
    if (backdrop)
      backdrop.addEventListener("click", closeSidebar);
    if (sidebar) {
      sidebar.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", closeSidebar);
      });
    }
    var here = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".sidebar-list a").forEach(function (a) {
      var href = a.getAttribute("href").split("?")[0].split("#")[0];
      if (href === here)
        a.classList.add("active");
    });
  });
})();
