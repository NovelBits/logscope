#!/usr/bin/env python3
# INTERNAL-CHECK: allow (this script defines the patterns it checks for; pattern literals are not internal content)
"""
Detect internal or private content that must not appear in this public repo.

LogScope is open source. Internal business notes, monetization strategy,
references to private repositories, or explicit confidentiality markers
must live elsewhere (e.g., the private novelbits-brain repo).

Two layers of check:

1. Filename layer. Any path with a forbidden component (e.g., `private/`,
   `INTERNAL.md`, `roadmap-private.md`) fails. Patterns target intentional
   internal markings, not coincidental substrings like "internalize".

2. Content layer. Files containing high-confidence internal markers fail
   (e.g., references to the private brain repo, explicit DO NOT COMMIT
   labels, or specific business-strategy phrases that were previously
   identified as belonging to internal notes only).

Allow-list: a file can opt out of the content scan by including the marker
`INTERNAL-CHECK: allow` somewhere in its first 50 lines (commented appropriately
for the file's language). Useful for documents that legitimately discuss
internal topics in an external-facing way, or for the check script itself.

Run locally: python3 scripts/check-internal-content.py
GHA: triggers on every PR to main and every push to main.
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Directories skipped entirely (build outputs, dependencies, git internals).
SKIP_DIRS = {
    ".git",
    "node_modules",
    "out",
    "dist",
    "build",
    ".astro",
    ".vercel",
    ".worktrees",
    "__pycache__",
}

# Filename / directory-component patterns that are never allowed.
# Full-component match (not substring) to avoid false positives on words like
# "internalize" or "privatized".
FORBIDDEN_NAME_PATTERNS = [
    re.compile(r"^internal$", re.IGNORECASE),
    re.compile(r"^private$", re.IGNORECASE),
    re.compile(r"^confidential$", re.IGNORECASE),
    re.compile(r"^secrets?$", re.IGNORECASE),
    re.compile(r".+-internal(\..+)?$", re.IGNORECASE),
    re.compile(r".+-private(\..+)?$", re.IGNORECASE),
    re.compile(r".+-confidential(\..+)?$", re.IGNORECASE),
    re.compile(r"^INTERNAL[_.-].*"),
    re.compile(r"^PRIVATE[_.-].*"),
    re.compile(r"^CONFIDENTIAL[_.-].*"),
]

# Content patterns indicating internal material. Curated for high signal,
# low false-positive. Each entry is (human-readable reason, compiled regex).
CONTENT_DENYLIST = [
    # References to private repos / paths
    ("references the private brain repo path",
     re.compile(r"novelbits-brain", re.IGNORECASE)),
    ("references the private Claude business notes path",
     re.compile(r"\.claude/business", re.IGNORECASE)),
    # Explicit confidentiality markers. Case-sensitive: real markers are
    # always uppercase stamps. Normal prose like "we do not share" is a
    # privacy-policy sentence, not a confidentiality marker.
    ("explicit DO NOT COMMIT marker",
     re.compile(r"\bDO NOT COMMIT\b")),
    ("explicit DO NOT SHARE marker",
     re.compile(r"\bDO NOT SHARE\b")),
    ("explicit INTERNAL ONLY marker",
     re.compile(r"\bINTERNAL ONLY\b")),
    # Specific phrases identified as internal-only on 2026-05-16 (LogScope
    # ROADMAP audit). If they appear in a public file, that file leaked
    # internal content.
    ("Pro tier business model heading",
     re.compile(r"Pro tier \(business model\)", re.IGNORECASE)),
    ("Brand positioning notes heading",
     re.compile(r"##+\s*Brand positioning notes\b", re.IGNORECASE)),
    ("Candidate Pro features list header",
     re.compile(r"Candidate Pro features", re.IGNORECASE)),
]

# Allow marker: if a file contains this token in its first 50 lines,
# the content scan is skipped for that file.
ALLOW_MARKER = re.compile(r"INTERNAL-CHECK:\s*allow", re.IGNORECASE)

# Extensions to read for content checks. Binary files (images, vsix, fonts)
# are not scanned.
TEXT_EXTENSIONS = {
    ".md", ".mdx", ".txt", ".json", ".yaml", ".yml",
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".html", ".astro", ".svelte",
}


def is_in_skip_dir(rel_path):
    return any(part in SKIP_DIRS for part in rel_path.parts)


def check_filename(rel_path):
    findings = []
    for component in rel_path.parts:
        for pat in FORBIDDEN_NAME_PATTERNS:
            if pat.fullmatch(component):
                findings.append((component, pat.pattern))
                break
    return findings


def check_content(abs_path):
    if abs_path.suffix.lower() not in TEXT_EXTENSIONS:
        return []
    try:
        text = abs_path.read_text(errors="ignore")
    except (OSError, UnicodeDecodeError):
        return []

    head_lines = text.split("\n", 50)[:50]
    head = "\n".join(head_lines)
    if ALLOW_MARKER.search(head):
        return []

    findings = []
    for line_no, line in enumerate(text.split("\n"), start=1):
        for reason, pat in CONTENT_DENYLIST:
            m = pat.search(line)
            if m:
                findings.append((line_no, reason, m.group(0)))
    return findings


def main():
    failures = []
    files_scanned = 0
    for abs_path in REPO_ROOT.rglob("*"):
        if not abs_path.is_file():
            continue
        rel_path = abs_path.relative_to(REPO_ROOT)
        if is_in_skip_dir(rel_path):
            continue

        for component, pattern in check_filename(rel_path):
            failures.append(
                f"FORBIDDEN PATH: {rel_path} "
                f"(component '{component}' matches pattern '{pattern}')"
            )

        for line_no, reason, matched in check_content(abs_path):
            failures.append(
                f"FORBIDDEN CONTENT: {rel_path}:{line_no}: "
                f"{reason} (matched: {matched!r})"
            )

        files_scanned += 1

    if failures:
        print(
            f"Internal-content check FAILED ({files_scanned} files scanned):\n",
            file=sys.stderr,
        )
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        print(
            "\nThis repo is public. Files matching the denylist or containing\n"
            "internal markers must be moved to a private location (e.g., the\n"
            "novelbits-brain repo) before this commit can land. If the match is\n"
            "a documented exception, add the marker `INTERNAL-CHECK: allow`\n"
            "to the file's first 50 lines (commented for the file's language).\n",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Internal-content check PASSED ({files_scanned} files scanned)")
    print(f"  - 0 filename denylist matches")
    print(f"  - 0 content denylist matches")
    sys.exit(0)


if __name__ == "__main__":
    main()
