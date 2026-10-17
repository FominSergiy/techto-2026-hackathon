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

## 2026-10-17 — main.py: verbal bookings count; TEST_NUMBER guard
tags: feature, workflow, email, telephony
- Feature: `result_from()` in `Davide_test/main.py` accepts a reservation number or a verbal confirmation with a price, and passes `type`, `receptionist` and `call_time` to `email_service`. `to_number()` uses `TEST_NUMBER` only if its first comma-separated entry has 10+ digits; otherwise it dials the hotel.
- Status: done. Checked offline against saved conversations: Rodd Moncton (verbal) builds a full receipt, a reservation-ID call keeps its number, voicemail and wrong-line calls still fail. Not yet tried in a live run.
- Notes (from the 15:08 and 15:11 Moncton runs):
  - **No real hotel gave a reservation number.** Rodd quoted $282 all-in, wanted a 25% deposit, and confirmed availability at pay-at-hotel. Verbal is the realistic outcome.
  - **A bad `TEST_NUMBER` dials "+".** All 3 calls at 15:08 failed with "number is not valid". An earlier comma-separated value got glued into one 21-digit number.
  - **Read-back mixed up guest and receptionist:** Alex said the booking was "under the name Hamza" (the receptionist), not the guest. Needs a prompt fix on `repo-sync`.
  - **Wrong line:** the Motel 6 number from search reached the bar. Alex got the front desk number but had no tool to use it, so the call was lost.
  - **Call address can be short:** the call gave "434 Main Street" with no city, and it overrides the fuller scraper address.

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
