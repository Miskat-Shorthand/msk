(function () {
  var INDEX_URL = "assets/units-index.json";
  var FALLBACK_ORDER = ["en", "id", "ms"];
  var indexPromise = null;

  function fetchIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).catch(function (err) {
        console.error("Failed to load units index:", err);
        return [];
      });
    }
    return indexPromise;
  }

  function pickLang(entry) {
    var current = window.i18n ? window.i18n.lang() : "en";
    if (entry.langs[current])
      return { lang: current, data: entry.langs[current] };
    for (var i = 0; i < FALLBACK_ORDER.length; i++) {
      var l = FALLBACK_ORDER[i];
      if (entry.langs[l])
        return { lang: l, data: entry.langs[l] };
    }
    var any = Object.keys(entry.langs)[0];
    return { lang: any, data: entry.langs[any] };
  }

  function t(key, fallback) {
    if (window.i18n) {
      var v = window.i18n.t(key);
      return v === key ? fallback : v;
    }
    return fallback;
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") e.className = attrs[k];
        else if (k === "html") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function text(tag, cls, str) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = str;
    return e;
  }

  function sortByOrder(nodes) {
    return nodes.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function findNode(tree, path) {
    if (!path) return { node: { children: tree }, trail: [] };
    var segments = path.split("/").filter(Boolean);
    var level = tree;
    var trail = [];
    var current = null;
    for (var i = 0; i < segments.length; i++) {
      current = (level || []).filter(function (n) { return n.id === segments[i]; })[0];
      if (!current) return { node: null, trail: trail };
      trail.push(current);
      level = current.children;
    }
    return { node: current, trail: trail };
  }

  function pathFor(trail) {
    return trail.map(function (n) { return n.id; }).join("/");
  }

  function renderBreadcrumb(container, trail) {
    if (!container) return;
    if (!trail.length) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    container.innerHTML = "";
    var rootLink = el("a", { href: "l&p.html" }, []);
    rootLink.textContent = t("unit.title", "Learn & Practice");
    container.appendChild(rootLink);
    trail.forEach(function (node, i) {
      container.appendChild(text("span", "unit-breadcrumb__sep", "\u203a"));
      var picked = pickLang(node);
      if (i === trail.length - 1) {
        container.appendChild(text("span", "unit-breadcrumb__current", picked.data.title));
      } else {
        var link = el("a", { href: "unit.html?path=" + encodeURIComponent(pathFor(trail.slice(0, i + 1))) }, []);
        link.textContent = picked.data.title;
        container.appendChild(link);
      }
    });
  }

  function renderCard(node, basePath, variant) {
    var picked = pickLang(node);
    var childPath = basePath ? basePath + "/" + node.id : node.id;
    var href = "unit.html?path=" + encodeURIComponent(childPath);

    if (variant === "edition") {
      var eCard = el("a", { class: "edition-card", href: href }, []);
      if (node.thumbnail) {
        eCard.appendChild(el("img", { class: "edition-card__cover", src: node.thumbnail, alt: "", loading: "lazy" }, []));
      } else {
        var placeholder = el("div", { class: "edition-card__cover edition-card__cover--placeholder" }, []);
        placeholder.textContent = (picked.data.title || "?").trim().charAt(0).toUpperCase();
        eCard.appendChild(placeholder);
      }
      var eBody = el("div", { class: "edition-card__body" }, []);
      eBody.appendChild(text("h3", "edition-card__title", picked.data.title));
      if (picked.data.summary)
        eBody.appendChild(text("p", "edition-card__excerpt", picked.data.summary));

      var ICON_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.5 5 8 4 5 4v14c3 0 5.5 1 7 2.5C13.5 19 16 18 19 18V4c-3 0-5.5 1-7 2.5z"/><path d="M12 6.5v14"/></svg>';
      var ICON_GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14.5 14.5 0 010 18"/><path d="M12 3a14.5 14.5 0 000 18"/></svg>';

      var unitCount = (node.children || []).length;
      var langCodes = Object.keys(node.langs || {});
      var meta = el("div", { class: "edition-card__meta" }, []);
      if (unitCount) {
        var m1 = el("span", { class: "edition-card__meta-item" }, []);
        m1.appendChild(el("span", { class: "edition-card__meta-icon", html: ICON_BOOK }, []));
        m1.appendChild(document.createTextNode(unitCount + " " + (unitCount === 1 ? t("unit.count.one", "unit") : t("unit.count.many", "unit"))));
        meta.appendChild(m1);
      }
      if (langCodes.length) {
        var m2 = el("span", { class: "edition-card__meta-item" }, []);
        m2.appendChild(el("span", { class: "edition-card__meta-icon", html: ICON_GLOBE }, []));
        m2.appendChild(document.createTextNode(langCodes.map(function (l) { return l.toUpperCase(); }).join(" \u00b7 ")));
        meta.appendChild(m2);
      }
      eBody.appendChild(meta);
      eCard.appendChild(eBody);
      return eCard;
    }

    var hasThumb = !!node.thumbnail;
    var card = el("a", { class: "article-card" + (hasThumb ? " article-card--has-thumb" : ""), href: href }, []);
    if (hasThumb)
      card.appendChild(el("img", { class: "article-card__thumb", src: node.thumbnail, alt: "", loading: "lazy" }, []));
    card.appendChild(text("h3", "article-card__title", picked.data.title));
    if (picked.data.summary)
      card.appendChild(text("p", "article-card__excerpt", picked.data.summary));
    return card;
  }

  window.MSK_UNIT_API_URL = "PASTE_YOUR_SEPARATE_RESTRICTED_EXEC_URL_HERE";
  var unitBodyCache = {};

  function fetchUnitBody(path, lang) {
    var key = path + ":" + lang;
    if (!unitBodyCache[key]) {
      var url = window.MSK_UNIT_API_URL + "?path=" + encodeURIComponent(path) + "&lang=" + encodeURIComponent(lang);
      unitBodyCache[key] = fetch(url).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      });
    }
    return unitBodyCache[key];
  }

  function attachCopyGuard(container) {
    container.addEventListener("copy", function (e) { e.preventDefault(); });
    container.addEventListener("cut", function (e) { e.preventDefault(); });
    container.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    container.addEventListener("dragstart", function (e) { e.preventDefault(); });
    container.addEventListener("keydown", function (e) {
      var k = (e.key || "").toLowerCase();
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (k === "c" || k === "x" || k === "a" || k === "s" || k === "p")) e.preventDefault();
    });
    container.querySelectorAll("img").forEach(function (img) { img.setAttribute("draggable", "false"); });
  }

  function showList() {
    var listEl = document.getElementById("unitList");
    var bodyEl = document.getElementById("unitBody");
    var noticeEl = document.getElementById("unitRestrictedNotice");
    if (listEl) listEl.hidden = false;
    if (bodyEl) bodyEl.hidden = true;
    if (noticeEl) noticeEl.hidden = true;
  }

  function showBody() {
    var listEl = document.getElementById("unitList");
    var bodyEl = document.getElementById("unitBody");
    if (listEl) listEl.hidden = true;
    if (bodyEl) bodyEl.hidden = false;
  }

  function renderPage() {
    var listEl = document.getElementById("unitList");
    var bodyEl = document.getElementById("unitBody");
    var titleEl = document.getElementById("unitTitle");
    var leadEl = document.getElementById("unitLead");
    var breadcrumbEl = document.getElementById("unitBreadcrumb");
    var noticeEl = document.getElementById("unitRestrictedNotice");
    if (!listEl && !bodyEl) return;

    var params = new URLSearchParams(location.search);
    var path = params.get("path") || "";

    fetchIndex().then(function (tree) {
      var found = findNode(tree, path);
      renderBreadcrumb(breadcrumbEl, found.trail);

      if (!found.node) {
        showList();
        if (titleEl) titleEl.textContent = t("unit.notfound", "Unit not found");
        if (leadEl) leadEl.textContent = "";
        if (listEl) {
          listEl.className = "article-list";
          listEl.innerHTML = "";
          listEl.appendChild(text("p", "article-empty", t("unit.notfound", "Unit not found")));
        }
        return;
      }

      var node = found.node;
      var isRoot = found.trail.length === 0;
      var picked = isRoot ? null : pickLang(node);

      if (titleEl) titleEl.textContent = isRoot ? t("unit.title", "Learn & Practice") : picked.data.title;
      if (leadEl) leadEl.textContent = isRoot ? t("unit.lead", "") : (picked.data.summary || "");
      document.title = (isRoot ? t("unit.title", "Learn & Practice") : picked.data.title) + " — Miskat Shorthand";

      var hasChildren = node.children && node.children.length;
      if (hasChildren) {
        showList();
        var variant = isRoot ? "edition" : "unit";
        listEl.className = isRoot ? "edition-list" : "article-list";
        listEl.innerHTML = "";
        sortByOrder(node.children).forEach(function (child) { listEl.appendChild(renderCard(child, path, variant)); });
        return;
      }

      if (isRoot) {
        showList();
        listEl.className = "article-list";
        listEl.innerHTML = "";
        listEl.appendChild(text("p", "article-empty", t("unit.empty", "No units yet — check back soon.")));
        return;
      }

      showBody();
      bodyEl.textContent = t("unit.loading", "Loading unit...");
      fetchUnitBody(path, picked.lang)
        .then(function (result) {
          if (!result || !result.ok) {
            bodyEl.innerHTML = "";
            bodyEl.appendChild(text("p", "article-empty", t("unit.loaderror", "Failed to load this unit. Please try again in a moment.")));
            if (noticeEl) noticeEl.hidden = true;
            return;
          }
          bodyEl.innerHTML = result.html || "";
          attachCopyGuard(bodyEl);
          if (noticeEl) noticeEl.hidden = false;
        })
        .catch(function (err) {
          console.error("Failed to load unit body:", err);
          bodyEl.innerHTML = "";
          bodyEl.appendChild(text("p", "article-empty", t("unit.loaderror", "Failed to load this unit. Please try again in a moment.")));
          if (noticeEl) noticeEl.hidden = true;
        });
    });
  }

  window.miskatLearn = { renderPage: renderPage };
  document.addEventListener("DOMContentLoaded", renderPage);
  document.addEventListener("i18n:ready", renderPage);
})();
