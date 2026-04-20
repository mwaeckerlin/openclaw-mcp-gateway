---
name: openclaw-mcp-gateway
description: Use this skill when you need to inspect or control an OpenClaw Gateway via MCP tools — checking gateway health, reading status/logs/config, managing cron jobs, or diagnosing failures. All tools are read-only except the cron management set.
---

# OpenClaw MCP Gateway

MCP gateway that exposes a strict allowlist of read-only and cron-management tools against an OpenClaw Gateway backend. Credentials stay outside SSH sandbox agents.

## First step

**Always call `openclaw_gateway_status` first.** If it returns `ok: false` or throws, the gateway is unreachable — stop and report the error. Do not call other tools until connectivity is confirmed.

## Tool selection guide

### Health and diagnostics

| Goal | Tool |
|---|---|
| Confirm gateway is reachable | `openclaw_gateway_status` |
| Full health snapshot | `openclaw_health` (add `verbose: true` for probe detail) |
| RPC layer reachability check | `openclaw_gateway_probe` |
| Read-only diagnostics (no repair) | `openclaw_doctor` (add `deep: true` for channel probes) |

### Status and usage

| Goal | Tool |
|---|---|
| Summary status | `openclaw_status` |
| Deep status including nodes | `openclaw_status` with `type: "deep"` |
| Usage/cost summary | `openclaw_status` with `type: "usage"` or `openclaw_gateway_usage_cost` |
| All status families at once | `openclaw_status` with `type: "all"` |
| Current system presence | `openclaw_system_presence` |

### Logs

| Goal | Tool |
|---|---|
| Recent gateway logs | `openclaw_logs` (bounded; `follow` is rejected) |
| Logs scoped to one channel | `openclaw_channels_logs` with `channel` |

### Channels and models

| Goal | Tool |
|---|---|
| Which channels are configured | `openclaw_channels_list` |
| Are channels reachable right now | `openclaw_channels_status` (add `probe: true`) |
| Which models are available | `openclaw_models_list` |
| Are model credentials valid | `openclaw_models_status` (add `probe: true` for live test) |
| Model aliases from config | `openclaw_models_aliases_list` |
| Model fallback chains from config | `openclaw_models_fallbacks_list` |

### Config inspection

| Goal | Tool |
|---|---|
| Read a specific config value | `openclaw_config_get` with required `path` (secret paths blocked) |
| Where is the active config file | `openclaw_config_file` |
| Is the config valid | `openclaw_config_validate` |
| Full config schema | `openclaw_config_schema` |

### Approvals, devices, and nodes

| Goal | Tool |
|---|---|
| Effective exec approvals | `openclaw_approvals_get` (`target`: `"local"` / `"gateway"` / `"node"`) |
| Paired and pending devices | `openclaw_devices_list` |
| Node list | `openclaw_nodes_list` (filter: `connectedOnly`, `lastConnected`) |
| Nodes awaiting pairing | `openclaw_nodes_pending` |
| Node status view | `openclaw_nodes_status` |

### Skills and sessions

| Goal | Tool |
|---|---|
| Are all skills ready | `openclaw_skills_check` |
| Browse skills | `openclaw_skills_list` (filter: `eligible`, `query`, paginate with `limit`/`offset`) |
| Detail for one skill | `openclaw_skills_detail` — requires one of `skillKey` or `name` |
| List active sessions | `openclaw_sessions_list` (filter: `kind`, `activeMinutes`) |
| Status of one session | `openclaw_session_status` — requires one of `sessionKey` or `sessionId` |

### Cron management

| Goal | Tool |
|---|---|
| Is the scheduler running | `openclaw_cron_status` |
| List jobs | `openclaw_cron_list` |
| Create a job | `openclaw_cron_add` — see [Cron job reference](#cron-job-reference) |
| Modify a job | `openclaw_cron_update` — requires one of `id` or `jobId`, plus `patch` |
| Delete a job | `openclaw_cron_remove` — requires one of `id` or `jobId` |
| Trigger a job now | `openclaw_cron_run` — **always follow up with `openclaw_cron_runs`**; the tool may only enqueue |
| Check run history or outcome | `openclaw_cron_runs` |

## Complete tool list

All exposed tools (use the selection guide above to pick the right one):

`openclaw_gateway_status` · `openclaw_health` · `openclaw_status` · `openclaw_logs` · `openclaw_gateway_probe` · `openclaw_gateway_usage_cost` · `openclaw_doctor` · `openclaw_system_presence` · `openclaw_channels_list` · `openclaw_channels_status` · `openclaw_channels_logs` · `openclaw_models_status` · `openclaw_models_list` · `openclaw_models_aliases_list` · `openclaw_models_fallbacks_list` · `openclaw_config_get` · `openclaw_config_file` · `openclaw_config_validate` · `openclaw_config_schema` · `openclaw_approvals_get` · `openclaw_devices_list` · `openclaw_nodes_list` · `openclaw_nodes_pending` · `openclaw_nodes_status` · `openclaw_skills_check` · `openclaw_sessions_list` · `openclaw_session_status` · `openclaw_skills_list` · `openclaw_skills_detail` · `openclaw_cron_status` · `openclaw_cron_list` · `openclaw_cron_add` · `openclaw_cron_update` · `openclaw_cron_remove` · `openclaw_cron_run` · `openclaw_cron_runs`

## Cron job reference

Use this when building arguments for `openclaw_cron_add` or `openclaw_cron_update`.

### schedule (required on add)

Pick one `kind`:

```jsonc
{ "kind": "at",    "at": "2026-06-01T10:00:00+00:00" }
{ "kind": "every", "everyMs": 3600000 }
{ "kind": "cron",  "expr": "0 9 * * 1-5", "tz": "Europe/Berlin" }
```

`cron` also accepts `staggerMs` (random jitter); `every` accepts `anchorMs`.

### payload (required on add)

Pick one `kind`:

```jsonc
{ "kind": "systemEvent", "text": "run nightly check" }
{ "kind": "agentTurn",   "message": "perform nightly analysis", "model": "gpt-4o",
  "fallbacks": ["gpt-4"], "timeoutSeconds": 300 }
```

`agentTurn` optional fields: `thinking`, `lightContext`, `toolsAllow`, `allowUnsafeExternalContent`.

### delivery (optional)

```jsonc
{ "mode": "none" }
{ "mode": "announce", "channel": "last" }
{ "mode": "webhook",  "to": "https://hooks.example.com/notify" }
```

Add `bestEffort: true` to avoid failing the job on delivery error. Use `failureDestination` for an alternate target on job failure.

### failureAlert (optional)

```jsonc
false
{ "after": 3, "channel": "last", "cooldownMs": 3600000 }
```

### state patch (openclaw_cron_update only)

Pass `patch.state` to manually correct runtime state fields: `nextRunAtMs`, `lastRunAtMs`, `lastRunStatus`, `consecutiveErrors`, `lastDeliveryStatus`, etc.

---

## Troubleshooting

| Error contains | Cause | Action |
|---|---|---|
| `Validation mismatch` | Input schema rejected before RPC | Fix argument shape |
| `Gateway auth failure` | Token invalid or missing | Check `OPENCLAW_GATEWAY_TOKEN` |
| `Gateway transport timeout` | Gateway unreachable or stalled | Check `OPENCLAW_GATEWAY_URL` |
| `Gateway protocol failure` | Bad RPC frame or device not paired | Check Gateway version; verify device pairing |
| `not supported by the current Gateway` | Gateway lacks the required RPC method | Upgrade Gateway |

## Safe operating rules

- All non-cron tools are read-only.
- `openclaw_config_get` blocks secret-bearing paths; do not attempt to work around this.
- `openclaw_cron_run` may return `enqueued: true` — always follow up with `openclaw_cron_runs` to confirm the outcome.
- Do not bypass these tools with raw HTTP calls to the OpenClaw gateway.
