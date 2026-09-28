# Features

Numbered register of every feature; a number is never reused. Every feature is covered by tests listed in [TESTS.md](TESTS.md); the guard `tests/docs-contract.sh` fails when a feature has no test.

- **F1 — Gateway credentials stay on the MCP server.** `OPENCLAW_GATEWAY_TOKEN` and the device identity are configured on this server only; a sandboxed agent calls it over MCP and never sees them.
- **F2 — Gateway diagnosis.** `openclaw_health`, `openclaw_status`, `openclaw_gateway_probe`, `openclaw_gateway_usage_cost`, `openclaw_doctor` and `openclaw_gateway_status` read the state of the OpenClaw Gateway; `openclaw_logs` reads a bounded part of the log and refuses `follow`.
- **F3 — Channels.** `openclaw_channels_list`, `openclaw_channels_status` and `openclaw_channels_logs` show the configured channel accounts, their runtime status and their log lines.
- **F4 — Models.** `openclaw_models_status`, `openclaw_models_list`, `openclaw_models_aliases_list` and `openclaw_models_fallbacks_list` show the model and provider state, the model list, aliases and fallbacks.
- **F5 — Configuration, read only.** `openclaw_config_get` reads one configuration path and refuses sensitive paths; `openclaw_config_file`, `openclaw_config_validate` and `openclaw_config_schema` show the file, the validation result and the schema.
- **F6 — Approvals, devices, nodes and presence.** `openclaw_approvals_get`, `openclaw_devices_list`, `openclaw_nodes_list`, `openclaw_nodes_pending`, `openclaw_nodes_status` and `openclaw_system_presence` show exec approvals, paired devices, nodes and the system presence.
- **F7 — Sessions.** `openclaw_sessions_list` lists sessions with bounded paging; `openclaw_session_status` shows one session named by exactly one target.
- **F8 — Skills.** `openclaw_skills_list`, `openclaw_skills_detail` and `openclaw_skills_check` show the visible skills, one skill by `skillKey` or `name`, and their readiness, without file paths.
- **F9 — Scheduled jobs.** `openclaw_cron_status`, `openclaw_cron_list`, `openclaw_cron_add`, `openclaw_cron_update`, `openclaw_cron_remove`, `openclaw_cron_run` and `openclaw_cron_runs` manage the cron jobs of the gateway; every argument is checked before the call.
- **F10 — Secrets redacted.** Tokens, credentials, access keys and bearer strings are removed from every answer: under every secret-named key, and in free text such as log lines wherever a token of a known service stands (Telegram, Slack, GitHub, Discord, Google, Notion, OpenAI and Anthropic keys, JWTs, private-key blocks, passwords in URLs, `key=value` pairs), and the bridge's own gateway token by its exact value.
- **F11 — Clear errors.** A refused login, a gateway without the capability, a timeout, a network failure and a malformed answer each come back as their own MCP error.
- **F12 — Tools switched off by the operator.** `DISABLE_TOOLS` names tools that are hidden from `tools/list` and refused when called.
- **F13 — Configuration of the connection.** `OPENCLAW_GATEWAY_URL`, `OPENCLAW_MCP_HOST` and `OPENCLAW_MCP_PORT` set the gateway address and the listening address; `http` and `https` addresses become `ws` and `wss` for the RPC connection.
- **F14 — Headless image.** The image contains no shell, no busybox and no perl.
- **F15 — Published for amd64 and arm64.** Every push builds the image natively for both architectures and publishes it under one tag on Docker Hub, with the reusable workflow of `mwaeckerlin/scratch`.
- **F16 — Agent instructions in the image.** `SKILL.md` ships in the image at `/app/skills/openclaw-mcp-gateway/SKILL.md`.
