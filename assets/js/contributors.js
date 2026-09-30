(function () {
  var SHEET_NAME = "Contributor";
  var NEW_HIGHLIGHT_DAYS = 30;
  var INDEX_LIMIT = 12;
  var TESTIMONIAL_INTERVAL_MS = 6000;
  var TESTIMONIAL_FADE_MS = 320;
  var COL_PHOTO = "photo";
  var IMAGE_KEYS = [COL_PHOTO];
  var testimonialTimer = null;
  var testimonialIndex = 0;
  var CANONICAL_COLUMNS = [
    { key: "id", test: /^id[_\s]*\(not-?shown\)$/i },
    { key: "fullName", test: /^full-?name$/i },
    { key: "flag", test: /^flag-?origin-?emoji$/i },
    { key: "status", test: /^membership-?stat\.?$/i },
    { key: "joinDate", test: /^date-?of-?joining$/i },
    { key: "nickname", test: /^nickname$/i },
    { key: "bioEn", test: /^en-?bio$/i },
    { key: "bioId", test: /^id-?bio$/i },
    { key: "bioMs", test: /^ms-?bio$/i },
    { key: COL_PHOTO, test: /^profil-?pic.*$/i },
    { key: "roleEn", test: /^role-?en$/i },
    { key: "roleId", test: /^role-?id$/i },
    { key: "roleMs", test: /^role-?ms$/i },
    { key: "detailedRoleEn", test: /^detailed-?role-?en$/i },
    { key: "detailedRoleId", test: /^detailed-?role-?id$/i },
    { key: "detailedRoleMs", test: /^detailed-?role-?ms$/i },
    { key: "web", test: /^personal-?web$/i },
    { key: "twitter", test: /^twitter-?url$/i },
    { key: "instagram", test: /^instagram-?url$/i },
    { key: "github", test: /^github-?url$/i },
    { key: "locationEn", test: /^location-?en$/i },
    { key: "locationId", test: /^location-?id$/i },
    { key: "locationMs", test: /^location-?ms$/i },
    { key: "skills", test: /^your-?skill\(?s?\)?$/i },
    { key: "eduEn", test: /^en-?edu.*$/i },
    { key: "eduId", test: /^id-?edu.*$/i },
    { key: "eduMs", test: /^ms-?edu.*$/i },
    { key: "quoteEn", test: /^testimonial-?quote-?en$/i },
    { key: "quoteId", test: /^testimonial-?quote-?id$/i },
    { key: "quoteMs", test: /^testimonial-?quote-?ms$/i }
  ];
  function normalizeHeader(h) {
    return (h || "").replace(/^\uFEFF/, "").replace(/\u00A0/g, " ").trim().replace(/\s+/g, " ");
  }
  function canonicalHeader(h) {
    var n = normalizeHeader(h);
    if (!n)
      return null;
    if (/^email/i.test(n))
      return null;
    if (/^[b-d]$/i.test(n))
      return null;
    for (var i = 0; i < CANONICAL_COLUMNS.length; i++) {
      if (CANONICAL_COLUMNS[i].test.test(n))
        return CANONICAL_COLUMNS[i].key;
    }
    return null;
  }
  var NS = {
    rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    pkgRel: "http://schemas.openxmlformats.org/package/2006/relationships",
    sml: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main"
  };
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "text")
          e.textContent = attrs[k];
        else if (k === "html")
          e.innerHTML = attrs[k];
        else
          e.setAttribute(k, attrs[k]);
      });
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function t(key, fallback) {
    if (window.i18n && window.i18n.t) {
      var val = window.i18n.t(key);
      return (val === key) ? fallback : val;
    }
    return fallback;
  }
  function parseXml(text) { return new DOMParser().parseFromString(text, "application/xml"); }
  function firstByNS(node, ns, local) { var l = node.getElementsByTagNameNS(ns, local); return l.length ? l[0] : null; }
  function resolveRelTarget(ownerFilePath, target) {
    if (target.indexOf("/") === 0)
      return target.slice(1);
    var dir = ownerFilePath.split("/");
    dir.pop();
    target.split("/").forEach(function (p) {
      if (p === "..")
        dir.pop();
      else if (p === "." || p === "") { }
      else
        dir.push(p);
    });
    return dir.join("/");
  }
  function relsPathFor(filePath) {
    var parts = filePath.split("/");
    var name = parts.pop();
    parts.push("_rels");
    parts.push(name + ".rels");
    return parts.join("/");
  }
  function readXmlFile(zip, path) {
    var f = zip.file(path);
    if (!f)
      return Promise.resolve(null);
    return f.async("string").then(parseXml);
  }
  function relTargetById(relsDoc, id) {
    var rels = relsDoc.getElementsByTagNameNS(NS.pkgRel, "Relationship");
    for (var i = 0; i < rels.length; i++)
      if (rels[i].getAttribute("Id") === id)
        return rels[i].getAttribute("Target");
    return null;
  }
  function mapSheetNamesToPaths(zip) {
    var workbookPath = "xl/workbook.xml";
    return readXmlFile(zip, workbookPath).then(function (wbDoc) {
      if (!wbDoc)
        return {};
      return readXmlFile(zip, relsPathFor(workbookPath)).then(function (relsDoc) {
        var map = {};
        if (!wbDoc || !relsDoc)
          return map;
        var sheetEls = wbDoc.getElementsByTagNameNS(NS.sml, "sheet");
        for (var i = 0; i < sheetEls.length; i++) {
          var name = sheetEls[i].getAttribute("name");
          var rId = sheetEls[i].getAttributeNS(NS.rel, "id");
          var target = rId ? relTargetById(relsDoc, rId) : null;
          if (name && target)
            map[name] = resolveRelTarget(workbookPath, target);
        }
        return map;
      });
    });
  }
  function extractSheetImages(zip, sheetXmlPath) {
    return readXmlFile(zip, sheetXmlPath).then(function (sheetDoc) {
      if (!sheetDoc)
        return {};
      var drawingEl = firstByNS(sheetDoc, NS.sml, "drawing");
      if (!drawingEl)
        return {};
      var rId = drawingEl.getAttributeNS(NS.rel, "id");
      if (!rId)
        return {};
      return readXmlFile(zip, relsPathFor(sheetXmlPath)).then(function (sheetRelsDoc) {
        var drawingTarget = sheetRelsDoc ? relTargetById(sheetRelsDoc, rId) : null;
        if (!drawingTarget)
          return {};
        var drawingPath = resolveRelTarget(sheetXmlPath, drawingTarget);
        return readXmlFile(zip, drawingPath).then(function (drawingDoc) {
          if (!drawingDoc)
            return {};
          var blips = drawingDoc.getElementsByTagNameNS(NS.a, "blip");
          var anchors = [];
          for (var i = 0; i < blips.length; i++) {
            var blip = blips[i];
            var embedId = blip.getAttributeNS(NS.rel, "embed");
            if (!embedId)
              continue;
            var node = blip.parentNode;
            var fromEl = null;
            while (node && node.nodeType === 1) {
              if (["twoCellAnchor", "oneCellAnchor", "absoluteAnchor"].indexOf(node.localName) !== -1) {
                fromEl = firstByNS(node, NS.xdr, "from");
                break;
              }
              node = node.parentNode;
            }
            if (!fromEl)
              continue;
            var colEl = firstByNS(fromEl, NS.xdr, "col");
            var rowEl = firstByNS(fromEl, NS.xdr, "row");
            if (!colEl || !rowEl)
              continue;
            anchors.push({ row: parseInt(rowEl.textContent, 10), col: parseInt(colEl.textContent, 10), embedId: embedId });
          }
          if (!anchors.length)
            return {};
          return readXmlFile(zip, relsPathFor(drawingPath)).then(function (drawingRelsDoc) {
            if (!drawingRelsDoc)
              return {};
            var mediaJobs = anchors.map(function (a) {
              var target = relTargetById(drawingRelsDoc, a.embedId);
              if (!target)
                return Promise.resolve(null);
              var mediaPath = resolveRelTarget(drawingPath, target);
              var mf = zip.file(mediaPath);
              if (!mf)
                return Promise.resolve(null);
              var ext = (mediaPath.split(".").pop() || "png").toLowerCase();
              var mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" }[ext] || "application/octet-stream";
              return mf.async("base64").then(function (b64) { return { key: a.row + "_" + a.col, dataUrl: "data:" + mime + ";base64," + b64 }; });
            });
            return Promise.all(mediaJobs).then(function (results) {
              var map = {};
              results.forEach(function (r) { if (r)
                map[r.key] = r.dataUrl; });
              return map;
            });
          });
        });
      });
    }).catch(function () { return {}; });
  }
  function rowsFromSheetJson(aoa) {
    if (!aoa || !aoa.length)
      return { headers: [], rows: [] };
    var headers = aoa[0].map(function (h) { return canonicalHeader((h || "").toString()); });
    var rows = [];
    aoa.slice(1).forEach(function (r, i) {
      var obj = {};
      headers.forEach(function (h, idx) {
        if (!h)
          return;
        var v = r[idx];
        obj[h] = (v === undefined || v === null) ? "" : String(v).trim();
      });
      if (!obj.fullName)
        return;
      obj.__srcRow = i + 1;
      rows.push(obj);
    });
    return { headers: headers, rows: rows };
  }
  function loadContributorSheet(sd) {
    if (!sd)
      return Promise.resolve({ ok: false, rows: [] });
    var parsed = rowsFromSheetJson(sd.values);
    var imageColIdx = {};
    IMAGE_KEYS.forEach(function (k) { imageColIdx[k] = parsed.headers.indexOf(k); });
    return Promise.resolve(sd.images || {}).then(function (imgMap) {
      parsed.rows.forEach(function (rowObj) {
        IMAGE_KEYS.forEach(function (k) {
          var colIdx = imageColIdx[k];
          if (colIdx === -1)
            return;
          var found = imgMap[rowObj.__srcRow + "_" + colIdx];
          if (found)
            rowObj["__img_" + k] = found;
        });
        rowObj.__photoDataUrl = rowObj.__img_photo;
      });
      return { ok: true, rows: parsed.rows };
    });
  }
  function normStatus(v) {
    var s = (v || "").trim().toLowerCase().replace(/\s+/g, "-");
    return s;
  }
  function daysSinceJoin(joinDateRaw) {
    if (!joinDateRaw)
      return null;
    var d = new Date(joinDateRaw);
    if (isNaN(d.getTime()))
      return null;
    return (Date.now() - d.getTime()) / 86400000;
  }
  function statusRank(row) {
    var status = normStatus(row.status);
    if (status === "active")
      return 10;
    if (status === "new") {
      var days = daysSinceJoin(row.joinDate);
      if (days !== null && days <= NEW_HIGHLIGHT_DAYS)
        return 5;
      return 11;
    }
    return 99;
  }
  function isNewBadge(row) {
    return normStatus(row.status) === "new";
  }
  function buildIndexList(rows) {
    return rows
      .map(function (r, i) { return { row: r, rank: statusRank(r), order: i }; })
      .filter(function (x) { return x.rank < 99; })
      .sort(function (a, b) { return a.rank - b.rank || a.order - b.order; })
      .map(function (x) { return x.row; });
  }
  function buildAboutBuckets(rows) {
    var buckets = { emeritus: [], onHiatus: [], alumni: [] };
    rows.forEach(function (r) {
      var status = normStatus(r.status);
      if (status === "emeritus")
        buckets.emeritus.push(r);
      else if (status === "on-hiatus")
        buckets.onHiatus.push(r);
      else if (status === "alumni")
        buckets.alumni.push(r);
    });
    return buckets;
  }
  function initials(name) {
    var parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length)
      return "?";
    var a = parts[0].charAt(0);
    var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (a + b).toUpperCase();
  }
  function currentRole(row) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    if (lang === "id")
      return row.roleId || row.roleEn || row.roleMs || "";
    if (lang === "ms")
      return row.roleMs || row.roleEn || row.roleId || "";
    return row.roleEn || row.roleId || row.roleMs || "";
  }
  function currentBio(row) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    if (lang === "id")
      return row.bioId || row.bioEn || row.bioMs || "";
    if (lang === "ms")
      return row.bioMs || row.bioEn || row.bioId || "";
    return row.bioEn || row.bioId || row.bioMs || "";
  }
  function currentLocation(row) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    if (lang === "id")
      return row.locationId || row.locationEn || row.locationMs || "";
    if (lang === "ms")
      return row.locationMs || row.locationEn || row.locationId || "";
    return row.locationEn || row.locationId || row.locationMs || "";
  }
  function currentQuote(row) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    if (lang === "id")
      return row.quoteId || row.quoteEn || row.quoteMs || "";
    if (lang === "ms")
      return row.quoteMs || row.quoteEn || row.quoteId || "";
    return row.quoteEn || row.quoteId || row.quoteMs || "";
  }
  function currentDetailedRole(row) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    if (lang === "id")
      return row.detailedRoleId || row.detailedRoleEn || row.detailedRoleMs || "";
    if (lang === "ms")
      return row.detailedRoleMs || row.detailedRoleEn || row.detailedRoleId || "";
    return row.detailedRoleEn || row.detailedRoleId || row.detailedRoleMs || "";
  }
  var EDU_LOGO_RE = /^\[\s*(https?:\/\/[^\]\s]+)\s*\]\s*(.*)$/i;
  function parseEduCell(raw) {
    if (!raw)
      return [];
    return raw.split(";").map(function (s) { return s.trim(); }).filter(Boolean).map(function (part) {
      var m = EDU_LOGO_RE.exec(part);
      return m ? { logo: m[1], text: m[2].trim() } : { logo: null, text: part };
    });
  }
  function currentEduTiers(row) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    var order = lang === "id" ? ["Id", "En", "Ms"] : lang === "ms" ? ["Ms", "En", "Id"] : ["En", "Id", "Ms"];
    for (var i = 0; i < order.length; i++) {
      var raw = row["edu" + order[i]];
      if (raw)
        return parseEduCell(raw);
    }
    return [];
  }
  function eduLogoNode(item) {
    if (!item.logo)
      return el("span", { class: "about-contributor-card__edu-icon", html: svgEduIcon() });
    var img = el("img", { class: "about-contributor-card__edu-logo", src: item.logo, alt: item.text || "", loading: "lazy" });
    img.addEventListener("error", function () {
      if (!img.parentNode)
        return;
      img.parentNode.replaceChild(el("span", { class: "about-contributor-card__edu-icon", html: svgEduIcon() }), img);
    });
    return img;
  }
  function secondaryLine(row) {
    var parts = [];
    if (row.nickname)
      parts.push(row.nickname);
    var role = currentRole(row);
    if (role)
      parts.push(role);
    var loc = currentLocation(row);
    if (!parts.length && loc)
      parts.push(loc);
    return parts.join(" · ");
  }
  function photoNode(row) {
    var img = row.__photoDataUrl
      ? el("img", { class: "contributor-row__avatar", src: row.__photoDataUrl, alt: row.fullName || "", loading: "lazy" })
      : el("div", { class: "contributor-row__avatar contributor-row__avatar--fallback", text: initials(row.fullName) });
    var wrap = el("div", { class: "contributor-row__photo" }, [img]);
    if (row.flag)
      wrap.appendChild(el("span", { class: "contributor-row__flag", text: row.flag }));
    return wrap;
  }
  function contributorRow(row) {
    var line1Children = [el("span", { class: "contributor-row__name", text: row.fullName || "" })];
    if (isNewBadge(row)) {
      line1Children.push(el("span", { class: "contributor-row__badge-new", text: t("index.contrib.badge.new", "New") }));
    }
    var body = el("div", { class: "contributor-row__body" }, [el("div", { class: "contributor-row__line1" }, line1Children)]);
    var line2Text = secondaryLine(row);
    if (line2Text)
      body.appendChild(el("div", { class: "contributor-row__line2", text: line2Text }));
    return el("div", { class: "contributor-row" }, [photoNode(row), body]);
  }
  function moreRow(count) {
    return el("div", { class: "contributor-row contributor-row--more" }, [
      el("span", { text: "+" + count + " " + t("index.contrib.more", "lainnya") })
    ]);
  }
  function svgEduIcon() {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M6 10.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5.5"/></svg>';
  }
  function detailedRoleTiers(row) {
    var raw = currentDetailedRole(row);
    if (!raw)
      return [];
    return raw.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function tierMarkerNode() {
    var svgNs = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 10 10");
    svg.setAttribute("aria-hidden", "true");
    var circle = document.createElementNS(svgNs, "circle");
    circle.setAttribute("cx", "5");
    circle.setAttribute("cy", "5");
    circle.setAttribute("r", "4");
    svg.appendChild(circle);
    return el("span", { class: "about-contributor-card__tier-marker" }, [svg]);
  }
  function skillChips(row) {
    if (!row.skills)
      return [];
    return row.skills.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function safeHttpUrl(raw) {
    if (!raw)
      return "";
    var v = String(raw).trim();
    try {
      var u = new URL(v, "https://invalid.example/");
      if ((u.protocol === "http:" || u.protocol === "https:") && /^https?:\/\//i.test(v))
        return u.href;
    } catch (e) { }
    return "";
  }
  function aboutLinkList(row) {
    var defs = [
      { key: "web", label: t("about.contrib.link.web", "Website") },
      { key: "github", label: "GitHub" },
      { key: "twitter", label: "Twitter/X" },
      { key: "instagram", label: "Instagram" }
    ];
    var links = [];
    defs.forEach(function (d) {
      var href = safeHttpUrl(row[d.key]);
      if (!href)
        return;
      links.push(el("a", { class: "about-contributor-card__link", href: href, target: "_blank", rel: "noopener noreferrer", text: d.label }));
    });
    return links;
  }
  function renderAboutCurrentList(rows) {
    var section = document.getElementById("contributorsCurrentSection");
    var list = document.getElementById("contributorsCurrentList");
    if (!section || !list)
      return;
    var items = buildIndexList(rows);
    if (!items.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    list.className = "about-contributor-grid";
    list.innerHTML = "";
    items.forEach(function (row) {
      var badge = isNewBadge(row) ? { text: t("index.contrib.badge.new", "New"), cls: "about-contributor-card__badge--new" } : null;
      list.appendChild(aboutContributorCard(row, { badge: badge, showQuote: false }));
    });
  }
  function aboutContributorCard(row, opts) {
    opts = opts || {};
    var headerChildren = [photoNode(row)];
    var nameLine = [el("span", { class: "about-contributor-card__name", text: row.fullName || "" })];
    if (opts.badge)
      nameLine.push(el("span", { class: "about-contributor-card__badge " + opts.badge.cls, text: opts.badge.text }));
    var identity = [el("div", { class: "about-contributor-card__name-line" }, nameLine)];
    if (row.nickname)
      identity.push(el("div", { class: "about-contributor-card__nickname", text: row.nickname }));
    var role = currentRole(row);
    if (role)
      identity.push(el("span", { class: "about-contributor-card__role", text: role }));
    headerChildren.push(el("div", { class: "about-contributor-card__identity" }, identity));
    var card = [el("div", { class: "about-contributor-card__header" }, headerChildren)];
    var bioText = currentBio(row);
    if (bioText)
      card.push(el("p", { class: "about-contributor-card__bio", text: bioText }));
    var tiers = detailedRoleTiers(row);
    if (tiers.length) {
      var tierNodes = tiers.map(function (tierText) {
        return el("li", { class: "about-contributor-card__tier" }, [
          tierMarkerNode(),
          el("span", { class: "about-contributor-card__tier-text", text: tierText })
        ]);
      });
      card.push(el("ul", { class: "about-contributor-card__tiers" }, tierNodes));
    }
    var eduTiers = currentEduTiers(row);
    if (eduTiers.length) {
      var eduItemNodes = eduTiers.map(function (item) {
        var itemChildren = [eduLogoNode(item)];
        if (item.text)
          itemChildren.push(el("span", { class: "about-contributor-card__edu-text", text: item.text }));
        return el("li", { class: "about-contributor-card__edu-item" }, itemChildren);
      });
      card.push(el("ul", { class: "about-contributor-card__edu-list" }, eduItemNodes));
    }
    var aboutQuoteText = currentQuote(row);
    if (opts.showQuote && aboutQuoteText) {
      card.push(el("p", { class: "about-contributor-card__quote", text: "\u201C" + aboutQuoteText + "\u201D" }));
    }
    var metaBits = [];
    var aboutLoc = currentLocation(row);
    if (aboutLoc)
      metaBits.push(el("span", { class: "about-contributor-card__meta-item" }, [
        el("span", { class: "about-contributor-card__meta-icon", text: "\uD83D\uDCCD" }),
        el("span", { text: aboutLoc })
      ]));
    var chips = skillChips(row);
    if (chips.length) {
      chips.forEach(function (c) { metaBits.push(el("span", { class: "about-contributor-card__chip", text: c })); });
    }
    if (metaBits.length)
      card.push(el("div", { class: "about-contributor-card__meta" }, metaBits));
    var links = aboutLinkList(row);
    if (links.length)
      card.push(el("div", { class: "about-contributor-card__links" }, links));
    return el("article", { class: "about-contributor-card" }, card);
  }
  function renderAboutSection(sectionId, listId, items, badge, showQuote) {
    var section = document.getElementById(sectionId);
    var list = document.getElementById(listId);
    if (!section || !list)
      return;
    if (!items.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    list.className = "about-contributor-grid";
    list.innerHTML = "";
    items.forEach(function (row) { list.appendChild(aboutContributorCard(row, { badge: badge, showQuote: showQuote })); });
  }
  function renderAboutBuckets(buckets) {
    var wrapper = document.getElementById("contributorsAboutSection");
    var appreciatedTotal = buckets.emeritus.length + buckets.onHiatus.length + buckets.alumni.length;
    if (wrapper)
      wrapper.hidden = (appreciatedTotal === 0);
    renderAboutSection("emeritusSection", "emeritusList", buckets.emeritus, { text: t("about.contrib.emeritus.badge", "Emeritus"), cls: "about-contributor-card__badge--emeritus" }, true);
    renderAboutSection("hiatusSection", "hiatusList", buckets.onHiatus, { text: t("about.contrib.hiatus.badge", "On hiatus"), cls: "about-contributor-card__badge--hiatus" }, false);
    renderAboutSection("alumniSection", "alumniList", buckets.alumni, null, false);
  }
  function buildTestimonialList(rows) {
    return rows.filter(function (r) {
      return normStatus(r.status) !== "inactive" && !!currentQuote(r);
    });
  }
  function testimonialCard(row) {
    var quoteText = currentQuote(row);
    var captionParts = [];
    var role = currentRole(row);
    if (role)
      captionParts.push(role);
    var loc = currentLocation(row);
    if (loc)
      captionParts.push(loc);
    var captionText = captionParts.join(" · ") || row.nickname || "";
    var content = [
      el("p", { class: "testimonial-card__name", text: row.fullName || "" }),
      el("p", { class: "testimonial-card__quote", text: quoteText })
    ];
    if (captionText)
      content.push(el("p", { class: "testimonial-card__caption", text: captionText }));
    return el("div", { class: "testimonial-card" }, [
      el("div", { class: "testimonial-card__content" }, content)
    ]);
  }
  function stopTestimonialRotation() {
    if (testimonialTimer) {
      clearInterval(testimonialTimer);
      testimonialTimer = null;
    }
  }
  function startTestimonialRotation(wrap, list) {
    stopTestimonialRotation();
    if (list.length < 2)
      return;
    testimonialTimer = setInterval(function () {
      wrap.classList.add("testimonial-carousel--fading");
      setTimeout(function () {
        testimonialIndex = (testimonialIndex + 1) % list.length;
        wrap.innerHTML = "";
        wrap.appendChild(testimonialCard(list[testimonialIndex]));
        wrap.classList.remove("testimonial-carousel--fading");
      }, TESTIMONIAL_FADE_MS);
    }, TESTIMONIAL_INTERVAL_MS);
  }
  function renderTestimonials(rows) {
    var section = document.getElementById("testimonialSection");
    var wrap = document.getElementById("testimonialCarousel");
    if (!section || !wrap)
      return;
    var list = buildTestimonialList(rows);
    window.MSKTestimonials = list;
    if (!list.length) {
      section.hidden = true;
      stopTestimonialRotation();
      return;
    }
    section.hidden = false;
    if (testimonialIndex >= list.length)
      testimonialIndex = 0;
    wrap.innerHTML = "";
    wrap.appendChild(testimonialCard(list[testimonialIndex]));
    startTestimonialRotation(wrap, list);
  }
  function render(rows) {
    var section = document.getElementById("contributorsSection");
    var wrap = document.getElementById("contributorGrid");
    if (!wrap || !section)
      return;
    var list = buildIndexList(rows);
    if (!list.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    wrap.className = "contributor-list";
    wrap.innerHTML = "";
    var shown = list.slice(0, INDEX_LIMIT);
    shown.forEach(function (row) { wrap.appendChild(contributorRow(row)); });
    if (list.length > INDEX_LIMIT)
      wrap.appendChild(moreRow(list.length - INDEX_LIMIT));
  }
  function loadData() {
    window.mskFetchData()
      .then(function (data) { return loadContributorSheet(data[SHEET_NAME]); })
      .then(function (result) {
      if (!result.ok)
        return;
      var buckets = buildAboutBuckets(result.rows);
      window.MSKContributors = {
        rows: result.rows,
        indexList: buildIndexList(result.rows),
        aboutBuckets: buckets
      };
      render(result.rows);
      renderAboutCurrentList(result.rows);
      renderAboutBuckets(buckets);
      renderTestimonials(result.rows);
      document.dispatchEvent(new CustomEvent("contributors:ready", { detail: { rows: result.rows } }));
    })
      .catch(function () { });
  }
  document.addEventListener("DOMContentLoaded", loadData);
  document.addEventListener("i18n:ready", function () {
    if (window.MSKContributors && window.MSKContributors.rows) {
      render(window.MSKContributors.rows);
      renderAboutCurrentList(window.MSKContributors.rows);
      renderAboutBuckets(window.MSKContributors.aboutBuckets);
      renderTestimonials(window.MSKContributors.rows);
    }
  });
})();
