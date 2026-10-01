window.MSK_API_URL = "https://script.google.com/macros/s/AKfycbx56NY8Z9U_kw4E2F_6pjsWSmATgheLC43QgH1rHO7atFoWNg_pqyi5XwQEkKdgqQSt/exec";
window.MSK_STATIC_URL = "assets/data/msk-data.json";
window.MSK_CACHE_KEY = "miskat-data-cache-v2";

window.mskFetchData = function () {
  if (window._mskP)
    return window._mskP;

  function readStored() {
    try {
      var raw = localStorage.getItem(window.MSK_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeStored(text) {
    try {
      if (localStorage.getItem(window.MSK_CACHE_KEY) !== text)
        localStorage.setItem(window.MSK_CACHE_KEY, text);
    } catch (e) { }
  }

  function parseData(text) {
    var data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid data");
    return data;
  }

  function load(url, options) {
    return fetch(url, options)
      .then(function (res) {
        if (!res.ok)
          throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var data = parseData(text);
        writeStored(text);
        return data;
      });
  }

  try {
    localStorage.removeItem("miskat-data-cache-v1");
  } catch (e) { }

  window._mskP = load(window.MSK_STATIC_URL, { cache: "no-cache" })
    .catch(function () {
      return load(window.MSK_API_URL);
    })
    .catch(function (err) {
      var stored = readStored();
      if (stored)
        return stored;
      window._mskP = null;
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
