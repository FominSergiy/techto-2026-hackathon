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

## 2026-10-17 — Alex: callback refusal, spoken dates, quote-or-exit, human-sounding voice
tags: feature, elevenlabs, call-handling
- Feature:
  - **Callbacks:** if the hotel offers to call back, Alex says we're calling several hotels and asks for the rate now. If they still can't give one, Alex thanks them and hangs up.
  - **Dates:** they arrive as ISO and are spoken as "October 17th". The opener no longer contains dates.
  - **Quote or exit:** if there's still no price after asking twice, Alex ends the call. Max call length is now 480 s (was 900).
  - **Voice:** Luke (a library voice, added to both workspaces), stability 0.3, speed 1.05, with occasional "um"/"so" fillers and varied soft-timeout fillers.
- Status: live on Main, `repo-sync` and Sergiy's copy. Test call 1 (`conv_1301m55mgr15e7za05bm2gba353m`, 77 s) passed for dates ("October 17th, checking out October 18th", no year), fillers, and a polite exit when the hotel refused. LLM time to first byte averaged 110 ms. The callback and refuse-to-quote cases are not tested yet.
  - Seen: Alex never said "I'll take it" before collecting details, and asked about taxes twice when the answer only covered currency.
- Notes:
  - **The opener is spoken word for word.** `first_message` doesn't go through the LLM, so a prompt rule can't reformat `{{check_in_date}}` there. Keep variables that need formatting out of `first_message`.
  - **Natural voice:** lower stability (0.3) plus disfluencies written into the text ("um", "uh") sounded far more human on `eleven_v3_conversational` than any voice swap alone. Compare voices with the same script.
  - **Library voices** can be sampled with TTS before adding them, but an agent can only use them once they're added (`POST /v1/voices/add/{owner}/{voice_id}`). The voice ID stays the same.
  - **LLM left as is:** on 4 recent calls `deepseek-v41-flash` (reasoning `null`) had LLM time to first byte of 70–225 ms on average and no reasoning tokens, so changing reasoning wasn't worth it.

## 2026-10-17 — Confirmation email service
tags: feature, email
- Feature: Standalone sender, `Davide_test/email_service.py`: `send_confirmation(payload)` in Python, or `--send payload.json` from any language. It checks the spec's 4 fields (confirmation, price, date, address) and fails if any is missing. With no reservation number it falls back to the verbal formats (`type: verbal_booking | verbal_availability`). It sends via Gmail SMTP or Resend, retries once, and returns `{provider, id, to, ms}`. `main.py` uses it, and its "email sent" log line marks the race time. Wiring guide: [email-service.md](../architecture/email-service.md).
- Status: done. A real Gmail SMTP send worked on 2026-10-17 (~0.9 s).
- Notes: Gmail needs 2-Step Verification on before it offers app passwords, which was the slowest part of setup. Resend's free tier is quicker to sign up for but only delivers to your own login address until a domain is verified, so it can't reach the organizers. Pre-flight: `--dry-run`, then `--test you@x.com`.

## 2026-10-17 — Alex: backchannels don't interrupt; read back once
tags: feature, elevenlabs, call-handling
- Feature: 16 backchannel terms ("yeah", "okay", "mm-hmm", "uh-huh", "sure"…) set as `turn.interruption_ignore_terms`, plus ElevenLabs' English defaults (`merge_with_default_ignore_terms`). Prompt now says: read back exactly once, never start over, repeat only a corrected item, never re-ask for a detail already given.
- Status: wip. On the `repo-sync` branch only; not merged to Main, no test call yet.
- Notes:
  - **Where this came from:** test calls `conv_5501…` and `conv_4501…` on the old config. The receptionist's "yeah" kept cutting the agent off mid-sentence, and it then restarted the read-back 2–3 times, wasting about 10–20 s per call.
  - **Why not "yes"/"no":** left out because they can be real answers.
  - **Not fixed here:** dates were spoken as "2026-10-17". Our service should pass human-readable dates (e.g. "October 17") in the dynamic variables.

## 2026-10-17 — Agent config in repo (Alex)
tags: feature, elevenlabs, telephony, call-handling
- Feature: Alex's config is pulled into `agent_configs/Alex.json` and fixed against the spec and architecture-plan:
  - No-payment fallback to verbal availability plus the receptionist's name.
  - IVR (`play_keypad_touch_tone`), hold (`skip_turn`) and voicemail (`voicemail_detection`) turned on; turn timeout 20 s, max 900 s.
  - New variables (`hotel_name`, `run_id`, `candidate_id`, `hotel_notes`, `listed_price`).
  - Post-call fields `stay_dates`, `receptionist_name`, `confirmation_type`; workflow removed.
  - Pushed to the `repo-sync` branch and the "Alex (repo config)" copy. Four webhook tools are drafted in `tool_configs/`.
- Status: wip. Test calls on `repo-sync` are not done; tools and the post-call webhook are not attached.
- Notes:
  - **API key:** the CLI reads `.env` in the current folder, so the repo's key (Davide's) is what's used, and remote changes show up as his.
  - **CLI quirks:**
    - `pull --dry-run` still writes `agents.json`.
    - An empty workflow is rejected; keep `start_node` only.
    - `agents update --json` rejects pulled configs (old schema), so use `push`.
    - Push never checks for drift.
  - **Teammate edits:** Davide changed the data-collection fields between our first read and the pull, so always pull right before editing. See [agent-config-sync.md](../architecture/agent-config-sync.md).

## 2026-10-17 — Reservation AI service page (/reservation)
tags: feature, ui, search, places, backboard
- Feature: A separate, clean page at `/reservation`: title "Reservation AI service", one input, one table (hotel, price / night, phone, address). One prompt runs the Google Maps search (5 Places searches plus the Backboard expected-price ranking) and the Backboard web search at the same time, merges them into one list and sorts it cheapest first.
- Status: wip - handler checked end to end with Places and Backboard faked (no live calls); merge tested offline; never run live.
- Notes: One search costs 5 Places calls + 2 Backboard calls (ranking, search) + 1 prompt-parsing call. Prices come in three kinds: found by Backboard on a page (shown as is, or "from" for a page's lowest rate) beats the model's estimate (shown "~"). The same hotel is matched across the two lists by name overlap, and two different local phone numbers stop a merge ("Holiday Inn" vs "Holiday Inn Express"); toll-free numbers are ignored because Backboard returns each chain's central booking line (1-800-454-3213 for Super 8). A hotel only Backboard found has not been city-checked.

## 2026-10-17 — Backboard free-text card: ask for a minimum number of hotels
tags: feature, search, backboard, learnings
- Feature: In free-text mode (`/api/backboard`) the user's words are now followed by "Unless the request above names a number of hotels, list at least N" (N = `count`, default 20).
- Status: done offline only (request-building tests), not re-run live.
- Notes: "cheap hotels sudbury" returned 2 hotels (an earlier run 5): the structured mode says "Find the 20 cheapest...", but free text sent only the user's words, so the model chose its own length (valid JSON, no truncation, 224 output tokens). The raw replies show `tool_calls: null`, so Backboard does not report whether web search ran; a short answer on few tokens does not prove it did not.

## 2026-10-17 — Expected-price ranking for the Google Maps card
tags: feature, search, places, backboard
- Feature: The Google Maps card has a "Rank by expected price" checkbox (on by default). When on, `backboard_search/classify.js` sends up to 20 hotels to a Backboard web-search model, which returns an expected nightly price, class (budget to luxury), confidence and a short reason for each. The table shows them and is ordered cheapest expected price first; unestimated hotels follow, with the reason. The page also shows the model, time and tokens used, and what the model replied.
- Status: wip - code and offline tests done (stubbed fetch), never run against Backboard.
- Notes: One extra Backboard call per search (web search makes it slow: allow a minute or two; timeout 180s). If it fails (no credits, bad reply) the Maps results still show, unranked, with the error. Expected prices are estimates, not rates for any dates. To judge it: compare the expected prices with what the price sources return for the same hotels.

## 2026-10-17 — Google Maps (Places only) search card
tags: feature, search, places, ui
- Feature: A card on the page that takes a prompt, reads the city from it and runs 5 fixed Places searches (`hotels in X`, `inns in X`, `motels in X`, `hotels at X`, `cheap hotels in X`). The table shows phone, address, price hint, rating, website, a Maps link and which searches found each hotel; chips show how many each search returned and added.
- Status: wip - code and offline tests done (stubbed fetch), never run against the live Places API.
- Notes: Places has a price range for only a few hotels, so most rows show "none" for price (the column is a hint, not a rate). Each run is 5 Text Search calls with phone and price fields (Enterprise SKU, see `sources.js` PLACES cost note); only the first 20 results per query are read. Closed places and places whose own address is outside the city are dropped and listed under the table. Learning from the first live run (Sudbury): Google files hotels under the amalgamated municipality ("Greater Sudbury"), so an exact city-name check dropped all 36 results. The check now strips "Greater" / "City of" and also accepts a formatted address that names the city ("..., Sudbury, ON"). `index.js` `filterToCity` (main search, after the Places enrichment) still compares the names exactly, so it has the same problem for such cities. Not available in DEMO mode (it would call the API). To judge it: compare the hotel count and phone count with what the price sources plus the Places enrichment return for the same city.

## 2026-10-17 — Page shows what every API returned and what the city check dropped
tags: feature, ui, search, learnings
- Feature: A search used to say "No hotels came back because the source(s) above failed" when the real story was different. Now `search.js --json` also prints a report (`@@REPORT@@`, built in `hotel_search/index.js` as `search.lastReport`), `server.js` passes it on, and the page shows: a table per source (ok or the error, hotels returned before any filter, how many passed the price/rating filters, the saved raw file), the city check's kept / dropped counts with the dropped hotels and the city each is really in, and an empty-result message that says which step removed everything. The city check itself is unchanged.
- Status: done, offline test replays the real run (`test/run-report.js`).
- Notes: Found in the saved responses of a "Humber Bay" run: SearchApi returned 17 Toronto hotels, Google Places put all of them in "Toronto" (Humber Bay is a neighbourhood, not a city), so the check dropped everything. Also in that run: the Apify Google actor returned no hotels but a notice, "free_tier_limit_reached" (free accounts get $1.00 of usage per actor per month, resets 2026-11-01 UTC; our test runs plus the browser runs used it up). The code treated that as an empty search; `apify-google-hotels.js` now raises it as an error that shows on the page. LiteAPI answered `data: []` for "Humber Bay", Booking `[]`, Backboard `[]`, Xotelo and Hotelbeds found no place with that name. Search a real city name (Toronto), not a neighbourhood.

## 2026-10-17 — Prompt review step switched off (REVIEW_STEP flag)
tags: feature, ui, prompt
- Feature: The page's "Review prompt" step (`/api/refine`) is off: `const REVIEW_STEP = false` in `public/index.html`. The buttons ("Run search", "Ask Backboard") send the typed text straight to the server, which parses it with `parsePrompt` (LLM, else regex) and runs it. The region stays Ontario, CA (`pinRegion` in `prompt.js` drops a region/country the parser guessed, unless the text has `--region=` / `--country-code=`). Typed `--flags` still win over parsed values. Set the flag to `true` to get the review step back; `/api/refine` and `prompt_refine.js` are untouched.
- Status: done, offline tests only.
- Notes: Without the review step nothing fills in assumed values on screen: dates default to the next Saturday for 1 night, the price cap to 150, the top count to `settings.js`'s `targetCount` (30), and a prompt with no city is refused with a message (`hasCity` guard in `server.js`, so nothing is searched or paid for; `report.js` also no longer crashes without a city).

## 2026-10-17 — City check without Google Places; Xotelo search falls back to the bare city name
tags: feature, search, places, xotelo, learnings
- Feature: (1) A Toronto search showed hotels from Markham and Richmond Hill: the Google actor returns nearby towns, and the only thing that removed them was the Places city check, which did not run (no `places` raw file in three browser runs). Now, when Places is off, `index.js` still drops hotels a source places in another city (`dropKnownOtherCities`); the Google normalizer reads the city from addresses like "Markham, ON, Canada". (2) Xotelo `/search` for "Toronto Ontario", "Etobicoke Ontario" and "Humber Bay Ontario" all answered 400 "No results found" live, so `locationKey` now also tries the bare city name (no retries on the 400).
- Status: wip. Offline tests (`test/city-check.js` replays real Toronto data, `test/xotelo-search.js`); neither tried live, and whether `/search "Toronto"` works is unknown (the result format `place_name` is still an assumption).
- Notes: The new check is weaker than Places: it only drops hotels the source gives a city for. In the real Toronto response 18 of 76 hotels had an address and only 6 of those named another town; 12 had a street address and 58 had none, so those stay. Only the Places check verifies those. Searching "Toronto" also drops hotels in districts like North York or Etobicoke if a source names them (Places does the same). With the 150 cap the Google actor returned phones for the first 18 hotels (page 1) and none for the rest.

## 2026-10-17 — Price cap no longer switched off by the prompt parser; warning when Google Places is off
tags: feature, search, prompt, learnings
- Feature: (1) The prompt parser told the model `maxNightlyPrice` could be "null for no limit", and models answered null for requests that named no price, so no cap reached the actors (the saved Google request for Humber Bay had no `max_price`, and the 150 default never applied). Now the model is told to omit the key, and a null is dropped unless the request says "no limit / any price / unlimited" (`test/prompt-llm.js`). (2) The results page shows a red note when a run had `--enrich-phones=false`, so a table with empty City / Address / Phone columns says why.
- Status: done, offline tests only.
- Notes: Found from `output/raw/`: the last three browser runs saved Xotelo and Google responses but no `places` folder, i.e. Places made no request, and the Google responses had no phones (plain search, no `max_price`). The Google actor returned phones in two runs that had `max_price: 100` and none with 400 or no cap, so the cap may be what triggers phones (unconfirmed, Run C would test it).

## 2026-10-17 — Google Hotels actor CAN return phones (correction), flat output shape handled
tags: feature, search, apify, learnings
- Feature: A manual Apify run of `johnvc/google-hotels-search-scraper` returned `address`, `phone` and `phone_link` for every hotel, as one flat item per hotel (no `properties` page wrapper). `apify-google-hotels.js` now reads both shapes (page items and flat items) and logs how many hotels came back with a phone; real data is in `test/fixtures/apify-google-hotels-with-phones.json`.
- Status: parsing done and tested offline. Which INPUT makes the actor return phones is NOT known yet: our run (Aurora, `search_type: "search"`, `max_pages`, no extras) returned page items with no phone or address in all 20 properties, and the actor's README and input schema list no "enrich" option (only a `property_token` details mode). So the earlier note "the actor has no phone in search output" was only true for our input.
- Notes: Next step is to read the exact input of the manual run (Apify console, run, Input tab) and put it in `buildInput()`. Until then phones come from Google Places, which keeps a source phone when it finds no match.

## 2026-10-17 — One hotel shape from every source (per-source normalizers)
tags: feature, search, architecture
- Feature: `normalizeHotel()` in `hotel-utils.js` defines the single output (name, city, address, phone, nightlyPrice, totalPrice, currency, rating out of 5, reviews, url, location), always with every field (null when unknown, numbers as numbers). Each source (Xotelo, SearchApi, LiteAPI, Hotelbeds, Apify Booking / Google Hotels / Hotels.com, Expedia) now has its own exported `normalize` that maps one raw API item through it; Backboard's `toHotel` has the same fields. `test/normalize.js` runs all of them and checks the shape. Also: Places keeps a phone the source already had, and the Booking actor now gets "City, Region, Country" instead of just the city.
- Status: done for the shape; offline tests only.
- Notes: The Hotels.com actor (`jeremy_frost/hotels-com-scraper`) returned an empty dataset in two live runs (Burlington, ON: `place` "Burlington Ontario Canada" with `min_stars` "1", then the docs-shaped "Burlington" with "3"). Its Apify log shows a Chrome WebDriver starting and exiting with code 0 after ~13s, no error and no results, so it probably can't read Hotels.com any more. It is unticked and labelled not working, and its `normalize` is still a guess. Its README lists no phone field either. Raw responses are in `output/raw/apify-hotelscom/`.

## 2026-10-17 — Raw API responses saved per source, and a sturdier Places match
tags: feature, search, places, learnings
- Feature: (1) Every source's raw JSON responses are saved unchanged to `output/raw/<source>/<UTC timestamp>-<city>.json` (an array, one entry per response, retries and error bodies included), plus a `places` folder and `backboard`. So an odd result can be checked against what the API actually said. (2) Google Places matching now retries 429/5xx, strips ", ON" / "(Downtown)" from names, runs a second search by name + city when the first (by name around the source's coordinates) finds nothing, and logs why each hotel got no match.
- Status: wip. Both are covered by offline tests (`test/raw-capture.js`, `test/places-match.js`), neither run live yet.
- Notes: Prompted by "Knights Inn Burlington, ON" from the Apify Google source showing no phone. That actor's search output has no phone or address at all (`output/raw/apify-google-hotels`); phones only ever come from Places, and the cause of this miss is not known yet: the new "no Places match" log line (and `output/raw/places`) will say. The acceptance rule is unchanged on purpose (name words >= 50% and within 750 m when the source gave coordinates), because a looser one hands a sister hotel's phone number to the wrong hotel. The actor's property-details mode (one run per `property_token`, ~$0.04 each) does return a phone, kept as a fallback idea.

## 2026-10-17 — Apify Google Hotels and Hotels.com sources
tags: feature, search, apify, learnings
- Feature: Two new price sources that run an Apify actor each: `apify-google-hotels.js` (`johnvc/google-hotels-search-scraper`, source `apifygoogle`) and `apify-hotelscom.js` (`jeremy_frost/hotels-com-scraper`, source `apifyhotelscom`, unticked by default). Both need `APIFY_KEY`; the shared runner is `runApifyActor` in `hotel-utils.js`, which `apify-booking.js` now uses too.
- Status: Google: done, tested with one live run (Aurora, ON: 1 page in 8s, 20 listings, 15 hotels, ~$0.04) and offline (`test/apify-google-hotels.js`, real response as fixture). Hotels.com: wip, NOT run. Apify refuses the first run until the actor is approved for full account access (`console.apify.com/actors/lbY6tVpNbYjhpdNnO?approvePermissions=true`), and its output field names are unknown, so `toHotels` there is a guess.
- Notes: The Google actor returns vacation rentals even with `vacation_rentals` off (kept on purpose, they carry `type: "vacation rental"` in the raw data), neighbouring towns (Markham, Richmond Hill: `strictCity` handles them via Places) and no addresses. Prices are Google's lowest OTA rate. `.env` already named the key `APIFY_KEY`, while `apify-booking.js` read `APIFY_TOKEN`, so Booking never saw it; all Apify sources now read `APIFY_KEY`. A second Hotels.com actor exists (`easyapi/hotels-com-scraper`, takes search URLs, from $2.99 per 1,000 results) if the first stays blocked.

## 2026-10-17 — Xotelo source is self-contained on RapidAPI
tags: feature, search, xotelo
- Feature: `xotelo.js` does search -> list -> rates by itself (`/search` for the location key, `/list` for hotels, `/rates` for live prices) through RapidAPI. The Xotelo checkbox needs `RAPID_API_KEY` and runs the whole flow; `tripadvisorLocationKey` in settings still skips `/search`.
- Status: wip. Offline tests pass (`test/xotelo-search.js`, `test/xotelo-list.js`). NOT run live yet.
- Notes: The RapidAPI host (`xotelo-hotel-prices.p.rapidapi.com`, override with `RAPIDAPI_XOTELO_HOST`) and the `/api/...` paths are guessed from the listing slug. The `/search` result fields (`location_key`, `name`, `place_name`) come from xotelo.com's docs and are unverified, so the place match may need adjusting. Unknown whether RapidAPI also avoids the ~11s big-city `/list` timeout.

## 2026-10-17 — Xotelo diagnosed live: big cities time out, rates come back empty
tags: feature, search, xotelo, learnings
- Feature: Tested against the real Xotelo API (no key needed). `/list` answers HTTP 200 with `{"error":{"status_code":500,...}}` in the body after ~10.8s for every city with many hotels (Toronto, Montreal, Hamilton: 13 calls, any `limit` from 10 to 100, any `sort`), while Aurora (5 hotels) answers in 0.9s every time. So it is not intermittent for big cities: Xotelo's server gives up at ~11s. `xotelo.js` now fails at once on a slow failure with a message saying so (it used to retry 5 times, ~1 minute of waiting), still retries quick failures with backoff, and `getJson` now backs off on a 500 reported inside an HTTP 200 body, which is how Xotelo reports errors.
- Status: done and checked live for Hamilton (fails in 11s with the message) and Aurora (list works, `/rates` called). Offline tests: `hotel_search/test/xotelo-list.js`, `get-json.js`.
- Notes: Even where `/list` works, `/rates` took ~13s per hotel and returned `rates: []` for the Aurora Microtel for 2026-10-24, 2026-11-20 and 2026-12-05, so the Aurora run found 0 hotels with live rates. Right now Xotelo gives no usable prices for any city we tried, so treat it as unreliable and rely on SearchApi, LiteAPI and Hotelbeds. Cost of leaving it ticked: 11s of a parallel run for a big city, ~14s for Aurora, and no results.

## 2026-10-17 — Backboard keeps unpriced hotels; top 20 in both boxes
tags: feature, search, backboard
- Feature: Hotels the Backboard model finds but cannot price are no longer dropped: they show as "no price" (`priceType: "none"`, `nightlyPrice: null`, Source `backboard (no price)`) after the priced ones, so they can still be called and asked. The prompt tells the model never to leave a hotel out because its price is unconfirmed. Both boxes now default to the top 20 hotels (was 10 for Backboard, 30 for the search), and the parser is told that "the cheapest option/hotel" is not a count of 1.
- Status: done, tested offline (stubbed fetch, 4 of 4 hotels kept with 1 unpriced). Not re-run live, so whether the model now returns 20 is unconfirmed: the "returned N" line under the table shows it.
- Notes: A top-1 result most likely came from the parser reading "find the cheapest option" as `targetCount: 1`, which then went into `--target-count=1` for the search. An explicit count in the request ("top 5") still wins, and the review panel shows `--target-count` so it can be edited before running. If Backboard is ever wired into the merged search, its null-priced rows must be filtered out there (`passesFilters` already rejects `nightlyPrice == null`).

## 2026-10-17 — Xotelo 500s: backoff and keep earlier pages
tags: feature, search, xotelo, reliability
- Feature: "xotelo failed: data.xotelo.com: Internal Server Error" is Xotelo's `/list` endpoint failing, which it does intermittently. `getJson` now waits 0.5s, 1s, 2s, ... between retries after a 5xx or 429 (client errors still retry at once), the list call gets 4 retries (the per-hotel rate lookups keep 2), and a later list page failing keeps the pages already listed instead of throwing them away.
- Status: done, tested offline (`hotel_search/test/get-json.js`, stubbed fetch). Not re-run against the real Xotelo, so a real outage longer than about 7.5s still fails the source. The other sources keep running when Xotelo fails (the UI shows the failure above the table).
- Notes: Before, the 2 retries were back to back, so all 3 attempts landed inside the same blip. If Xotelo is down for a run, untick it: the other sources carry the results.

## 2026-10-17 — Backboard returned only 1 hotel: parsing and prompt fixes
tags: feature, search, backboard, learnings
- Feature: The Backboard box now keeps every hotel the model priced, and shows how many it returned, which it dropped and why, and the raw reply (collapsible). Prices answered as text ("$112", "139.00 CAD", "from $85/night") are read as numbers, "[1]" citation marks no longer break the JSON extraction, and an empty `[]` is a valid "found none". Hotels carry `priceType`: "quoted" (rate for the searched dates) or "from" (lowest nightly rate the page showed, labelled `backboard (from rate)` in the Source column).
- Status: done, tested offline only (stubbed fetch: a reply with text prices and citations that kept 1 of 4 before keeps 3 of 4 now). Not re-run against the live API, so whether the real cause was the text prices, the strict "omit unless you saw a real price" prompt, or the model genuinely finding few prices is unconfirmed: the new "returned / dropped" line and raw reply answer that on the next run.
- Notes: Before, `Number("$112")` was NaN and the hotel was silently dropped, and the system prompt told the model to omit any hotel without a confirmed price, which web search rarely gives for specific dates. The prompt now asks for several searches, a plain-number `nightlyPrice`, and prefers a "from" rate to leaving a hotel out. "From" rates are hints, not the rate for those dates, so re-quote on the call.

## 2026-10-17 — Review-then-run prompt flow (prompt_refine.js)
tags: feature, ui, prompt
- Feature: "Review prompt" on each box rewrites the rough text into the full prompt and shows it (editable) with a list of what was filled in from defaults and any warnings (e.g. no country for a non-default city). "Run search" / "Ask Backboard" then runs exactly that text. Cancel discards it.
- Status: done, tested offline (`test/prompt-refine.js`, DEMO-mode server probe). The Haiku-parsed path and a live run through the reviewed prompt were not exercised.
- Notes: The review step uses Haiku (`ANTHROPIC_API_KEY`) or Backboard's `gpt-4o-mini` (`BACKBOARD_API_KEY`), one small call shown as tokens in the panel, and the run itself costs none. With neither key the regex parser only understands a capitalised city and ISO dates, so typos and "tomorrow" fall back to defaults, and the panel shows a warning saying so. The Backboard parser path is tested with a stubbed fetch only, `gpt-4o-mini` availability on Backboard is unverified. The city comes from the request (default city from `settings.js` if none), the region is always Ontario and the country CA: another region or country in the request is ignored with a warning. Editing the sentence in the search prompt does nothing: the `--flags` line is what runs. Backboard defaults to 10 hotels and only gets rating/review minimums if the request asked for them, since the 4.0 / 50 defaults empty small cities.

## 2026-10-17 — Expedia hotel source (Playwright)
tags: feature, search, data-source
- Feature: `node expedia.js` (or the "Expedia" checkbox in the UI) opens Expedia's hotel search for `settings` (city, region, country, dates, adults, currency, price sort), clicks "Show more" until `targetCount` hotels pass the filters or `maxPages` is hit, and returns the cheapest ones in the shared hotel shape (rating halved to out of 5; per-night/total converted with `nights`). Prints a warning with counts when a field can't be parsed.
- Status: wip. Parser, pagination, dump and headless bot-check error are tested offline against synthetic pages (`test/expedia-parse.js`, `test/expedia-local-flow.js`). NOT yet run against the real site: selectors, the `sort`/`currency` URL params and the "Show more" flow are guesses.
- Notes: Run `HEADLESS=false node expedia.js --dump-html=expedia-dump.html` once and share the dump to fix selectors. Headless runs (the default, and what `server.js` child processes use unless started as `HEADLESS=false node server.js`) hit the bot check and fail with a clear message in the run log. Cards give no coordinates and only a neighbourhood, so address/city come from Google Places; with `strictCity` an Expedia hotel Places can't place is dropped. One run per browser profile at a time. Prices are not currency-converted (a mismatch is warned about).

## 2026-10-17 — Web UI for hotel search
tags: feature, ui
- Feature: `node server.js` serves a page with a prompt textarea. The prompt becomes settings overrides, the suite runs, and the merged hotels (name, city, address, phone, price, rating, source, other offers, link) show in a table, with the run log and prompt-parsing token usage underneath.
- Status: wip. Backend tested end to end with a live search (Aurora, searchapi + xotelo: 5 hotels with phones in ~37s). Page script syntax-checked but not yet viewed in a browser. The Claude prompt-parsing path is untested (no `ANTHROPIC_API_KEY` in `.env`).
- Notes: No progress streaming yet, the page just shows a timer until the whole run finishes (Xotelo alone took 36s for 5 hotels). Regex fallback needs `City, XX` to get the country right; the LLM path infers it. The `booking` source and `expedia.js` aren't wired in (`expedia.js` isn't a source).

## 2026-10-17 — Hotel search suite (single output format)
tags: feature, search, output
- Feature: `node search.js` runs all enabled sources in parallel, merges to one row per hotel (cheapest offer wins, other offers kept), looks up phone and address in Google Places, and outputs name, city, address, phone, price, source and url as a table plus `output/hotels-<city>-<checkIn>.csv/json`. Each source's timing is logged.
- Status: wip. Run for Aurora, ON with xotelo, searchapi and liteapi: 3 hotels, all in Aurora. Hotelbeds untested (no `HOTELBEDS_SECRET`).
- Notes: Gotchas found debugging Aurora: (1) Google Hotels returns the surrounding region, so `region` is in the query and results are checked against the Places address. (2) Chains share names ("Holiday Inn Express & Suites ..."), so a name-only Places match gave a Richmond Hill hotel the Aurora hotel's address; matches are now checked against the source's coordinates. (3) Xotelo types real hotels as "Limited Service Property", so it no longer filters on type. (4) A failing later page used to discard earlier pages. (5) Aurora only has 3 real hotels, so default filters (min 50 reviews, 4.0 rating) can empty the list: relax them for small cities. A Places match is only accepted if at least half of the hotel's distinctive name words match, so a wrong hotel doesn't get someone else's phone number. `url` falls back to the Google Maps link for sources without hotel links (LiteAPI, Hotelbeds). Sources and Places are called live, so each run costs API quota (30 Places lookups).

## 2026-10-17 — Hotel price search scripts
tags: feature, search, data-source
- Feature: `xotelo.js`, `searchapi.js`, `liteapi.js`, `hotelbeds.js` and `apify-booking.js` each return the 30 cheapest hotels in `settings.city` that pass the shared filters (max nightly price, min rating out of 5, min reviews). `search.js` runs the enabled sources in parallel and merges them. Every setting can be overridden on the command line (`--city=Paris`). SerpApi was swapped for SearchApi.io, which we have a key for.
- Status: wip. Xotelo was tested live before the refactor (30 Toronto hotels in ~63s, no key). The others are written against the docs and haven't been run yet.
- Notes: None of these return phone numbers, so join with Google Places (`maps.js`) by name. Xotelo `/search` now needs RapidAPI and `/list` throws random 500s (retried), so `locations.js` finds the TripAdvisor city key with a SearchApi Google search (`site:tripadvisor.com`) and finds the Hotelbeds code in the Content API destination list (matching suburbs through zones). Both are cached in `.cache/locations.json`. Rating scales differ (Booking and LiteAPI are out of 10). Hotelbeds, LiteAPI and Booking prices are per stay, so they are divided by `NIGHTS`. The Apify actor runs a browser server-side, which is a gray area under the rules.

## 2026-10-17 — On-device price finder (pricing.js)
tags: feature, search, pricing, llm
- Feature: `node pricing.js <City>` searches Places, OCR-prefilters each hotel's photos and sends hits to a local VLM, scrapes the hotel site and likely rate pages over plain HTTP, and has the local model extract rates. Writes `pricing-results.json`.
- Status: done (experiment)
- Notes: The VLM reads a synthetic rate card correctly (~12s and ~1.2k tokens per image on M4). On 5 Toronto budget hotels, 0 of 50 Places photos and 0 of 17 pages contained room prices. Photos are rooms and lobbies. Rates live in JS booking engines (asiwebres, xmlcal, Wix) that need dates, so static scraping can't see them. Conclusion: Places photos and static sites are not a viable price source. Use a rates API, or ask the price on the call.
