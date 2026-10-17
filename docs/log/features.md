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
