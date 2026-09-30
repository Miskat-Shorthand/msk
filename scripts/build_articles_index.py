#!/usr/bin/env python3
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTICLES_DIR = os.path.join(ROOT, "articles")
OUT_PATH = os.path.join(ROOT, "assets", "articles-index.json")
SUPPORTED_LANGS = ["en", "id", "ms"]
FOLDER_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)$")
META_RE = re.compile(r"^\s*<!--\s*meta\s*(\{.*?\})\s*-->", re.DOTALL)
WORDS_PER_MIN = 200
EXCERPT_LEN = 180
AUTO_THUMB_NAMES = ["thumb.jpg", "thumb.jpeg", "thumb.png", "thumb.webp", "thumb.gif", "thumb.svg"]


def find_thumbnail(folder, name, extra, warn):
    """Returns the site-root-relative thumbnail path for an article, or None.

    Priority: an explicit "thumbnail" filename in meta.json, else the first
    auto-detected thumb.* file sitting in the article's own folder.
    """
    explicit = extra.get("thumbnail")
    if explicit:
        if os.path.isfile(os.path.join(folder, explicit)):
            return f"articles/{name}/{explicit}"
        warn(
            f"meta.json in '{name}' points \"thumbnail\" at '{explicit}', "
            "but that file doesn't exist — ignoring"
        )
        return None
    for candidate in AUTO_THUMB_NAMES:
        if os.path.isfile(os.path.join(folder, candidate)):
            return f"articles/{name}/{candidate}"
    return None


def strip_tags(html):
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def read_lang_file(path, warn):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    m = META_RE.match(raw)
    meta = {}
    body = raw
    if m:
        try:
            meta = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            warn(f"bad meta JSON in {path}: {e}")
        body = raw[m.end():]
    else:
        warn(
            f"{path} has no leading <!--meta {{...}} --> comment — "
            "title will fall back to the slug"
        )
    body = body.strip()
    text = strip_tags(body)
    title = meta.get("title") or None
    excerpt = meta.get("excerpt")
    if not excerpt:
        excerpt = text[:EXCERPT_LEN].rsplit(" ", 1)[0] + "…" if len(text) > EXCERPT_LEN else text
    words = len(text.split())
    read_mins = max(1, round(words / WORDS_PER_MIN))
    return {"title": title, "excerpt": excerpt, "readMins": read_mins}


def main():
    warnings = []

    def warn(msg):
        warnings.append(msg)
        print("WARN:", msg, file=sys.stderr)

    entries = []
    if not os.path.isdir(ARTICLES_DIR):
        warn("no articles/ directory found — writing an empty index")
    else:
        for name in sorted(os.listdir(ARTICLES_DIR)):
            folder = os.path.join(ARTICLES_DIR, name)
            if not os.path.isdir(folder):
                continue
            m = FOLDER_RE.match(name)
            if not m:
                warn(f"skipping '{name}' — folder name must look like YYYY-MM-DD-slug")
                continue
            date_str, slug = m.group(1), m.group(2)
            try:
                datetime.date.fromisoformat(date_str)
            except ValueError:
                warn(f"skipping '{name}' — '{date_str}' is not a valid date")
                continue

            tags = []
            extra = {}
            meta_json_path = os.path.join(folder, "meta.json")
            if os.path.isfile(meta_json_path):
                try:
                    with open(meta_json_path, encoding="utf-8") as f:
                        extra = json.load(f)
                    tags = [str(t) for t in extra.get("tags", [])]
                except Exception as e:
                    warn(f"bad meta.json in '{name}': {e}")

            thumbnail = find_thumbnail(folder, name, extra, warn)

            langs = {}
            for lang in SUPPORTED_LANGS:
                lp = os.path.join(folder, f"{lang}.html")
                if os.path.isfile(lp):
                    entry = read_lang_file(lp, warn)
                    if not entry["title"]:
                        entry["title"] = slug.replace("-", " ").title()
                    langs[lang] = entry

            if not langs:
                warn(f"skipping '{name}' — no en.html/id.html/ms.html found inside it")
                continue

            author = extra.get("author") or None

            entries.append({
                "slug": slug,
                "folder": name,
                "date": date_str,
                "tags": tags,
                "thumbnail": thumbnail,
                "author": author,
                "langs": langs,
            })

    entries.sort(key=lambda e: (e["date"], e["slug"]), reverse=True)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
        f.write("\n")

    message = f"Wrote {len(entries)} article(s) to {os.path.relpath(OUT_PATH, ROOT)}"
    if warnings:
        message += f" ({len(warnings)} warning(s))"
    print(message)


if __name__ == "__main__":
    main()
