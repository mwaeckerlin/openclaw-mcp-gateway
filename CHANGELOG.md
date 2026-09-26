# Changelog

- 2026-09-26 **1.1.1**
    - Works with OpenClaw 2026.9: the gateway connects with protocol 4, which OpenClaw now requires; before, every tool except the HTTP ones failed with «protocol mismatch»
    - The image is published for amd64 and arm64 under one tag, built, tested and published automatically on every change and every week
    - Every tool is tested end to end against a local OpenClaw Gateway, and a tool the gateway does not answer fails the test
    - The README explains the `403 proxy_attribution_required` answer of OpenClaw 2026.9 when the gateway trusts the network of the MCP gateway as a proxy, and how to configure `trustedProxies`
    - The test environment's device pairing no longer enters the image build
    - The package is named `@mwaeckerlin/openclaw-mcp-gateway`, and the npm scripts follow the family: `npm run build` builds the image, `npm run build:ts` compiles TypeScript
    - Image build no longer emits warnings (modernized instruction format)
    - The image build keeps the downloaded npm packages between builds and fetches only what is new

- 2026-07-16 **1.1.0**
    - The shipped image is verified to contain no shell, busybox or perl
