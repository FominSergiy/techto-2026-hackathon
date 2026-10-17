---
title: Agent Config Sync
tags: [architecture, elevenlabs, telephony, process]
status: active
updated: 2026-10-17
---

# Agent Config Sync

How the ElevenLabs agent config in this repo stays in sync with ElevenLabs, when to sync, and how to switch on the coordinator hooks. Agent settings themselves are in [architecture-plan.md](architecture-plan.md#agent-config-elevenlabs).

## What Lives Where

| Thing | In the repo | On ElevenLabs |
|---|---|---|
| Agent registry | `agents.json` (config path, `agent_id`, `branch_id`, `version_id` of the last pull/push) | — |
| Agent config | `agent_configs/Alex.json` (prompt, voice, tools, turn, data collection, workflow) | Agent **Alex** `agent_2501m552v9ayegsrycv3hb092dw4` |
| Coordinator webhook tools | `tool_configs/*.json` (not registered, not uploaded) | Not created yet |
| Secrets | `.env` (gitignored) | Workspace secrets store |

ElevenLabs targets:

| Target | ID | Config | Live traffic |
|---|---|---|---|
| Alex · `Main` branch | `agtbrch_7801m552vbmxf77ankk22ex5hy1v` | This repo: callback/dates/Luke voice (version `agtvrsn_6701m55m4p53ea9as0hw7rghm45t`). It replaced Davide's dashboard prompt `agtvrsn_5901m55h5xt7et3tzm1n9vjpayns` ("Refine agent prompt…"), which is still in the version history. | 100% |
| Alex · `repo-sync` branch | `agtbrch_6701m55bzx57f3d97smmefs2tv86` | Same config as Main (version `agtvrsn_3001m55ma733e9rrnsf0rd7xnck9`) | 0% |
| Alex · `main-backup-2026-10-17` branch | `agtbrch_1301m55ck5zaf1dsh4yen1wxy07j` | Davide's original Main, from before the sync (same as git `e324d67`) | 0% |
| Alex · `Alex - Experiment` branch | `agtbrch_6601m552vbzye7fayn8rqbx9nm7a` | Davide's | 0% |
| Agent **Alex (repo config)** (a copy) | `agent_3301m55c1j1xfap8y08jjvcj3g23` | This repo as of PR #4 | Its own agent; no phone number assigned |

**Rollback:** merge `main-backup-2026-10-17` into Main, or push `git show e324d67:agent_configs/Alex.json` to Main.

`agents.json` records the `repo-sync` branch, but **CLI 1.6.1 ignores that field and a plain `elevenlabs agents push` goes to Main**. Always pass the branch: `elevenlabs agents push --branch agtbrch_6701m55bzx57f3d97smmefs2tv86`.

## How Sync Works

- **`elevenlabs agents pull`** copies ElevenLabs → local and overwrites the local file. It asks first; `--yes` skips the prompt. `--branch` (with `--agent`) pulls a non-Main branch.
- **`elevenlabs agents push`** copies local → ElevenLabs. It **replaces** the config on the branch in `agents.json` (or `--branch`) and creates a new version; `--version-description` labels it.
- **No merge, no drift check.** Push always says "force override". `agents status` only reads `agents.json`; it never compares with ElevenLabs. If someone edits in the UI and we then push, their edits are gone. Pull first.
- **Tools are separate objects.** `elevenlabs tools push` creates them and returns IDs. The agent references them by ID in `conversation_config.agent.prompt.tool_ids`; push the tools first, then the agent.
- **Branches are the safety net.** Push to a branch, test it, then merge it into Main in the UI or with `elevenlabs agents branches merge`. A new branch gets 0% of live traffic.

## When to Sync

1. **Before editing:** `elevenlabs agents pull --agent agent_2501m552v9ayegsrycv3hb092dw4 --branch repo-sync --yes`. Commit any diff it shows; that's someone's UI edit.
2. **After editing, to test:** `elevenlabs agents push --branch agtbrch_6701m55bzx57f3d97smmefs2tv86 --version-description "<what changed>"`. Without `--branch` it goes to Main. To test that branch, place a call to `POST /v1/convai/twilio/outbound-call` with `agent_id` = Alex and `conversation_initiation_client_data.branch_id` = the `repo-sync` ID. Or use the copy's `agent_id`.
3. **After test calls pass:** merge `repo-sync` into Main. Only one person merges; tell the team first, since Davide may have UI edits on Main. Preview with `elevenlabs agents branches preview_merge`.
4. **After a merge in the UI:** pull Main into the repo and commit, so git matches what's live.

To update the copy, push the same file under its own name and ID. `agent_configs/Alex.json` keeps the name "Alex", and pushing it straight to the copy would rename it. The copy's registry is kept outside the repo for that reason:

```bash
mkdir -p /tmp/alex-copy/agent_configs && cd /tmp/alex-copy
jq --indent 4 '.name = "Alex (repo config)"' <repo>/agent_configs/Alex.json > agent_configs/Alex-repo-config.json
# agents.json here: one entry, id agent_3301m55c1j1xfap8y08jjvcj3g23, config agent_configs/Alex-repo-config.json
elevenlabs agents push --agent agent_3301m55c1j1xfap8y08jjvcj3g23
```

## Personal Copies in Your Own Workspace

Teammates without access to Davide's workspace test on their own copy, built from the same `agent_configs/Alex.json`. Keep the copy's registry and key outside the repo so the repo's `agents.json` and `.env` stay untouched.

| Owner | Workspace agent | Sync folder |
|---|---|---|
| Sergiy | `agent_3001m55j894cfm4bavqabbnjgc54` (no phone number yet) | `~/project-space/alex-sergiy` |

Setup (once):

```bash
mkdir -p ~/project-space/alex-<you>/agent_configs && cd ~/project-space/alex-<you>
echo "ELEVENLABS_API_KEY=<your key>" > .env    # the CLI reads .env from the current folder
echo '{"agents": []}' > agents.json            # `agents add` fails without it
cp <repo>/agent_configs/Alex.json agent_configs/
set -a; . ./.env; set +a
elevenlabs agents add "Alex" --from-file agent_configs/Alex.json
# `add` writes a duplicate Alex-1.json; delete it and point agents.json at Alex.json
```

To sync: copy the newest `Alex.json` in, then `elevenlabs agents push --version-description "<what changed>"`. To make calls, import a Twilio number into your workspace and assign it to the copy. The voice (Luke, `RNnkVeW25AwKYxZgnHBH`) is a library voice, so add it to your workspace first: `POST /v1/voices/add/32b8dada727cfb7bb57cd138caa6325977eb85dceae264884bab126701e502bd/RNnkVeW25AwKYxZgnHBH`.

## Gotchas

- **The CLI reads `.env` in the current folder.** In this repo it uses `ELEVENLABS_API_KEY`, which is Davide's key, so every push and branch shows up as Davide. In a folder without `.env` it falls back to your own `elevenlabs auth login`, which may lack edit rights on agents Davide created.
- **A plain `push` targets Main** (CLI 1.6.1), whatever `branch_id` says in `agents.json`. This overwrote Main once on 2026-10-17. Always pass `--branch`, and check `agents.json` after a push: the CLI rewrites `branch_id` to the branch it actually pushed to.
- **`pull --branch X` without `--update` skips** an agent that already exists. With `--update` it writes a second file, `Alex.<branch>.json`, and a `branches` block in `agents.json`.
- **`pull --dry-run` still writes an empty `agents.json`.**
- **An empty workflow is rejected** ("Dictionary should have at least 1 item"). To have no workflow, keep only `start_node` with an empty `edge_order`.
- **`elevenlabs agents update --json` validates against an older schema** and rejects a pulled config. Use `agents push`.
- **Pulled numbers lose their `.0`** after editing with `JSON.stringify` (`4.0` → `4`). It's harmless; ElevenLabs reads them the same.

## Switching On the Hooks

Two kinds, both needing the public tunnel URL from [run-workflow.md](run-workflow.md#network). Do this once `run.js` and the named tunnel are up.

**Webhook tools** (mid-call check-ins). The configs are in `tool_configs/`: `report_quote`, `claim_booking`, `check_status`, `report_confirmation`.
1. Create a workspace secret for the shared header: `elevenlabs agents secrets create`. Put its `secret_id` in each file in place of `REPLACE_WITH_ELEVENLABS_SECRET_ID`.
2. Replace `https://REPLACE_WITH_TUNNEL_HOST` with the tunnel host.
3. Register and upload: `elevenlabs tools add` or `elevenlabs tools push`. Note the returned tool IDs.
4. Add the IDs to `tool_ids` in `agent_configs/Alex.json`, add the check-in rules below to the prompt, and push to `repo-sync`.

Each body carries `run_id`, `candidate_id` and `system__conversation_id` from dynamic variables, plus the fields the LLM fills in.

**Post-call webhook** (Stage 7):
1. `elevenlabs webhooks create` → `https://<tunnel>/webhooks/elevenlabs`, with HMAC auth. Save the signing secret in `.env`.
2. Set `platform_settings.workspace_overrides.webhooks.post_call_webhook_id` in `agent_configs/Alex.json` and push.

**Check-in rules to add to the prompt** only when the tools are attached:

```
Check-ins (follow each reply exactly):
- Right after the hotel states a price, call report_quote.
- Just before you say you'll take the room, call claim_booking. Only say yes on BOOK. On DECLINE, thank them and end the call.
- While on hold for a long time, call check_status. If told to wrap up, thank them and end the call.
- Once the hotel confirms (with a number, verbally, or availability only), call report_confirmation. If the reply asks for a missing detail, ask for it, then call it again.
```

## Dynamic Variables Passed per Call

| Variable | Used for | Default placeholder |
|---|---|---|
| `guest_name`, `number_of_guests`, `check_in_date`, `check_out_date` | Greeting, booking | Davide's test values |
| `contact_email` | Given only if the hotel offers to email a confirmation | Davide's |
| `hotel_name` | Prompt, read-back | `the hotel` |
| `run_id`, `candidate_id` | Webhook tool bodies | `test-run`, `h1` |
| `listed_price` | Not used in the prompt yet; reserved for checks | empty |
| `hotel_notes` | Backboard lessons from past calls | empty |
