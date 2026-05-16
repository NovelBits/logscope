#!/usr/bin/env python3
"""
Verify marketing surfaces are in sync with the canonical features list.

Reads canonical truth from `marketing/listing.json` and verifies:
  * package.json `displayName` matches canonical exactly
  * package.json `description` mentions every canonical feature
  * README.md hero tagline (first bold line after the title) mentions every canonical feature
  * docs/src/content/docs/index.mdx hero.tagline mentions every canonical feature

Each feature has aliases so phrasing can vary across surfaces. Matching is
case-insensitive substring against the feature name and every alias.

Exit 0 on pass, non-zero on any failure. Used by the listing-sync GHA
workflow on PR-to-main and by publish.yml before vsce publish.

Run locally: python3 scripts/check-listing-sync.py
"""
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_canonical():
    path = REPO_ROOT / "marketing" / "listing.json"
    return json.loads(path.read_text())


def load_package_description_and_displayname():
    pkg = json.loads((REPO_ROOT / "package.json").read_text())
    return pkg.get("displayName", ""), pkg.get("description", "")


def load_readme_hero():
    """Return the first bold-wrapped line after the title in README.md."""
    readme = (REPO_ROOT / "README.md").read_text()
    for line in readme.split("\n"):
        s = line.strip()
        if s.startswith("**") and s.endswith("**") and len(s) > 4:
            return s.strip("*").strip()
    return ""


def load_docs_hero():
    """Return the hero.tagline value from docs/src/content/docs/index.mdx frontmatter."""
    docs_index = (REPO_ROOT / "docs" / "src" / "content" / "docs" / "index.mdx").read_text()
    fm_match = re.search(r"\A---\n(.*?)\n---", docs_index, re.DOTALL)
    if not fm_match:
        return ""
    frontmatter = fm_match.group(1)
    # tagline: appears under hero: with 2-space indent. Match until next sibling
    # frontmatter key or until end of frontmatter.
    tagline_match = re.search(
        r"^  tagline:\s*(.+?)(?=\n  [a-z_]+:|\n[a-z_]+:|\Z)",
        frontmatter,
        re.DOTALL | re.MULTILINE,
    )
    if tagline_match:
        return tagline_match.group(1).strip()
    return ""


def feature_in_text(feature, text):
    """True if the feature name or any of its aliases appears in text (case-insensitive)."""
    text_lower = text.lower()
    if feature["name"].lower() in text_lower:
        return True
    for alias in feature.get("aliases", []):
        if alias.lower() in text_lower:
            return True
    return False


def main():
    canonical = load_canonical()
    pkg_display, pkg_desc = load_package_description_and_displayname()
    readme_hero = load_readme_hero()
    docs_hero = load_docs_hero()

    surfaces = [
        ("package.json description", pkg_desc),
        ("README hero", readme_hero),
        ("docs/src/content/docs/index.mdx hero.tagline", docs_hero),
    ]

    failures = []

    if pkg_display != canonical["displayName"]:
        failures.append(
            "package.json displayName does not match canonical\n"
            f"    canonical: {canonical['displayName']}\n"
            f"    actual:    {pkg_display}"
        )

    for surface_name, surface_text in surfaces:
        if not surface_text:
            failures.append(f"{surface_name}: could not extract content")
            continue
        for feature in canonical["features"]:
            if not feature_in_text(feature, surface_text):
                failures.append(
                    f"{surface_name}: missing feature '{feature['name']}'"
                )

    if failures:
        print("Listing sync check FAILED:\n", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        print(
            "\nUpdate marketing/listing.json or the surface(s) above to match.",
            file=sys.stderr,
        )
        print(
            "Canonical features must trace to verified source code; do not advertise pre-UI features.",
            file=sys.stderr,
        )
        sys.exit(1)

    feature_count = len(canonical["features"])
    surface_count = len(surfaces)
    print("Listing sync check PASSED")
    print(f"  - displayName matches canonical")
    print(f"  - {feature_count} canonical features present in all {surface_count} surfaces")
    print(f"  - canonical source of truth: marketing/listing.json")
    sys.exit(0)


if __name__ == "__main__":
    main()
