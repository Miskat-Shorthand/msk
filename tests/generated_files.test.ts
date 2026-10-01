import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { exists, readJson, readText, rootDir } from "./helpers.ts";

type LangText = { title: string; excerpt: string; readMins?: number; body?: string };
type ArticleEntry = {
    slug: string;
    folder: string;
    date: string;
    tags: string[];
    thumbnail: string | null;
    langs: Record<string, LangText>;
};
type UnitNode = { id: string; langs: Record<string, { title: string }>; children?: UnitNode[] };

function articlesIndex(): ArticleEntry[] {
    return readJson("assets/articles-index.json") as ArticleEntry[];
}

describe("assets/articles-index.json", () => {
    test("every entry points at real files", () => {
        const problems: string[] = [];
        for (const entry of articlesIndex()) {
            for (const lang of Object.keys(entry.langs)) {
                if (!exists(`articles/${entry.folder}/${lang}.html`)) problems.push(`${entry.folder}: no ${lang}.html`);
            }
            if (entry.thumbnail !== null && !exists(entry.thumbnail)) problems.push(`${entry.folder}: missing thumbnail ${entry.thumbnail}`);
        }
        assert.deepEqual(problems, []);
    });

    test("covers every article folder and is sorted newest first", () => {
        const folders = fs
            .readdirSync(path.join(rootDir, "articles"), { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort();
        const entries = articlesIndex();
        assert.deepEqual(entries.map(e => e.folder).sort(), folders);
        const keys = entries.map(e => `${e.date}/${e.slug}`);
        assert.deepEqual(keys, [...keys].sort().reverse());
    });

    test("slugs are unique (article.html?slug= relies on it)", () => {
        const slugs = articlesIndex().map(e => e.slug);
        assert.equal(new Set(slugs).size, slugs.length);
    });
});

describe("assets/search-index.json", () => {
    const searchIndex = readJson("assets/search-index.json") as { version: number; articles: ArticleEntry[] };

    test("has the shape search-core.js expects", () => {
        assert.equal(searchIndex.version, 1);
        assert.ok(Array.isArray(searchIndex.articles));
    });

    test("agrees with articles-index.json on slugs, dates, tags, titles and excerpts", () => {
        const expected = articlesIndex().map(e => ({
            slug: e.slug,
            date: e.date,
            tags: e.tags,
            langs: Object.fromEntries(Object.entries(e.langs).map(([lang, v]) => [lang, { title: v.title, excerpt: v.excerpt }])),
        }));
        const actual = searchIndex.articles.map(a => ({
            slug: a.slug,
            date: a.date,
            tags: a.tags,
            langs: Object.fromEntries(Object.entries(a.langs).map(([lang, v]) => [lang, { title: v.title, excerpt: v.excerpt }])),
        }));
        assert.deepEqual(actual, expected);
    });

    test("holds collapsed plain text and never the leading <!--meta ...--> comment", () => {
        // Note: "<h2>" inside a body is fine when the article talks ABOUT tags (it was written as &lt;h2&gt;).
        const problems: string[] = [];
        for (const article of searchIndex.articles) {
            for (const [lang, v] of Object.entries(article.langs)) {
                const body = v.body ?? "";
                if (body === "") problems.push(`${article.slug}/${lang}: empty body`);
                if (body.includes("<!--meta")) problems.push(`${article.slug}/${lang}: meta comment left in body`);
                if (/\s{2,}/.test(body)) problems.push(`${article.slug}/${lang}: whitespace not collapsed`);
            }
        }
        assert.deepEqual(problems, []);
    });
});

describe("assets/units-index.json", () => {
    function walk(nodes: UnitNode[], trail: string, problems: string[]): void {
        const seen = new Set<string>();
        for (const node of nodes) {
            const here = trail ? `${trail}/${node.id}` : node.id;
            if (typeof node.id !== "string" || node.id === "") problems.push(`${trail || "(root)"}: node without an id`);
            if (String(node.id).includes("/")) problems.push(`${here}: id contains "/", which is the path separator`);
            if (seen.has(node.id)) problems.push(`${here}: duplicate id among siblings`);
            seen.add(node.id);
            const titled = Object.values(node.langs ?? {}).some(l => typeof l.title === "string" && l.title !== "");
            if (!titled) problems.push(`${here}: no title in any language`);
            walk(node.children ?? [], here, problems);
        }
    }

    test("is a tree of uniquely identified, titled nodes", () => {
        const tree = readJson("assets/units-index.json");
        assert.ok(Array.isArray(tree));
        const problems: string[] = [];
        walk(tree as UnitNode[], "", problems);
        assert.deepEqual(problems, []);
    });
});

describe("sitemap.xml and feeds/ (only checked once they exist)", () => {
    const sitemap = exists("sitemap.xml");
    const slugs = new Set(articlesIndex().map(e => e.slug));

    function locations(xml: string, element: string): string[] {
        return [...xml.matchAll(new RegExp(`<${element}>([^<]*)</${element}>`, "g"))].map(m => m[1] ?? "");
    }

    test("sitemap.xml lists absolute URLs, every article once, and no JS-only shells", { skip: !sitemap }, () => {
        const urls = locations(readText("sitemap.xml"), "loc");
        assert.ok(urls.every(u => /^https?:\/\/[^\s]+$/.test(u)), "every <loc> must be an absolute URL without spaces");
        assert.equal(new Set(urls).size, urls.length, "duplicate <loc>");
        for (const hidden of ["article.html", "unit.html", "search.html"]) {
            assert.ok(!urls.some(u => /\/(article|unit|search)\.html$/.test(u) && u.endsWith(hidden)), `${hidden} must not be listed`);
        }
        const listed = urls.filter(u => u.includes("article.html?slug=")).map(u => decodeURIComponent(u.split("slug=")[1] ?? ""));
        assert.deepEqual(listed.sort(), [...slugs].sort());
    });

    for (const lang of ["en", "id", "ms"]) {
        const file = `feeds/${lang}.xml`;
        test(`${file} has one item per article`, { skip: !exists(file) }, () => {
            const xml = readText(file);
            assert.equal((xml.match(/<item>/g) ?? []).length, slugs.size);
            assert.ok(xml.includes(`<language>${lang}</language>`));
        });
    }
});
