(function () {
  var LANG_KEY = "miskat-lang";
  var SUPPORTED = ["en", "id", "ms"];
  var current = localStorage.getItem(LANG_KEY) || "en";
  if (SUPPORTED.indexOf(current) === -1)
    current = "en";
  var dict = {};
  function applyDict() {
    document.documentElement.setAttribute("lang", current);
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null)
        el.textContent = dict[key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (dict[key] != null)
        el.setAttribute("placeholder", dict[key]);
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-title");
      if (dict[key] != null) {
        el.setAttribute("title", dict[key]);
        el.setAttribute("aria-label", dict[key]);
      }
    });
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === current);
    });
    document.dispatchEvent(new CustomEvent("i18n:ready", { detail: { lang: current } }));
  }
  function load(lang) {
    return fetch("assets/lang/" + lang + ".json").then(function (res) {
      if (!res.ok)
        throw new Error("HTTP " + res.status);
      return res.json();
    });
  }
  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1 || lang === current)
      return;
    load(lang).then(function (d) {
      current = lang;
      dict = d;
      localStorage.setItem(LANG_KEY, lang);
      applyDict();
    });
  }
  window.i18n = {
    t: function (key) { return dict[key] != null ? dict[key] : key; },
    lang: function () { return current; },
    setLang: setLang
  };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".lang-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setLang(btn.getAttribute("data-lang")); });
    });
    load(current).then(function (d) { dict = d; applyDict(); });
  });
})();
