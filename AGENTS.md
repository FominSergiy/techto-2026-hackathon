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

TBD. Record the choice in [decisions.md](docs/log/decisions.md), then summarize it here.

## Repo Structure

- `search.js`: the single entry point. Calls `hotel_search/`, prints the results table and saves CSV + JSON to `output/`. `--json` prints the records as one JSON line instead (what `server.js` runs in a child process, because `settings.js` reads `process.argv` once)
- `hotel_search/`: the search suite
  - `index.js`: runs every enabled source in parallel, merges to one row per hotel (cheapest offer), adds phone/address from Google Places, keeps only hotels in the search city
  - `settings.js`: city and region (City X), dates (default: next Saturday, 1 night), guests, currency, filters and enabled sources. Any value can be overridden on the command line (`--max-nightly-price=200`)
  - `sources.js`: the price sources, the `.env` keys each needs and whether it starts ticked (`defaultOn`) - drives the UI checkboxes and `index.js`
  - `xotelo.js`, `searchapi.js`, `liteapi.js`, `hotelbeds.js`, `apify-booking.js`, `expedia.js`: one price source each, also runnable on their own. `expedia.js` reads the real search page with Playwright (persistent profile in `.browser-profile/`, `HEADLESS=false` so a human can solve the bot check, `--dump-html=<file>` for selector fixes); its selectors are unverified
  - `places.js`: Google Places lookup that supplies phone numbers, street addresses and each hotel's real city
  - `locations.js`: looks up the TripAdvisor (Xotelo) and Hotelbeds location codes from the city, cached in `.cache/`
  - `report.js`: the single output format (name, city, address, phone, price, source, url) as table, CSV and JSON
  - `hotel-utils.js`: shared env loading, JSON fetching, paging, filtering and cheapest-first ranking
  - `maps.js`: standalone Google Places search (phone numbers, rough price level)
  - `test/`: offline Expedia parser and flow tests (fake pages, no network)
- `server.js`: web UI backend (plain `node:http`, no deps). Serves `public/index.html`, `GET /api/sources` and `POST /api/search {prompt, sources, places}`, which parses the prompt and runs `search.js --json`
- `prompt.js`: free-text prompt -> `search.js` CLI args. Claude (haiku) when `ANTHROPIC_API_KEY` is set, regex fallback otherwise; raw `--flags` in the prompt always win. `{ literal: true }` skips parsing for a reviewed prompt, `{ offline: true }` forces the regex parser
- `prompt_refine.js`: step 1 of the two-step UI flow (`POST /api/refine`). Rewrites a rough request into the full prompt that will run. The place is never read from the request: the city is `settings.js`'s `city` and the region is always Ontario (an ignored place is shown as a warning) (sentence + `--flags` for the price APIs, a full sentence asking for phones/addresses/source pages for Backboard) and lists what it assumed. The UI shows it, and the "Run" button then runs exactly that text. `node test/prompt-refine.js` runs the offline tests
- `public/index.html`: prompt textarea, a checkbox per API (disabled when its `.env` key is missing), and the results table. A separate "Backboard (web search)" card has its own textarea and button (`POST /api/backboard`)
- `backboard_search/`: Backboard (web-search model) as a hotel price source, self-contained. Prices are hints, not API rates. Needs `BACKBOARD_API_KEY`. Not yet a checkbox in the main search, see its README for the wiring. `node backboard_search/test.js` runs the offline tests
- `pricing.js`: experiment, on-device price finder (Places photos + hotel sites via local Ollama models). Found no usable prices, see `docs/log/features.md`
- Git-ignored at the repo root: `.env`, `output/`, `.cache/`, `.browser-profile/`, `expedia-dump*.html`

## How to Run

```bash
cp .env.example .env              # fill in the keys for the sources you use
node search.js                    # all sources in hotel_search/settings.js -> table + output/*.csv/json
node search.js --city=Paris --country-code=FR --sources=xotelo,searchapi --max-nightly-price=200
node server.js                    # web UI on http://localhost:3000 (prompt textarea -> results table)
DEMO=1 node server.js             # same UI, but every search shows the newest saved output/*.json - no API calls
node hotel_search/xotelo.js       # a single source (no key needed for Xotelo)
HEADLESS=false node hotel_search/expedia.js --dump-html=expedia-dump.html
node hotel_search/test/expedia-parse.js   # offline Expedia tests
```
