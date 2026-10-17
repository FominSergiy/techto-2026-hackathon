---
title: Feature Log
tags: [log, features]
status: active
updated: 2026-10-17
---

# Feature Log

Short, append-only record of features as they are planned, started and shipped. **Newest entry at the top.** When a feature's status changes, update its entry in place and bump the date.

Entry format:

    ## YYYY-MM-DD — <feature name>
    tags: feature, <area>
    - Feature: what it does
    - Status: planned | wip | done
    - Notes: gotchas, learnings, links (optional)

<!-- Add new entries below this line -->

## 2026-10-17 — Web UI for hotel search
tags: feature, ui
- Feature: `node server.js` serves a page with a prompt textarea. The prompt becomes settings overrides, the suite runs, and the merged hotels (name, city, address, phone, price, rating, source, other offers, link) show in a table, with the run log and prompt-parsing token usage underneath.
- Status: wip. Backend tested end to end with a live search (Aurora, searchapi + xotelo: 5 hotels with phones in ~37s). Page script syntax-checked but not yet viewed in a browser. The Claude prompt-parsing path is untested (no `ANTHROPIC_API_KEY` in `.env`).
- Notes: No progress streaming yet, the page just shows a timer until the whole run finishes (Xotelo alone took 36s for 5 hotels). Regex fallback needs `City, XX` to get the country right; the LLM path infers it. The `booking` source and `expedia.js` aren't wired in (`expedia.js` isn't a source).

## 2026-10-17 — Hotel search suite (single output format)
tags: feature, search, output
- Feature: `node search.js` runs all enabled sources in parallel, merges to one row per hotel (cheapest offer wins, other offers kept), looks up phone and address in Google Places, and outputs name, city, address, phone, price, source and url as a table plus `output/hotels-<city>-<checkIn>.csv/json`. Each source's timing is logged.
- Status: wip. Written but not run yet.
- Notes: A Places match is only accepted if at least half of the hotel's distinctive name words match, so a wrong hotel doesn't get someone else's phone number. `url` falls back to the Google Maps link for sources without hotel links (LiteAPI, Hotelbeds). Sources and Places are called live, so each run costs API quota (30 Places lookups).

## 2026-10-17 — Hotel price search scripts
tags: feature, search, data-source
- Feature: `xotelo.js`, `searchapi.js`, `liteapi.js`, `hotelbeds.js` and `apify-booking.js` each return the 30 cheapest hotels in `settings.city` that pass the shared filters (max nightly price, min rating out of 5, min reviews). `search.js` runs the enabled sources in parallel and merges them. Every setting can be overridden on the command line (`--city=Paris`). SerpApi was swapped for SearchApi.io, which we have a key for.
- Status: wip. Xotelo was tested live before the refactor (30 Toronto hotels in ~63s, no key). The others are written against the docs and haven't been run yet.
- Notes: None of these return phone numbers, so join with Google Places (`maps.js`) by name. Xotelo `/search` now needs RapidAPI and `/list` throws random 500s (retried), so `locations.js` finds the TripAdvisor city key with a SearchApi Google search (`site:tripadvisor.com`) and finds the Hotelbeds code in the Content API destination list (matching suburbs through zones). Both are cached in `.cache/locations.json`. Rating scales differ (Booking and LiteAPI are out of 10). Hotelbeds, LiteAPI and Booking prices are per stay, so they are divided by `NIGHTS`. The Apify actor runs a browser server-side, which is a gray area under the rules.

