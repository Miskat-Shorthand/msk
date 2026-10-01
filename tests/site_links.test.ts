import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { articleHtmlFiles, attributesOf, readText, rootDir, rootHtmlFiles } from "./helpers.ts";

const LINK_ATTRIBUTES = new Set(["href", "src", "action"]);

/** Local file a link points at, or null for external links, anchors, mailto:, data: etc. */
function localTarget(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return null;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//")) return null;
    const withoutQueryAndHash = trimmed.split("#")[0]?.split("?")[0] ?? "";
    try {
        return decodeURIComponent(withoutQueryAndHash);
    } catch {
        return withoutQueryAndHash;
    }
}

function missingLinks(htmlFile: string, baseDir: string): string[] {
    const missing: string[] = [];
    for (const attr of attributesOf(readText(htmlFile))) {
        if (!LINK_ATTRIBUTES.has(attr.name)) continue;
        const target = localTarget(attr.value);
        if (target === null) continue;
        const resolved = target === "" ? baseDir : path.join(baseDir, target);
        if (!fs.existsSync(resolved)) missing.push(`${htmlFile}: <${attr.tag} ${attr.name}="${attr.value}">`);
    }
    return missing;
}

describe("local links", () => {
    test("every href/src/action in a root page points at a file that exists", () => {
        const missing = rootHtmlFiles().flatMap(file => missingLinks(file, rootDir));
        assert.deepEqual(missing, []);
    });

    test("relative src in article bodies exist next to the article (articles.js resolves them there)", () => {
        const missing: string[] = [];
        for (const file of articleHtmlFiles()) {
            const folder = path.join(rootDir, path.dirname(file));
            for (const attr of attributesOf(readText(file))) {
                if (attr.name !== "src") continue;
                const target = localTarget(attr.value);
                if (target === null || target.startsWith("/")) continue;
                if (!fs.existsSync(path.join(folder, target))) missing.push(`${file}: src="${attr.value}"`);
            }
        }
        assert.deepEqual(missing, []);
    });

    test("the file names with an ampersand are linked consistently (l&p.html)", () => {
        // The page exists, and every link to it uses the same spelling.
        assert.ok(fs.existsSync(path.join(rootDir, "l&p.html")));
        const spellings = new Set<string>();
        for (const file of rootHtmlFiles()) {
            for (const attr of attributesOf(readText(file))) {
                if (attr.name === "href" && /^l(&|&amp;|%26)p\.html/.test(attr.value)) spellings.add(attr.value.split("?")[0] ?? "");
            }
        }
        assert.equal(spellings.size, 1, `different spellings of l&p.html: ${[...spellings].join(", ")}`);
    });
});
