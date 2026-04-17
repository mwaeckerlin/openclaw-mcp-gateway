import { readFileSync } from "node:fs";

export type AllowedToolName =
  | "openclaw_status"
  | "openclaw_gateway_status"
  | "openclaw_logs";

export interface AllowedGatewayRequest {
  method: "GET";
  path: string;
  timeoutMs: number;
  description: string;
  notSupportedOn404?: boolean;
}

export interface GatewayConfig {
  baseUrl: string;
  key: string;
}

export const ALLOWED_GATEWAY_REQUESTS: Record<AllowedToolName, AllowedGatewayRequest> = {
  openclaw_status: {
    method: "GET",
    path: "/api/v1/status",
    timeoutMs: 12_000,
    description: "Return overall OpenClaw status from the Gateway API."
  },
  openclaw_gateway_status: {
    method: "GET",
    path: "/api/v1/gateway/status",
    timeoutMs: 12_000,
    description: "Return OpenClaw gateway status from the Gateway API."
  },
  openclaw_logs: {
    method: "GET",
    path: "/api/v1/logs?tail=200",
    timeoutMs: 18_000,
    description: "Return the latest OpenClaw logs from the Gateway API.",
    notSupportedOn404: true
  }
};

export function isAllowedToolName(value: string): value is AllowedToolName {
  return Object.hasOwn(ALLOWED_GATEWAY_REQUESTS, value);
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("OPENCLAW_GATEWAY_URL is empty");
  }

  const normalized = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  const parsed = new URL(normalized);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OPENCLAW_GATEWAY_URL must use http or https");
  }

  return parsed.toString();
}

function readGatewayKey(): string {
  const inlineKey = process.env.OPENCLAW_GATEWAY_KEY?.trim();
  if (inlineKey) {
    return inlineKey;
  }

  const keyFile = process.env.OPENCLAW_GATEWAY_KEY_FILE?.trim();
  if (keyFile) {
    const fileValue = readFileSync(keyFile, "utf8").trim();
    if (fileValue) {
      return fileValue;
    }
    throw new Error("OPENCLAW_GATEWAY_KEY_FILE is empty");
  }

  throw new Error("Set OPENCLAW_GATEWAY_KEY or OPENCLAW_GATEWAY_KEY_FILE");
}

export function loadGatewayConfig(): GatewayConfig {
  const baseUrlEnv = process.env.OPENCLAW_GATEWAY_URL;
  if (!baseUrlEnv) {
    throw new Error("OPENCLAW_GATEWAY_URL is required");
  }

  return {
    baseUrl: normalizeUrl(baseUrlEnv),
    key: readGatewayKey()
  };
}
