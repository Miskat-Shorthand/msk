(function () {
  var SHEETS = ["Indonesian & Malay"];
  var COL_WORD_ID = "Indonesian";
  var COL_WORD_MS = "Malay";
  var COL_LANG = "lang";
  var COL_STROKE = "Stroke";
  var COL_BRIEF = "msk-brief";
  var COL_KEY_ID = "key-id";
  var COL_KEY_MS = "key-ms";
  var COL_FOREIGN = "Foreign";
  var IMG_COLS = [COL_STROKE, COL_BRIEF, COL_KEY_ID, COL_KEY_MS];
  var RTL_OR_NONITALIC_LANGS = ["ar", "he", "fa", "ur"];
  var CANONICAL_COLUMNS = [
    { key: COL_WORD_ID, test: /^indonesian$/i },
    { key: COL_WORD_MS, test: /^malay$/i },
    { key: COL_LANG, test: /^lang$/i },
    { key: COL_STROKE, test: /^stroke$/i },
    { key: COL_BRIEF, test: /^msk-?brief$/i },
    { key: COL_KEY_ID, test: /^key-?id$/i },
    { key: COL_KEY_MS, test: /^key-?ms$/i },
    { key: COL_FOREIGN, test: /^foreign$/i },
    { key: "en-Topic", test: /^en-?topic$/i },
    { key: "id-Topic", test: /^id-?topic$/i },
    { key: "my-Topic", test: /^my-?topic$/i },
    { key: "Info-en", test: /^info-?en$/i },
    { key: "Info-id", test: /^info-?id$/i },
    { key: "Info-ms", test: /^info-?ms$/i }
  ];
  function normalizeHeader(h) {
    return (h || "")
      .replace(/^\uFEFF/, "")
      .replace(/\u00A0/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }
  function canonicalHeader(h) {
    var n = normalizeHeader(h);
    if (!n)
      return null;
    if (/^dup/i.test(n))
      return null;
    for (var i = 0; i < CANONICAL_COLUMNS.length; i++) {
      if (CANONICAL_COLUMNS[i].test.test(n))
        return CANONICAL_COLUMNS[i].key;
    }
    return n;
  }
  function pickForFilter(r, filter, idCol, msCol) {
    var idVal = (r[idCol] || "").trim();
    var msVal = (r[msCol] || "").trim();
    if (filter === "id")
      return { text: idVal || msVal, imgCol: idVal ? idCol : msCol };
    if (filter === "ms")
      return { text: msVal || idVal, imgCol: msVal ? msCol : idCol };
    if (idVal && msVal && idVal !== msVal)
      return { text: idVal + "/" + msVal, imgCol: idCol };
    return { text: idVal || msVal, imgCol: idVal ? idCol : msCol };
  }
  function foreignLangCode(r) {
    var tag = (r[COL_LANG] || "").trim();
    if (!tag)
      return null;
    var codes = tag.toLowerCase().split(/[;,]/).map(function (s) { return s.trim(); });
    for (var i = 0; i < codes.length; i++) {
      if (codes[i] && codes[i] !== "id" && codes[i] !== "ms")
        return codes[i];
    }
    return null;
  }
  function foreignInfo(r) {
    var val = (r[COL_FOREIGN] || "").trim();
    if (!val)
      return null;
    var code = foreignLangCode(r) || "en";
    return { code: code, val: val };
  }
  function isForeignOnlyRow(r) {
    return !(r[COL_WORD_ID] || "").trim() && !(r[COL_WORD_MS] || "").trim() && !!foreignInfo(r);
  }
  function foreignLine(code, val) {
    var isItalic = RTL_OR_NONITALIC_LANGS.indexOf(code) === -1;
    var textNode = isItalic ? el("i", { class: "word-line-text word-foreign-text", text: val })
      : el("span", { class: "word-line-text word-foreign-text", text: val, dir: "rtl" });
    return el("div", { class: "word-line word-line-foreign" }, [
      el("span", { class: "lang-badge lang-badge-foreign", text: code.toUpperCase() }),
      textNode
    ]);
  }
  function matchesLangFilter(r, filter) {
    if (filter === "all")
      return true;
    if (filter === "foreign")
      return !!foreignInfo(r);
    var tag = (r[COL_LANG] || "").trim();
    if (!tag)
      return true;
    var codes = tag.toLowerCase().split(/[;,]/).map(function (s) { return s.trim(); });
    return codes.indexOf(filter) !== -1;
  }
  var LANG_COLS = {
    en: { topic: "en-Topic", info: "Info-en" },
    id: { topic: "id-Topic", info: "Info-id" },
    ms: { topic: "my-Topic", info: "Info-ms" }
  };
  var NS = {
    rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    pkgRel: "http://schemas.openxmlformats.org/package/2006/relationships",
    sml: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main"
  };
  var PAGE_SIZE = 80;
  var QUIZ_COLS = ["word", "stroke", "brief", "keyboard"];
  var QUIZ_MASK_COLS = ["word", "stroke", "brief", "keyboard"];
  var state = {
    rows: [], topic: "", loadErrors: [], page: 1, langFilter: "all",
    showForeign: false,
    quiz: { active: false, display: "blur", cols: { word: false, stroke: false, brief: false, keyboard: false }, tableVisible: true },
    shuffle: { active: false, seed: 1 }
  };
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, seed) {
    var a = arr.slice();
    var rand = mulberry32(seed);
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }
  function currentLangCols() {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    return LANG_COLS[lang] || LANG_COLS.en;
  }
  function isPhraseVal(v) {
    return /\s/.test((v || "").trim());
  }
  function wordLine(langTag, val) {
    return el("div", { class: "word-line word-line-" + langTag.toLowerCase() }, [
      el("span", { class: "lang-badge lang-badge-" + langTag.toLowerCase(), text: langTag }),
      el("span", { class: "word-line-text", text: val || "—" })
    ]);
  }
  function wordFieldNode(r, filter) {
    var pick = pickForFilter(r, filter, COL_WORD_ID, COL_WORD_MS);
    var foreign = state.showForeign ? foreignInfo(r) : null;
    var lines = null;
    if (filter === "all") {
      var idVal = (r[COL_WORD_ID] || "").trim();
      var msVal = (r[COL_WORD_MS] || "").trim();
      if (idVal && msVal && idVal !== msVal && (isPhraseVal(idVal) || isPhraseVal(msVal))) {
        lines = [wordLine("ID", idVal), wordLine("MS", msVal)];
      }
    }
    if (!foreign && !lines)
      return el("span", { class: "word-card-word-text", text: pick.text || "" });
    if (!lines)
      lines = [el("div", { class: "word-line" }, [el("span", { class: "word-line-text", text: pick.text || "" })])];
    if (foreign)
      lines.push(foreignLine(foreign.code, foreign.val));
    return el("div", { class: "word-dual-cell" }, lines);
  }
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
  function isImageUrl(val) {
    return /^https?:\/\//i.test(val) && /\.(png|jpe?g|svg|gif|webp)(\?.*)?$/i.test(val);
  }
  function imgKey(colName) { return "__img__" + colName; }
  function topicFieldNode(rawValue) {
    var topics = topicList(rawValue);
    if (!topics.length)
      return el("div", { class: "word-card-topics topic-tags" });
    return el("div", { class: "word-card-topics topic-tags" }, topics.map(function (topic) { return el("span", { class: "topic-tag", text: topic }); }));
  }
  function glyphOrImageNode(val, altText, imgOverride) {
    if (imgOverride) {
      return el("div", { class: "glyph-cell" }, [el("img", { src: imgOverride, alt: altText || "", loading: "lazy" })]);
    }
    if (val && isImageUrl(val)) {
      return el("div", { class: "glyph-cell" }, [el("img", { src: val, alt: altText || "", loading: "lazy" })]);
    }
    return el("div", { class: "glyph-cell", text: val || "—" });
  }
  function miniField(labelKey, labelFallback, contentNode, colKey) {
    var valueWrap = el("div", { class: "mini-value" }, [contentNode]);
    markQuizCell(valueWrap, colKey);
    var field = el("div", { class: "mini-field" }, [
      el("div", { class: "mini-label", text: t(labelKey, labelFallback) }),
      valueWrap
    ]);
    field.setAttribute("data-col", colKey);
    return field;
  }
  function keyLine(langTag, val, imgOverride, altText) {
    var valueNode = imgOverride
      ? el("img", { src: imgOverride, alt: altText || "", loading: "lazy", class: "key-line-img" })
      : el("span", { class: "key-line-text", text: val || "—" });
    return el("div", { class: "key-line key-line-" + langTag.toLowerCase() }, [
      el("span", { class: "lang-badge lang-badge-" + langTag.toLowerCase(), text: langTag }),
      valueNode
    ]);
  }
  function keyFieldNode(r, filter, wordText) {
    if (filter !== "all") {
      var single = pickForFilter(r, filter, COL_KEY_ID, COL_KEY_MS);
      return glyphOrImageNode(single.text, wordText, r[imgKey(single.imgCol)]);
    }
    var idVal = (r[COL_KEY_ID] || "").trim();
    var msVal = (r[COL_KEY_MS] || "").trim();
    if (!idVal || !msVal || idVal === msVal) {
      var pick = pickForFilter(r, "all", COL_KEY_ID, COL_KEY_MS);
      return glyphOrImageNode(pick.text, wordText, r[imgKey(pick.imgCol)]);
    }
    return el("div", { class: "glyph-cell key-dual-cell" }, [
      keyLine("ID", idVal, r[imgKey(COL_KEY_ID)], wordText),
      keyLine("MS", msVal, r[imgKey(COL_KEY_MS)], wordText)
    ]);
  }
  function parseXml(text) {
    return new DOMParser().parseFromString(text, "application/xml");
  }
  function firstByNS(node, ns, local) {
    var list = node.getElementsByTagNameNS(ns, local);
    return list.length ? list[0] : null;
  }
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
    for (var i = 0; i < rels.length; i++) {
      if (rels[i].getAttribute("Id") === id)
        return rels[i].getAttribute("Target");
    }
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
            anchors.push({
              row: parseInt(rowEl.textContent, 10),
              col: parseInt(colEl.textContent, 10),
              embedId: embedId
            });
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
              return mf.async("base64").then(function (b64) {
                return { key: a.row + "_" + a.col, dataUrl: "data:" + mime + ";base64," + b64 };
              });
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
      if (!obj[COL_WORD_ID] && !obj[COL_WORD_MS] && !obj[COL_FOREIGN])
        return;
      obj.__srcRow = i + 1;
      rows.push(obj);
    });
    return { headers: headers, rows: rows };
  }
  function loadOneSheet(sd, sheetName) {
    if (!sd)
      return Promise.resolve({ ok: false, sheetName: sheetName, rows: [] });
    var parsed = rowsFromSheetJson(sd.values);
    return Promise.resolve(sd.images || {}).then(function (imgMap) {
      parsed.rows.forEach(function (rowObj) {
        var absRow = rowObj.__srcRow;
        IMG_COLS.forEach(function (colName) {
          var colIdx = parsed.headers.indexOf(colName);
          if (colIdx === -1)
            return;
          var found = imgMap[absRow + "_" + colIdx];
          if (found)
            rowObj[imgKey(colName)] = found;
        });
        delete rowObj.__srcRow;
      });
      return { ok: true, sheetName: sheetName, rows: parsed.rows };
    });
  }
  function renderChips(topics) {
    var wrap = document.getElementById("topicChips");
    if (!wrap)
      return;
    wrap.innerHTML = "";
    var all = el("button", { class: "topic-chip" + (state.topic === "" ? " active" : ""), text: t("dict.chip.all", "All") });
    all.addEventListener("click", function () { setTopic(""); });
    wrap.appendChild(all);
    topics.forEach(function (topic) {
      var chip = el("button", { class: "topic-chip" + (state.topic === topic.key ? " active" : ""), text: topic.label });
      chip.addEventListener("click", function () { setTopic(topic.key); });
      wrap.appendChild(chip);
    });
  }
  function setTopic(topic) {
    state.topic = topic;
    state.page = 1;
    var url = new URL(location.href);
    if (topic)
      url.searchParams.set("topic", topic);
    else
      url.searchParams.delete("topic");
    history.replaceState(null, "", url);
    renderTable();
    renderChips(uniqueTopics());
  }
  var LANG_FILTERS = [
    { value: "all", label: "dict.filter.all", fallback: "All" },
    { value: "id", label: "dict.filter.id", fallback: "Indonesian only" },
    { value: "ms", label: "dict.filter.ms", fallback: "Malay only" },
    { value: "foreign", label: "dict.filter.foreign", fallback: "Foreign only" }
  ];
  function renderLangFilterChips() {
    var wrap = document.getElementById("langFilterChips");
    if (!wrap)
      return;
    wrap.innerHTML = "";
    LANG_FILTERS.filter(function (f) {
      return f.value !== "foreign" || state.showForeign;
    }).forEach(function (f) {
      var chip = el("button", {
        class: "topic-chip" + (state.langFilter === f.value ? " active" : ""),
        text: t(f.label, f.fallback)
      });
      chip.addEventListener("click", function () { setLangFilter(f.value); });
      wrap.appendChild(chip);
    });
  }
  function setLangFilter(filter) {
    state.langFilter = filter;
    if (filter === "foreign") {
      state.showForeign = true;
      var showForeignToggle = document.getElementById("dictShowForeignToggle");
      if (showForeignToggle)
        showForeignToggle.checked = true;
    }
    state.page = 1;
    var url = new URL(location.href);
    if (filter !== "all")
      url.searchParams.set("words", filter);
    else
      url.searchParams.delete("words");
    history.replaceState(null, "", url);
    renderLangFilterChips();
    renderTable();
  }
  function setPage(page) {
    state.page = page;
    renderTable();
    var wrap = document.querySelector(".cards-wrap");
    if (wrap)
      wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function topicList(val) {
    if (!val)
      return [];
    return val.split(";").map(function (s) { return s.trim(); }).filter(Boolean);
  }
  var TOPIC_LANG_COLS = ["en-Topic", "id-Topic", "my-Topic"];
  function rowTopicTriples(r) {
    var lists = TOPIC_LANG_COLS.map(function (col) { return topicList(r[col]); });
    var maxLen = Math.max(lists[0].length, lists[1].length, lists[2].length);
    var triples = [];
    for (var i = 0; i < maxLen; i++) {
      triples.push({ en: lists[0][i] || "", id: lists[1][i] || "", ms: lists[2][i] || "" });
    }
    return triples;
  }
  function topicKeyFor(triple) {
    return (triple.en || triple.id || triple.ms || "").trim();
  }
  function rowTopicKeys(r) {
    return rowTopicTriples(r).map(topicKeyFor).filter(Boolean);
  }
  function topicRegistry() {
    var map = {};
    state.rows.forEach(function (r) {
      rowTopicTriples(r).forEach(function (triple) {
        var key = topicKeyFor(triple);
        if (!key)
          return;
        if (!map[key])
          map[key] = { en: "", id: "", ms: "" };
        if (triple.en)
          map[key].en = triple.en;
        if (triple.id)
          map[key].id = triple.id;
        if (triple.ms)
          map[key].ms = triple.ms;
      });
    });
    return map;
  }
  function topicLabelField(lang) {
    return (lang === "id" || lang === "ms") ? lang : "en";
  }
  function topicLabel(key) {
    if (!key)
      return "";
    var rec = topicRegistry()[key];
    if (!rec)
      return key;
    var field = topicLabelField((window.i18n && window.i18n.lang) ? window.i18n.lang() : "en");
    return rec[field] || rec.en || rec.id || rec.ms || key;
  }
  function uniqueTopics() {
    var registry = topicRegistry();
    var field = topicLabelField((window.i18n && window.i18n.lang) ? window.i18n.lang() : "en");
    var list = Object.keys(registry).map(function (key) {
      var rec = registry[key];
      return { key: key, label: rec[field] || rec.en || rec.id || rec.ms || key };
    });
    list.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return list;
  }
  function readSearchState() {
    var advToggle = document.getElementById("dictAdvancedToggle");
    var advanced = !!(advToggle && advToggle.checked);
    var val = function (id) {
      var elx = document.getElementById(id);
      return elx ? elx.value.trim().toLowerCase() : "";
    };
    if (!advanced) {
      return { advanced: false, simple: val("dictSearchSimple") };
    }
    return {
      advanced: true,
      word: val("dictSearchWord"),
      brief: val("dictSearchBrief"),
      keyboard: val("dictSearchKeyboard"),
      topic: val("dictSearchTopic"),
      notes: val("dictSearchNotes")
    };
  }
  function rowMatchesSearch(r, cols, s, filter) {
    var wordVal = pickForFilter(r, filter, COL_WORD_ID, COL_WORD_MS).text;
    var keyVal = pickForFilter(r, filter, COL_KEY_ID, COL_KEY_MS).text;
    var foreignVal = state.showForeign ? (r[COL_FOREIGN] || "").trim() : "";
    if (!s.advanced) {
      if (!s.simple)
        return true;
      return (wordVal || "").toLowerCase().indexOf(s.simple) !== -1 ||
        (foreignVal || "").toLowerCase().indexOf(s.simple) !== -1 ||
        (r[cols.info] || "").toLowerCase().indexOf(s.simple) !== -1;
    }
    if (s.word && (wordVal || "").toLowerCase().indexOf(s.word) === -1 &&
      (foreignVal || "").toLowerCase().indexOf(s.word) === -1)
      return false;
    if (s.brief && (r[COL_BRIEF] || "").toLowerCase().indexOf(s.brief) === -1)
      return false;
    if (s.keyboard && (keyVal || "").toLowerCase().indexOf(s.keyboard) === -1)
      return false;
    if (s.topic) {
      var topicHaystack = TOPIC_LANG_COLS.map(function (col) { return r[col] || ""; }).join(" \u2022 ").toLowerCase();
      if (topicHaystack.indexOf(s.topic) === -1)
        return false;
    }
    if (s.notes && (r[cols.info] || "").toLowerCase().indexOf(s.notes) === -1)
      return false;
    return true;
  }
  function searchSummaryText(s) {
    if (!s.advanced)
      return s.simple ? ("\"" + s.simple + "\"") : "";
    var parts = [];
    if (s.word)
      parts.push("word:\"" + s.word + "\"");
    if (s.brief)
      parts.push("brief:\"" + s.brief + "\"");
    if (s.keyboard)
      parts.push("keyboard:\"" + s.keyboard + "\"");
    if (s.topic)
      parts.push("topic:\"" + s.topic + "\"");
    if (s.notes)
      parts.push("notes:\"" + s.notes + "\"");
    return parts.join(", ");
  }
  function renderTable() {
    var tbody = document.getElementById("dictBody");
    var status = document.getElementById("dictStatus");
    if (!tbody)
      return;
    var cols = currentLangCols();
    var filter = state.langFilter;
    var s = readSearchState();
    var filtered = state.rows.filter(function (r) {
      var matchesTopic = !state.topic || rowTopicKeys(r).indexOf(state.topic) !== -1;
      var matchesLang = matchesLangFilter(r, filter);
      var matchesForeignVisibility = state.showForeign || !isForeignOnlyRow(r);
      return matchesTopic && matchesLang && matchesForeignVisibility && rowMatchesSearch(r, cols, s, filter);
    });
    var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page > totalPages)
      state.page = totalPages;
    if (state.page < 1)
      state.page = 1;
    var startIdx = (state.page - 1) * PAGE_SIZE;
    var pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);
    if (state.shuffle.active) {
      pageRows = seededShuffle(pageRows, state.shuffle.seed * 1000003 + state.page);
    }
    tbody.innerHTML = "";
    pageRows.forEach(function (r) {
      var word = pickForFilter(r, filter, COL_WORD_ID, COL_WORD_MS);
      var wordNode = wordFieldNode(r, filter);
      var wordWrap = el("div", { class: "word-card-word" }, [wordNode]);
      markQuizCell(wordWrap, "word");
      var topicWrap = topicFieldNode(r[cols.topic]);
      markQuizCell(topicWrap, "topic");
      var head = el("div", { class: "word-card-head" }, [wordWrap, topicWrap]);
      var strokeNode = glyphOrImageNode(r[COL_STROKE], word.text, r[imgKey(COL_STROKE)]);
      var briefNode = glyphOrImageNode(r[COL_BRIEF], word.text, r[imgKey(COL_BRIEF)]);
      var keyboardNode = keyFieldNode(r, filter, word.text);
      var grid = el("div", { class: "word-card-grid" }, [
        miniField("dict.th.stroke", "Stroke", strokeNode, "stroke"),
        miniField("dict.th.briefform", "Brief-form", briefNode, "brief"),
        miniField("dict.th.keyboard", "Keyboard", keyboardNode, "keyboard")
      ]);
      var card = el("div", { class: "word-card" }, [head, grid]);
      var notesVal = (r[cols.info] || "").trim();
      if (notesVal) {
        var notesWrap = el("div", { class: "word-card-notes" }, [
          el("span", { class: "mini-label", text: t("dict.th.information", "Notes") }),
          el("span", { class: "word-card-notes-text", text: notesVal })
        ]);
        markQuizCell(notesWrap, "notes");
        card.appendChild(notesWrap);
      }
      tbody.appendChild(card);
    });
    renderPagination(totalPages);
    applyQuizWrapClasses();
    if (status) {
      status.classList.remove("error");
      var rangeStart = filtered.length ? startIdx + 1 : 0;
      var rangeEnd = startIdx + pageRows.length;
      var searchText = searchSummaryText(s);
      var summary = (filtered.length > PAGE_SIZE ? rangeStart + "–" + rangeEnd + " " + t("dict.status.from", "of") + " " : "") +
        filtered.length + " " + t("dict.status.entries", "entries") +
        (state.topic ? " · " + t("dict.status.topic", "topic") + ": " + topicLabel(state.topic) : "") +
        (searchText ? " · " + t("dict.status.search", "search") + ": " + searchText : "");
      if (state.loadErrors.length) {
        summary += " · " + t("dict.status.sheeterror", "Some data failed to load") + ": " + state.loadErrors.join(", ");
        status.classList.add("error");
      }
      status.textContent = summary;
    }
  }
  function paginationRange(current, total) {
    var delta = 1;
    var range = [];
    for (var i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
        range.push(i);
      }
    }
    var withDots = [];
    var prev = null;
    range.forEach(function (p) {
      if (prev !== null && p - prev > 1)
        withDots.push("…");
      withDots.push(p);
      prev = p;
    });
    return withDots;
  }
  function renderPagination(totalPages) {
    var wrap = document.getElementById("dictPagination");
    if (!wrap)
      return;
    wrap.innerHTML = "";
    if (totalPages <= 1)
      return;
    var prev = el("button", { class: "page-btn", text: "‹", "aria-label": "Previous page" });
    prev.disabled = state.page <= 1;
    prev.addEventListener("click", function () { if (state.page > 1)
      setPage(state.page - 1); });
    wrap.appendChild(prev);
    paginationRange(state.page, totalPages).forEach(function (p) {
      if (p === "…") {
        wrap.appendChild(el("span", { class: "page-ellipsis", text: "…" }));
        return;
      }
      var btn = el("button", { class: "page-btn" + (p === state.page ? " active" : ""), text: String(p) });
      if (p !== state.page)
        btn.addEventListener("click", function () { setPage(p); });
      wrap.appendChild(btn);
    });
    var next = el("button", { class: "page-btn", text: "›", "aria-label": "Next page" });
    next.disabled = state.page >= totalPages;
    next.addEventListener("click", function () { if (state.page < totalPages)
      setPage(state.page + 1); });
    wrap.appendChild(next);
  }
  function markQuizCell(td, colKey) {
    td.setAttribute("data-col", colKey);
    if (!(state.quiz.active && state.quiz.display === "blur" && state.quiz.cols[colKey]))
      return;
    td.setAttribute("title", t("dict.quiz.reveal.hint", "Click to reveal"));
    if (QUIZ_MASK_COLS.indexOf(colKey) !== -1) {
      var real = el("span", { class: "quiz-real" });
      while (td.firstChild)
        real.appendChild(td.firstChild);
      td.appendChild(real);
      td.appendChild(el("span", { class: "quiz-mask-bar", "aria-hidden": "true" }));
      td.classList.add("quiz-masked");
    }
    else {
      td.classList.add("quiz-blurred");
    }
  }
  function applyQuizGate() {
    var gate = document.getElementById("dictQuizGate");
    var wrap = document.querySelector(".cards-wrap");
    var pagination = document.getElementById("dictPagination");
    var gated = state.quiz.active && !state.quiz.tableVisible;
    if (gate)
      gate.hidden = !gated;
    if (wrap)
      wrap.hidden = gated;
    if (pagination)
      pagination.hidden = gated;
  }
  function applyQuizWrapClasses() {
    var wrap = document.querySelector(".cards-wrap");
    if (!wrap)
      return;
    QUIZ_COLS.forEach(function (col) { wrap.classList.remove("quiz-hide-" + col); });
    wrap.classList.toggle("quiz-active", !!state.quiz.active);
    if (state.quiz.active && state.quiz.display === "hide") {
      QUIZ_COLS.forEach(function (col) {
        if (state.quiz.cols[col])
          wrap.classList.add("quiz-hide-" + col);
      });
    }
  }
  function loadData() {
    var status = document.getElementById("dictStatus");
    if (String(window.MSK_API_URL || "").indexOf("GANTI_DENGAN") === 0) {
      if (status) {
        status.classList.add("error");
        status.textContent = t("dict.status.notconfigured", "Not configured yet.");
      }
      return;
    }
    if (status)
      status.textContent = t("dict.status.loading", "Loading data...");
    window.mskFetchData()
      .then(function (data) {
      return Promise.all(SHEETS.map(function (name) {
        return loadOneSheet(data[name], name);
      }));
    })
      .then(function (results) {
      var allRows = [];
      var errors = [];
      results.forEach(function (r) {
        if (r.ok)
          allRows = allRows.concat(r.rows);
        else
          errors.push(r.sheetName);
      });
      state.rows = allRows;
      state.loadErrors = errors;
      var params = new URLSearchParams(location.search);
      state.topic = params.get("topic") || "";
      var wordsParam = params.get("words");
      if (wordsParam === "id" || wordsParam === "ms" || wordsParam === "foreign")
        state.langFilter = wordsParam;
      if (state.langFilter === "foreign") {
        state.showForeign = true;
        var showForeignToggle = document.getElementById("dictShowForeignToggle");
        if (showForeignToggle)
          showForeignToggle.checked = true;
      }
      if (!allRows.length && errors.length) {
        if (status) {
          status.classList.add("error");
          status.textContent = t("dict.status.fetcherror", "Failed to load data. Make sure the dataset is shared" +
            "and names are correct.") + " (" + errors.join(", ") + ")";
        }
        return;
      }
      renderChips(uniqueTopics());
      renderLangFilterChips();
      renderTable();
    })
      .catch(function (err) {
      if (status) {
        status.classList.add("error");
        status.textContent = t("dict.status.fetcherror", "Failed to load data.") + " (" + err.message + ")";
      }
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    var searchIds = ["dictSearchSimple", "dictSearchWord", "dictSearchBrief", "dictSearchKeyboard", "dictSearchTopic", "dictSearchNotes"];
    searchIds.forEach(function (id) {
      var elx = document.getElementById(id);
      if (elx)
        elx.addEventListener("input", function () { state.page = 1; renderTable(); });
    });
    var advToggle = document.getElementById("dictAdvancedToggle");
    var simpleRow = document.getElementById("simpleSearchRow");
    var advancedRow = document.getElementById("advancedSearchRow");
    var simpleLabel = document.getElementById("lookupSimpleLabel");
    var advancedLabel = document.getElementById("lookupAdvancedLabel");
    var showCategoriesToggle = document.getElementById("dictShowCategoriesToggle");
    var topicFilterGroup = document.getElementById("topicFilterGroup");
    function setCategoriesVisible(visible) {
      if (topicFilterGroup)
        topicFilterGroup.hidden = !visible;
      if (!visible && state.topic)
        setTopic("");
    }
    if (advToggle) {
      advToggle.addEventListener("change", function () {
        var isAdvanced = advToggle.checked;
        if (simpleRow)
          simpleRow.hidden = isAdvanced;
        if (advancedRow)
          advancedRow.hidden = !isAdvanced;
        if (simpleLabel)
          simpleLabel.hidden = isAdvanced;
        if (advancedLabel)
          advancedLabel.hidden = !isAdvanced;
        if (!isAdvanced) {
          if (showCategoriesToggle)
            showCategoriesToggle.checked = false;
          setCategoriesVisible(false);
        }
        state.page = 1;
        renderTable();
      });
    }
    if (showCategoriesToggle) {
      showCategoriesToggle.addEventListener("change", function () {
        setCategoriesVisible(showCategoriesToggle.checked);
      });
    }
    var showForeignToggle = document.getElementById("dictShowForeignToggle");
    if (showForeignToggle) {
      showForeignToggle.addEventListener("change", function () {
        state.showForeign = showForeignToggle.checked;
        if (!state.showForeign && state.langFilter === "foreign") {
          setLangFilter("all");
        }
        else {
          renderLangFilterChips();
          renderTable();
        }
      });
    }
    var quizToggle = document.getElementById("dictQuizToggle");
    var quizPanel = document.getElementById("dictQuizPanel");
    if (quizToggle && quizPanel) {
      quizToggle.addEventListener("change", function () {
        quizPanel.hidden = !quizToggle.checked;
        state.quiz.active = quizToggle.checked;
        state.quiz.tableVisible = !quizToggle.checked;
        applyQuizGate();
        renderTable();
      });
    }
    var quizShowTableBtn = document.getElementById("dictQuizShowTable");
    if (quizShowTableBtn) {
      quizShowTableBtn.addEventListener("click", function () {
        state.quiz.tableVisible = true;
        applyQuizGate();
      });
    }
    document.querySelectorAll("input[name='dictQuizDisplay']").forEach(function (radio) {
      radio.addEventListener("change", function () {
        if (radio.checked) {
          state.quiz.display = radio.value;
          renderTable();
        }
      });
    });
    QUIZ_COLS.forEach(function (col) {
      var cb = document.getElementById("dictQuizCol_" + col);
      if (!cb)
        return;
      cb.addEventListener("change", function () {
        state.quiz.cols[col] = cb.checked;
        renderTable();
      });
    });
    var revealAllBtn = document.getElementById("dictQuizRevealAll");
    if (revealAllBtn) {
      revealAllBtn.addEventListener("click", function () {
        document.querySelectorAll("#dictBody .quiz-blurred, #dictBody .quiz-masked").forEach(function (td) {
          td.classList.add("revealed");
        });
      });
    }
    var tbodyEl = document.getElementById("dictBody");
    if (tbodyEl) {
      tbodyEl.addEventListener("click", function (ev) {
        var td = ev.target.closest ? ev.target.closest(".quiz-blurred, .quiz-masked") : null;
        if (td)
          td.classList.toggle("revealed");
      });
    }
    var shuffleToggle = document.getElementById("dictShuffleToggle");
    var shuffleReroll = document.getElementById("dictShuffleReroll");
    if (shuffleToggle) {
      shuffleToggle.addEventListener("change", function () {
        state.shuffle.active = shuffleToggle.checked;
        if (state.shuffle.active)
          state.shuffle.seed = Date.now() % 1000000;
        if (shuffleReroll)
          shuffleReroll.hidden = !state.shuffle.active;
        renderTable();
      });
    }
    if (shuffleReroll) {
      shuffleReroll.addEventListener("click", function () {
        state.shuffle.seed = Date.now() % 1000000;
        renderTable();
      });
    }
    applyQuizGate();
    loadData();
  });
  document.addEventListener("i18n:ready", function () {
    if (state.rows.length) {
      renderChips(uniqueTopics());
      renderLangFilterChips();
      renderTable();
    }
  });
})();
