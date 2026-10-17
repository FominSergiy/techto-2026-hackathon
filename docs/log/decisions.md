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
