# Secure Access To OpenClaw From Sandbox

Give sandboxed SSH AI agents controlled access to [OpenClaw](https://github.com/mwaeckerlin/openclaw) through this MCP gateway service.

AI agents running inside SSH-isolated and Docker-sandboxed environments cannot — and should not — reach OpenClaw directly, i.e. they have no access to the OpenClaw CLI. The AI agent in the SSH sandbox could access directly to the gateway, if it had the gateway token. But it would be a security risk to expose the gateway token to the AI agent. Instead it talks only to this lightweight MCP service. The gateway enforces a hardcoded allowlist of operations: the AI agent cannot choose arbitrary Gateway methods, cannot bypass local schema validation for allowlisted tools, and cannot inject arbitrary commands. This makes the overall architecture significantly more secure than any setup where the AI has direct HTTP/WebSocket access to OpenClaw.

[mwaeckerlin/openclaw](https://github.com/mwaeckerlin/openclaw) runs an OpenClaw Gateway and an SSH Sandbox in two isolated docker containers, so that the AI agent has absolutely no access to any secret or token or the gateway and it's configuration.

Typically, this server runs in such an enviroenment, where the nodes are typically docker containers in a docker swarm or in kubernetes pods, but could also be just virtual machines:

```plantuml
@startuml
node "mwaeckerlin/openclaw:gateway" {
  [OpenClaw-Gateway] as gateway
}
node "mwaeckerlin/openclaw:sandbox" {
  [SSH-Sandbox] as sandbox
}
node "mwaeckerlin/openclaw-mcp-gateway" {
  [OpenClaw-MCP-Gateway] as mcp
}

gateway --right--> sandbox : ssh (agent executes commands)
sandbox -down-> mcp    : MCP tool calls
mcp -up-> gateway    : forward verified calls
:AI-Agent: .down.> sandbox
@enduml
```


## MCP Tools

| MCP Tool | Transport | Gateway Method/Endpoint | Description |
|---|---|---|---|
| `tools/list` | MCP | (no) | Lists all available MCP tools |
| `openclaw_status` | HTTP | `POST /tools/invoke` (tool: `sessions_list`) | Lists active OpenClaw sessions |
| `openclaw_gateway_status` | HTTP | `GET /api/v1/check` | Checks OpenClaw gateway health |
| `openclaw_cron_status` | WebSocket RPC | `cron.status` | Returns cron scheduler status |
| `openclaw_cron_list` | WebSocket RPC | `cron.list` | Lists jobs with paging/filter/sort |
| `openclaw_cron_add` | WebSocket RPC | `cron.add` | Creates cron jobs (`at`, `every`, `cron`) with full payload/delivery options |
| `openclaw_cron_update` | WebSocket RPC | `cron.update` | Patches jobs via `id` or `jobId` |
| `openclaw_cron_remove` | WebSocket RPC | `cron.remove` | Removes jobs via `id` or `jobId` |
| `openclaw_cron_run` | WebSocket RPC | `cron.run` | Triggers a job (may only enqueue) |
| `openclaw_cron_runs` | WebSocket RPC | `cron.runs` | Inspects actual run outcomes/history |

## Security

This service provides three independent layers of security. You do not have to trust any single layer — all three must be bypassed simultaneously to compromise the system.

**1. Sandbox isolation — the AI agent cannot reach OpenClaw or the internet directly.**
The AI agent runs inside a Docker container or SSH-isolated environment. That environment should not bear any token. Only the OpenClawGateway and the MCP server holds the OpenClaw gateway token. Even if the AI is manipulated or "jailbroken", it cannot contact the OpenClaw gateway, because it has no token.

**2. Fixed-allowlist MCP gateway — the AI agent cannot choose what it sends.**
Every MCP tool call is mapped to a single, hardcoded OpenClaw operation defined at build time. There is no generic passthrough, no dynamic method selection beyond explicit tool names, no shell execution, and no eval. Cron tools accept structured arguments but reject unknown top-level fields and validate supported shapes locally before forwarding to Gateway RPC. The AI cannot escalate a `tools/list` or `openclaw_status` call into arbitrary Gateway access. The MCP gateway is the only component with network access to OpenClaw, and it acts as a strict one-way firewall.

**3. Hardened container image — the runtime has the smallest possible attack surface.**
The production image is built on [`mwaeckerlin/nodejs`](https://github.com/mwaeckerlin/nodejs), a purpose-built, minimal Node.js base image. It runs as a non-root user, contains no shell or package manager, and ships only the files required to execute the application. The total image size is only **91.8 MB**. There is nothing inside the container that an attacker could use to escalate privileges or pivot to other systems.

## Configuration

> ⚠️ **Production rule: never pass secrets as environment variables.**
> Use Docker secrets instead (mounted at `/run/secret/openclaw_gateway_token`). Environment variables can leak through log files, `/proc`, container inspection, and child processes.

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_GATEWAY_URL` | yes | Base URL of the OpenClaw Gateway, e.g. `http://localhost:18789` |
| `OPENCLAW_GATEWAY_TOKEN` | yes* | Bearer token for Gateway authentication |
| `OPENCLAW_GATEWAY_KEY` | yes* | Legacy alias for `OPENCLAW_GATEWAY_TOKEN` |
| `OPENCLAW_MCP_HOST` | no | Host to bind (default: `0.0.0.0`) |
| `OPENCLAW_MCP_PORT` | no | Port to listen on (default: `4000`) |

\* One of `OPENCLAW_GATEWAY_TOKEN` or `OPENCLAW_GATEWAY_KEY` is required. In production, mount the token as a Docker secret at `/run/secret/openclaw_gateway_token` — no environment variable needed.

Cron MCP tools use Gateway WebSocket RPC on the same Gateway base URL (`OPENCLAW_GATEWAY_URL`), converted internally from `http(s)` to `ws(s)`.

## OpenClaw SKILL for this project

This repository ships an OpenClaw skill at:

- `skills/openclaw-mcp-gateway/SKILL.md`

OpenClaw skills are authored as a `SKILL.md` file with YAML frontmatter (`name`, `description`) plus markdown body instructions; OpenClaw discovers skills from the workspace skills directory:

- `~/.openclaw/workspace/skills/<skill-name>/SKILL.md`

### Deploy this skill locally

```bash
mkdir -p ~/.openclaw/workspace/skills/openclaw-mcp-gateway
cp skills/openclaw-mcp-gateway/SKILL.md ~/.openclaw/workspace/skills/openclaw-mcp-gateway/SKILL.md
openclaw skills list
openclaw skills detail openclaw-mcp-gateway
```

### Use this skill

- Ask OpenClaw for tasks related to MCP gateway setup, cron tool usage, or gateway troubleshooting.
- The skill guides:
  - configuration and health checks
  - cron tool semantics (`openclaw_cron_run` enqueue vs `openclaw_cron_runs` final status)
  - common auth/transport/protocol/validation error handling

## Local Development

```bash
npm install
npm run build         # compiles TypeScript to dist/
npm run build:docker  # builds the Docker image
npm test              # runs unit tests, then E2E tests inside Docker Compose
```

## Running

```bash
npm start
```

Runs `docker compose up --build --force-recreate --remove-orphans` and starts the full stack.

Compose defaults (override via environment variables in development only):

- `OPENCLAW_GATEWAY_URL=http://localhost:18789`
- `OPENCLAW_GATEWAY_TOKEN=test-gateway-token`

## End-to-End Tests

`test/docker-compose.yml` brings up three services and runs end-to-end assertions against a live OpenClaw gateway:

```plantuml
@startuml
participant "test-client" as tc
participant "mcp-gateway" as gw
participant "openclaw" as oc

tc -> gw : GET /healthz
gw --> tc : 200 OK

tc -> gw : MCP tools/list
gw --> tc : [openclaw_status, openclaw_gateway_status, openclaw_cron_*]

tc -> gw : MCP call openclaw_gateway_status
gw -> oc : GET /api/v1/check
oc --> gw : gateway status
gw --> tc : MCP response

tc -> gw : MCP call openclaw_status
gw -> oc : POST /tools/invoke (sessions_list)
oc --> gw : session list
gw --> tc : MCP response

tc -> gw : MCP call unknown_tool_xyz
gw --> tc : MCP error (expected)
@enduml
```

```bash
cd test
docker compose up --build --force-recreate --remove-orphans --abort-on-container-exit --exit-code-from test-client
```

Optional overrides:

- `OPENCLAW_E2E_GATEWAY_TOKEN` (default: `test-gateway-token`)
- `OPENCLAW_E2E_OPENAI_API_KEY` (default: `test-openai-key`)

## MCP Client Example

```json
{
  "mcpServers": {
    "openclaw-gateway": {
      "transport": "streamable-http",
      "url": "http://127.0.0.1:4000",
      "headers": {
        "Authorization": "Bearer your-gateway-token"
      }
    }
  }
}
```
