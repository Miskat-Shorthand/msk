import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** Repository root (the folder that contains index.html). */
export const rootDir: string = path.join(import.meta.dirname, "..");

export function exists(rel: string): boolean {
    return fs.existsSync(path.join(rootDir, rel));
}

export function readText(rel: string): string {
    return fs.readFileSync(path.join(rootDir, rel), "utf8");
}

export function readJson(rel: string): unknown {
    return JSON.parse(readText(rel));
}

/** Root-level pages, e.g. ["about.html", "index.html", "l&p.html", ...]. */
export function rootHtmlFiles(): string[] {
    return fs
        .readdirSync(rootDir)
        .filter(name => name.endsWith(".html"))
        .sort();
}

/** Article bodies as repository-relative paths: articles/<folder>/<lang>.html */
export function articleHtmlFiles(): string[] {
    const articlesDir = path.join(rootDir, "articles");
    if (!fs.existsSync(articlesDir)) return [];
    const files: string[] = [];
    for (const folder of fs.readdirSync(articlesDir, { withFileTypes: true })) {
        if (!folder.isDirectory()) continue;
        for (const name of fs.readdirSync(path.join(articlesDir, folder.name)).sort()) {
            if (name.endsWith(".html")) files.push(`articles/${folder.name}/${name}`);
        }
    }
    return files.sort();
}

export type Attribute = Readonly<{ tag: string; name: string; value: string }>;

/** Every start tag in an HTML string, as raw text. Comments are removed first. */
export function startTags(html: string): string[] {
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, "");
    return withoutComments.match(/<[a-zA-Z][^>]*>/g) ?? [];
}

/** Attributes of all start tags. Handles "double", 'single' and unquoted values. */
export function attributesOf(html: string): Attribute[] {
    const found: Attribute[] = [];
    for (const raw of startTags(html)) {
        const tag = (/^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw)?.[1] ?? "").toLowerCase();
        const attrRe = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        const body = raw.slice(1 + tag.length);
        for (const m of body.matchAll(attrRe)) {
            found.push({ tag, name: (m[1] ?? "").toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? "" });
        }
    }
    return found;
}

/** Copy of a value that belongs to this realm (see loadSearchCore). */
export function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export type SearchDoc = {
    id: string;
    type: "article" | "unit";
    url: string;
    title: string;
    excerpt: string;
    body: string;
    tags: string[];
    date: string | null;
    crumbs: string;
};

export type SearchResult = { doc: SearchDoc; score: number };

export interface MskSearchApi {
    fold(text: string): string;
    foldWithMap(text: string): { text: string; map: number[] };
    tokenize(text: string): string[];
    parseQuery(query: string): { terms: string[]; searchable: boolean };
    prepareDocs(docs: SearchDoc[]): unknown[];
    search(prepared: unknown[], query: string): { terms: string[]; searchable: boolean; results: SearchResult[] };
    findRanges(text: string, terms: string[]): [number, number][];
    highlightSegments(text: string, terms: string[]): { text: string; hit: boolean }[];
    makeSnippet(doc: { body: string; excerpt: string }, terms: string[], maxLen?: number): string;
    buildArticleDocs(searchIndex: unknown, lang: string): SearchDoc[];
    buildUnitDocs(tree: unknown, lang: string): SearchDoc[];
}

/**
 * Run assets/js/search-core.js the way a browser would (as a classic script
 * that writes window.MskSearch) without needing a DOM.
 *
 * Objects created inside the vm context belong to another JavaScript realm, so
 * node:assert's deepStrictEqual would reject them on prototype alone. Wrap
 * results in plain() before comparing.
 */
export function loadSearchCore(): MskSearchApi {
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.runInNewContext(readText("assets/js/search-core.js"), sandbox, { filename: "assets/js/search-core.js" });
    const api = sandbox.window["MskSearch"];
    if (!api) throw new Error("search-core.js did not define window.MskSearch");
    return api as MskSearchApi;
}
