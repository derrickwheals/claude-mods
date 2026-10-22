#!/usr/bin/env python3
"""UserPromptSubmit hook: name the session KEY_slug when an ai-sdlc step starts.

A settings-hook port of the rename-session mod, for machines where the mod's hooks are bypassed by cc-plugin-sec-default. No Todoist or model call: the key and title come from the change's intent.md.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

COMMAND = re.compile(r"^/ai-sdlc:(intent|spec|plan|build|review)(?:\s+([\s\S]*))?$")
KEY = re.compile(r"\b([A-Z]{2,5}-\d{3,})\b")
CHANGE_ID = re.compile(r"\b(\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*)")
STOP = {"a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "so", "that", "this", "is", "be", "it", "as", "at", "by", "from", "when", "its"}
SCAN_MAX = 40


def frontmatter(text):
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---", text)
    out = {}
    for line in (m.group(1) if m else "").splitlines():
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if kv:
            out[kv.group(1)] = kv.group(2).strip().strip("\"'")
    return out


def slugify(text):
    words = [w for w in re.findall(r"[a-z0-9]+", KEY.sub(" ", text).lower()) if w not in STOP]
    return "_".join(words[:4])[:40]


def read_intent(path):
    try:
        fm = frontmatter(path.read_text())
    except OSError:
        return None
    m = KEY.search(fm.get("backlog", ""))
    return (m.group(1) if m else "", fm.get("title", ""))


def branch_change(cwd):
    try:
        b = subprocess.run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""
    return b[len("change/"):] if b.startswith("change/") else ""


def resolve(step, arg, cwd):
    changes = Path(cwd) / "docs" / "changes"
    cid = CHANGE_ID.search(arg)
    if cid:
        hit = read_intent(changes / cid.group(1) / "intent.md")
        if hit:
            return hit
    key = KEY.search(arg)
    if key:
        folders = sorted((p for p in changes.glob("*/intent.md")), reverse=True)[:SCAN_MAX]
        for p in folders:
            hit = read_intent(p)
            if hit and hit[0] == key.group(1):
                return hit
        return (key.group(1), KEY.sub(" ", arg).strip())
    if not arg and step in ("plan", "build", "review"):
        cid = branch_change(cwd)
        if cid:
            return read_intent(changes / cid / "intent.md")
        return None
    return ("", arg) if arg else None


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    m = COMMAND.match(str(event.get("prompt", "")).strip())
    if not m:
        return
    item = resolve(m.group(1), (m.group(2) or "").strip(), event.get("cwd") or ".")
    if not item:
        return
    key, topic = item
    slug = slugify(topic)
    title = "_".join(p for p in (key, slug) if p)
    if not title:
        return
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "sessionTitle": title}}))


if __name__ == "__main__":
    main()
