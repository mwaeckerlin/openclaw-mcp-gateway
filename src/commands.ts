import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export type AllowedToolName =
  | "openclaw_status"
  | "openclaw_gateway_status";

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

export const ALLOWED_GATEWAY_OPERATIONS: Record<AllowedToolName, AllowedGatewayOperation> = {
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
    description: "Return OpenClaw gateway status from GET /api/v1/check."
  }
};

export function isAllowedToolName(value: string): value is AllowedToolName {
  return Object.hasOwn(ALLOWED_GATEWAY_OPERATIONS, value);
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
  fileEnvVar: string,
  legacyInlineEnvVar?: string,
  legacyFileEnvVar?: string
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

  const filePath = process.env[fileEnvVar]?.trim();
  if (filePath) {
    const validatedPath = validateFilePath(filePath, fileEnvVar);
    const fileValue = readFileSync(validatedPath, "utf8").trim();
    if (fileValue) {
      return validateGatewayToken(fileValue);
    }
    throw new Error(`${fileEnvVar} is empty`);
  }

  if (legacyFileEnvVar) {
    const legacyFilePath = process.env[legacyFileEnvVar]?.trim();
    if (legacyFilePath) {
      const validatedPath = validateFilePath(legacyFilePath, legacyFileEnvVar);
      const fileValue = readFileSync(validatedPath, "utf8").trim();
      if (fileValue) {
        return validateGatewayToken(fileValue);
      }
      throw new Error(`${legacyFileEnvVar} is empty`);
    }
  }

  const inlineHint = legacyInlineEnvVar ? `${inlineEnvVar} or ${legacyInlineEnvVar}` : inlineEnvVar;
  const fileHint = legacyFileEnvVar ? `${fileEnvVar} or ${legacyFileEnvVar}` : fileEnvVar;
  throw new Error(`Set ${inlineHint} or ${fileHint}`);
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
      "OPENCLAW_GATEWAY_TOKEN_FILE",
      "OPENCLAW_GATEWAY_KEY",
      "OPENCLAW_GATEWAY_KEY_FILE"
    )
  };
}
