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

## 2026-10-17 — Email via Gmail SMTP (default), Resend as an option
tags: decision, email, stack
- Decision: `Davide_test/email_service.py` sends the receipt. It uses Gmail SMTP with an app password by default, or Resend when `RESEND_API_KEY` is set. It is Python because the backend now lives in `Davide_test/` (Python), which conflicts with the Node.js entry below. The team still has to settle that.
- Why: The spec requires the receipt to reach an address the organizers provide. Gmail SMTP can send to any address with no domain setup, while Resend's free tier only sends to your own login until a domain is verified. Neither adds a dependency.
- Alternatives: SendGrid (sender verification + more setup); Resend only (blocked on a domain).

## 2026-10-17 — Agent config lives in the repo; ElevenLabs CLI syncs it, branch first
tags: decision, elevenlabs, telephony, process
- Decision: `agent_configs/Alex.json` is the source of truth, synced with `elevenlabs agents pull/push`. Pushes go to Alex's `repo-sync` branch (0% live). Main is changed only by merging after test calls. Alex's 3-step workflow is removed in favour of one prompt. Coordinator webhook tools are written but not attached until the tunnel exists. A copy, "Alex (repo config)", carries the same config as a standalone agent.
- Why: Push has no merge or drift check (last writer wins), so branches protect Davide's live Main. A single prompt avoids the workflow's conflicting step prompts and undefined variables, and saves the LLM checks between steps (spec: time and cost). Attaching tools before our service exists would make calls fail.
- Alternatives: Use the ElevenLabs MCP (needs OAuth in an interactive session; not available to us); push straight to Main; keep the workflow and rewrite its steps.

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
