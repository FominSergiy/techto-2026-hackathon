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
