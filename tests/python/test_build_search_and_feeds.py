"""Tests for scripts/build_search_and_feeds.py (standard library only).

Run:  python3 -m unittest discover -s tests/python -v
"""
import json
import os
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "scripts"))

import build_search_and_feeds as b  # noqa: E402


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


class HtmlToTextTests(unittest.TestCase):
    def test_collapses_whitespace_and_separates_blocks(self):
        self.assertEqual(b.html_to_text("<p>a</p><p>b</p>"), "a b")
        self.assertEqual(b.html_to_text("<ul><li>x</li><li>y</li></ul>"), "x y")
        self.assertEqual(b.html_to_text("a<br>b<br/>c"), "a b c")

    def test_keeps_inline_text_together(self):
        self.assertEqual(b.html_to_text("<p>un<strong>believ</strong>able</p>"), "unbelievable")

    def test_decodes_entities(self):
        self.assertEqual(b.html_to_text("<code>&lt;h2&gt;</code> &amp; &copy;"), "<h2> & \u00a9")

    def test_drops_script_style_and_comments(self):
        html = "<!--meta {\"title\": \"x\"} --><style>p{}</style><p>keep</p><script>alert(1)</script>"
        self.assertEqual(b.html_to_text(html), "keep")

    def test_void_script_like_self_closing_does_not_swallow_text(self):
        self.assertEqual(b.html_to_text("<p>a</p><img src='x.png'/><p>b</p>"), "a b")


class SiteUrlTests(unittest.TestCase):
    def test_normalizes_trailing_slash(self):
        self.assertEqual(b.normalize_site_url("https://x.github.io/msk"), "https://x.github.io/msk/")
        self.assertEqual(b.normalize_site_url("https://x.github.io/msk///"), "https://x.github.io/msk/")
        self.assertEqual(b.normalize_site_url("  "), "")
        self.assertEqual(b.normalize_site_url(None), "")

    def test_rejects_bad_urls(self):
        for bad in ["x.github.io/msk", "ftp://x/", "https://", "https://x/?a=1", "https://x/#top"]:
            with self.assertRaises(ValueError, msg=bad):
                b.normalize_site_url(bad)

    def test_precedence_cli_then_env_then_config(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root)
        write(os.path.join(root, "site.config.json"), json.dumps({"siteUrl": "https://config.test/"}))
        self.assertEqual(b.load_site_url(root, None, {}), "https://config.test/")
        self.assertEqual(b.load_site_url(root, None, {"SITE_URL": "https://env.test"}), "https://env.test/")
        self.assertEqual(b.load_site_url(root, "https://cli.test", {"SITE_URL": "https://env.test"}), "https://cli.test/")

    def test_missing_or_empty_config_means_no_url(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root)
        self.assertEqual(b.load_site_url(root, None, {}), "")
        write(os.path.join(root, "site.config.json"), json.dumps({"siteUrl": ""}))
        self.assertEqual(b.load_site_url(root, None, {}), "")

    def test_broken_config_is_reported(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root)
        write(os.path.join(root, "site.config.json"), "{not json")
        with self.assertRaises(ValueError):
            b.load_site_url(root, None, {})
        write(os.path.join(root, "site.config.json"), "[]")
        with self.assertRaises(ValueError):
            b.load_site_url(root, None, {})


class UrlTests(unittest.TestCase):
    def test_page_urls(self):
        base = "https://x.test/msk/"
        self.assertEqual(b.page_url(base, "index.html"), base)
        self.assertEqual(b.page_url(base, "about.html"), base + "about.html")
        self.assertEqual(b.page_url(base, "l&p.html"), base + "l%26p.html")

    def test_article_url_encodes_slug(self):
        self.assertEqual(b.article_url("https://x.test/", "a b&c"), "https://x.test/article.html?slug=a%20b%26c")

    def test_pick_lang_matches_articles_js(self):
        self.assertEqual(b.pick_lang({"id": 1, "ms": 2}, "ms"), "ms")
        self.assertEqual(b.pick_lang({"id": 1, "ms": 2}, "en"), "id")  # en missing -> en,id,ms order
        self.assertEqual(b.pick_lang({"ms": 2}, "en"), "ms")
        self.assertIsNone(b.pick_lang({}, "en"))


class BuildOutputsTests(unittest.TestCase):
    """Builds a tiny throwaway site and checks every output."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        for name in ["index.html", "about.html", "articles.html", "l&p.html", "article.html", "unit.html", "search.html"]:
            write(os.path.join(self.root, name), "<html></html>")
        for lang, title, lead in [("en", "Site", "Lead & more"), ("id", "Situs", "Pengantar"), ("ms", "Laman", "Pengenalan")]:
            write(os.path.join(self.root, "assets", "lang", f"{lang}.json"),
                  json.dumps({"nav.title": title, "articles.lead": lead}))
        a = os.path.join(self.root, "articles", "2026-03-01-first-post")
        write(os.path.join(a, "en.html"),
              '<!--meta {"title": "First <Post> & more", "excerpt": "An excerpt."}-->\n<p>Hello <b>world</b></p><p>Second</p>')
        write(os.path.join(a, "id.html"),
              '<!--meta {"title": "Tulisan Pertama", "excerpt": "Cuplikan."}-->\n<p>Halo dunia</p>')
        write(os.path.join(a, "meta.json"), json.dumps({"tags": ["intro", "a&b"]}))
        c = os.path.join(self.root, "articles", "2026-04-10-newer")
        write(os.path.join(c, "ms.html"), '<!--meta {"title": "Baharu", "excerpt": "Ringkas"}-->\n<p>Isi</p>')
        self.warnings = []

    def build(self, url="https://x.test/msk/"):
        return b.build_outputs(self.root, url, self.warnings.append)

    def test_search_index_content(self):
        index = json.loads(self.build()["assets/search-index.json"])
        self.assertEqual(index["version"], b.SEARCH_INDEX_VERSION)
        self.assertEqual([a["slug"] for a in index["articles"]], ["newer", "first-post"])  # newest first
        first = index["articles"][1]
        self.assertEqual(first["tags"], ["intro", "a&b"])
        self.assertEqual(sorted(first["langs"]), ["en", "id"])
        self.assertEqual(first["langs"]["en"]["body"], "Hello world Second")
        self.assertEqual(first["langs"]["id"]["body"], "Halo dunia")

    def test_without_site_url_only_the_search_index_is_built(self):
        self.assertEqual(sorted(self.build(url="")), ["assets/search-index.json"])

    def test_output_is_deterministic(self):
        self.assertEqual(self.build(), self.build())

    def test_sitemap_is_valid_and_complete(self):
        xml = self.build()["sitemap.xml"]
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = [u.find("s:loc", ns).text for u in ET.fromstring(xml).findall("s:url", ns)]
        self.assertEqual(urls, [
            "https://x.test/msk/about.html",
            "https://x.test/msk/articles.html",
            "https://x.test/msk/",
            "https://x.test/msk/l%26p.html",
            "https://x.test/msk/article.html?slug=newer",
            "https://x.test/msk/article.html?slug=first-post",
        ])
        self.assertIn("<lastmod>2026-04-10</lastmod>", xml)
        self.assertNotIn("unit.html", xml)
        self.assertNotIn("search.html", xml)

    def test_feeds_are_valid_rss_per_language(self):
        outputs = self.build()
        for lang in b.SUPPORTED_LANGS:
            root = ET.fromstring(outputs[f"feeds/{lang}.xml"])
            channel = root.find("channel")
            self.assertEqual(channel.find("language").text, lang)
            self.assertEqual(len(channel.findall("item")), 2)
            self.assertEqual(channel.find("link").text, "https://x.test/msk/articles.html")

    def test_feed_falls_back_like_the_site_does(self):
        outputs = self.build()
        en_items = ET.fromstring(outputs["feeds/en.xml"]).find("channel").findall("item")
        # 'newer' only exists in ms -> shown with its ms title in the en feed
        self.assertEqual([i.find("title").text for i in en_items], ["Baharu", "First <Post> & more"])
        id_items = ET.fromstring(outputs["feeds/id.xml"]).find("channel").findall("item")
        self.assertEqual([i.find("title").text for i in id_items], ["Baharu", "Tulisan Pertama"])

    def test_feed_escapes_special_characters(self):
        xml = self.build()["feeds/en.xml"]
        self.assertIn("First &lt;Post&gt; &amp; more", xml)
        self.assertIn("<category>a&amp;b</category>", xml)
        self.assertIn("Lead &amp; more", xml)

    def test_feed_dates_are_rfc822(self):
        xml = self.build()["feeds/en.xml"]
        self.assertIn("<pubDate>Fri, 10 Apr 2026 00:00:00 +0000</pubDate>", xml)
        self.assertIn("<lastBuildDate>Fri, 10 Apr 2026 00:00:00 +0000</lastBuildDate>", xml)

    def test_empty_site_still_builds(self):
        shutil.rmtree(os.path.join(self.root, "articles"))
        outputs = self.build()
        self.assertEqual(json.loads(outputs["assets/search-index.json"])["articles"], [])
        self.assertNotIn("<item>", outputs["feeds/en.xml"])
        self.assertNotIn("lastBuildDate", outputs["feeds/en.xml"])
        ET.fromstring(outputs["feeds/en.xml"])
        ET.fromstring(outputs["sitemap.xml"])


class CommandLineTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        write(os.path.join(self.root, "index.html"), "<html></html>")
        for lang in b.SUPPORTED_LANGS:
            write(os.path.join(self.root, "assets", "lang", f"{lang}.json"), json.dumps({"nav.title": "t", "articles.lead": "l"}))
        write(os.path.join(self.root, "articles", "2026-01-01-a", "en.html"), '<!--meta {"title":"A","excerpt":"e"}-->\n<p>x</p>')
        self.out = os.path.join(self.root, "assets", "search-index.json")

    def run_main(self, *args):
        stdout, stderr = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = open(os.devnull, "w")
        try:
            return b.main(["--root", self.root, *args])
        finally:
            sys.stdout.close()
            sys.stdout, sys.stderr = stdout, stderr

    def test_write_then_check_then_stale(self):
        self.assertEqual(self.run_main("--check"), 1)          # nothing written yet
        self.assertFalse(os.path.exists(self.out))             # --check never writes
        self.assertEqual(self.run_main(), 0)
        self.assertTrue(os.path.exists(self.out))
        self.assertEqual(self.run_main("--check"), 0)
        write(os.path.join(self.root, "articles", "2026-01-01-a", "en.html"), '<!--meta {"title":"A2","excerpt":"e"}-->\n<p>x</p>')
        self.assertEqual(self.run_main("--check"), 1)          # an edited article makes the index stale

    def test_bad_site_url_exits_2(self):
        self.assertEqual(self.run_main("--site-url", "not-a-url"), 2)

    def test_site_url_creates_sitemap_and_feeds(self):
        self.assertEqual(self.run_main("--site-url", "https://x.test/"), 0)
        self.assertTrue(os.path.exists(os.path.join(self.root, "sitemap.xml")))
        self.assertTrue(os.path.exists(os.path.join(self.root, "feeds", "id.xml")))


class RealRepositoryTests(unittest.TestCase):
    def test_committed_search_index_is_up_to_date(self):
        outputs = b.build_outputs(REPO, "", lambda m: None)
        with open(os.path.join(REPO, "assets", "search-index.json"), encoding="utf-8", newline="") as f:
            self.assertEqual(f.read(), outputs["assets/search-index.json"],
                             "run: python3 scripts/build_search_and_feeds.py")


if __name__ == "__main__":
    unittest.main()
