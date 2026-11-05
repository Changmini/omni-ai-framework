#!/usr/bin/env python3
"""Fails when tracked files contain personal data patterns.

Checks every git-tracked text file for real-looking account paths, email addresses,
phone numbers, Korean resident numbers and secret tokens. Generic placeholders
(user, u, x, me, runner, <name>) are allowed. Images cannot be checked; any tracked
image is listed so a person reviews it.

Usage: python3 .github/scripts/check-personal-data.py   (exit 1 on findings)
"""
import re
import subprocess
import sys

GENERIC_USERS = {"user", "u", "x", "me", "runner", "you", "example", "name", "username", "distro"}
ALLOWED_EMAIL = re.compile(r"(noreply@|@example\.(com|org|net)$|@users\.noreply\.github\.com$)")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")

PATTERNS = [
    ("account path", re.compile(r"(?:/home/|/Users/|[A-Za-z]:\\{1,2}Users\\{1,2})([A-Za-z0-9_.-]+)")),
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("phone number", re.compile(r"\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b")),
    ("resident registration number", re.compile(r"\b\d{6}-[1-4]\d{6}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
]


def tracked_files():
    out = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def main() -> int:
    findings, images = [], []
    for path in tracked_files():
        if path.lower().endswith(IMAGE_EXT):
            images.append(path)
            continue
        try:
            text = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for label, rx in PATTERNS:
                for m in rx.finditer(line):
                    if label == "account path" and (m.group(1).lower() in GENERIC_USERS or set(m.group(1)) == {"."}):
                        continue
                    if label == "email" and ALLOWED_EMAIL.search(m.group(0)):
                        continue
                    findings.append(f"{path}:{lineno}: {label}: {m.group(0)}")
    for f in findings:
        print(f"error: {f}")
    for img in images:
        print(f"review: image cannot be scanned automatically: {img}")
    print(f"\n{len(findings)} finding(s), {len(images)} image(s) to review")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
