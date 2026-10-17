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


## 2026-10-17 — Docs live in docs/, AGENTS.md is the canonical agent guide
tags: decision, docs, process
- Decision: All project docs go under `docs/` with YAML frontmatter. `AGENTS.md` is the single agent guide, and `CLAUDE.md` just imports it.
- Why: One searchable place for context. Grep-friendly frontmatter and headings keep it cheap for agents to find things.
- Alternatives: Separate CLAUDE.md / AGENTS.md content (rejected: they would drift apart).
