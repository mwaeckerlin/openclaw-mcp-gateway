# Tests

Register of all tests, sorted by the [FEATURES.md](FEATURES.md) number each test covers. `npm test` runs everything, locally and in the pipeline. The guard `tests/docs-contract.sh` fails when a feature has no test entry here or a test carries a skip marker.

## Unit

`npm run test:unit` runs `src/*.test.ts` with the Node.js test runner.

- **F2** `src/readonly-rpc-tools.test.ts` › openclaw_health, openclaw_status, openclaw_logs, openclaw_gateway_probe, openclaw_gateway_usage_cost, openclaw_doctor — accepted and refused arguments.
- **F2** `src/server.test.ts` › openclaw_health, openclaw_logs, openclaw_gateway_usage_cost dispatch; openclaw_status via the status RPC family; openclaw_logs follow mode refused; openclaw_gateway_status text body and empty body.
- **F2** `src/commands.test.ts` › shapeHttpToolResponse curates openclaw_gateway_status fields using allowlist.
- **F3** `src/readonly-rpc-tools.test.ts` › openclaw_channels_status, openclaw_channels_logs — accepted and refused arguments.
- **F3** `src/server.test.ts` › openclaw_channels_status, openclaw_channels_list, openclaw_channels_logs dispatch.
- **F4** `src/readonly-rpc-tools.test.ts` › openclaw_models_status, openclaw_models_list — accepted and refused arguments.
- **F4** `src/server.test.ts` › openclaw_models_status, check=true, openclaw_models_list, openclaw_models_aliases_list, openclaw_models_fallbacks_list dispatch.
- **F5** `src/readonly-rpc-tools.test.ts` › openclaw_config_get requires and accepts a path.
- **F5** `src/server.test.ts` › openclaw_config_get extracts a value, exists=false for a missing path, sensitive path blocked; openclaw_config_file, openclaw_config_validate, openclaw_config_schema dispatch.
- **F6** `src/readonly-rpc-tools.test.ts` › openclaw_approvals_get targets, openclaw_nodes_list, openclaw_nodes_status arguments.
- **F6** `src/server.test.ts` › openclaw_approvals_get target local, gateway and node; openclaw_devices_list redacts tokens; openclaw_nodes_pending; openclaw_system_presence.
- **F7** `src/commands.test.ts` › openclaw_sessions_list payload mapping and bounded paging, openclaw_session_status requires exactly one target, buildHttpInvokePayload.
- **F7** `src/server.test.ts` › openclaw_sessions_list formatted JSON and pagination input, curated openclaw_session_status fields.
- **F8** `src/skills.test.ts` › bounded paging, exactly one selector, curated list without path metadata, selected visible skill.
- **F8** `src/server.test.ts` › openclaw_skills_list via skills.status, selected skill detail, openclaw_skills_check counts eligible skills.
- **F9** `src/cron.test.ts` › cron.status, cron.list, cron.add, cron.update, cron.remove, cron.run, cron.runs — every accepted and refused argument.
- **F9** `src/server.test.ts` › cron.status, cron.list and cron.update dispatch; cron validation failure as InvalidParams.
- **F10** `src/readonly-rpc-tools.test.ts` › redactSensitive removes token-like keys, credential and access_key, bearer tokens inside strings, nested objects, and truncates long arrays; it removes a Telegram, Slack, GitHub, Discord, Google, Notion and Anthropic token, a JWT, a password in a URL and key-value pairs from free text, removes a registered secret by its exact value, and keeps ordinary log text.
- **F11** `src/server.test.ts` › capability error on gateway 404, 501 and endpoint_disabled; error on 500; timeout; network failure; unknown tool; error details from a JSON body; cron RPC auth failure, not supported and generic failure.
- **F11** `src/cron.test.ts` › gateway-rpc challenge/connect/request flow with protocols 3 to 4, timeout, auth failure, non-ok response, malformed frame, transport error, connection closed before connect.
- **F12** `src/disabled-tools.test.ts` › comma and whitespace separation, empty entries ignored, disabled tools hidden, exact names only.
- **F12** `src/server.test.ts` › disabled tools refused with a clear error.
- **F13** `src/commands.test.ts` › loadGatewayConfig reads URL and token, defaults the URL to http://openclaw:18789.
- **F13** `src/cron.test.ts` › gateway-rpc url converts http to ws and https to wss.

## End-to-end

`npm run test:e2e` generates a device pairing, starts a local OpenClaw Gateway (`mwaeckerlin/openclaw:gateway`) and this server, and runs `test/e2e.mjs` in a separate container. No test reaches an external system.

- **F1** `test/e2e.mjs` › the client reaches the MCP server over its own network and holds no gateway token.
- **F2** `test/e2e.mjs` › openclaw_gateway_status, openclaw_status, openclaw_health, openclaw_logs, openclaw_gateway_probe, openclaw_gateway_usage_cost, openclaw_doctor against the running gateway.
- **F3** `test/e2e.mjs` › openclaw_channels_list, openclaw_channels_status, openclaw_channels_logs.
- **F4** `test/e2e.mjs` › openclaw_models_status, openclaw_models_list, openclaw_models_aliases_list, openclaw_models_fallbacks_list.
- **F5** `test/e2e.mjs` › openclaw_config_get including a refused sensitive path, openclaw_config_file, openclaw_config_validate, openclaw_config_schema.
- **F6** `test/e2e.mjs` › openclaw_approvals_get, openclaw_devices_list, openclaw_nodes_list, openclaw_nodes_pending, openclaw_nodes_status, openclaw_system_presence.
- **F7** `test/e2e.mjs` › openclaw_sessions_list.
- **F8** `test/e2e.mjs` › openclaw_skills_list, openclaw_skills_detail of the first listed skill, openclaw_skills_check.
- **F9** `test/e2e.mjs` › a job is added, updated, run, its runs read and removed, and the refused variants of each call.

## Image contract

- **F16** `tests/image-contract.sh` › skill_shipped — `/app/skills/openclaw-mcp-gateway/SKILL.md` in the image equals `SKILL.md`.
- **F14** `tests/image-contract.sh` › no sh, no bash, no busybox, no perl — the image is headless.

## Workflow contract

- **F15** `tests/workflow-contract.sh` of `mwaeckerlin/scratch` — the reusable workflow selects exactly the images a repository publishes; this repository calls it from `.github/workflows/docker.yml`.
