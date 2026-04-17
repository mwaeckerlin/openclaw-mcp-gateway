# OpenClaw MCP Gateway

MCP server to give SSH-sandboxed AI agents limited access to OpenClaw Gateway operations over network MCP HTTP transport.

## Runtime context

- OpenClaw runtime repository: https://github.com/mwaeckerlin/openclaw

## Security model

Allowlist-only:

- no arbitrary shell execution
- no arbitrary command execution
- no dynamic endpoint selection from MCP input

## Supported MCP tools

Fixed mappings:

- `openclaw_status` → `POST /tools/invoke` with hard-coded payload `{"tool":"sessions_list","action":"json","args":{}}`
- `openclaw_gateway_status` → `GET /api/v1/check`

No payload-mapping environment variables are used.

## Required environment variables

- `OPENCLAW_GATEWAY_URL` (required): Gateway base URL
- `OPENCLAW_GATEWAY_TOKEN` (preferred) or `OPENCLAW_GATEWAY_TOKEN_FILE`
- legacy compatibility: `OPENCLAW_GATEWAY_KEY` / `OPENCLAW_GATEWAY_KEY_FILE`
- `OPENCLAW_MCP_HOST` (optional, default `0.0.0.0`)
- `OPENCLAW_MCP_PORT` (optional, default `3000`)

## Local development

```bash
npm install
npm run build
```

```bash
OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789" \
OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
npm start
```

The server listens on `http://<OPENCLAW_MCP_HOST>:<OPENCLAW_MCP_PORT>/mcp`.

## Docker

`Dockerfile` uses:

- `mwaeckerlin/nodejs-build` (build stage)
- `mwaeckerlin/nodejs` (runtime stage)

```bash
docker build -t mwaeckerlin/openclaw-mcp-gateway .
```

```bash
docker run --rm -it \
  -p 3000:3000 \
  -e OPENCLAW_GATEWAY_URL="http://gateway.example.local:18789" \
  -e OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
  -e OPENCLAW_MCP_PORT=3000 \
  mwaeckerlin/openclaw-mcp-gateway
```

## docker-compose

```bash
OPENCLAW_GATEWAY_URL="http://gateway.example.local:18789" \
OPENCLAW_GATEWAY_TOKEN="your-gateway-token" \
docker compose up --build
```

## E2E from `test/`

`test/docker-compose.yml` runs a three-container system:

1. `alpine/openclaw:latest`
2. `mwaeckerlin/openclaw-mcp-gateway` (built from this repository)
3. `test-client` (built from `test/Dockerfile`)

```bash
cd test
docker compose up --abort-on-container-exit --exit-code-from test-client
```

Optional overrides:

- `OPENCLAW_E2E_GATEWAY_TOKEN` (default: `test-gateway-token`)
- `OPENCLAW_E2E_OPENAI_API_KEY` (default: `test-openai-key`)
- `OPENCLAW_E2E_MCP_URL` (default: `http://mcp-gateway:3000/mcp`)

## MCP client example (streamable HTTP)

```json
{
  "mcpServers": {
    "openclaw-gateway": {
      "transport": "streamable-http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-gateway-token"
      }
    }
  }
}
```

## Documentation references used

- https://github.com/openclaw/openclaw/blob/main/docs/gateway/tools-invoke-http-api.md
- https://github.com/openclaw/openclaw/blob/main/docs/reference/rpc.md
- https://github.com/openclaw/openclaw/blob/main/src/gateway/tools-invoke-http.ts
- https://github.com/openclaw/openclaw/blob/main/src/agents/tool-catalog.ts
