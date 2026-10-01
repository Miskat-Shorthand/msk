import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { attributesOf, readJson, readText, rootDir, rootHtmlFiles } from "./helpers.ts";

const LANGS = ["en", "id", "ms"] as const;

function loadLang(lang: string): Record<string, string> {
    const data = readJson(`assets/lang/${lang}.json`);
    assert.ok(data !== null && typeof data === "object" && !Array.isArray(data), `${lang}.json must be an object`);
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
        assert.equal(typeof value, "string", `${lang}.json: "${key}" must be a string`);
        out[key] = value as string;
    }
    return out;
}

const dictionaries: Record<string, Record<string, string>> = Object.fromEntries(
    LANGS.map(lang => [lang, loadLang(lang)]),
);

function dict(lang: string): Record<string, string> {
    const found = dictionaries[lang];
    assert.ok(found, `missing dictionary for ${lang}`);
    return found;
}

function placeholders(text: string): string[] {
    return [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? "").sort();
}

describe("i18n dictionaries", () => {
    test("en, id and ms define exactly the same keys", () => {
        const reference = Object.keys(dict("en")).sort();
        for (const lang of LANGS) {
            const keys = Object.keys(dict(lang)).sort();
            const missing = reference.filter(k => !keys.includes(k));
            const extra = keys.filter(k => !reference.includes(k));
            assert.deepEqual({ lang, missing, extra }, { lang, missing: [], extra: [] });
        }
    });

    test("no translation is empty", () => {
        for (const lang of LANGS) {
            const empty = Object.entries(dict(lang))
                .filter(([, value]) => value.trim() === "")
                .map(([key]) => key);
            assert.deepEqual({ lang, empty }, { lang, empty: [] });
        }
    });

    test("{placeholders} are identical in every language", () => {
        for (const [key, english] of Object.entries(dict("en"))) {
            for (const lang of ["id", "ms"]) {
                assert.deepEqual(placeholders(dict(lang)[key] ?? ""), placeholders(english), `"${key}" in ${lang}`);
            }
        }
    });
});

describe("i18n keys used by the pages", () => {
    const known = new Set(Object.keys(dict("en")));

    test("every data-i18n* attribute in the HTML has a translation", () => {
        const names = new Set(["data-i18n", "data-i18n-placeholder", "data-i18n-title"]);
        const unknown: string[] = [];
        for (const file of rootHtmlFiles()) {
            for (const attr of attributesOf(readText(file))) {
                if (names.has(attr.name) && !known.has(attr.value)) unknown.push(`${file}: ${attr.name}="${attr.value}"`);
            }
        }
        assert.deepEqual(unknown, []);
    });

    test("every literal key passed to t() / i18n.t() in the scripts has a translation", () => {
        const jsDir = path.join(rootDir, "assets", "js");
        const unknown: string[] = [];
        for (const name of fs.readdirSync(jsDir).filter(n => n.endsWith(".js")).sort()) {
            const source = fs.readFileSync(path.join(jsDir, name), "utf8");
            // The literal must be the whole first argument: t("a.b") or t("a.b", "fallback").
            // That skips keys built at runtime such as t("stroke.pos." + name).
            for (const m of source.matchAll(/\bt\(\s*"([A-Za-z0-9_.&-]+)"\s*[,)]/g)) {
                const key = m[1] ?? "";
                if (!known.has(key)) unknown.push(`assets/js/${name}: ${key}`);
            }
        }
        assert.deepEqual(unknown, []);
    });
});
