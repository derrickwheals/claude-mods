# Prompt Upgrade

Turns a rough prompt into a great one before it is sent. It opens a pane, asks up to three quick multiple-choice questions, rewrites the prompt, and shows your original and the upgrade side by side. Nothing runs until you press Run it.

## Install

Type this at the prompt of a Claude Code terminal session. It needs Claude Code 2.1.275 or later and read access to the repository on GitHub.

```
/plugin install prompt-upgrade --marketplace derrickwheals/claude-mods
```

Answer `y` to add the marketplace, then choose the user scope. To try it from a clone instead, run `claude --plugin-dir <path to the prompt-upgrade folder>`.

## Commands

- `/better <your rough prompt>` upgrades that prompt.
- `/better` on its own opens a box to type one.
- `/better on` and `/better off` turn the automatic mode on and off. It is off until you turn it on.
- `/better history` shows your last 20 upgrades. Click one to reopen its review.

## Automatic mode

With automatic mode on, a prompt you type in the prompt box goes to the pane first instead of being sent. These go straight through untouched: slash commands, prompts with files or images attached, messages sent while Claude is working, short replies such as "yes" or "keep going", and anything starting with `>` (the `>` is removed and the rest is sent as typed).

## The four steps

Your prompt, Questions, Rewrite, Review. Each question has two to four options, an "Other (type it)" chip and a quiet Skip. On the review screen the buttons are Run it, Edit, Copy and Cancel. Cancel closes the pane and puts your original prompt back in the prompt box. If a model call fails you get a calm error card with Try again, Send my original and Cancel.

## Settings you may want to change

- The model used for both calls is `MODEL` in `hooks/logic.ts` (`haiku`).
- Your last 20 upgrades are kept in the mod's own store, not in files.

## Checks

```
claude plugin validate .
claude plugin test .
```
