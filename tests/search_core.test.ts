import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { loadSearchCore, plain, readJson } from "./helpers.ts";
import type { SearchDoc } from "./helpers.ts";

const core = loadSearchCore();

function makeDoc(overrides: Partial<SearchDoc> & { id: string }): SearchDoc {
    return {
        type: "article",
        url: `article.html?slug=${overrides.id}`,
        title: "",
        excerpt: "",
        body: "",
        tags: [],
        date: null,
        crumbs: "",
        ...overrides,
    };
}

function idsFor(docs: SearchDoc[], query: string): string[] {
    return plain(core.search(core.prepareDocs(docs), query).results.map(r => r.doc.id));
}

describe("folding and tokenizing", () => {
    test("fold lower-cases and removes accents", () => {
        assert.equal(core.fold("Caf\u00e9 \u00d1and\u00fa"), "cafe nandu");
        assert.equal(core.fold("Cafe\u0301"), "cafe"); // already-decomposed input
    });

    test("tokenize splits on anything that is not a letter or digit", () => {
        assert.deepEqual(plain(core.tokenize("ber-, e-mail; 3.5 \u2014 ok")), ["ber", "e", "mail", "3", "5", "ok"]);
        assert.deepEqual(plain(core.tokenize("")), []);
    });

    test("foldWithMap maps every folded character back to its source index", () => {
        const { text, map } = core.foldWithMap("A\u00e9B");
        assert.equal(text, "aeb");
        assert.deepEqual(plain(map), [0, 1, 2]);
    });
});

describe("parseQuery", () => {
    test("de-duplicates terms and ignores punctuation", () => {
        assert.deepEqual(plain(core.parseQuery("Kamus, kamus  STENO!")), { terms: ["kamus", "steno"], searchable: true });
    });

    test("is not searchable when empty or when every term is a single character", () => {
        for (const q of ["", "   ", "a", "a b c", "-"]) assert.equal(core.parseQuery(q).searchable, false, JSON.stringify(q));
        assert.equal(core.parseQuery("a bc").searchable, true);
    });

    test("keeps at most 8 terms", () => {
        assert.equal(core.parseQuery("aa bb cc dd ee ff gg hh ii jj").terms.length, 8);
    });
});

describe("search", () => {
    test("returns nothing for a query that is not searchable", () => {
        assert.deepEqual(idsFor([makeDoc({ id: "a", title: "a b" })], "a"), []);
    });

    test("every term must match (AND), but in any field", () => {
        const docs = [
            makeDoc({ id: "both", title: "Kamus steno", body: "isi" }),
            makeDoc({ id: "split", title: "Kamus besar", body: "tentang steno" }),
            makeDoc({ id: "one", title: "Kamus besar" }),
        ];
        assert.deepEqual(idsFor(docs, "kamus steno").sort(), ["both", "split"]);
    });

    test("ignores accents and case in both directions", () => {
        const docs = [makeDoc({ id: "a", title: "Caf\u00e9 Tua" })];
        assert.deepEqual(idsFor(docs, "CAFE"), ["a"]);
        assert.deepEqual(idsFor(docs, "caf\u00e9"), ["a"]);
    });

    test("finds Indonesian/Malay words by their root ('baca' -> 'membaca')", () => {
        const docs = [makeDoc({ id: "a", body: "Belajar membaca dan menulis" })];
        assert.deepEqual(idsFor(docs, "baca"), ["a"]);
        assert.deepEqual(idsFor(docs, "menulis"), ["a"]);
    });

    test("terms shorter than 3 letters only match the start of a word", () => {
        const docs = [makeDoc({ id: "a", body: "membaca" }), makeDoc({ id: "b", body: "baca" })];
        assert.deepEqual(idsFor(docs, "ba"), ["b"]);
    });

    test("ranks title above tags above excerpt above body", () => {
        const docs = [
            makeDoc({ id: "body", body: "steno" }),
            makeDoc({ id: "excerpt", excerpt: "steno" }),
            makeDoc({ id: "tags", tags: ["steno"] }),
            makeDoc({ id: "title", title: "steno" }),
        ];
        assert.deepEqual(idsFor(docs, "steno"), ["title", "tags", "excerpt", "body"]);
    });

    test("ranks an exact word above a prefix above an inner match", () => {
        const docs = [
            makeDoc({ id: "inner", title: "membaca" }),
            makeDoc({ id: "prefix", title: "bacaan" }),
            makeDoc({ id: "exact", title: "baca" }),
        ];
        assert.deepEqual(idsFor(docs, "baca"), ["exact", "prefix", "inner"]);
    });

    test("gives a bonus when the words appear next to each other", () => {
        const docs = [
            makeDoc({ id: "apart", body: "steno itu cepat dan kamus itu besar" }),
            makeDoc({ id: "phrase", body: "kamus steno itu besar dan cepat" }),
        ];
        assert.deepEqual(idsFor(docs, "kamus steno"), ["phrase", "apart"]);
    });

    test("matches tags and crumbs", () => {
        const docs = [makeDoc({ id: "t", tags: ["style-guide"] }), makeDoc({ id: "c", crumbs: "Edisi 1 \u203a Unit 2" })];
        assert.deepEqual(idsFor(docs, "guide"), ["t"]);
        assert.deepEqual(idsFor(docs, "edisi"), ["c"]);
    });

    test("breaks ties by newest date, then by id, so order is stable", () => {
        const docs = [
            makeDoc({ id: "b", title: "steno", date: "2026-01-01" }),
            makeDoc({ id: "a", title: "steno", date: "2026-01-01" }),
            makeDoc({ id: "new", title: "steno", date: "2026-05-01" }),
        ];
        assert.deepEqual(idsFor(docs, "steno"), ["new", "a", "b"]);
    });
});

describe("findRanges / highlightSegments", () => {
    test("ranges index the ORIGINAL text even when accents were folded away", () => {
        const text = "Un Caf\u00e9 \u00d1and\u00fa";
        assert.deepEqual(plain(core.findRanges(text, ["cafe"])), [[3, 7]]);
        assert.equal(text.slice(3, 7), "Caf\u00e9");
    });

    test("a decomposed accent stays inside the highlight", () => {
        const text = "Cafe\u0301 ok"; // "Cafe" + combining acute
        assert.deepEqual(plain(core.findRanges(text, ["cafe"])), [[0, 5]]);
    });

    test("handles characters outside the BMP (emoji take two UTF-16 units)", () => {
        const text = "\u{1F600} baca";
        assert.deepEqual(plain(core.findRanges(text, ["baca"])), [[3, 7]]);
    });

    test("short terms only highlight at the start of a word; longer ones anywhere", () => {
        assert.deepEqual(plain(core.findRanges("cab ab", ["ab"])), [[4, 6]]);
        assert.deepEqual(plain(core.findRanges("xbacax", ["bac"])), [[1, 4]]);
    });

    test("merges overlapping matches from different terms", () => {
        assert.deepEqual(plain(core.findRanges("membaca", ["memb", "baca"])), [[0, 7]]);
    });

    test("segments always concatenate back to the input", () => {
        for (const text of ["", "no match here", "Baca baca BACA", "x \u{1F600} baca\u0301 y"]) {
            const segments = plain(core.highlightSegments(text, ["baca"]));
            assert.equal(segments.map(s => s.text).join(""), text);
        }
        const marked = plain(core.highlightSegments("a Baca b", ["baca"])).filter(s => s.hit).map(s => s.text);
        assert.deepEqual(marked, ["Baca"]);
    });
});

describe("makeSnippet", () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(20);

    test("shows the window around the first match, with ellipses on cut sides", () => {
        const snippet = core.makeSnippet({ body: `${filler}TARGET ${filler}`, excerpt: "excerpt" }, ["target"], 120);
        assert.ok(snippet.includes("TARGET"), snippet);
        assert.ok(snippet.startsWith("\u2026 "), snippet);
        assert.ok(snippet.endsWith(" \u2026"), snippet);
        assert.ok(snippet.length <= 120 + 4, `too long: ${snippet.length}`);
    });

    test("keeps a match that is at the very start without a leading ellipsis", () => {
        const snippet = core.makeSnippet({ body: `TARGET ${filler}`, excerpt: "" }, ["target"], 100);
        assert.ok(snippet.startsWith("TARGET"), snippet);
        assert.ok(snippet.endsWith(" \u2026"), snippet);
    });

    test("falls back to the start of the excerpt when the body has no match", () => {
        assert.equal(core.makeSnippet({ body: "nothing relevant", excerpt: "Short excerpt" }, ["zzz"]), "Short excerpt");
    });

    test("returns short text unchanged", () => {
        assert.equal(core.makeSnippet({ body: "tiny body", excerpt: "" }, ["tiny"]), "tiny body");
    });

    test("never cuts a surrogate pair in half", () => {
        const body = "\u{1F600}".repeat(200) + " target " + "\u{1F600}".repeat(200);
        const snippet = core.makeSnippet({ body, excerpt: "" }, ["target"], 60);
        assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(snippet), "lone surrogate in snippet");
    });
});

describe("document builders", () => {
    const searchIndex = {
        version: 1,
        articles: [
            { slug: "both", date: "2026-02-01", tags: ["x"], langs: { en: { title: "EN", excerpt: "e", body: "b" }, id: { title: "ID", excerpt: "e", body: "b" } } },
            { slug: "only-id", date: "2026-01-01", tags: [], langs: { id: { title: "Hanya ID", excerpt: "", body: "" } } },
            { slug: "no langs", date: "2026-01-01", tags: [], langs: {} },
        ],
    };

    test("article docs follow the reader's language and fall back like articles.js (en, id, ms)", () => {
        const titles = (lang: string): string[] => plain(core.buildArticleDocs(searchIndex, lang).map(d => d.title));
        assert.deepEqual(titles("id"), ["ID", "Hanya ID"]);
        assert.deepEqual(titles("en"), ["EN", "Hanya ID"]);
        assert.deepEqual(titles("ms"), ["EN", "Hanya ID"]);
    });

    test("article docs link to article.html?slug= with an encoded slug", () => {
        const docs = core.buildArticleDocs({ articles: [{ slug: "a b&c", langs: { en: { title: "T" } } }] }, "en");
        assert.equal(docs[0]?.url, "article.html?slug=a%20b%26c");
    });

    test("tolerates missing or malformed data", () => {
        assert.deepEqual(plain(core.buildArticleDocs(null, "en")), []);
        assert.deepEqual(plain(core.buildArticleDocs({ articles: "nope" }, "en")), []);
        assert.deepEqual(plain(core.buildUnitDocs(null, "en")), []);
        assert.deepEqual(plain(core.buildUnitDocs({}, "en")), []);
    });

    test("unit docs use the same path format as learn.js (ids joined by '/', then URL-encoded)", () => {
        const tree = [
            {
                id: "edisi-1",
                langs: { en: { title: "Edition 1", summary: "S" } },
                children: [{ id: "2", langs: { en: { title: "Unit 2" } }, children: [{ id: "a", langs: { en: { title: "2a" } } }] }],
            },
        ];
        const docs = plain(core.buildUnitDocs(tree, "en"));
        assert.deepEqual(docs.map(d => d.url), [
            "unit.html?path=edisi-1",
            "unit.html?path=edisi-1%2F2",
            "unit.html?path=edisi-1%2F2%2Fa",
        ]);
        assert.deepEqual(docs.map(d => d.crumbs), ["", "Edition 1", "Edition 1 \u203a Unit 2"]);
        assert.equal(docs[0]?.excerpt, "S");
    });
});

describe("against the real site data", () => {
    const searchIndex = readJson("assets/search-index.json");
    const unitsIndex = readJson("assets/units-index.json");

    for (const lang of ["en", "id", "ms"]) {
        test(`every document can be found by typing its own title (${lang})`, () => {
            const docs = [...core.buildArticleDocs(searchIndex, lang), ...core.buildUnitDocs(unitsIndex, lang)];
            const prepared = core.prepareDocs(docs);
            const notFound: string[] = [];
            for (const doc of docs) {
                const found = core.search(prepared, doc.title);
                if (!found.searchable) continue; // a title made only of 1-character words
                if (!found.results.some(r => r.doc.id === doc.id)) notFound.push(`${doc.id} (${doc.title})`);
            }
            assert.deepEqual(notFound, []);
        });
    }

    test("document ids are unique", () => {
        const docs = [...core.buildArticleDocs(searchIndex, "en"), ...core.buildUnitDocs(unitsIndex, "en")];
        const ids = docs.map(d => d.id);
        assert.equal(new Set(ids).size, ids.length);
    });
});
