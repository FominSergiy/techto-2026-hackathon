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

TBD. Record the choice in [decisions.md](docs/log/decisions.md), then summarize it here.

## Repo Structure

- `settings.js`: city and region (City X), dates (default: next Saturday, 1 night), guests, currency, filters and enabled sources. Any value can be overridden on the command line.
- `search.js`: the suite. Runs every enabled source in parallel, merges to one row per hotel (cheapest offer), adds phone/address from Google Places, prints a table and saves CSV + JSON to `output/`
- `sources.js`: the list of price sources and the `.env` keys each needs (drives the UI checkboxes and `search.js`)
- `server.js`: web UI backend (plain `node:http`, no deps). Serves `public/index.html` and `POST /api/search {prompt}`, which parses the prompt and runs `search-json.js` in a child process
- `prompt.js`: free-text prompt -> `search.js` CLI args. Claude (haiku) when `ANTHROPIC_API_KEY` is set, regex fallback otherwise; raw `--flags` in the prompt always win
- `search-json.js`: child entry that runs the suite and prints the records as JSON (needed because `settings.js` reads `process.argv` once)
- `public/index.html`: prompt textarea, a checkbox per API (disabled when its `.env` key is missing), and the results table
- `places.js`: Google Places lookup that supplies phone numbers and street addresses
- `report.js`: the single output format (name, city, address, phone, price, source, url) as table, CSV and JSON
- `xotelo.js`, `searchapi.js`, `liteapi.js`, `hotelbeds.js`, `apify-booking.js`: one hotel price source each, also runnable on their own
- `locations.js`: looks up the TripAdvisor (Xotelo) and Hotelbeds location codes from the city, cached in `.cache/`
- `hotel-utils.js`: shared env loading, JSON fetching, paging, filtering and cheapest-first ranking
- `maps.js`: Google Places search (phone numbers, rough price level)
- `expedia.js`: Playwright scraper. Against the no-browser-automation rule, reference only.

## How to Run

```bash
cp .env.example .env    # fill in the keys for the sources you use
node search.js          # the suite: all sources in settings.sources -> table + output/*.csv/json
node server.js          # web UI on http://localhost:3000 (prompt textarea -> results table)
DEMO=1 node server.js   # same UI, but every search shows the newest saved output/*.json - no API calls
node xotelo.js          # a single source (no key needed for Xotelo)
node search.js --city=Paris --country-code=FR --sources=xotelo,searchapi --max-nightly-price=200
```
