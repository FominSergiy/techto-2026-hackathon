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

## 2026-10-17 — Backend is Node.js, not Python + FastAPI
tags: decision, architecture, stack
- Decision: Our service (dialer, coordinator, webhook receiver, emailer) is a single Node.js process. FastAPI/uvicorn and the Python scripts are dropped from the architecture docs.
- Why: The team is on Node.js. Single-process Node keeps the booking-lock state in one place, as the coordinator needs (see architecture-plan.md).
- Alternatives: Python + FastAPI (original proposal).

## 2026-10-17 — No payment; booking ends at verbal confirmation and/or reservation ID
tags: decision, booking, call-handling, spec
- Decision: The agent never handles payment. Success means the hotel confirms the booking verbally, gives a reservation ID, or both. If a hotel won't book without a card, the agent gets verbal confirmation that the room is available for the requested date at the quoted price, and we count that as the confirmation.
- Why: Clarified by the team and added to the spec under "Booking Goal (No Payment)". It keeps payment details out of the call flow and makes the call shorter.

## 2026-10-17 — Docs live in docs/, AGENTS.md is the canonical agent guide
tags: decision, docs, process
- Decision: All project docs go under `docs/` with YAML frontmatter. `AGENTS.md` is the single agent guide, and `CLAUDE.md` just imports it.
- Why: One searchable place for context. Grep-friendly frontmatter and headings keep it cheap for agents to find things.
- Alternatives: Separate CLAUDE.md / AGENTS.md content (rejected: they would drift apart).
