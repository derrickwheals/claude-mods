# Rename Session

Renames the Claude Code session when an ai-sdlc step starts, so the session list shows which backlog item each one is working on. The name is the backlog item's key, an underscore and a short slug, for example `SKL-001_mod_rename_session`.

## Install

Type this at the prompt of a Claude Code terminal session. It needs Claude Code 2.1.275 or later and read access to the repository on GitHub.

```
/plugin install rename-session --marketplace derrickwheals/claude-mods
```

Answer `y` to add the marketplace, then choose the user scope. To try it from a clone instead, run `claude --plugin-dir <path to the rename-session folder>`.

## What triggers it

The five ai-sdlc steps that are about one item: `/ai-sdlc:intent`, `/ai-sdlc:spec`, `/ai-sdlc:plan`, `/ai-sdlc:build` and `/ai-sdlc:review`. `/ai-sdlc:status` and `/ai-sdlc:adopt` are not about one item and never rename.

- Typed in the prompt box, the session is renamed straight away and a toast says so.
- Started by Claude through the Skill tool (for example "start on DW-006"), the name is worked out in the background and applied with your next prompt. Claude Code only lets a plugin set the session title when a prompt is submitted.

## Where the key and the slug come from

The key is the backlog reference, such as `DW-006`. The slug is two to four words made by a quick Haiku call from the item's title, with the first few meaningful words of the title as the fallback if the call fails.

For the argument given to the step, in this order:

1. A change id or folder (`2026-10-21-rename-session`): the key is in the `backlog:` line of that change's `intent.md`, the title is its `title:`.
2. A backlog key (`DW-006`): the `intent.md` under `docs/changes/` whose `backlog:` line holds the key, else the Todoist task whose title starts with the key (`DW-006 — Title`), else the words typed after the key.
3. A path to a backlog note (`backlog/something.md`): the key from its name or `item:` line, the title from `title:` or its first heading.
4. Nothing: for `plan`, `build` and `review`, the change named by a `change/<id>` branch. If the branch is not one, the session is not renamed.
5. Free text (`/ai-sdlc:intent Add dark mode`): the slug alone, because there is no backlog key to put in front of it. Claude never invents a key.

An item keeps the slug it was first given, so its intent, plan and build sessions share one name. Those slugs are kept in the mod's own store.

## Notes

- Todoist is read through the `claude.ai Todoist` connector, only to find a task by its key. If it is not connected, the lookup is skipped within five seconds and the words typed are used.
- The model used for the slug is `MODEL` in `hooks/logic.ts` (`haiku`).
- A name you set yourself with `/rename` is replaced the next time one of the five steps starts.

## Checks

```
claude plugin validate .
claude plugin test .
```
