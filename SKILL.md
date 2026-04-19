---
name: openclaw-mcp-gateway
description: Use this skill when operating or integrating the openclaw-mcp-gateway project: configuring MCP-to-Gateway auth, running health/tools checks, enabling cron RPC tools, and troubleshooting gateway transport/validation/auth errors for SSH-sandboxed agents.
---

# OpenClaw MCP Gateway

Use this skill to operate the `openclaw-mcp-gateway` service safely and effectively.

## What this project does

- Exposes a strict MCP allowlist for OpenClaw Gateway operations.
- Keeps gateway credentials outside SSH sandbox agents.
- Supports fixed HTTP tools and allowlisted Gateway WebSocket RPC cron tools.

## Setup Checklist

1. Set `OPENCLAW_GATEWAY_URL`.
2. Set `OPENCLAW_GATEWAY_TOKEN` (or legacy `OPENCLAW_GATEWAY_KEY`) or mount `/run/secret/openclaw_gateway_token`.
3. Start service (`npm start` or compose).
4. Verify `GET /healthz` returns `{ "ok": true, "status": "ready" }`.
5. Verify MCP `tools/list` contains:
   - `openclaw_status`
   - `openclaw_gateway_status`
   - `openclaw_cron_status`
   - `openclaw_cron_list`
   - `openclaw_cron_add`
   - `openclaw_cron_update`
   - `openclaw_cron_remove`
   - `openclaw_cron_run`
   - `openclaw_cron_runs`

## Tool Parameters

### `openclaw_status`

No parameters. Lists active OpenClaw sessions (calls `POST /tools/invoke` with `sessions_list`).

### `openclaw_gateway_status`

No parameters. Checks gateway health (calls `GET /healthz`).

### `openclaw_cron_status`

No parameters. Returns cron scheduler status.

### `openclaw_cron_list`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer 1–200 | Max jobs to return |
| `offset` | integer ≥0 | Pagination offset |
| `query` | string | Filter by name/description |
| `enabled` | `"all"` \| `"enabled"` \| `"disabled"` | Filter by enabled state |
| `includeDisabled` | boolean | Include disabled jobs |
| `sortBy` | `"nextRunAtMs"` \| `"updatedAtMs"` \| `"name"` | Sort field |
| `sortDir` | `"asc"` \| `"desc"` | Sort direction |

### `openclaw_cron_add`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Job name |
| `schedule` | object | yes | Schedule — see [Schedule](#schedule-object) |
| `sessionTarget` | string | yes | `"main"` \| `"isolated"` \| `"current"` \| `"session:<id>"` |
| `wakeMode` | string | yes | `"now"` \| `"next-heartbeat"` |
| `payload` | object | yes | What to deliver — see [Payload](#payload-object) |
| `description` | string | no | Human-readable description |
| `enabled` | boolean | no | Start enabled (default: true) |
| `deleteAfterRun` | boolean | no | Remove job after first successful run |
| `agentId` | string \| null | no | Target agent override |
| `sessionKey` | string \| null | no | Session key override |
| `delivery` | object | no | How to notify — see [Delivery](#delivery-object) |
| `failureAlert` | false \| object | no | Alert after repeated failures — see [FailureAlert](#failurealert-object) |

### `openclaw_cron_update`

Exactly one of `id` or `jobId` is required, plus `patch`:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | one-of | Internal job UUID |
| `jobId` | string | one-of | Human-readable job name/id |
| `patch` | object | yes | Fields to update (all optional) — same fields as `openclaw_cron_add`, plus `state` (see [State patch](#state-patch)) |

### `openclaw_cron_remove`

Exactly one of `id` or `jobId` is required:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | one-of | Internal job UUID |
| `jobId` | string | one-of | Human-readable job name/id |

### `openclaw_cron_run`

Exactly one of `id` or `jobId` is required:

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | one-of | Internal job UUID |
| `jobId` | string | one-of | Human-readable job name/id |
| `mode` | `"due"` \| `"force"` | no | `force` ignores schedule; `due` runs only if due |

> **Note:** `openclaw_cron_run` may return `enqueued: true`. Use `openclaw_cron_runs` to inspect the final execution outcome.

### `openclaw_cron_runs`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `scope` | `"job"` \| `"all"` | Scope to specific job or all jobs |
| `id` | string | Filter by internal job UUID |
| `jobId` | string | Filter by human-readable job name/id |
| `limit` | integer 1–200 | Max runs to return |
| `offset` | integer ≥0 | Pagination offset |
| `statuses` | string[] (1–3 items) | Array of `"ok"`, `"error"`, `"skipped"` |
| `status` | `"all"` \| `"ok"` \| `"error"` \| `"skipped"` | Single status filter |
| `deliveryStatuses` | string[] (1–4 items) | Array of delivery status values |
| `deliveryStatus` | `"delivered"` \| `"not-delivered"` \| `"unknown"` \| `"not-requested"` | Single delivery status filter |
| `query` | string | Text filter |
| `sortDir` | `"asc"` \| `"desc"` | Sort direction |

---

## Schedule Object

One of three kinds:

```jsonc
// Run once at a specific time (ISO 8601 with offset)
{ "kind": "at", "at": "2026-06-01T10:00:00+00:00" }

// Repeat every N milliseconds
{ "kind": "every", "everyMs": 3600000, "anchorMs": 0 }

// Cron expression
{ "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Europe/Berlin", "staggerMs": 0 }
```

| Field | Type | Required for | Description |
|---|---|---|---|
| `kind` | `"at"` \| `"every"` \| `"cron"` | all | Schedule type |
| `at` | string (ISO 8601) | `at` | Run-once timestamp |
| `everyMs` | integer ≥1 | `every` | Interval in milliseconds |
| `anchorMs` | integer ≥0 | `every` | Epoch anchor offset |
| `expr` | string | `cron` | Cron expression |
| `tz` | string | `cron` | IANA timezone (default: UTC) |
| `staggerMs` | integer ≥0 | `cron` | Random jitter up to N ms |

## Payload Object

One of two kinds:

```jsonc
// System event
{ "kind": "systemEvent", "text": "run nightly check" }

// Agent turn (trigger an AI agent)
{
  "kind": "agentTurn",
  "message": "perform nightly analysis",
  "model": "gpt-4o",
  "fallbacks": ["gpt-4"],
  "toolsAllow": ["search", "code_interpreter"],
  "lightContext": false,
  "allowUnsafeExternalContent": false,
  "timeoutSeconds": 300
}
```

| Field | Type | Required for | Description |
|---|---|---|---|
| `kind` | `"systemEvent"` \| `"agentTurn"` | all | Payload type |
| `text` | string | `systemEvent` | Event text |
| `message` | string | `agentTurn` | Prompt for the agent |
| `model` | string | — | Model override |
| `fallbacks` | string[] | — | Fallback models |
| `thinking` | string | — | Thinking mode hint |
| `timeoutSeconds` | number ≥0 | — | Agent timeout |
| `allowUnsafeExternalContent` | boolean | — | Allow external content |
| `lightContext` | boolean | — | Use minimal context |
| `toolsAllow` | string[] | — | Allowed tools list |

## Delivery Object

```jsonc
// No delivery notification
{ "mode": "none" }

// Announce result to a channel
{ "mode": "announce", "channel": "last" }

// POST result to a webhook URL
{ "mode": "webhook", "to": "https://hooks.example.com/notify" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `mode` | `"none"` \| `"announce"` \| `"webhook"` | yes (on add) | Delivery mode |
| `to` | string | yes for `webhook` | Webhook URL |
| `channel` | `"last"` \| string | — | Channel name (`"last"` = most recent) |
| `accountId` | string | — | Account ID override |
| `bestEffort` | boolean | — | Do not fail job on delivery error |
| `failureDestination` | object | — | Alternative destination on job failure: `{ channel?, to?, accountId?, mode? }` |

## FailureAlert Object

```jsonc
// Disable failure alerts
false

// Alert after N consecutive failures
{ "after": 3, "channel": "last", "cooldownMs": 3600000 }
```

| Field | Type | Description |
|---|---|---|
| `after` | integer ≥1 | Consecutive failures before alert |
| `channel` | `"last"` \| string | Alert channel |
| `to` | string | Alert destination |
| `cooldownMs` | integer ≥0 | Minimum ms between repeated alerts |
| `mode` | `"announce"` \| `"webhook"` | Alert delivery mode |
| `accountId` | string | Account ID for alert |

## State Patch

Available only in `openclaw_cron_update.patch.state`. Used to manually correct job runtime state:

| Field | Type | Description |
|---|---|---|
| `nextRunAtMs` | integer ≥0 | Override next run epoch ms |
| `runningAtMs` | integer ≥0 | Mark as currently running since epoch ms |
| `lastRunAtMs` | integer ≥0 | Override last run epoch ms |
| `lastRunStatus` | `"ok"` \| `"error"` \| `"skipped"` | Override last run status |
| `lastStatus` | `"ok"` \| `"error"` \| `"skipped"` | Override overall status |
| `lastError` | string | Last error message |
| `lastErrorReason` | `"auth"` \| `"format"` \| `"rate_limit"` \| `"billing"` \| `"timeout"` \| `"model_not_found"` \| `"unknown"` | Error reason code |
| `lastDurationMs` | integer ≥0 | Last run duration in ms |
| `consecutiveErrors` | integer ≥0 | Override consecutive error count |
| `lastDelivered` | boolean | Override last delivery success flag |
| `lastDeliveryStatus` | `"delivered"` \| `"not-delivered"` \| `"unknown"` \| `"not-requested"` | Override delivery status |
| `lastDeliveryError` | string | Last delivery error message |
| `lastFailureAlertAtMs` | integer ≥0 | Last failure alert epoch ms |

---

## Troubleshooting Map

| Error message contains | Cause | Fix |
|---|---|---|
| `Validation mismatch` | Input schema rejected locally | Fix argument shape |
| `Gateway auth failure` | Token invalid or missing | Check `OPENCLAW_GATEWAY_TOKEN` |
| `Gateway transport timeout` | Gateway unreachable or stalled | Check `OPENCLAW_GATEWAY_URL` connectivity |
| `Gateway protocol failure` | Malformed or non-ok RPC frame | Check Gateway version compatibility |
| `not supported by the current Gateway` | Gateway lacks required cron method | Upgrade Gateway |

## Safe Operating Rules

- Never expose Gateway token to sandboxed agents.
- Use only allowlisted MCP tools; do not bypass with raw Gateway RPC.
- Keep per-tool usage scoped to required operation only.
- Cron tools connect to Gateway via WebSocket on the same base URL (`http` → `ws`, `https` → `wss`).
