---
title: Decision Log
tags: [log, decisions]
status: active
updated: 2026-10-17
---

# Decision Log

Short, append-only record of decisions. **Newest entry at the top.** Keep each entry to a few lines.

Entry format:

    ## YYYY-MM-DD — <short title>
    tags: decision, <area>
    - Decision: what we chose
    - Why: reason, ideally tied to the spec
    - Alternatives: what we rejected (optional)

<!-- Add new entries below this line -->

## 2026-10-17 — The place is fixed: city from settings.js, region always Ontario
tags: decision, ui, prompt, search
- Decision: The review step (`prompt_refine.js`) ignores any city, region or country in the request. The city is `settings.js`'s `city` (City X, edited once it is revealed), the region is always Ontario and the country is `settings.countryCode`. If the request names another place, the review panel warns that it was ignored.
- Why: The task is one known city, and a place parsed from loose text (or guessed by Haiku) was the main way a run could search the wrong city (Aurora, IL, or a default region with the wrong city). The place is not a per-run input.
- Alternatives: Still reading the city from the prompt (the previous behaviour, wrong city is easy). A `--city` flag override (only the `search.js` CLI keeps that, the UI does not).

## 2026-10-17 — Two-step prompts: review the rewritten prompt, then run it
tags: decision, ui, prompt
- Decision: Both UI boxes first call `POST /api/refine` (`prompt_refine.js`), which rewrites the rough request into the full explicit prompt and shows it in an editable box with the assumptions it made. A second click runs exactly that text. For the price APIs the reviewed prompt carries every setting as a `--flag`, so `parsePrompt(..., { literal: true })` uses them as-is and doesn't spend a second Haiku call. For Backboard it is a full sentence asking for city/region/country, dates, guests, currency, phone, address and the page behind each price.
- Why: A vague prompt silently became defaults (next Saturday, Aurora, 4.0 rating) and one run costs API quota and tokens. Seeing the prompt first catches that before it is spent, and it is the same text the run uses, so there is no gap between what was shown and what ran.
- Alternatives: Always parse with Haiku and run immediately (current behaviour before this, no chance to correct it). Showing only chips of the parsed settings (not editable, and Backboard has no settings to show).

## 2026-10-17 — No payment; booking ends at verbal confirmation and/or reservation ID
tags: decision, booking, call-handling, spec
- Decision: The agent never handles payment. Success means the hotel confirms the booking verbally, gives a reservation ID, or both. If a hotel won't book without a card, the agent gets verbal confirmation that the room is available for the requested date at the quoted price, and we count that as the confirmation.
- Why: Clarified by the team and added to the spec under "Booking Goal (No Payment)". It keeps payment details out of the call flow and makes the call shorter.

## 2026-10-17 — Search suite lives in hotel_search/, one root entry point
tags: decision, structure
- Decision: All search scripts moved to `hotel_search/` (the old `search.js` orchestrator is now `hotel_search/index.js`). The root `search.js` is the single entry point and also has a `--json` mode, which replaces `search-json.js`. `.cache/`, `output/` and `.browser-profile/` stay at the repo root. All six sources are on by default, so the UI starts with every box ticked (a source still shows disabled until its `.env` keys exist).
- Why: One place for the search code and one command to run it. The UI child process just calls `search.js --json`.
- Alternatives: Moving the UI into its own folder too (not asked for). Keeping cache and output inside `hotel_search/` (would orphan the saved TripAdvisor key cache).

## 2026-10-17 — Expedia source via Playwright, human solves the bot check
tags: decision, search, data-source
- Decision: `expedia.js` is a proper source (`search()`, UI checkbox `expedia`, off by default). It drives Chromium with a persistent local profile (`.browser-profile/`, git-ignored). When Expedia shows its "Bot or Not?" / 429 check it does not try to get around it: headless it fails with a message pointing at `HEADLESS=false`, headed it waits up to 3 minutes for the human to solve it in the window. All selectors and text patterns sit in two constant blocks at the top, and `--dump-html=<file>` saves the page for selector fixes.
- Why: Expedia is the one major OTA with no API we can reach (Rapid needs weeks of approval). Reading its page gives real prices. A visible window plus a remembered challenge keeps a human in the loop instead of fighting detection.
- Alternatives: stealth plugins, spoofed fingerprints, proxies, CAPTCHA services or ScrapingBee (rejected: evasion). The Apify Booking actor (already a source, different site).

## 2026-10-17 — Verify each hotel's city via Google Places
tags: decision, search, data-quality
- Decision: `search.js` keeps only hotels whose Google Places address is in `settings.city`, `region` and `countryCode` (`strictCity`). Places matches use the source's coordinates (within 750 m). SearchApi sorts by relevance, not price.
- Why: Searching "Aurora" returned Markham, Newmarket and even Aurora, IL. The city column had been filled with the search city, which hid it. Sorting by price made Google rank the whole region by price and buried the city's own hotels.
- Alternatives: Distance from a city center (needs a radius guess, and Aurora borders Newmarket). Trusting source city fields (SearchApi has none).

## 2026-10-17 — UI backend spawns a child process per search
tags: decision, ui, backend
- Decision: `server.js` (plain `node:http`, no framework) runs each search as `node search-json.js <args>` and reads JSON from stdout. The prompt is turned into settings args by Claude Haiku when `ANTHROPIC_API_KEY` is set, otherwise a regex parser.
- Why: `settings.js` parses `process.argv` once at load, so one shared server process can't take per-request settings (and concurrent searches would clobber each other). A child process reuses every script unchanged. Zero new dependencies.
- Alternatives: mutating the `settings` singleton under a lock (fragile); Express (extra dependency for two routes).

## 2026-10-17 — Hotel search via APIs, one script per source
tags: decision, search, data-source
- Decision: Search hotels through APIs only: SearchApi.io (Google Hotels), Xotelo, LiteAPI, Hotelbeds and Apify Booking, each in its own script. City, dates and filters live in `settings.js`.
- Why: The spec bans browser automation. Expedia's site also blocks headless browsers with a "Bot or Not?" 429 challenge. City X is revealed at competition time, so it is a single setting.
- Alternatives: Playwright scraper for Expedia (`expedia.js`, against the rules, reference only). Partner APIs like Expedia Rapid and Booking Demand (approval takes weeks). Amadeus self-service (shut down July 2026).

## 2026-10-17 — On-device models for price extraction (Ollama qwen2.5vl:3b + tesseract)
tags: decision, search, pricing, llm
- Decision: Extract prices from Places photos and hotel websites with local models: tesseract OCR as a prefilter, then `qwen2.5vl:3b` via Ollama with a JSON schema. Websites are fetched with plain HTTP (no browser).
- Why: Zero cloud-token cost (cost is judged) and spec bans browser automation. OCR prefilter cuts per-hotel time from ~130s to ~5s.
- Alternatives: Cloud VLM (costs tokens); Playwright scraping (banned by rules).

## 2026-10-17 — Docs live in docs/, AGENTS.md is the canonical agent guide
tags: decision, docs, process
- Decision: All project docs go under `docs/` with YAML frontmatter. `AGENTS.md` is the single agent guide, and `CLAUDE.md` just imports it.
- Why: One searchable place for context. Grep-friendly frontmatter and headings keep it cheap for agents to find things.
- Alternatives: Separate CLAUDE.md / AGENTS.md content (rejected: they would drift apart).
