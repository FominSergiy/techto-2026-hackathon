---
title: Hackathon Brief (Project Spec)
tags: [spec, requirements, judging, rules]
status: active
updated: 2026-10-17
---

# Hackathon Brief (Project Spec)

This is the source of truth for the project. Every decision in `docs/log/decisions.md` must be traceable to something here.

## Mission

> Build an AI Agent that finds and books the best deal at a hotel in City X. Every agent runs the same task at the same time. The fastest and least expensive booking reservation wins.

The agent must:

- find the least expensive hotels in a city
- call these hotels and attempt to make a reservation
- e-mail the reservation confirmation to an email address we will provide

## Rules

- No ready-made agents.
- No browser automation tools.
- The agent **must make a phone call**.
- The agent **must deliver a receipt to the provided email address**.

## Booking Goal (No Payment)

- There is **no payment**. The agent never collects, asks for or gives card or payment details.
- The agent's final goal is to **make a booking**: get a verbal confirmation from the hotel, a reservation ID, or both.
- If the hotel asks for a card to hold the room, the agent should ask to book without one (for example, pay at the hotel).
- If the hotel refuses to book without payment, the agent gets a **verbal confirmation that the room is available for the requested date at the quoted price**. We treat that as the confirmation.

## Required Output (to count at all)

The confirmation email must contain all four:

1. Reservation confirmation number
2. Price
3. Date
4. Hotel address

## Judging Criteria

- Agents are ranked on **speed** and **cost**. To count, each agent must email a reservation confirmation number, price, date and hotel address.
- The top 3 teams are shortlisted to present to the judges how they built their agents.
- Judges score:
  - **Total Time (10 pts)**: How long did the agent take to complete the competition?
  - **Call Handling (10 pts)**: How well did the agent handle the phone call to the hotel reception? Was the conversation natural? Did it handle IVR or holds? Was the agent able to get the reservation #?
  - **Learnings (10 pts)**: How many tokens were consumed? What would you do differently? What would faster look like? Are there clear lessons for others to learn from?

## Derived Requirements (our interpretation, not official)

Pipeline the agent has to run end to end:

1. **Search**: find the cheapest hotels in City X (no browser automation, so APIs or data sources only).
2. **Rank**: order candidates by price, with phone numbers attached.
3. **Call**: place an outbound phone call to the hotel.
4. **Converse**: get through IVR menus and holds, speak naturally with reception, and fall back to the next hotel if needed.
5. **Capture**: get the booking confirmed (verbal and/or reservation ID) plus price, date and address from the call. No payment step.
6. **Email**: send a confirmation containing all four required fields to the provided address.

Cross-cutting:

- **Instrument from day one**: record wall-clock time per stage and token usage per run. Both are judged.
- **Keep a learnings trail**: log what worked and what didn't in `docs/log/`. It feeds the Learnings score.
- **Optimize for speed over polish**: this is a hackathon, not production.

## Open Questions / TBD

- Which city is City X? (revealed at competition time?)
- Target email address (provided by organizers)
- Check-in date(s), number of nights, number of guests
- Telephony provider for outbound calls
- Hotel data source (price + phone number)
- What "cost" means: room price, agent run cost (tokens/telephony), or both?
- Whether hotels are real or simulated by organizers
- Verbal-only confirmation: Required Output asks for a confirmation number. If the hotel gives no reservation ID (including when it refuses to book without payment and only confirms availability), what goes in that field? (Proposed: always ask for an ID; if none is given, state "verbal confirmation" with the receptionist's name and call time.)
