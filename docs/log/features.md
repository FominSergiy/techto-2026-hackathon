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

## 2026-10-17 — On-device price finder (pricing.js)
tags: feature, search, pricing, llm
- Feature: `node pricing.js <City>` searches Places, OCR-prefilters each hotel's photos and sends hits to a local VLM, scrapes the hotel site and likely rate pages over plain HTTP, and has the local model extract rates. Writes `pricing-results.json`.
- Status: done (experiment)
- Notes: The VLM reads a synthetic rate card correctly (~12s and ~1.2k tokens per image on M4). On 5 Toronto budget hotels, 0 of 50 Places photos and 0 of 17 pages contained room prices. Photos are rooms and lobbies. Rates live in JS booking engines (asiwebres, xmlcal, Wix) that need dates, so static scraping can't see them. Conclusion: Places photos and static sites are not a viable price source. Use a rates API, or ask the price on the call.
