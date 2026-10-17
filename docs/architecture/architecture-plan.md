---
title: Architecture Plan
tags: [architecture, telephony, elevenlabs, backboard, coordination, tokens, testing]
status: draft
updated: 2026-10-17
---

# Architecture Plan

A condensed version of the research in [the field guide](../research/elevenlabs-backboard-field-guide.html) ([live artifact with comments](https://claude.ai/artifact/LNTQDh9RvPumpS1tPmusPp)). These are proposals. Log each one in [decisions.md](../log/decisions.md) once we commit to it. The end-to-end flow from a text prompt to the email, with the stages and what each service owns, is in [run-workflow.md](run-workflow.md).

## Summary

- **A run starts from a text prompt.** Backboard parses it and searches for hotels; our code picks the 5 cheapest.
- **Calls run on ElevenLabs.** We create one ElevenLabs agent (a stored config) and run 5 parallel conversations with it, one per hotel. Twilio provides the phone line.
- **Our service is one local process.** It places the calls, exposes a public API the agents call during their calls, keeps the race state in memory, and sends the email.
- **Coordination happens in our process, not in Backboard.** A dict plus a lock makes sure only one hotel gets booked.
- **Backboard sits outside the calls.** It parses the prompt and runs the hotel search. Optionally it also stores lessons across runs, checks transcripts and writes reports.
- **Every token is logged** to a ledger per run. A tally script sums it after the email is sent.

## Stack Choices

| Component | Choice | Why | Cost |
|---|---|---|---|
| Voice agent + conversation | ElevenLabs Agents (Creator plan) | Built-in tools for holds, phone menus, voicemail and hang-up; 10 concurrent calls | Hackathon coupon (Creator plan); 275 min included, then $0.08/min |
| Phone line | Twilio number imported into ElevenLabs | ElevenLabs needs Twilio or a SIP trunk to call out | Not covered by credits; a few dollars total |
| Our service | Python + FastAPI, one process (`run.py`) | Fast to build; async calls fit a 5-way fan-out | Free |
| Public URL | cloudflared named tunnel or ngrok reserved domain | ElevenLabs must reach our endpoints; the URL must stay stable | Free |
| Email | Resend, SendGrid or Gmail SMTP (TBD) | Neither sponsor sends email | Free tier |
| Prompt parsing, hotel search, memory | Backboard | One API key for any model, plus web search and memory | Hackathon credits + $5 free |
| Dev tooling | ElevenLabs hosted MCP, ElevenLabs docs MCP, Backboard docs MCP | Set up agents and read transcripts while building; never used in the live run | Free |

**MCP status:** ElevenLabs has a hosted product MCP at `https://api.elevenlabs.io/v1/mcp` (OAuth) and a docs MCP. Backboard has only a docs MCP; its product is REST and SDK only. The product lives at backboard.io; backboard.ai is a parked domain.

## Runtime Architecture

```
 our service (run.py)                                cloud
┌────────────────────────────────┐   POST outbound-call ×5    ┌───────────────────┐       ┌────────┐
│ dialer                         │ ─────────────────────────▶ │ ElevenLabs        │◀─────▶│ Twilio │──▶ hotels
│ coordinator (FastAPI)          │ ◀── tool calls (HTTP) ──── │ 5 conversations   │       └────────┘
│   board = {...} + lock         │ ─── JSON tool result ────▶ │ (LLM + voice)     │
│ post-call webhook receiver     │ ◀── call ended + data ──── │                   │
│ emailer + ledger.jsonl         │                            └───────────────────┘
└────────────────────────────────┘ ── optional ──▶ Backboard (lessons, checks, reports)
        ▲ public HTTPS via tunnel
```

## One Call, Start to Finish

1. **Dial.** `POST /v1/convai/twilio/outbound-call` with `agent_id`, `agent_phone_number_id`, `to_number` and dynamic variables (`run_id`, `candidate_id`, hotel name, dates, guest). It returns `conversation_id` and `callSid` within about a second.
2. **ElevenLabs runs the call.** Listening, the LLM, speech, holds and phone-menu tones all happen on their side. Our code is not in that loop.
3. **Tool calls reach our API.** When the agent's LLM decides to use a tool, ElevenLabs POSTs to our endpoint and waits for our JSON reply. This is pull-only: we can't push into a call between tool calls.
4. **Email on confirmation.** When `report_confirmation` arrives, we send the receipt right away. The race clock stops here.
5. **Hang up.** The agent calls `end_call`. As a backstop, we hang up through Twilio using the `callSid`.
6. **Post-call webhook.** It arrives later and carries the transcript, the extracted fields and cost/token data. We use it to double-check the email and to fill the ledger.

## Coordinator

State lives in memory, mirrored to `runs/<run_id>/ledger.jsonl`:

```python
board = {"run_id": "...", "winner": None,
         "calls": {"h1": {"status": "ringing", "quote": None, "conversation_id": "...", "callSid": "..."}}}
```

| Route (webhook tool) | Agent calls it when | We do | Agent hears |
|---|---|---|---|
| `report_quote(price, available)` | The hotel gives a price | Store the quote | `booking_open`, best price seen |
| `claim_booking(price)` | It is about to say "yes, book it" | Take the lock; apply the booking policy | `BOOK`, or `DECLINE` + a polite line |
| `check_status()` | At checkpoints, or while waiting | Read the board | Keep going / wrap up |
| `report_confirmation(conf, price, dates, address)` | The hotel gives a confirmation number | Send the email, mark done, wind down other calls | `ok` |
| `POST /webhooks/elevenlabs` | ElevenLabs, after each call | Verify HMAC; log tokens and fields | — |

**Booking policy.** Quotes commit to nothing; bookings reserve a real room. Choosing the best price therefore has to happen at the quote stage, before anyone books.
- **First success (default):** the first claim at or under the price ceiling gets `BOOK`. Fastest.
- **Best price:** hold each claim for a 20–30 s window. The agent says "one moment while I confirm with my guest" and waits. The cheapest quote then gets `BOOK`. Cheaper, but slower, and the hotel may not wait.

**Gotchas:**
- Run one worker only (`uvicorn --workers 1`). With several workers, each has its own state and the lock breaks.
- The tool URLs are saved in the agent config, so the tunnel URL must not change between restarts. Otherwise, have `run.py` update the URLs at startup.
- Protect our routes with a secret header. Webhook tools can send custom headers.

## Agent Config (ElevenLabs)

- **Language and voice:** English (`en`), a natural voice, and hotel and street names as ASR keywords.
- **System tools:**
  - `skip_turn`: stay silent on hold.
  - `play_keypad_touch_tone`: navigate phone menus (`0-9 * #`; `w`/`W` add pauses).
  - `voicemail_detection`: end the call, no message.
  - `end_call`
- **Webhook tools:** the four coordinator routes, each passing `{{candidate_id}}` and `{{system__conversation_id}}`.
- **Turn settings:**
  - `turn_timeout` 20–30 s, for holds
  - `max_duration_seconds` 900
  - turn eagerness `normal`
  - interruptions on
  - a soft-timeout filler ("one sec…")
  - tool call sounds on
- **Call setting:** `ringing_timeout_secs` 25 (default 60).
- **Data collection (backup extraction):** `booked`, `confirmation_number`, `total_price`, `currency`, `stay_dates`, `hotel_address`.
- **Dynamic variables, not overrides.** Overrides must first be enabled in the agent's security settings.
- **Prompt rules:**
  - Say yes if asked whether it's an AI.
  - Never give card numbers; follow `{{payment_policy}}`.
  - Read the confirmation number back digit by digit.

## Backboard's Role

**In the main path:** parsing the prompt and searching for hotels (Stages 2–3 in [run-workflow.md](run-workflow.md)).

**Optional, best first:**

1. **Lessons across runs.** Store per-hotel facts after each call ("press 2 for reservations, holds ~40 s"). Before the next run, search memory and pass the hits in as `{{hotel_notes}}`.
2. **Checks and reports.** Have a model double-check the winning transcript's four fields, and write the Learnings summary from the ledger.
3. **In-call LLM via a custom-LLM proxy.** Our server answers ElevenLabs' OpenAI-style LLM requests and forwards them to Backboard. This adds latency on every turn. Use it only if deep sponsor use earns points.
**Not for the live race state.** Memory writes are asynchronous and there is no atomic lock.

## Token and Cost Tally

Every token-spending step appends a line to `runs/<run_id>/ledger.jsonl`. `tally.py` runs after the email and writes `report.md` / `report.json`.

| Source | Where the numbers come from |
|---|---|
| Backboard | Every response: `input_tokens`, `output_tokens`, `model_name`. Streaming adds cached tokens and `cost_usd`. |
| ElevenLabs calls | `GET /v1/convai/conversations/{id}` once `status` is `done`: `metadata.charging.llm_usage.initiated_generation.model_usage` (tokens + price per model), `llm_price`, `cost_fiat`, `call_duration_secs`, `tts_usage.total_characters` |
| ElevenLabs post-call analysis | `charging.analysis.total.price` (cost only, no tokens) |
| Twilio | Call `price` and `duration` by `callSid` |

**Cross-checks:**
- Compare the ledger against Backboard's `/billing/usage/recent`. It covers the whole account, so keep the key to ourselves during a run.
- Check that each call's token prices add up to `llm_price`.

**Report:** totals and breakdowns by stage, call and model. Also tokens per booking, the share of tokens spent on calls that lost, and the all-in cost.

## Suggested Runs

| Run | Goal | Setup | Pass when |
|---|---|---|---|
| 0. Setup | Accounts and plumbing | Redeem the Creator coupon; buy a Twilio number; import it into ElevenLabs; verify teammates' phones (trial); start the tunnel; create the agent | `outbound-call` returns a `conversation_id` |
| 1. Single call | One call end to end | Call one teammate's phone; receptionist books right away | Email arrives with all 4 fields; ledger has the call's tokens |
| 2. Scenarios | Call handling (10 pts) | One call at a time: a 45 s hold with music, a menu ("press 1 for reservations"), a request for a card, no rooms, voicemail | Each scenario handled without talking over the receptionist or hanging up early |
| 3. Fan-out | Coordination | 5 calls at once to 5 teammates, with different prices and speeds | Exactly one `BOOK`; the others decline politely; one email |
| 4. Policy A/B | Speed vs price | Repeat run 3 with "first success" and then "best price" | Timings and costs compared; choice logged in decisions.md |
| 5. Dress rehearsal | Competition timing | Full run with timing on, upgraded Twilio account (no trial notice), the real email address format | Race time and tally report produced; nothing set up by hand during the run |
| Optional harness | Repeatable tests | A second ElevenLabs agent on a second number plays the front desk | Scenarios rerun without people; costs agent minutes |

Twilio trial accounts can only call verified numbers and play a notice before connecting. Upgrade before run 5.

## Open Questions

- What should the agent say when asked for a card guarantee? Ask the organizers.
- Is the ElevenLabs Agents platform fine under "no ready-made agents"? We write the prompt, tools and orchestration ourselves, but confirm.
- Are the hotels real or simulated by the organizers?
- Which email provider? Which hotel data source, once search is back in scope?
- Booking policy default: first success or best price (see run 4).
