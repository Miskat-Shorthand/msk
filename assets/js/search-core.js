/*
 * search-core.js — the DOM-free part of the site search.
 *
 * Everything here is a pure function of its arguments, so it can be unit
 * tested in plain Node (see tests/search_core.test.ts) and reused by
 * search.js, which only wires it to the page.
 *
 * Exposes window.MskSearch.
 *
 * How matching works
 *   - Text is "folded": lower-cased and stripped of diacritics, so "Café"
 *     matches "cafe". Tokens are runs of letters/digits.
 *   - A query is split into terms. EVERY term must match somewhere in a
 *     document (AND), but a term can match in any field.
 *   - A term matches a token when it equals it (best), starts it, or - for
 *     terms of 3+ letters - appears inside it. The last rule is deliberate:
 *     Indonesian and Malay build words with prefixes and suffixes, so
 *     "baca" should find "membaca" and "dibacakan".
 *   - Fields are weighted: title > tags > excerpt > crumbs > body.
 *
 * Written from scratch for this project; no third-party code.
 */
(function (global) {
  "use strict";

  var MIN_TERM_LENGTH = 2;       // the longest term must have at least this many chars
  var SUBSTRING_MIN_LENGTH = 3;  // shorter terms only match at the start of a word
  var MAX_TERMS = 8;
  var FALLBACK_ORDER = ["en", "id", "ms"]; // same order as articles.js / learn.js

  var FIELD_WEIGHTS = { title: 8, tags: 5, excerpt: 3, crumbs: 2, body: 1 };
  var PHRASE_BONUS = { title: 6, excerpt: 3, body: 2 };
  var QUALITY = { exact: 1, prefix: 0.75, substring: 0.4 };
  var BODY_FREQUENCY_STEP = 0.1;  // extra credit per body occurrence ...
  var BODY_FREQUENCY_CAP = 10;    // ... counted up to this many times

  var WORD_CHAR = /[\p{L}\p{N}]/u;
  var NON_WORD_RUN = /[^\p{L}\p{N}]+/u;
  var COMBINING_MARKS = /[\u0300-\u036f]/g;
  var COMBINING_MARK = /[\u0300-\u036f]/;

  // ---------------------------------------------------------------- folding

  function foldChar(ch) {
    return ch.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
  }

  /**
   * Fold a string and remember where every folded character came from.
   * map[i] is the index in `str` of the character that produced folded[i], so
   * ranges found in the folded text can be mapped back onto the original.
   */
  function foldWithMap(str) {
    str = String(str == null ? "" : str);
    var out = [];
    var map = [];
    var i = 0;
    while (i < str.length) {
      var ch = String.fromCodePoint(str.codePointAt(i));
      var folded = foldChar(ch);
      for (var k = 0; k < folded.length; k++) {
        out.push(folded.charAt(k));
        map.push(i);
      }
      i += ch.length;
    }
    return { text: out.join(""), map: map };
  }

  function fold(str) {
    return foldWithMap(str).text;
  }

  function tokenize(str) {
    return fold(str).split(NON_WORD_RUN).filter(function (t) { return t.length > 0; });
  }

  // ------------------------------------------------------------------ query

  /**
   * Turn what the user typed into search terms.
   * searchable is false when there are no terms, or when even the longest
   * term is shorter than MIN_TERM_LENGTH (too vague to be useful).
   */
  function parseQuery(query) {
    var seen = {};
    var terms = [];
    tokenize(query).forEach(function (term) {
      if (!seen[term] && terms.length < MAX_TERMS) {
        seen[term] = true;
        terms.push(term);
      }
    });
    var longest = terms.reduce(function (max, t) { return Math.max(max, t.length); }, 0);
    return { terms: terms, searchable: longest >= MIN_TERM_LENGTH };
  }

  // ---------------------------------------------------------------- scoring

  function prepareField(text) {
    var tokens = tokenize(text);
    return { tokens: tokens, joined: tokens.join(" ") };
  }

  /**
   * Pre-compute folded tokens for each document once, so typing in the search
   * box only has to compare strings.
   */
  function prepareDocs(docs) {
    return docs.map(function (doc) {
      return {
        doc: doc,
        fields: {
          title: prepareField(doc.title),
          tags: prepareField((doc.tags || []).join(" ")),
          excerpt: prepareField(doc.excerpt),
          crumbs: prepareField(doc.crumbs),
          body: prepareField(doc.body)
        }
      };
    });
  }

  function matchQuality(term, token) {
    if (token === term) return QUALITY.exact;
    var at = token.indexOf(term);
    if (at === 0) return QUALITY.prefix;
    if (at > 0 && term.length >= SUBSTRING_MIN_LENGTH) return QUALITY.substring;
    return 0;
  }

  function matchTermInField(term, tokens) {
    var best = 0;
    var count = 0;
    for (var i = 0; i < tokens.length; i++) {
      var q = matchQuality(term, tokens[i]);
      if (q > 0) {
        count++;
        if (q > best) best = q;
      }
    }
    return { quality: best, count: count };
  }

  function scoreTerm(term, fields) {
    var total = 0;
    Object.keys(FIELD_WEIGHTS).forEach(function (name) {
      var m = matchTermInField(term, fields[name].tokens);
      if (m.quality === 0) return;
      total += FIELD_WEIGHTS[name] * m.quality;
      if (name === "body") {
        total += m.quality * Math.min(m.count, BODY_FREQUENCY_CAP) * BODY_FREQUENCY_STEP;
      }
    });
    return total;
  }

  function phraseBonus(terms, fields) {
    if (terms.length < 2) return 0;
    var needle = " " + terms.join(" ") + " ";
    var bonus = 0;
    Object.keys(PHRASE_BONUS).forEach(function (name) {
      if ((" " + fields[name].joined + " ").indexOf(needle) !== -1) bonus += PHRASE_BONUS[name];
    });
    return bonus;
  }

  function compareResults(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    var da = a.doc.date || "";
    var db = b.doc.date || "";
    if (da !== db) return da < db ? 1 : -1;     // newer first
    if (a.doc.id === b.doc.id) return 0;
    return a.doc.id < b.doc.id ? -1 : 1;
  }

  /**
   * @param prepared  output of prepareDocs()
   * @param query     raw text from the search box
   * @returns {{terms: string[], searchable: boolean, results: {doc: object, score: number}[]}}
   */
  function search(prepared, query) {
    var parsed = parseQuery(query);
    var out = { terms: parsed.terms, searchable: parsed.searchable, results: [] };
    if (!parsed.searchable) return out;

    prepared.forEach(function (p) {
      var score = 0;
      for (var i = 0; i < parsed.terms.length; i++) {
        var s = scoreTerm(parsed.terms[i], p.fields);
        if (s === 0) return;            // AND: every term has to match
        score += s;
      }
      score += phraseBonus(parsed.terms, p.fields);
      out.results.push({ doc: p.doc, score: score });
    });
    out.results.sort(compareResults);
    return out;
  }

  // ------------------------------------------------------- highlight/snippet

  function charBefore(text, index) {
    if (index <= 0) return "";
    var unit = text.charAt(index - 1);
    var code = unit.charCodeAt(0);
    if (code >= 0xdc00 && code <= 0xdfff && index >= 2) return text.charAt(index - 2) + unit;
    return unit;
  }

  function codePointLengthAt(str, index) {
    return str.codePointAt(index) > 0xffff ? 2 : 1;
  }

  /**
   * Find every place `terms` match inside `text`.
   * Returns merged, sorted [start, end) pairs that index the ORIGINAL text.
   * Mirrors the matching rules: terms of 3+ letters match anywhere, shorter
   * ones only at the start of a word.
   */
  function findRanges(text, terms) {
    text = String(text == null ? "" : text);
    if (!text || !terms.length) return [];
    var folded = foldWithMap(text);
    var raw = [];

    terms.forEach(function (term) {
      if (!term) return;
      var from = 0;
      for (;;) {
        var at = folded.text.indexOf(term, from);
        if (at === -1) break;
        from = at + 1;
        if (term.length < SUBSTRING_MIN_LENGTH && at > 0 && WORD_CHAR.test(charBefore(folded.text, at))) continue;
        raw.push([at, at + term.length]);
      }
    });
    if (!raw.length) return [];

    raw.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var merged = [raw[0].slice()];
    for (var i = 1; i < raw.length; i++) {
      var last = merged[merged.length - 1];
      if (raw[i][0] <= last[1]) last[1] = Math.max(last[1], raw[i][1]);
      else merged.push(raw[i].slice());
    }

    return merged.map(function (r) {
      var start = folded.map[r[0]];
      var lastSource = folded.map[r[1] - 1];
      var end = lastSource + codePointLengthAt(text, lastSource);
      while (end < text.length && COMBINING_MARK.test(text.charAt(end))) end++;  // keep trailing accents inside the highlight
      return [start, end];
    });
  }

  /** Split text into [{text, hit}] pieces that concatenate back to `text`. */
  function highlightSegments(text, terms) {
    text = String(text == null ? "" : text);
    var ranges = findRanges(text, terms);
    var segments = [];
    var cursor = 0;
    ranges.forEach(function (r) {
      if (r[0] > cursor) segments.push({ text: text.slice(cursor, r[0]), hit: false });
      segments.push({ text: text.slice(r[0], r[1]), hit: true });
      cursor = r[1];
    });
    if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
    return segments;
  }

  function avoidSplittingPair(str, index) {
    if (index > 0 && index < str.length) {
      var code = str.charCodeAt(index);
      if (code >= 0xdc00 && code <= 0xdfff) return index - 1;
    }
    return index;
  }

  function cutWindow(source, start, maxLen, lead) {
    var len = source.length;
    if (len <= maxLen) return source;

    var s = start;
    if (s > 0) {
      var nextSpace = source.indexOf(" ", s);
      var snapLimit = Math.floor(lead / 2);        // never snap past the match itself
      s = nextSpace !== -1 && nextSpace - s <= snapLimit ? nextSpace + 1 : avoidSplittingPair(source, s);
    }
    var e = Math.min(len, s + maxLen);
    if (e < len) {
      var prevSpace = source.lastIndexOf(" ", e);
      e = prevSpace > s + maxLen / 2 ? prevSpace : avoidSplittingPair(source, e);
    }
    return (s > 0 ? "\u2026 " : "") + source.slice(s, e).trim() + (e < len ? " \u2026" : "");
  }

  /**
   * Pick a short piece of text to show under a result: a window of the body
   * around the first match, or the start of the excerpt when the body has no
   * match (for example when only the title matched).
   */
  function makeSnippet(doc, terms, maxLen) {
    maxLen = maxLen || 180;
    var lead = Math.floor(maxLen * 0.25);
    var body = doc.body || "";
    var ranges = body ? findRanges(body, terms) : [];
    if (ranges.length) return cutWindow(body, Math.max(0, ranges[0][0] - lead), maxLen, lead);
    return cutWindow(doc.excerpt || "", 0, maxLen, lead);
  }

  // ------------------------------------------------------------ doc builders

  function pickLangData(langs, lang) {
    if (!langs) return null;
    if (langs[lang]) return langs[lang];
    for (var i = 0; i < FALLBACK_ORDER.length; i++) {
      if (langs[FALLBACK_ORDER[i]]) return langs[FALLBACK_ORDER[i]];
    }
    var keys = Object.keys(langs);
    return keys.length ? langs[keys[0]] : null;
  }

  /** assets/search-index.json  ->  documents in the reader's language. */
  function buildArticleDocs(searchIndex, lang) {
    if (!searchIndex || !Array.isArray(searchIndex.articles)) return [];
    var docs = [];
    searchIndex.articles.forEach(function (a) {
      var data = pickLangData(a.langs, lang);
      if (!data || !a.slug) return;
      docs.push({
        id: "article:" + a.slug,
        type: "article",
        url: "article.html?slug=" + encodeURIComponent(a.slug),
        title: data.title || a.slug,
        excerpt: data.excerpt || "",
        body: data.body || "",
        tags: a.tags || [],
        date: a.date || null,
        crumbs: ""
      });
    });
    return docs;
  }

  /** assets/units-index.json (a tree)  ->  one document per unit. */
  function buildUnitDocs(tree, lang) {
    var docs = [];
    function walk(nodes, parentPath, trail) {
      (nodes || []).forEach(function (node) {
        if (!node || node.id == null) return;
        var path = parentPath ? parentPath + "/" + node.id : String(node.id);
        var data = pickLangData(node.langs, lang) || {};
        var title = data.title || String(node.id);
        docs.push({
          id: "unit:" + path,
          type: "unit",
          url: "unit.html?path=" + encodeURIComponent(path),
          title: title,
          excerpt: data.summary || "",
          body: "",
          tags: [],
          date: null,
          crumbs: trail.join(" \u203a ")
        });
        walk(node.children, path, trail.concat([title]));
      });
    }
    if (Array.isArray(tree)) walk(tree, "", []);
    return docs;
  }

  global.MskSearch = {
    MIN_TERM_LENGTH: MIN_TERM_LENGTH,
    fold: fold,
    foldWithMap: foldWithMap,
    tokenize: tokenize,
    parseQuery: parseQuery,
    prepareDocs: prepareDocs,
    search: search,
    findRanges: findRanges,
    highlightSegments: highlightSegments,
    makeSnippet: makeSnippet,
    pickLangData: pickLangData,
    buildArticleDocs: buildArticleDocs,
    buildUnitDocs: buildUnitDocs
  };
})(typeof window !== "undefined" ? window : globalThis);
