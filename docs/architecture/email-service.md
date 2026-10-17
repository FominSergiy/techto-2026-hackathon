---
title: Email Service
tags: [architecture, email, workflow]
status: active
updated: 2026-10-17
---

# Email Service

`Davide_test/email_service.py` is the standalone receipt sender (Stage 6 in [run-workflow.md](run-workflow.md#stage-6--email)). Give it one booking payload and it checks the spec's 4 required fields, builds the email and sends it. It holds no run state and knows nothing about calls, so any code that has a booking can use it.

## Payload

| Key | Required | Notes |
|---|---|---|
| `number` | Yes, unless `type` is verbal | Reservation / confirmation number from the call |
| `type` | No | `reservation_id` (default) · `verbal_booking` · `verbal_availability`. A verbal type with no `number` fills the field with "Verbal confirmation … from `receptionist` at `hotel`, call at `call_time`" |
| `price` | Yes | A number is formatted with `CURRENCY` (default CAD); a string is used as is |
| `date` | Yes | Check-in date, ISO `YYYY-MM-DD` |
| `address` | Yes | Hotel street address. Fall back to the search result if the call didn't capture it |
| `hotel`, `phone`, `check_out` | No | Shown in the email when present |
| `receptionist`, `call_time` | No | Used only for verbal types |
| `to` | No | Overrides `RESULT_EMAIL` (CLI `--send` only; in Python pass `to=`) |

A missing required field raises `ValueError` and nothing is sent. The caller should then ask the agent for that field.

```json
{"hotel": "Novotel Toronto Vaughan", "address": "200 Bass Pro Mills Dr, Vaughan, ON L4K 0B9",
 "phone": "+19056600212", "number": "ABC123", "price": 128, "date": "2026-10-17", "check_out": "2026-10-18"}
```

## Wiring It In

**From Python (the call code in `main.py`):** this path is already wired up. When a call returns a booking, `main.py` maps the ElevenLabs `data_collection_results` into the payload and calls:

```python
from email_service import send_confirmation
result = send_confirmation(res)   # -> {"provider", "id", "to", "ms"}; raises on failure
```

The `email sent` log line marks the race time. If the send raises, the booking is already logged on the line before it, so it can be re-sent by hand with `--send`.

**From a webhook or coordinator (`report_confirmation` tool):** build the same dict from the tool arguments and call `send_confirmation` in a background thread, so the agent's tool call returns at once (see Stage 6).

**From another language (e.g. a Node coordinator):** pipe the JSON in. It prints a result JSON and exits 0, or prints `{"error": ...}` and exits 1.

```bash
python Davide_test/email_service.py --send payload.json
```

## Config

Put these in the repo-root `.env`; `load_dotenv()` searches upward and finds it. All keys are listed in `Davide_test/.env.example`.

- `RESULT_EMAIL`: the recipient. Set it to the organizers' address on race day.
- `TEAM_NUMBER`: goes in the subject line.
- `SMTP_USER`, `SMTP_APP_PASSWORD`: Gmail plus an app password (the default provider).
- Optional: `EMAIL_BCC`, `CURRENCY`, `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM`.

## Pre-flight

```bash
python Davide_test/email_service.py --dry-run
```

```bash
python Davide_test/email_service.py --test you@example.com
```

A Gmail SMTP send took about 0.9 s on 2026-10-17. Sends are retried once, 1 s apart.
