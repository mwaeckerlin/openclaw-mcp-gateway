import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CronToolName } from "./cron.js";

export type HttpToolName =
  | "openclaw_status"
  | "openclaw_gateway_status";

export type AllowedToolName = HttpToolName | CronToolName;

export interface GatewayInvokePayload {
  tool: string;
  action?: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  dryRun?: boolean;
}

interface BaseGatewayOperation {
  requestKind: "invoke" | "check";
  timeoutMs: number;
  description: string;
}

interface InvokeGatewayOperation extends BaseGatewayOperation {
  requestKind: "invoke";
  payload: {
    tool: string;
    action?: string;
    args?: Record<string, unknown>;
    sessionKey?: string;
    dryRun?: boolean;
  };
}

interface CheckGatewayOperation extends BaseGatewayOperation {
  requestKind: "check";
}

export type AllowedGatewayOperation = InvokeGatewayOperation | CheckGatewayOperation;

export interface GatewayConfig {
  baseUrl: string;
  token: string;
}

export const ALLOWED_HTTP_GATEWAY_OPERATIONS: Record<HttpToolName, AllowedGatewayOperation> = {
  openclaw_status: {
    requestKind: "invoke",
    timeoutMs: 12_000,
    description: "Return overall OpenClaw status from the Gateway API.",
    payload: {
      tool: "sessions_list",
      action: "json",
      args: {}
    }
  },
  openclaw_gateway_status: {
    requestKind: "check",
    timeoutMs: 12_000,
    description: "Return OpenClaw gateway status from GET /healthz."
  }
};

export function isAllowedToolName(value: string): value is AllowedToolName {
  return isHttpToolName(value);
}

export function isHttpToolName(value: string): value is HttpToolName {
  return Object.hasOwn(ALLOWED_HTTP_GATEWAY_OPERATIONS, value);
}

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("OPENCLAW_GATEWAY_URL is empty");
  }

  const parsed = new URL(trimmed);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OPENCLAW_GATEWAY_URL must use http or https");
  }

  return parsed.toString();
}

function validateFilePath(pathValue: string, envVar: string): string {
  if (!isAbsolute(pathValue)) {
    throw new Error(`${envVar} must be an absolute path`);
  }

  if (pathValue.includes("\u0000")) {
    throw new Error(`${envVar} contains invalid characters`);
  }

  return pathValue;
}

function validateGatewayToken(token: string): string {
  if (token.includes("\r") || token.includes("\n")) {
    throw new Error("Gateway token must not contain line breaks");
  }

  return token;
}

function readSecret(
  inlineEnvVar: string,
  fileEnvVar: string | undefined,
  legacyInlineEnvVar?: string,
  defaultFilePath?: string
): string {
  const inline = process.env[inlineEnvVar]?.trim();
  if (inline) {
    return validateGatewayToken(inline);
  }

  if (legacyInlineEnvVar) {
    const legacyInline = process.env[legacyInlineEnvVar]?.trim();
    if (legacyInline) {
      return validateGatewayToken(legacyInline);
    }
  }

  if (fileEnvVar) {
    const filePath = process.env[fileEnvVar]?.trim();
    if (filePath) {
      const validatedPath = validateFilePath(filePath, fileEnvVar);
      const fileValue = readFileSync(validatedPath, "utf8").trim();
      if (fileValue) {
        return validateGatewayToken(fileValue);
      }
      throw new Error(`${fileEnvVar} is empty`);
    }
  }

  if (defaultFilePath && existsSync(defaultFilePath)) {
    const fileValue = readFileSync(defaultFilePath, "utf8").trim();
    if (fileValue) {
      return validateGatewayToken(fileValue);
    }
    throw new Error(`${defaultFilePath} is empty`);
  }

  const inlineHint = legacyInlineEnvVar ? `${inlineEnvVar} or ${legacyInlineEnvVar}` : inlineEnvVar;
  const fileHint = fileEnvVar ?? "";
  throw new Error(`Set ${inlineHint}${fileHint ? ` or ${fileHint}` : ""}`);
}

export function loadGatewayConfig(): GatewayConfig {
  const baseUrlEnv = process.env.OPENCLAW_GATEWAY_URL;
  if (!baseUrlEnv) {
    throw new Error("OPENCLAW_GATEWAY_URL is required");
  }

  return {
    baseUrl: normalizeUrl(baseUrlEnv),
    token: readSecret(
      "OPENCLAW_GATEWAY_TOKEN",
      undefined,
      "OPENCLAW_GATEWAY_KEY",
      "/run/secret/openclaw_gateway_token"
    )
  };
}
