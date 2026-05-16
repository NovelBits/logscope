#!/usr/bin/env python3
# INTERNAL-CHECK: allow (this script generates release pages; documented purpose)
"""
Generate Starlight release pages from CHANGELOG.md.

Reads CHANGELOG.md at the repo root, parses each `## [version] - date`
section, and writes one Starlight markdown page per release into
`docs/src/content/docs/releases/`. Also regenerates the chronological
list inside `releases/index.mdx` between the markers
`<!-- RELEASES-LIST-START -->` and `<!-- RELEASES-LIST-END -->`.

Handles both `-` and `—` (em-dash) as the version-date separator in
the CHANGELOG header, plus optional annotations like
`## [0.6.0] - 2026-05-13 (superseded by 0.6.1)`.

Idempotent: running the script multiple times produces the same
output. Pages no longer present in CHANGELOG.md are removed from
the releases directory.

Run from repo root: python3 scripts/generate-release-pages.py
Or via npm script: cd docs && npm run gen:releases
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHANGELOG = REPO_ROOT / "CHANGELOG.md"
RELEASES_DIR = REPO_ROOT / "docs" / "src" / "content" / "docs" / "releases"
INDEX_FILE = RELEASES_DIR / "index.md"

# Match `## [0.6.5] - 2026-05-16` or `## [0.5.15] — 2026-04-30`,
# optionally followed by `(annotation)`.
HEADER_RE = re.compile(
    r"^##\s*\[(?P<version>[0-9.]+)\]\s*[-—]\s*"
    r"(?P<date>\d{4}-\d{2}-\d{2})"
    r"(?:\s*\((?P<annotation>[^)]+)\))?\s*$"
)

MARKER_START = "<!-- RELEASES-LIST-START -->"
MARKER_END = "<!-- RELEASES-LIST-END -->"


def parse_changelog():
    """Return a list of release dicts in the order they appear in CHANGELOG.md
    (newest first by convention)."""
    text = CHANGELOG.read_text()
    releases = []
    current = None
    body_lines = []

    for line in text.split("\n"):
        m = HEADER_RE.match(line)
        if m:
            if current is not None:
                current["body"] = "\n".join(body_lines).strip()
                releases.append(current)
                body_lines = []
            current = {
                "version": m["version"],
                "date": m["date"],
                "annotation": m["annotation"],
            }
        elif current is not None:
            body_lines.append(line)

    if current is not None:
        current["body"] = "\n".join(body_lines).strip()
        releases.append(current)

    return releases


def short_description(release):
    """Produce a concise human-readable description for SEO and the index list.
    Strategy:
      1. First `**Bold.**` lead in a bullet (most release-note items follow this pattern).
      2. Otherwise, the first non-empty, non-heading content line, truncated.
      3. Fallback: generic version string.
    """
    for line in release["body"].split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        m = re.match(r"^-\s+\*\*([^*]+?)\.?\*\*", stripped)
        if m:
            return m.group(1).strip().rstrip(".")
        # First plain content line: clean leading `- ` and truncate.
        cleaned = re.sub(r"^[-*]\s+", "", stripped)
        cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
        return cleaned[:140].rstrip()
    return f"LogScope v{release['version']} release notes"


def version_slug(version):
    """Convert `0.6.5` -> `v-0-6-5` for use as a Starlight slug and filename."""
    return "v-" + version.replace(".", "-")


def yaml_safe_quote(text):
    """Wrap text in YAML-safe double quotes, escaping inner double quotes."""
    return '"' + text.replace("\\", "\\\\").replace('"', "'") + '"'


def write_release_page(release):
    slug = version_slug(release["version"])
    desc = short_description(release)
    annotation_block = (
        f"\n*{release['annotation']}*\n" if release["annotation"] else ""
    )
    content = (
        "---\n"
        f"title: v{release['version']}\n"
        f"description: {yaml_safe_quote(desc)}\n"
        "---\n"
        "\n"
        f"**Released:** {release['date']}\n"
        f"{annotation_block}\n"
        f"{release['body']}\n"
    )
    out_path = RELEASES_DIR / f"{slug}.md"
    out_path.write_text(content)
    return out_path


def render_index_list(releases):
    """Render the chronological list of releases as markdown bullets."""
    lines = []
    for r in releases:
        slug = version_slug(r["version"])
        desc = short_description(r)
        annotation = f" _({r['annotation']})_" if r["annotation"] else ""
        lines.append(
            f"- **[v{r['version']}](/logscope/releases/{slug}/)** &mdash; "
            f"{r['date']} &mdash; {desc}{annotation}"
        )
    return "\n".join(lines)


def update_index(releases):
    if not INDEX_FILE.exists():
        print(
            f"ERROR: {INDEX_FILE} does not exist. Create it first with the marker pair.",
            file=sys.stderr,
        )
        return False

    text = INDEX_FILE.read_text()
    if MARKER_START not in text or MARKER_END not in text:
        print(
            f"ERROR: {INDEX_FILE} is missing the marker pair "
            f"{MARKER_START} / {MARKER_END}",
            file=sys.stderr,
        )
        return False

    pre, _, rest = text.partition(MARKER_START)
    _, _, post = rest.partition(MARKER_END)
    rendered = render_index_list(releases)
    new_text = f"{pre}{MARKER_START}\n\n{rendered}\n\n{MARKER_END}{post}"
    if new_text != text:
        INDEX_FILE.write_text(new_text)
    return True


def cleanup_stale_pages(releases):
    """Remove release page files that no longer correspond to a CHANGELOG entry."""
    valid_slugs = {version_slug(r["version"]) for r in releases}
    removed = []
    for path in RELEASES_DIR.glob("v-*.md"):
        if path.stem not in valid_slugs:
            path.unlink()
            removed.append(path.name)
    return removed


def main():
    RELEASES_DIR.mkdir(parents=True, exist_ok=True)

    releases = parse_changelog()
    print(f"Parsed {len(releases)} releases from CHANGELOG.md")

    for r in releases:
        write_release_page(r)
    print(f"Wrote {len(releases)} release page(s) to {RELEASES_DIR.relative_to(REPO_ROOT)}")

    removed = cleanup_stale_pages(releases)
    if removed:
        print(f"Removed {len(removed)} stale page(s): {', '.join(removed)}")

    if INDEX_FILE.exists():
        if update_index(releases):
            print(f"Updated {INDEX_FILE.name} with {len(releases)} releases")
    else:
        print(
            f"WARNING: {INDEX_FILE} does not exist; create it before running again",
            file=sys.stderr,
        )

    print("Done.")


if __name__ == "__main__":
    main()
