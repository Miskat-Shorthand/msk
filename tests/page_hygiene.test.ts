import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { attributesOf, readText, rootHtmlFiles, startTags } from "./helpers.ts";

const pages = rootHtmlFiles().map(file => ({ file, html: readText(file) }));

function sidebarLinks(html: string): string[] {
    const start = html.indexOf('<nav class="sidebar"');
    const end = html.indexOf("</nav>", start);
    assert.ok(start !== -1 && end !== -1, "sidebar <nav> not found");
    return attributesOf(html.slice(start, end))
        .filter(a => a.tag === "a" && a.name === "href")
        .map(a => a.value);
}

describe("every page", () => {
    test("has a title, a viewport, a language and a Content-Security-Policy", () => {
        const problems: string[] = [];
        for (const { file, html } of pages) {
            if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${file}: empty or missing <title>`);
            if (!/<meta\s+name="viewport"/.test(html)) problems.push(`${file}: no viewport meta`);
            if (!/<html[^>]*\slang="[a-z-]+"/.test(html)) problems.push(`${file}: <html> has no lang`);
            if (!/<meta\s+http-equiv="Content-Security-Policy"/.test(html)) problems.push(`${file}: no CSP meta`);
        }
        assert.deepEqual(problems, []);
    });

    test("has no inline <script> and no inline on*= handlers (the CSP would block them)", () => {
        const problems: string[] = [];
        for (const { file, html } of pages) {
            for (const tag of startTags(html)) {
                if (/^<script\b/i.test(tag) && !/\ssrc\s*=/i.test(tag)) problems.push(`${file}: inline ${tag}`);
            }
            for (const attr of attributesOf(html)) {
                if (/^on[a-z]+$/.test(attr.name)) problems.push(`${file}: <${attr.tag} ${attr.name}>`);
            }
        }
        assert.deepEqual(problems, []);
    });

    test("loads each local asset with one single ?v= version everywhere (cache busting stays in sync)", () => {
        const versions = new Map<string, Set<string>>();
        for (const { html } of pages) {
            for (const attr of attributesOf(html)) {
                const isAsset = (attr.tag === "script" && attr.name === "src") || (attr.tag === "link" && attr.name === "href");
                if (!isAsset || /^[a-z]+:|^\/\//i.test(attr.value)) continue;
                const [assetPath = "", query = ""] = attr.value.split("?");
                const set = versions.get(assetPath) ?? new Set<string>();
                set.add(query);
                versions.set(assetPath, set);
            }
        }
        const inconsistent = [...versions].filter(([, set]) => set.size > 1).map(([p, set]) => `${p}: ${[...set].join(" vs ")}`);
        assert.deepEqual(inconsistent, []);
    });

    test("shares the same sidebar links as index.html", () => {
        const reference = sidebarLinks(readText("index.html"));
        const different = pages.filter(({ html }) => JSON.stringify(sidebarLinks(html)) !== JSON.stringify(reference)).map(p => p.file);
        assert.deepEqual(different, []);
    });
});

describe("search.html", () => {
    const html = readText("search.html");

    test("is excluded from search engines", () => {
        assert.match(html, /<meta\s+name="robots"\s+content="noindex"/);
    });

    test("loads search-core.js before search.js", () => {
        const scripts = attributesOf(html).filter(a => a.tag === "script" && a.name === "src").map(a => a.value.split("?")[0]);
        assert.ok(scripts.indexOf("assets/js/search-core.js") !== -1, "search-core.js missing");
        assert.ok(scripts.indexOf("assets/js/search-core.js") < scripts.indexOf("assets/js/search.js"), "wrong script order");
    });

    test("has the elements search.js looks up by id", () => {
        const ids = new Set(attributesOf(html).filter(a => a.name === "id").map(a => a.value));
        for (const id of ["searchForm", "searchInput", "searchStatus", "searchResults"]) {
            assert.ok(ids.has(id), `missing #${id}`);
        }
    });

    test("is linked from the sidebar of every page", () => {
        const without = pages.filter(({ html: h }) => !sidebarLinks(h).includes("search.html")).map(p => p.file);
        assert.deepEqual(without, []);
    });
});
