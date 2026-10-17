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
