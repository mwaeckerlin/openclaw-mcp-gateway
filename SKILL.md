---
name: openclaw-mcp-gateway
description: Use this skill when operating or integrating the openclaw-mcp-gateway project: configuring MCP-to-Gateway auth, running health/tools checks, enabling cron RPC tools, and troubleshooting gateway transport/validation/auth errors for SSH-sandboxed agents.
---

# OpenClaw MCP Gateway

Use this skill to operate the `openclaw-mcp-gateway` service safely and effectively.

## What this project does

- Exposes a strict MCP allowlist for OpenClaw Gateway operations.
- Keeps gateway credentials outside SSH sandbox agents.
- Supports read-only Gateway RPC tools (health, status, logs, probe, channels, models, config, approvals, nodes, devices, skills, presence) and cron management tools.

## First step

Call `openclaw_gateway_status` before any other tool. If it returns `ok: false` or fails, stop and report the connectivity error — the gateway is unreachable. Do not proceed with other tools until the gateway is healthy.

## Tool selection guide

Choose the right tool for the task at hand:

### Health and diagnostics

| Task | Tool |
|---|---|
| Quick reachability check | `openclaw_gateway_status` |
| Full health snapshot with probe detail | `openclaw_health` (add `verbose: true`) |
| Full RPC reachability and diagnosis | `openclaw_gateway_probe` |
| Read-only diagnostics (no repair) | `openclaw_doctor` |

### Status and usage

| Task | Tool |
|---|---|
| Summary status | `openclaw_status` (default `type`) |
| Deep status including connected nodes | `openclaw_status` (`type: "deep"`) |
| Usage/cost summary | `openclaw_status` (`type: "usage"`) or `openclaw_gateway_usage_cost` |
| All status families at once | `openclaw_status` (`type: "all"`) |
| Current system presence entries | `openclaw_system_presence` |

### Logs

| Task | Tool |
|---|---|
| Recent gateway logs | `openclaw_logs` |
| Logs for one channel only | `openclaw_channels_logs` (pass `channel`) |

### Channels and models

| Task | Tool |
|---|---|
| What channel accounts are configured | `openclaw_channels_list` |
| Are channels reachable right now | `openclaw_channels_status` (add `probe: true` for live checks) |
| What models are available | `openclaw_models_list` |
| Are model auth tokens valid | `openclaw_models_status` |
| Model aliases | `openclaw_models_aliases_list` |
| Model fallback chains | `openclaw_models_fallbacks_list` |

### Config inspection

| Task | Tool |
|---|---|
| Read a config value at a path | `openclaw_config_get` (required: `path`) |
| Where is the active config file | `openclaw_config_file` |
| Is the config valid | `openclaw_config_validate` |
| Full config schema | `openclaw_config_schema` |

### Approvals, devices, and nodes

| Task | Tool |
|---|---|
| Effective exec approvals | `openclaw_approvals_get` |
| Paired and pending devices | `openclaw_devices_list` |
| Node list with optional filters | `openclaw_nodes_list` |
| Only nodes awaiting pairing | `openclaw_nodes_pending` |
| Node status with optional filters | `openclaw_nodes_status` |

### Skills and sessions

| Task | Tool |
|---|---|
| Are all skills ready | `openclaw_skills_check` |
| List skills (with filtering/paging) | `openclaw_skills_list` |
| Detail for one skill | `openclaw_skills_detail` (one of `skillKey` or `name` required) |
| List active sessions | `openclaw_sessions_list` |
| Status of one specific session | `openclaw_session_status` (one of `sessionKey` or `sessionId` required) |

### Cron operations

| Task | Tool |
|---|---|
| Is the scheduler running | `openclaw_cron_status` |
| List jobs | `openclaw_cron_list` |
| Create a job | `openclaw_cron_add` |
| Modify an existing job | `openclaw_cron_update` |
| Delete a job | `openclaw_cron_remove` |
| Trigger a job now | `openclaw_cron_run` — **always follow up with `openclaw_cron_runs`** to confirm the outcome; the tool may only enqueue the job |
| Check run history or outcome | `openclaw_cron_runs` |

## Available tools

| MCP Tool | What it does | CLI equivalent |
|---|---|---|
| `openclaw_health` | Gateway health snapshot | `openclaw health` |
| `openclaw_status` | Status family summary (default/deep/usage/all) | `openclaw status` |
| `openclaw_logs` | Bounded log tail with redaction | `openclaw logs` |
| `openclaw_gateway_probe` | Gateway reachability and RPC diagnostics | `openclaw health --probe` |
| `openclaw_gateway_usage_cost` | Usage cost summaries from session logs | `openclaw usage cost` |
| `openclaw_doctor` | Read-only diagnostics (no repair) | `openclaw doctor` |
| `openclaw_gateway_status` | Curated health fields from `GET /healthz` | `openclaw status` (HTTP only) |
| `openclaw_channels_list` | Configured channel accounts | `openclaw channels list` |
| `openclaw_channels_status` | Channel runtime status, optional live probes | `openclaw channels status` |
| `openclaw_channels_logs` | Bounded channel log tail with redaction | `openclaw channels logs` |
| `openclaw_models_status` | Model/provider auth status and live probes | `openclaw models status` |
| `openclaw_models_list` | Available models for an agent workspace | `openclaw models list` |
| `openclaw_models_aliases_list` | Model aliases from active config | `openclaw models aliases` |
| `openclaw_models_fallbacks_list` | Model fallback chains from active config | `openclaw models fallbacks` |
| `openclaw_config_get` | Read one config path (secret paths blocked) | `openclaw config get <path>` |
| `openclaw_config_file` | Active config file path | `openclaw config file` |
| `openclaw_config_validate` | Config validation summary | `openclaw config validate` |
| `openclaw_config_schema` | Full config JSON schema | `openclaw config schema` |
| `openclaw_approvals_get` | Effective exec approvals snapshot | `openclaw exec approvals get` |
| `openclaw_devices_list` | Pending and paired devices (tokens redacted) | `openclaw device pair list` |
| `openclaw_nodes_list` | Node list with optional filters | `openclaw node list` |
| `openclaw_nodes_pending` | Nodes awaiting pairing approval | `openclaw node pair list` |
| `openclaw_nodes_status` | Node status view with optional filters | `openclaw node status` |
| `openclaw_skills_check` | Skill readiness summary | `openclaw skills status` |
| `openclaw_system_presence` | Current system presence entries | `openclaw system presence` |
| `openclaw_sessions_list` | Read-only session list with bounded paging | `openclaw sessions list` |
| `openclaw_session_status` | Read-only status for one session | `openclaw session status` |
| `openclaw_skills_list` | Curated skill inventory with filtering/paging | `openclaw skills list` |
| `openclaw_skills_detail` | Detail for one skill by key or name | `openclaw skills detail` |
| `openclaw_cron_status` | Cron scheduler status | `openclaw cron status` |
| `openclaw_cron_list` | List cron jobs with paging/filter/sort | `openclaw cron list` |
| `openclaw_cron_add` | Create a cron job (`at`, `every`, or `cron` schedule) | `openclaw cron add` |
| `openclaw_cron_update` | Patch an existing cron job | `openclaw cron update` |
| `openclaw_cron_remove` | Remove a cron job | `openclaw cron remove` |
| `openclaw_cron_run` | Trigger a job on demand (may only enqueue) | `openclaw cron run` |
| `openclaw_cron_runs` | Inspect actual run outcomes and history | `openclaw cron runs` |

## Tool Parameters

### `openclaw_status`

`{ type?: "default" | "deep" | "usage" | "all" }` — runs real status family (no legacy sessions alias).

### `openclaw_health`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `verbose` | boolean | Include probe details in response |
| `timeoutMs` | integer 1000–120000 | Call timeout in ms |

### `openclaw_logs`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer 1–5000 | Max log lines to return |
| `maxBytes` | integer 1–1000000 | Max response bytes |
| `follow` | boolean | Streaming follow — rejected in MCP, must be omitted or `false` |
| `intervalMs` | integer 100–60000 | Polling interval in ms |
| `format` | `"default"` \| `"json"` \| `"plain"` | Output format |
| `localTime` | boolean | Use local timestamps instead of UTC |

### `openclaw_gateway_probe`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `requireRpc` | boolean | Fail if RPC layer is unavailable |
| `deep` | boolean | Run deeper probes |
| `noProbe` | boolean | Skip active probing |
| `timeoutMs` | integer 500–120000 | Probe timeout in ms |

### `openclaw_gateway_usage_cost`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `days` | integer 1–3650 | Look-back window in days |

### `openclaw_doctor`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `deep` | boolean | Run deeper diagnostics |
| `noWorkspaceSuggestions` | boolean | Omit workspace suggestions from output |

### `openclaw_gateway_status`

No parameters. Checks gateway health (calls `GET /healthz`) and returns only curated safe fields.

### `openclaw_channels_list`

No parameters.

### `openclaw_channels_status`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `probe` | boolean | Run active channel probes |
| `timeoutMs` | integer 500–120000 | Probe timeout in ms |

### `openclaw_channels_logs`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `channel` | string | Channel name filter |
| `lines` | integer 1–5000 | Max log lines |

### `openclaw_models_status`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `check` | boolean | Include auth/config checks |
| `probe` | boolean | Run live provider probes |
| `probeProvider` | string | Probe a specific provider only |
| `probeProfileIds` | string[] (≤50 items) | Profile IDs to probe |
| `probeTimeoutMs` | integer 1000–120000 | Per-probe timeout in ms |
| `probeConcurrency` | integer 1–32 | Max concurrent probes |
| `probeMaxTokens` | integer 1–32000 | Token limit for probe requests |
| `agentId` | string | Target agent workspace |

### `openclaw_models_list`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `agentId` | string | Target agent workspace |

### `openclaw_models_aliases_list`

No parameters.

### `openclaw_models_fallbacks_list`

No parameters.

### `openclaw_config_get`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Config path to read; secret-bearing paths are blocked |

### `openclaw_config_file`

No parameters. Returns the active config file path.

### `openclaw_config_validate`

No parameters. Returns a config validation summary.

### `openclaw_config_schema`

No parameters. Returns the full config schema.

### `openclaw_approvals_get`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `target` | `"local"` \| `"gateway"` \| `"node"` | Approval target scope |
| `node` | string | Node identifier (used with `target: "node"`) |

### `openclaw_devices_list`

No parameters. Returns pending and paired devices with tokens redacted.

### `openclaw_nodes_list`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `connectedOnly` | boolean | Return only currently connected nodes |
| `lastConnected` | string | Duration filter, e.g. `"24h"` |

### `openclaw_nodes_pending`

No parameters.

### `openclaw_nodes_status`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `connectedOnly` | boolean | Return only currently connected nodes |
| `lastConnected` | string | Duration filter, e.g. `"24h"` |

### `openclaw_skills_check`

No parameters. Returns skill readiness summary.

### `openclaw_system_presence`

No parameters. Returns current system presence entries.

### `openclaw_sessions_list`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `kind` | `"main"` \| `"group"` \| `"cron"` \| `"hook"` \| `"node"` | Filter by session kind |
| `activeMinutes` | integer 1–10080 | Filter to recently active sessions |
| `limit` | integer 1–100 | Max sessions to return |
| `offset` | integer 0–1000 | Pagination offset |

### `openclaw_session_status`

Exactly one of `sessionKey` or `sessionId` is required.

### `openclaw_skills_list`

All parameters optional:

| Parameter | Type | Description |
|---|---|---|
| `agentId` | string | Optional agent workspace selector |
| `limit` | integer 1–100 | Max skills to return |
| `offset` | integer 0–1000 | Pagination offset |
| `eligible` | boolean | Restrict to currently eligible skills |
| `query` | string | Filter by skill name/key/description |

### `openclaw_skills_detail`

Exactly one of `skillKey` or `name` is required (optional `agentId` supported).

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
| `Gateway protocol failure` | Malformed or non-ok RPC frame, or device not paired | Check Gateway version; verify `OPENCLAW_DEVICE_PAIRING` contains the correct public key |
| `not supported by the current Gateway` | Gateway lacks required cron method | Upgrade Gateway |

## Safe Operating Rules

- Use only the MCP tools listed above; do not attempt to bypass with raw HTTP calls to the OpenClaw gateway.
- Session/skill/status tools are read-only.
- `openclaw_cron_run` may return `enqueued: true` — always follow up with `openclaw_cron_runs` to check the actual outcome.
- Keep per-tool usage scoped to the required operation only.
