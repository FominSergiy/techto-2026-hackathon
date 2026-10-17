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

## 2026-10-17 — Google Maps search as its own card: fixed queries, not a source checkbox
tags: decision, search, places, ui
- Decision: A separate "Google Maps (Places only)" card (`POST /api/places`, `hotel_search/places-search.js`) reduces the prompt to a city (same parser as the main search) and runs 5 fixed Places text searches for it, merged by Places id. It is not one of the price-source checkboxes and not in `sources.js`.
- Why: It finds candidates with phones from Google Maps alone, which is a way to test how good Places is as a hotel finder with no price API behind it. Fixed queries keep the cost known (5 calls) and the results comparable run to run.
- Alternatives: One free-text Places query (misses "inns", "motels"); more pages per query (Places paginates, 20 per page: costs more calls, not tried yet).

## 2026-10-17 — Each source normalizes its own output into one shared shape
tags: decision, search, architecture
- Decision: Every source script owns a `normalize(rawItem)` built on the shared `normalizeHotel()`, instead of each building its hotel object inline. The rest of the suite (merge, Places, report, UI) only knows the one shape.
- Why: The sources' raw outputs differ a lot (rating out of 10 or 5, price per night or per stay, nested or flat), and a field missing in one source (phone, city, location) silently became `undefined` downstream. One function guarantees every field exists, with the right type and `null` for unknown.
- Alternatives: A single mapper module that knows every API (couples all sources in one file; each source is easier to change next to its own API code).

## 2026-10-17 — Prompt-only settings have no default in settings.js
tags: decision, search, settings
- Decision: `settings.js` no longer defaults `city`, `checkIn`/`checkOut` (dates are still derived: next Saturday), `minRating`, `minReviews` or the TripAdvisor/Hotelbeds location codes, and the price cap is 150 (it was 200; the Google Hotels actor returned phones and addresses in the two runs with a cap of 100 and none in runs with 400 or no cap, so a lower cap may be what triggers it, not yet confirmed). They are still accepted as `--flags` (`PROMPT_ONLY` in `settings.js`). A request with no city gets a warning in the review panel, and rating/review minimums stay off unless the request asks for them.
- Why: The values only exist once the prompt is parsed, and a default city (Aurora) silently searched the wrong place. Dropping the keys from `defaults` alone made `parseArgs` reject `--city`, so the prompt flow broke.
- Alternatives: Keep `city: null` etc. in `defaults` (simpler, but it was removed on purpose). The old behaviour of resetting the region for a non-default city went too: the region is always Ontario.

## 2026-10-17 — Apify sources: johnvc Google Hotels actor and jeremy_frost Hotels.com actor
tags: decision, search, apify
- Decision: Google Hotels via `johnvc/google-hotels-search-scraper` (the exact "Google Hotels Search Scraper" title, $0.02 per run + $0.02 per page) and Hotels.com via `jeremy_frost/hotels-com-scraper`. The key is `APIFY_KEY`, matching `.env`, for every Apify source.
- Why: Both take a city and dates directly, so no search URL has to be built, and both are pay-per-use rather than monthly rentals. The Google actor gives structured prices and links like SearchApi does, from a second quota.
- Alternatives: `easyapi/hotels-com-scraper` (needs Hotels.com search URLs), `automation-lab/google-hotels-search-scraper` (its Apify page returned 404).

## 2026-10-17 — Xotelo runs its whole flow through RapidAPI, inside xotelo.js
tags: decision, search, xotelo
- Decision: `xotelo.js` calls `/search` (city -> TripAdvisor location key, cached), `/list` (hotels) and `/rates` (live prices) on Xotelo's RapidAPI listing with `RAPID_API_KEY`. The lookup moved out of `locations.js`, so ticking the Xotelo box runs the full source on its own.
- Why: `/search` is only offered on RapidAPI, and the old key lookup needed a SearchApi key, a second source's quota, just to feed Xotelo. Each source should be self-contained.
- Alternatives: Keep the free `data.xotelo.com` for `/list` and `/rates` (it times out at ~11s for big cities, see features log; RapidAPI may not).

## 2026-10-17 — Prompt rewriting uses a cheap LLM: Haiku, else Backboard gpt-4o-mini, else regex
tags: decision, prompt, llm, cost
- Decision: `parsePrompt` tries Claude Haiku (`ANTHROPIC_API_KEY`), then Backboard's `gpt-4o-mini` (`BACKBOARD_API_KEY`, no web search, no memory), then the regex parser. The LLM only extracts settings as JSON (fixes typos, resolves "today"/"tomorrow"); the review prompt and `--flags` are still built by code. When regex was used the review panel shows a warning with the reason.
- Why: The regex fallback ran silently when no Anthropic key was set (the case on this machine) and turned "monteral ... today 17th october ... tomorrow 18th october" into the default city and next Saturday. A small model costs a few hundred tokens per review and the Backboard key is already needed for the Backboard source.
- Alternatives: Having the LLM write the whole prompt and flags (cannot be tested or trusted to emit exact flags). A bigger model (more tokens for a parsing job). Improving the regex (will never cover typos).

## 2026-10-17 — City comes from the prompt, region always Ontario
tags: decision, ui, prompt, search
- Decision: Supersedes "The place is fixed". The review step (`prompt_refine.js`) takes the city from the request, and uses `settings.js`'s `city` only when the request names none (listed under "Filled in"). The region is always Ontario and the country always CA: a different region or country in the request is ignored with a warning in the review panel.
- Why: The city is the one thing that changes between runs, so it must be typed. Only the region is constant, and forcing it removes the wrong-province failure (Aurora, IL, or Paris, France) without a second input.
- Alternatives: City fixed in `settings.js` (tried first, needs an edit per city). Letting the request set the region too (previous behaviour).

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
