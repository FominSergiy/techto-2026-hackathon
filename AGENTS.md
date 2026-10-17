# AGENTS.md

Guide for coding agents (and humans) working in this repo. Read this first.

## Purpose

Hackathon project: an AI agent that finds the cheapest hotel in City X, phones it to book a room, and emails the confirmation. Full brief: [docs/spec/hackathon-brief.md](docs/spec/hackathon-brief.md).

## Ground Rules

- **The spec wins.** Every decision must follow [the spec](docs/spec/hackathon-brief.md). If something conflicts with it, stop and flag it.
- **Hackathon mode.** Take the fastest path that works. Skip production hardening, heavy abstractions and exhaustive tests unless they help us win.
- **Competition rules:** no ready-made agents and no browser automation tools. The agent must make a real phone call and deliver the receipt by email.
- **Judged on time, cost, call handling and learnings.** Keep track of timing and token usage, and log learnings as you go.

## Docs Index

Every doc lives under `docs/`. Keep this table up to date when you add, rename or remove a doc.

| Path | Purpose | Tags |
|---|---|---|
| [docs/spec/hackathon-brief.md](docs/spec/hackathon-brief.md) | Mission, rules, required output, judging criteria, open questions | spec, requirements, judging, rules |
| [docs/architecture/run-workflow.md](docs/architecture/run-workflow.md) | End-to-end run: text prompt → parse → search → 5 calls → check-ins → email → tally; services, endpoints, failure paths, network | architecture, workflow, search, telephony, elevenlabs, backboard, coordination, email |
| [docs/architecture/architecture-plan.md](docs/architecture/architecture-plan.md) | Condensed plan: stack choices, runtime architecture, single-call lifecycle, coordinator routes, agent config, Backboard's role, token tally, suggested test runs | architecture, telephony, elevenlabs, backboard, coordination, tokens, testing |
| [docs/research/elevenlabs-backboard-field-guide.html](docs/research/elevenlabs-backboard-field-guide.html) | ElevenLabs + Backboard research: MCP status, pipeline, hold/IVR handling, coordinating parallel calls, test setup, token tally ([live artifact](https://claude.ai/artifact/LNTQDh9RvPumpS1tPmusPp) for comments) | research, telephony, elevenlabs, backboard, mcp, architecture, tokens, judging |
| [docs/log/decisions.md](docs/log/decisions.md) | Append-only log of short decisions | log, decisions |
| [docs/log/features.md](docs/log/features.md) | Append-only log of features and their status | log, features |

## Doc Conventions (keep everything searchable)

- Every file in `docs/` starts with YAML frontmatter:
  ```yaml
  ---
  title: Human Readable Title
  tags: [area, topic]
  status: draft | active | superseded
  updated: YYYY-MM-DD
  ---
  ```
- Filenames are `kebab-case.md`. Group docs by folder (`docs/spec/`, `docs/log/`, and new folders as needed).
- One `#` H1 per doc, plus descriptive `##` headings so `grep "^## "` gives a useful outline.
- Reuse existing tags before you invent new ones.
- Prefer short docs and link between them rather than repeating content.

## Logging

Two lightweight logs in `docs/log/`. Put the **newest entry at the top**, keep entries to a few lines, and follow the format at the top of each file.

- **[decisions.md](docs/log/decisions.md)**: add an entry whenever we choose a tool, provider, approach or trade-off, or change a past decision. Include *why*, and tie it to the spec when possible.
- **[features.md](docs/log/features.md)**: add an entry when a feature is planned, started or finished, and update its status in place. Put gotchas and learnings in `Notes`, because they feed the Learnings score.

Entry headings always look like `## YYYY-MM-DD — <title>` and are followed by a `tags:` line.

## How to Search

```bash
# list every doc with its tags
grep -rn "^tags:" docs/

# find docs on a topic
grep -rln "telephony" docs/

# outline of all log entries (date + title)
grep -n "^## " docs/log/*.md

# decisions about a specific area
grep -n -A4 "tags:.*telephony" docs/log/decisions.md
```

## Stack

Backend: Node.js, one process (see [architecture-plan.md](docs/architecture/architecture-plan.md)). Remaining choices are in [decisions.md](docs/log/decisions.md).

## Repo Structure

TBD. So far only `docs/` exists.

## How to Run

TBD.
