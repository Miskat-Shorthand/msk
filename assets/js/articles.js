(function () {
  var INDEX_URL = "assets/articles-index.json";
  var FALLBACK_ORDER = ["en", "id", "ms"];
  var indexPromise = null;
  function fetchIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL).then(function (res) {
        if (!res.ok)
          throw new Error("HTTP " + res.status);
        return res.json();
      }).catch(function (err) {
        console.error("Failed to load articles index:", err);
        return [];
      });
    }
    return indexPromise;
  }
  function pickLang(entry) {
    var current = window.i18n ? window.i18n.lang() : "en";
    if (entry.langs[current]) {
      return { lang: current, data: entry.langs[current], isFallback: false };
    }
    for (var i = 0; i < FALLBACK_ORDER.length; i++) {
      var l = FALLBACK_ORDER[i];
      if (entry.langs[l]) {
        return { lang: l, data: entry.langs[l], isFallback: true };
      }
    }
    var any = Object.keys(entry.langs)[0];
    return { lang: any, data: entry.langs[any], isFallback: true };
  }
  var LOCALE_MAP = { en: "en-US", id: "id-ID", ms: "ms-MY" };
  function formatDate(dateStr) {
    var current = window.i18n ? window.i18n.lang() : "en";
    var locale = LOCALE_MAP[current] || "en-US";
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime()))
      return dateStr;
    var month = new Intl.DateTimeFormat(locale, { month: "long" }).format(d);
    var day = String(d.getDate()).padStart(2, "0");
    return month + " " + day + ", " + d.getFullYear();
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
        if (k === "class")
          e.className = attrs[k];
        else if (k === "html")
          e.innerHTML = attrs[k];
        else
          e.setAttribute(k, attrs[k]);
      });
    (children || []).forEach(function (c) { if (c)
      e.appendChild(c); });
    return e;
  }
  function text(tag, cls, str) {
    var e = document.createElement(tag);
    if (cls)
      e.className = cls;
    e.textContent = str;
    return e;
  }
  function renderRecentWidget(containerId, limit) {
    var wrap = document.getElementById(containerId);
    if (!wrap)
      return;
    fetchIndex().then(function (entries) {
      wrap.innerHTML = "";
      if (!entries.length) {
        wrap.appendChild(text("p", "article-empty", t("articles.empty", "No articles yet — check back soon.")));
        return;
      }
      entries.slice(0, limit || 5).forEach(function (entry) {
        var picked = pickLang(entry);
        var row = el("a", { class: "article-row", href: "article.html?slug=" + encodeURIComponent(entry.slug) }, [
          text("span", "article-row__date", formatDate(entry.date)),
          text("span", "article-row__title", picked.data.title)
        ]);
        wrap.appendChild(row);
      });
    });
  }
  var listState = { page: 1, tag: new URLSearchParams(location.search).get("tag") || null, pageSize: 8 };
  function tagHref(tag) {
    return "articles.html?tag=" + encodeURIComponent(tag);
  }
  function tagPill(tag) {
    var a = text("a", "article-tag-pill", tag);
    a.href = tagHref(tag);
    return a;
  }
  function setTag(tag) {
    listState.tag = tag;
    listState.page = 1;
    history.pushState(null, "", tag ? tagHref(tag) : "articles.html");
    renderList();
  }
  window.addEventListener("popstate", function () {
    listState.tag = new URLSearchParams(location.search).get("tag") || null;
    listState.page = 1;
    renderList();
  });
  function renderTagChips(entries) {
    var wrap = document.getElementById("articleTagChips");
    if (!wrap)
      return;
    var tagSet = [];
    entries.forEach(function (e) {
      (e.tags || []).forEach(function (tag) {
        if (tagSet.indexOf(tag) === -1)
          tagSet.push(tag);
      });
    });
    if (!tagSet.length) {
      wrap.innerHTML = "";
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    wrap.innerHTML = "";
    var allBtn = el("button", { class: "topic-chip article-tag" + (listState.tag === null ? " active" : "") }, []);
    allBtn.textContent = t("articles.tag.all", "All");
    allBtn.addEventListener("click", function () { setTag(null); });
    wrap.appendChild(allBtn);
    tagSet.forEach(function (tag) {
      var btn = el("button", { class: "topic-chip article-tag" + (listState.tag === tag ? " active" : "") }, []);
      btn.textContent = tag;
      btn.addEventListener("click", function () { setTag(tag); });
      wrap.appendChild(btn);
    });
  }
  function paginationRange(current, total) {
    var delta = 1, range = [];
    for (var i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - delta && i <= current + delta))
        range.push(i);
    }
    var withDots = [], prev = null;
    range.forEach(function (p) {
      if (prev !== null && p - prev > 1)
        withDots.push("…");
      withDots.push(p);
      prev = p;
    });
    return withDots;
  }
  var tagObserver = null;
  function fitTags(row) {
    var pills = Array.prototype.slice.call(row.querySelectorAll("a.article-tag-pill"));
    var oldMore = row.querySelector(".article-tag-more");
    if (oldMore)
      row.removeChild(oldMore);
    pills.forEach(function (p) { p.hidden = false; p.style.maxWidth = ""; });
    if (row.scrollWidth <= row.clientWidth)
      return;
    var more = text("span", "article-tag-pill article-tag-more", "\u2026");
    more.setAttribute("aria-hidden", "true");
    row.appendChild(more);
    var i = pills.length - 1;
    while (i > 0 && row.scrollWidth > row.clientWidth) {
      pills[i].hidden = true;
      i--;
    }
    if (pills.length && row.scrollWidth > row.clientWidth) {
      var gap = parseFloat(window.getComputedStyle(row).columnGap) || 0;
      pills[0].style.maxWidth = Math.max(0, row.clientWidth - more.offsetWidth - gap) + "px";
    }
  }
  function fitAllTags(scope) {
    var rows = scope.querySelectorAll(".article-card__tags");
    for (var i = 0; i < rows.length; i++)
      fitTags(rows[i]);
  }
  function watchTagRows(scope) {
    if (tagObserver) {
      tagObserver.disconnect();
      tagObserver = null;
    }
    fitAllTags(scope);
    if (window.ResizeObserver) {
      tagObserver = new ResizeObserver(function (changes) {
        changes.forEach(function (c) { fitTags(c.target); });
      });
      var rows = scope.querySelectorAll(".article-card__tags");
      for (var i = 0; i < rows.length; i++)
        tagObserver.observe(rows[i]);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { fitAllTags(scope); });
    }
  }
  if (!window.ResizeObserver) {
    window.addEventListener("resize", function () {
      var listEl = document.getElementById("articleList");
      if (listEl)
        fitAllTags(listEl);
    });
  }
  function renderCard(entry) {
    var picked = pickLang(entry);
    var cardClass = "article-card" + (entry.thumbnail ? " article-card--has-thumb" : "");
    var card = el("div", { class: cardClass }, []);
    if (entry.thumbnail) {
      card.appendChild(el("img", { class: "article-card__thumb", src: entry.thumbnail, alt: "", loading: "lazy" }, []));
    }
    var body = el("div", { class: "article-card__body" }, []);
    var titleEl = text("h3", "article-card__title", "");
    var titleLink = text("a", null, picked.data.title);
    titleLink.href = "article.html?slug=" + encodeURIComponent(entry.slug);
    titleEl.appendChild(titleLink);
    body.appendChild(titleEl);
    var meta = el("div", { class: "article-card__meta" }, [
      text("span", null, formatDate(entry.date)),
      text("span", "article-card__dot", "·"),
      text("span", null, picked.data.readMins + " " + t("articles.min-read", "min read"))
    ]);
    body.appendChild(meta);
    body.appendChild(text("p", "article-card__excerpt", picked.data.excerpt));
    if (entry.tags && entry.tags.length) {
      var tagRow = el("div", { class: "article-card__tags" }, []);
      entry.tags.forEach(function (tg) { tagRow.appendChild(tagPill(tg)); });
      body.appendChild(tagRow);
    }
    card.appendChild(body);
    return card;
  }
  function renderList() {
    fetchIndex().then(function (allEntries) {
      var listEl = document.getElementById("articleList");
      var pagEl = document.getElementById("articlePagination");
      if (!listEl)
        return;
      renderTagChips(allEntries);
      var entries = listState.tag
        ? allEntries.filter(function (e) { return (e.tags || []).indexOf(listState.tag) !== -1; })
        : allEntries;
      listEl.innerHTML = "";
      if (!entries.length) {
        listEl.appendChild(text("p", "article-empty", t("articles.empty", "No articles yet — check back soon.")));
        if (pagEl)
          pagEl.innerHTML = "";
        return;
      }
      var total = Math.max(1, Math.ceil(entries.length / listState.pageSize));
      if (listState.page > total)
        listState.page = total;
      var start = (listState.page - 1) * listState.pageSize;
      var pageEntries = entries.slice(start, start + listState.pageSize);
      pageEntries.forEach(function (entry) { listEl.appendChild(renderCard(entry)); });
      watchTagRows(listEl);
      if (pagEl) {
        pagEl.innerHTML = "";
        if (total > 1) {
          var prev = el("button", { class: "page-btn", "aria-label": "Previous page" }, []);
          prev.textContent = "\u2039";
          if (listState.page <= 1)
            prev.disabled = true;
          prev.addEventListener("click", function () { listState.page--; renderList(); });
          pagEl.appendChild(prev);
          paginationRange(listState.page, total).forEach(function (p) {
            if (p === "…") {
              pagEl.appendChild(text("span", "page-ellipsis", "…"));
              return;
            }
            var btn = el("button", { class: "page-btn" + (p === listState.page ? " active" : "") }, []);
            btn.textContent = String(p);
            if (p !== listState.page)
              btn.addEventListener("click", function () { listState.page = p; renderList(); });
            pagEl.appendChild(btn);
          });
          var next = el("button", { class: "page-btn", "aria-label": "Next page" }, []);
          next.textContent = "\u203a";
          if (listState.page >= total)
            next.disabled = true;
          next.addEventListener("click", function () { listState.page++; renderList(); });
          pagEl.appendChild(next);
        }
      }
    });
  }
  function authorInitials(name) {
    var parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length)
      return "?";
    var a = parts[0].charAt(0);
    var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (a + b).toUpperCase();
  }
  function findContributorById(id) {
    var rows = window.MSKContributors && window.MSKContributors.rows;
    if (!rows || !id)
      return null;
    var needle = id.trim().toLowerCase();
    return rows.filter(function (r) { return (r.id || "").trim().toLowerCase() === needle; })[0] || null;
  }
  function renderAuthorByline(entry) {
    var wrap = document.getElementById("articleAuthor");
    if (!wrap)
      return;
    if (!entry.author) {
      wrap.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    function attempt() {
      if (!window.MSKContributors)
        return false;
      var row = findContributorById(entry.author);
      if (!row) {
        wrap.hidden = true;
        wrap.innerHTML = "";
        return true;
      }
      var photo = row.__photoDataUrl
        ? el("img", { class: "article-author__photo", src: row.__photoDataUrl, alt: row.fullName || "" }, [])
        : el("span", { class: "article-author__photo article-author__photo--fallback" }, [
          text("span", null, authorInitials(row.fullName))
        ]);
      wrap.innerHTML = "";
      wrap.hidden = false;
      wrap.appendChild(el("div", { class: "article-author__inner" }, [
        photo,
        el("div", { class: "article-author__text" }, [
          text("span", "article-author__label", t("articles.author.by", "Written by")),
          text("span", "article-author__name", row.fullName || "")
        ])
      ]));
      return true;
    }
    if (!attempt()) {
      document.addEventListener("contributors:ready", function handler() {
        document.removeEventListener("contributors:ready", handler);
        attempt();
      });
    }
  }
  function renderArticlePage() {
    var body = document.getElementById("articleBody");
    if (!body)
      return;
    var params = new URLSearchParams(location.search);
    var slug = params.get("slug");
    var titleEl = document.getElementById("articleTitle");
    var metaEl = document.getElementById("articleMeta");
    var tagsEl = document.getElementById("articleTags");
    var authorEl = document.getElementById("articleAuthor");
    var noticeEl = document.getElementById("articleLangNotice");
    fetchIndex().then(function (entries) {
      var entry = entries.filter(function (e) { return e.slug === slug; })[0];
      if (!entry) {
        if (titleEl)
          titleEl.textContent = t("articles.notfound", "Article not found");
        if (metaEl)
          metaEl.textContent = "";
        body.innerHTML = "";
        if (noticeEl)
          noticeEl.hidden = true;
        if (authorEl) {
          authorEl.hidden = true;
          authorEl.innerHTML = "";
        }
        return;
      }
      var picked = pickLang(entry);
      document.title = picked.data.title + " — Miskat Shorthand";
      var descMeta = document.querySelector('meta[name="description"]');
      if (descMeta)
        descMeta.setAttribute("content", picked.data.excerpt);
      if (titleEl)
        titleEl.textContent = picked.data.title;
      if (metaEl) {
        metaEl.innerHTML = "";
        metaEl.appendChild(text("span", null, formatDate(entry.date)));
        metaEl.appendChild(text("span", "article-card__dot", "·"));
        metaEl.appendChild(text("span", null, picked.data.readMins + " " + t("articles.min-read", "min read")));
      }
      if (tagsEl) {
        tagsEl.innerHTML = "";
        (entry.tags || []).forEach(function (tg) { tagsEl.appendChild(tagPill(tg)); });
      }
      renderAuthorByline(entry);
      if (noticeEl) {
        noticeEl.hidden = !picked.isFallback;
      }
      fetch("articles/" + entry.folder + "/" + picked.lang + ".html")
        .then(function (res) { if (!res.ok)
        throw new Error("HTTP " + res.status); return res.text(); })
        .then(function (raw) {
        var stripped = raw.replace(/^\s*<!--\s*meta[\s\S]*?-->\s*/, "");
        body.innerHTML = stripped;
        rewriteRelativeImages(body, entry.folder);
      })
        .catch(function (err) {
        console.error("Failed to load article body:", err);
        body.innerHTML = "";
      });
    });
  }
  var ABSOLUTE_SRC_RE = /^([a-z][a-z0-9+.-]*:|\/\/|\/)/i;
  function rewriteRelativeImages(container, folder) {
    var imgs = container.querySelectorAll("img[src]");
    for (var i = 0; i < imgs.length; i++) {
      var raw = imgs[i].getAttribute("src");
      if (raw && !ABSOLUTE_SRC_RE.test(raw)) {
        imgs[i].setAttribute("src", "articles/" + folder + "/" + raw);
      }
    }
  }
  window.miskatArticles = {
    renderRecentWidget: renderRecentWidget,
    renderList: renderList,
    renderArticlePage: renderArticlePage
  };
  document.addEventListener("DOMContentLoaded", function () {
    renderRecentWidget("recentArticles", 5);
    renderList();
    renderArticlePage();
  });
  document.addEventListener("i18n:ready", function () {
    renderRecentWidget("recentArticles", 5);
    renderList();
    renderArticlePage();
  });
})();
