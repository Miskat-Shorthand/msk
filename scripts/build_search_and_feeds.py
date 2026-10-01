#!/usr/bin/env python3
"""Build the static files that make the site searchable and discoverable.

Outputs (all deterministic: same input -> byte-identical output):

  assets/search-index.json   full text of every article, per language
  sitemap.xml                static pages + one URL per article
  feeds/<lang>.xml           one RSS 2.0 feed per language

sitemap.xml and feeds/ need absolute URLs, so they are only written when a
site URL is configured (site.config.json -> "siteUrl", or the SITE_URL
environment variable, or --site-url). Without one the search index is still
built and a notice is printed.

Usage:
  python3 scripts/build_search_and_feeds.py            # write files
  python3 scripts/build_search_and_feeds.py --check    # exit 1 if any file is stale

Only the Python standard library is used. Article titles, excerpts, tags and
dates come from build_articles_index.collect_entries() so this script can
never disagree with assets/articles-index.json.
"""
import argparse
import datetime
import email.utils
import json
import os
import sys
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit
from xml.sax.saxutils import escape, quoteattr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_articles_index as bai  # noqa: E402

ROOT = bai.ROOT
SUPPORTED_LANGS = bai.SUPPORTED_LANGS
FALLBACK_ORDER = ["en", "id", "ms"]  # same order as assets/js/articles.js
SEARCH_INDEX_VERSION = 1
SEARCH_INDEX_PATH = os.path.join("assets", "search-index.json")
SITEMAP_PATH = "sitemap.xml"
FEEDS_DIR = "feeds"
CONFIG_PATH = "site.config.json"

# Root-level pages that are NOT listed in the sitemap: article.html and
# unit.html are empty shells filled in by JavaScript from a query string, and
# search.html is a results page that should not be indexed.
SITEMAP_EXCLUDED_PAGES = {"article.html", "unit.html", "search.html"}

# Tags that start a new block of text. A space is inserted before and after
# them so "<p>a</p><p>b</p>" becomes "a b" and not "ab".
BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "br", "dd", "details", "div", "dl", "dt",
    "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
    "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table", "td", "th", "tr", "ul",
}
SKIPPED_TAGS = {"script", "style", "template"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in SKIPPED_TAGS:
            self._skip_depth += 1
        elif tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_startendtag(self, tag, attrs):
        # <br/>, <hr/>, <img/> ... never open a scope, so don't touch skip depth.
        if tag in BLOCK_TAGS and tag not in SKIPPED_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in SKIPPED_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self.parts.append(data)


def html_to_text(html):
    """Return the visible text of an HTML fragment with whitespace collapsed."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return " ".join("".join(parser.parts).split())


def read_article_text(path):
    with open(path, encoding="utf-8") as f:
        return html_to_text(f.read())


def pick_lang(langs, wanted):
    """Mirror pickLang() in assets/js/articles.js: wanted, then en/id/ms, then any."""
    if wanted in langs:
        return wanted
    for lang in FALLBACK_ORDER:
        if lang in langs:
            return lang
    return next(iter(langs), None)


# --------------------------------------------------------------------------
# search-index.json
# --------------------------------------------------------------------------

def build_search_index(entries, articles_dir):
    articles = []
    for entry in entries:
        langs = {}
        for lang in SUPPORTED_LANGS:
            data = entry["langs"].get(lang)
            if data is None:
                continue
            body_path = os.path.join(articles_dir, entry["folder"], f"{lang}.html")
            langs[lang] = {
                "title": data["title"],
                "excerpt": data["excerpt"],
                "body": read_article_text(body_path),
            }
        articles.append({
            "slug": entry["slug"],
            "date": entry["date"],
            "tags": entry["tags"],
            "langs": langs,
        })
    return {"version": SEARCH_INDEX_VERSION, "articles": articles}


def dump_json(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


# --------------------------------------------------------------------------
# sitemap.xml
# --------------------------------------------------------------------------

def normalize_site_url(raw):
    """Return the site URL with exactly one trailing slash, or raise ValueError."""
    value = (raw or "").strip()
    if not value:
        return ""
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(f"siteUrl must start with http:// or https:// (got {value!r})")
    if parts.query or parts.fragment:
        raise ValueError(f"siteUrl must not contain a query or fragment (got {value!r})")
    return value.rstrip("/") + "/"


def static_pages(root):
    """Root-level .html files that belong in the sitemap, sorted by name."""
    names = [
        n for n in os.listdir(root)
        if n.endswith(".html") and n not in SITEMAP_EXCLUDED_PAGES and os.path.isfile(os.path.join(root, n))
    ]
    return sorted(names)


def page_url(site_url, page):
    # index.html is the site root; every other page keeps its file name.
    # quote(safe="") turns the "&" in "l&p.html" into "%26".
    return site_url if page == "index.html" else site_url + quote(page, safe="")


def article_url(site_url, slug):
    return f"{site_url}article.html?slug={quote(slug, safe='')}"


def build_sitemap(site_url, pages, entries):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for page in pages:
        lines.append(f"  <url><loc>{escape(page_url(site_url, page))}</loc></url>")
    for entry in entries:
        lines.append(
            f"  <url><loc>{escape(article_url(site_url, entry['slug']))}</loc>"
            f"<lastmod>{entry['date']}</lastmod></url>"
        )
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# feeds/<lang>.xml
# --------------------------------------------------------------------------

def load_lang_strings(root, lang):
    path = os.path.join(root, "assets", "lang", f"{lang}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def rfc822(date_str):
    d = datetime.date.fromisoformat(date_str)
    moment = datetime.datetime(d.year, d.month, d.day, tzinfo=datetime.timezone.utc)
    return email.utils.format_datetime(moment)


def build_feed(site_url, lang, entries, strings):
    title = strings["nav.title"]
    description = strings["articles.lead"]
    feed_url = f"{site_url}{FEEDS_DIR}/{lang}.xml"
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "<channel>",
        f"  <title>{escape(title)}</title>",
        f"  <link>{escape(page_url(site_url, 'articles.html'))}</link>",
        f"  <description>{escape(description)}</description>",
        f"  <language>{escape(lang)}</language>",
    ]
    if entries:
        out.append(f"  <lastBuildDate>{rfc822(entries[0]['date'])}</lastBuildDate>")
    out.append(f'  <atom:link href={quoteattr(feed_url)} rel="self" type="application/rss+xml"/>')
    for entry in entries:
        chosen = pick_lang(entry["langs"], lang)
        data = entry["langs"][chosen]
        url = article_url(site_url, entry["slug"])
        out.append("  <item>")
        out.append(f"    <title>{escape(data['title'])}</title>")
        out.append(f"    <link>{escape(url)}</link>")
        out.append(f'    <guid isPermaLink="true">{escape(url)}</guid>')
        out.append(f"    <pubDate>{rfc822(entry['date'])}</pubDate>")
        out.append(f"    <description>{escape(data['excerpt'])}</description>")
        for tag in entry["tags"]:
            out.append(f"    <category>{escape(tag)}</category>")
        out.append("  </item>")
    out.append("</channel>")
    out.append("</rss>")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------

def load_site_url(root, cli_value=None, env=None):
    """CLI flag beats SITE_URL env var beats site.config.json."""
    env = os.environ if env is None else env
    if cli_value:
        return normalize_site_url(cli_value)
    if env.get("SITE_URL"):
        return normalize_site_url(env["SITE_URL"])
    path = os.path.join(root, CONFIG_PATH)
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            try:
                config = json.load(f)
            except json.JSONDecodeError as e:
                raise ValueError(f"{CONFIG_PATH} is not valid JSON: {e}") from e
        if not isinstance(config, dict):
            raise ValueError(f"{CONFIG_PATH} must contain a JSON object")
        return normalize_site_url(config.get("siteUrl"))
    return ""


def build_outputs(root, site_url, warn):
    """Return {relative_path: file_content} for every file this script owns."""
    articles_dir = os.path.join(root, "articles")
    entries = bai.collect_entries(warn, articles_dir)
    outputs = {SEARCH_INDEX_PATH: dump_json(build_search_index(entries, articles_dir))}
    if site_url:
        outputs[SITEMAP_PATH] = build_sitemap(site_url, static_pages(root), entries)
        for lang in SUPPORTED_LANGS:
            outputs[f"{FEEDS_DIR}/{lang}.xml"] = build_feed(site_url, lang, entries, load_lang_strings(root, lang))
    return outputs


def read_text_or_none(path):
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return f.read()
    except FileNotFoundError:
        return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="do not write; exit 1 if any output is stale")
    parser.add_argument("--site-url", help="absolute site URL, e.g. https://example.github.io/msk/")
    parser.add_argument("--root", default=ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    warnings = []

    def warn(msg):
        warnings.append(msg)
        print("WARN:", msg, file=sys.stderr)

    try:
        site_url = load_site_url(args.root, args.site_url)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    if not site_url:
        print(
            f'NOTE: no site URL configured, so {SITEMAP_PATH} and {FEEDS_DIR}/ were skipped. '
            f'Set "siteUrl" in {CONFIG_PATH} (or the SITE_URL environment variable).',
            file=sys.stderr,
        )

    outputs = build_outputs(args.root, site_url, warn)

    stale = []
    for rel, content in sorted(outputs.items()):
        path = os.path.join(args.root, *rel.split("/"))
        if read_text_or_none(path) == content:
            continue
        stale.append(rel)
        if not args.check:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(content)

    if args.check:
        if stale:
            print("Out of date (run: python3 scripts/build_search_and_feeds.py):", file=sys.stderr)
            for rel in stale:
                print(f"  {rel}", file=sys.stderr)
            return 1
        print(f"{len(outputs)} generated file(s) are up to date")
        return 0

    for rel in sorted(outputs):
        print(("Wrote " if rel in stale else "Unchanged ") + rel)
    if warnings:
        print(f"({len(warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
