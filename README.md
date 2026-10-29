# uhd-kanban: a Markdown Kanban board for Claude Code

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](plugins/uhd-kanban/LICENSE)
[![Plugin version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fhwanyong%2Fskill-kanban%2Fmain%2Fplugins%2Fuhd-kanban%2F.claude-plugin%2Fplugin.json&query=%24.version&label=plugin&color=blue)](plugins/uhd-kanban/.claude-plugin/plugin.json)
[![Claude Code 2.1.312+](https://img.shields.io/badge/Claude%20Code-2.1.312%2B-D97757)](https://github.com/anthropics/claude-code)
[![Node.js 21+](https://img.shields.io/badge/node-%3E%3D21-339933?logo=node.js&logoColor=white)](https://nodejs.org)

English | [한국어](README.ko.md)

**uhd-kanban** is a Claude Code plugin that keeps a per-project Kanban board as plain Markdown files in `kanban/`. The main Claude Code session splits a request into cards, starts one background session (`claude --bg`) per card, and reviews each result. A side pane in Claude Code shows how many cards each column holds and whether each card session is running.

![The uhd-kanban board monitor pane in Claude Code. A header line reads "13:20 · 9 columns · 502 cards · every 60s", and a legend line reads "in-progress: live pending stalled done". Below the column counts 261, 28, 6, 160, 22, 4, 11, 6, 4, nine vertical bars, one per column, grow downward; each card is one colored cell. The in-progress bar contains green cells for card sessions that are running.](docs/images/board-monitor-502-cards.en.png)

*A board with 502 cards in the board monitor pane. The pane shows counts and session states only; card titles are not displayed.*

> [!NOTE]
> Command output, card session prompts and pane labels are available in English and Korean (see [Language](#language)). The skill documents (`SKILL.md`) are written in Korean and include English trigger phrases.

## Contents

- [Why uhd-kanban](#why-uhd-kanban)
- [What is in the plugin](#what-is-in-the-plugin)
- [Quick start](#quick-start)
- [Language](#language)
- [How the board is stored](#how-the-board-is-stored)
- [Delegating work to card sessions](#delegating-work-to-card-sessions)
- [Commands](#commands)
- [Board monitor pane](#board-monitor-pane)
- [Requirements](#requirements)
- [FAQ](#faq)
- [Credits](#credits)
- [License](#license)

## Why uhd-kanban

| Feature | What it does |
|---|---|
| Plain files | One card is one `.md` file. The column is the directory name and the order is the number prefix of the file name, so `ls`, `git diff` and any editor show the board. No server, no database, no account. |
| Delegation | The main session does not write code. Each card runs in its own `claude --bg` session that receives only the card body as its prompt, so the main session's context does not fill with implementation details. |
| Edit guard | A hook asks the user before the main session edits a project file with Edit, Write or NotebookEdit. The question appears in every permission mode, including `bypassPermissions`. |
| Dependencies and a parallel limit | `depends_on` keeps a card from starting before the cards it waits for are finished. `run.max_parallel` (default 3) caps the number of card sessions that run at once. |
| Recovery | `uk recover` resumes card sessions that stopped or were respawned by the daemon, and records the new session id on the card. |
| Board monitor | A pane draws one cell per card and colors the cells of the in-progress column by session state. It refreshes every 60 seconds by default. |

## What is in the plugin

| Component | Path | Purpose |
|---|---|---|
| Skill `uhd-kanban` | [`plugins/uhd-kanban/skills/uhd-kanban/`](plugins/uhd-kanban/skills/uhd-kanban/SKILL.md) | Create, move, reorder, comment on and archive cards. Run a card as a `claude --bg` session. Resume stopped sessions. |
| Skill `delegate` | [`plugins/uhd-kanban/skills/delegate/`](plugins/uhd-kanban/skills/delegate/SKILL.md) | Rules for the main session of a project with a board: split work into cards, run them with `uk run`, review results, move cards. |
| Hooks module | [`plugins/uhd-kanban/hooks/register.tsx`](plugins/uhd-kanban/hooks/register.tsx) | Opens the board monitor pane when `.uhd-kanban/config.json` exists above the session directory, registers the `/kanban-board` command, and runs `uk guard` before Edit, Write and NotebookEdit. |

## Quick start

1. Install the plugin from this repository's marketplace inside Claude Code:

   ```
   /plugin marketplace add hwanyong/skill-kanban
   /plugin install uhd-kanban@skill-kanban
   ```

2. Create a board in the project root. Ask Claude to initialize a uhd-kanban board, or run the command yourself:

   ```sh
   node ~/.claude/plugins/cache/skill-kanban/uhd-kanban/<version>/skills/uhd-kanban/bin/uhd-kanban.mjs init --locale en
   ```

   This creates `.uhd-kanban/config.json`, `.uhd-kanban/profiles.json` and `kanban/`. If they already exist, nothing is changed and the command exits with code 1.

3. Open `claude` once in the project root and accept the workspace trust dialog. `claude --bg` does not inherit trust from parent directories, so `uk run` fails with `Workspace not trusted` until you do.

4. Give the main session a task. With the `delegate` skill, it splits the task into cards, starts them with `uk run`, and reports card ids, results and open decisions back to you.

To install from a local clone instead, run `claude plugin marketplace add <folder>` and then `claude plugin install uhd-kanban@skill-kanban`. Claude Code then reads that folder directly; run `/reload-plugins` after editing it.

## Language

Each board has one language, set by `locale` in `.uhd-kanban/config.json` (`en` or `ko`). It selects the language of command output, of the prompts given to card sessions, and of the board monitor pane. `uk init --locale en|ko` writes it; without `--locale`, `init` takes it from `LC_ALL`, `LC_MESSAGES` or `LANG` at that moment (a value starting with `ko` gives `ko`, anything else `en`). A board without `locale` follows those variables on every run.

Values written into card files do not depend on the language. Statuses, types and comment kinds are English ids such as `progress`, `question` and `result`. A Korean board shows a kind as `progress(진행)`.

Boards created with 0.4.0 or earlier recorded comment kinds as Korean words. `uk check` reports this, and `uk migrate` converts them:

```sh
uk migrate --dry-run   # prints what would change
uk migrate             # rewrites comments.kinds, adds "locale": "ko", and rewrites comment header lines in every card
```

Only the `### c<n> [<kind>]` header lines and two lines of `config.json` change. Running it again changes nothing. `uk comment --kind` and `uk inbox --kind` still accept the 14 old Korean words (`lib/kinds.mjs`) and record the id, so card sessions started before the migration keep working.

## How the board is stored

| Path | Content |
|---|---|
| `.uhd-kanban/config.json` | Columns, the initial column per card type, order numbering, dependency rules, comment kinds, archive rules, `run` settings and `monitor` settings |
| `.uhd-kanban/profiles.json` | Maps `model:` tag profiles to `claude --model` values |
| `kanban/<n>-<status>/<order>-k<id>-<title>.md` | A card in a column, for example `kanban/1-to-do/0010-k457-fix-login-error.md` |
| `kanban/archived/<YYYY-MM>/<YYYY-MM-DD>-k<id>-<title>.md` | An archived card. The date is the date of `completed_at`. |

A card is YAML frontmatter, a body, and a `## Comments` section. `uk run` uses the body as the prompt of the card session.

```markdown
---
id: 457
type: task
title: Fix login error
priority: high
tags: [model:deep, effort:high]
depends_on: [455]
created_at: 2026-10-29T08:00:00Z
updated_at: 2026-10-29T09:10:00Z
---

Goal, files to change, what not to do, and how to verify the result.

## Comments

### c1 [assign] from=user to=k457 at=2026-10-29T09:00:00Z

Started with claude --bg. session=… model=opus(model:deep) effort=high
```

Frontmatter, file names and directories are changed only through commands. The commands take a lock (the `.uhd-kanban/lock/` directory) and update the file name and the frontmatter together. After editing a card body by hand, run `uk check`.

### Default columns

| Directory | `status` | Card types it accepts | Meaning |
|---|---|---|---|
| `1-to-do` | `to-do` | task, bug, decision | Not started |
| `2-in-progress` | `in-progress` | task, bug, decision | A card session is working on it |
| `3-in-review` | `in-review` | task, bug | Implemented, waiting for review |
| `4-done` | `done` | task, bug, decision, milestone | Finished |
| `5-decided` | `decided` | decision | Decided, not yet applied |
| `6-planned` | `planned` | milestone | Planned milestone |
| `7-implemented` | `implemented` | decision | Decision applied to the code |
| `8-cancelled` | `cancelled` | task, bug, decision | Will not be done |
| `9-active` | `active` | milestone | Milestone in progress |

| Card type | Column order |
|---|---|
| task, bug | `to-do` → `in-progress` → `in-review` → `done`, or `cancelled` |
| decision | `to-do` → `in-progress` → `decided` → `implemented`, or `done` when no code change is needed, or `cancelled` |
| milestone | `planned` → `active` → `done` |

## Delegating work to card sessions

`uk run k457` does four things:

1. Converts the card's `model:<profile>` tag to `--model` through `profiles.json`, and passes an `effort:<value>` tag as `--effort`.
2. Moves the card to the `run.status` column (`in-progress`) after the same dependency check as `uk move`.
3. Runs `claude --bg --dangerously-skip-permissions -n k457 --model … <prompt>` in the project root. The prompt is the card body plus instructions for leaving `progress`, `question` and `result` comments and for moving the card after the result.
4. Writes `session` and `session_started_at` to the card and adds an `assign` comment.

Card sessions run without permission prompts because nobody is present to answer them. They all share the project's working tree, so cards that change the same files, generated files or devices must be ordered with `depends_on`.

| Tag | `--model` |
|---|---|
| `model:top` | `fable` |
| `model:deep-1m` | `opus[1m]` |
| `model:deep` | `opus` |
| `model:standard` | `sonnet` |
| `model:fast` | `haiku` |
| `model:user` | none. The card is for a person and `uk run` does not start it. |

Card sessions report back through comments. `uk comment` appends a comment and prints a `SendMessage` line for the recipient session, and `uk inbox` lists comments addressed to a session that have not been answered.

## Commands

In the skill documents, `uk` stands for `node <skill folder>/bin/uhd-kanban.mjs`. You usually do not type these commands; Claude runs them through the skills. Cards are referred to as `k457` or `457`.

| Command | What it does |
|---|---|
| `uk init` | Creates `.uhd-kanban/` and `kanban/`. `--locale en\|ko` sets the board language |
| `uk check` | Validates the configuration and every card without changing files |
| `uk new` | Creates a card |
| `uk move` | Moves a card to another column, with dependency checks |
| `uk order` | Changes a card's position within its column |
| `uk renumber` | Renumbers the order prefixes of one column |
| `uk set` | Changes title, priority, tags, `depends_on` or `collection` |
| `uk archive` | Moves finished cards older than `archive.after_days` (default 7) to `kanban/archived/` |
| `uk comment` | Appends a comment and prints the `SendMessage` line |
| `uk inbox` | Lists unanswered comments addressed to a session |
| `uk run` | Starts a card as a `claude --bg` session |
| `uk recover` | Resumes stopped card sessions with `claude --bg --resume` |
| `uk guard` | Decides whether a session may edit a file (used by the hook) |
| `uk board` | Prints card counts per column and session states (used by the pane) |
| `uk migrate` | Converts a board made with 0.4.0 or earlier to English kind ids and adds `locale` |
| `uk locale` | Prints the language used in the current directory (used by the pane) |

Exit codes: `0` success, `1` rule violation or failure (details on stderr), `2` usage error, `3` no board above the current directory. Full options are in [`SKILL.md`](plugins/uhd-kanban/skills/uhd-kanban/SKILL.md#명령).

Example output of `uk board` for the demo board below (`locale` `en`):

```
1-to-do 7
2-in-progress 3 (sessions: live 2 · none 1)
3-in-review 2
4-done 8
5-decided 1
6-planned 0
7-implemented 1
8-cancelled 1
9-active 1
```

## Board monitor pane

![The board monitor pane for a demo board with 24 cards in 9 columns. A legend line reads "in-progress: live pending stalled done". The column counts read 7, 3, 2, 8, 1, 0, 1, 1, 1. In the second bar, the in-progress column, two cells are green because two card sessions are running, and one cell keeps the column color because that card has no session.](docs/images/board-monitor-demo.en.png)

*A demo board with 24 fictional cards and two running card sessions.*

The pane opens when the session directory has `.uhd-kanban/config.json` above it. The counts row at the top lists the number of cards per column in the order of `config.json` `columns`, and each bar grows downward with one cell per card. If a pane was closed, `/kanban-board` opens it again.

| Cell color in the in-progress column | Legend label | Session state |
|---|---|---|
| Green | `live` | Running |
| Yellow | `pending` | Being respawned |
| Red | `stalled` | Stopped (resume with `uk recover`) |
| Gray | `done` | Finished |
| Column color | - | The card has no session |

The refresh interval is `monitor.interval_seconds` in `config.json` (an integer of 10 or more, default 60).

## Requirements

- Claude Code 2.1.312 or later (the hooks module API was checked against this version)
- Node.js 21 or later on `PATH` (`Object.groupBy`)
- Developed on macOS. Other platforms have not been verified.

## FAQ

### What is uhd-kanban?

A Claude Code plugin that stores a Kanban board as Markdown files inside the project and lets the main Claude Code session hand each card to its own background session. It contains two skills (`uhd-kanban` and `delegate`) and a hooks module that draws the board monitor pane.

### Does it need a server, a database or an account?

No. The board is the `kanban/` directory and `.uhd-kanban/` configuration. Commands are a Node.js script that reads and writes these files.

### How is it different from a hosted issue tracker?

The board is part of the repository, so cards are versioned with the code and Claude sessions read and write them with file commands. A hosted tracker keeps cards outside the repository and needs an API and an account.

### How many card sessions can run at the same time?

Three by default. Set `run.max_parallel` in `.uhd-kanban/config.json` to another positive integer, or to `-1` for no limit. `uk run` refuses to start a card when the limit is reached and exits with code 1.

### Can I edit cards by hand?

You can edit the card body (the part before `## Comments`) and then run `uk check`. Change frontmatter, file names and columns with `uk new`, `uk set`, `uk move` and `uk order`, and add comments with `uk comment`.

### What happens when a card session stops?

`uk board` and the pane show it as stopped. `uk recover` resumes it with `claude --bg --resume`, writes the new session id to the card, and adds an `assign` comment. A card that came back from review is resumed with `uk recover --force k<id>`.

### Does it work with git worktrees?

Yes. When a command runs inside a git worktree, it uses the board of the main worktree, so card ids and order numbers stay in one place.

### Can the main session still edit files when I ask it to?

Yes. The edit guard asks instead of refusing. Approve the confirmation prompt for that request.

## Credits

Written from scratch in Node.js ESM with reference to [mattjoyce/kanban-skill](https://github.com/mattjoyce/kanban-skill) (commit b86a6ec, Apache-2.0).

## License

[MIT](plugins/uhd-kanban/LICENSE)
