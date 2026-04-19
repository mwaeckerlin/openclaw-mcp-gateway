import {
  createPrivateKey,
  randomUUID,
  sign as cryptoSign
} from "node:crypto";
import WebSocket, { RawData } from "ws";
import { GatewayConfig } from "./commands.js";
import { DeviceIdentity, generateDeviceIdentity } from "./device-identity.js";

export type { DeviceIdentity };

type GatewayRpcFrame = Record<string, unknown>;

type GatewayRpcErrorKind = "capability" | "auth" | "timeout" | "transport" | "protocol" | "pairing";

export class GatewayRpcError extends Error {
  constructor(
    public readonly kind: GatewayRpcErrorKind,
    message: string
  ) {
    super(message);
    this.name = "GatewayRpcError";
  }
}

interface RpcResponseFrame {
  type: "res";
  id: string;
  ok?: boolean;
  payload?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

type WebSocketFactory = (url: string) => Pick<
  WebSocketLike,
  "on" | "send" | "close" | "readyState"
>;

interface WebSocketLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(data: string): void;
  close(): void;
  readyState: number;
}

const DEFAULT_SCOPE = ["operator.admin", "operator.read"];

// Payload format matches openclaw gateway's buildDeviceAuthPayloadV3:
// "v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}"
function buildDevicePayloadV3(
  deviceId: string,
  scopes: string[],
  signedAtMs: number,
  token: string,
  nonce: string,
  platform: string
): string {
  const normalizeDeviceMeta = (v: string): string => v.trim().toLowerCase();
  return [
    "v3",
    deviceId,
    "gateway-client",
    "backend",
    "operator",
    scopes.join(","),
    String(signedAtMs),
    token,
    nonce,
    normalizeDeviceMeta(platform),
    "" // deviceFamily: unused
  ].join("|");
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = createPrivateKey(privateKeyPem);
  const sig = cryptoSign(null, Buffer.from(payload, "utf8"), key);
  return sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let webSocketFactory: WebSocketFactory = (url) => new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });

function normalizeRpcUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  } else {
    throw new GatewayRpcError("transport", "Gateway RPC URL must be http(s) for ws conversion");
  }
  return parsed.toString();
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function extractErrorMessage(frame: RpcResponseFrame): string {
  const message = typeof frame.error?.message === "string" ? frame.error.message : undefined;
  const code = typeof frame.error?.code === "string" ? frame.error.code : undefined;
  return [code, message].filter(Boolean).join(": ");
}

function isCapabilityErrorText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("not supported") ||
    normalized.includes("method_not_found") ||
    normalized.includes("endpoint_disabled") ||
    normalized.includes("tool_not_allowlisted")
  );
}

function isAuthErrorText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("missing scope") ||
    normalized.includes("permission denied")
  );
}

function isPairingErrorText(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("not_paired") || normalized.includes("pairing required");
}

function toGatewayRpcError(frame: RpcResponseFrame, context: string): GatewayRpcError {
  const message = extractErrorMessage(frame) || `${context} failed`;
  if (isCapabilityErrorText(message)) {
    return new GatewayRpcError("capability", message);
  }
  if (isAuthErrorText(message)) {
    return new GatewayRpcError("auth", message);
  }
  if (isPairingErrorText(message)) {
    return new GatewayRpcError("pairing", message);
  }
  return new GatewayRpcError("protocol", message);
}

/**
 * Register this device with the Gateway via HTTP so subsequent WebSocket
 * connect frames pass the Gateway's pairing check.
 *
 * The Gateway requires that any non-loopback operator client first pairs its
 * device identity (public key + device-id) against a valid operator token.
 * Without prior pairing the Gateway rejects WS connect frames from bridge
 * network addresses with NOT_PAIRED.
 *
 * Calling this on startup (and retrying per-call on NOT_PAIRED responses)
 * satisfies the pairing requirement without any network topology tricks.
 */
export async function pairWithGateway(
  gatewayConfig: GatewayConfig,
  deviceIdentity: DeviceIdentity,
  timeoutMs: number
): Promise<void> {
  const url = new URL("/api/v1/pair", gatewayConfig.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayConfig.token}`
      },
      body: JSON.stringify({
        deviceId: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKeyRaw,
        clientId: "gateway-client",
        platform: process.platform,
        mode: "backend"
      }),
      signal: controller.signal
    });

    // 200/201 = newly paired; 409 = already paired (both are success).
    if (!response.ok && response.status !== 409) {
      const body = await response.text().catch(() => "");
      throw new GatewayRpcError(
        "pairing",
        `Gateway pair failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 200)}` : ""}`
      );
    }
  } catch (error: unknown) {
    if (error instanceof GatewayRpcError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayRpcError("pairing", `Gateway pair request timed out after ${timeoutMs}ms`);
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new GatewayRpcError("pairing", `Gateway pair request failed: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Single WS RPC attempt.  Throws GatewayRpcError("pairing", …) when the
 * Gateway responds NOT_PAIRED so the caller can pair and retry exactly once.
 */
async function callGatewayRpcOnce(
  gatewayConfig: GatewayConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  deviceIdentity?: DeviceIdentity
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const wsUrl = normalizeRpcUrl(gatewayConfig.baseUrl);
    const ws = webSocketFactory(wsUrl);
    const connectRequestId = randomUUID();
    const methodRequestId = randomUUID();
    let settled = false;
    let connected = false;
    let connectSent = false;
    // Use the supplied stable identity when available; fall back to an ephemeral
    // one only for callers that have not yet been wired to the startup identity.
    const identity = deviceIdentity ?? generateDeviceIdentity();

    const stop = (error?: Error, result?: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(connectFallbackTimer);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const sendFrame = (frame: GatewayRpcFrame): void => {
      try {
        ws.send(JSON.stringify(frame));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        stop(new GatewayRpcError("transport", `Failed to send Gateway RPC frame: ${message}`));
      }
    };

    const sendConnect = (nonce?: string): void => {
      if (connectSent) {
        return;
      }
      connectSent = true;
      const scopes = DEFAULT_SCOPE;

      // Build device field when the gateway has given us a challenge nonce.
      // Without a device, the gateway clears our requested scopes to [].
      let device: Record<string, unknown> | undefined;
      if (nonce) {
        const signedAtMs = Date.now();
        const payload = buildDevicePayloadV3(
          identity.deviceId,
          scopes,
          signedAtMs,
          gatewayConfig.token,
          nonce,
          process.platform
        );
        device = {
          id: identity.deviceId,
          publicKey: identity.publicKeyRaw,
          signature: signDevicePayload(identity.privateKeyPem, payload),
          signedAt: signedAtMs,
          nonce
        };
      }

      sendFrame({
        type: "req",
        id: connectRequestId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            version: "1.0.0",
            platform: process.platform,
            mode: "backend"
          },
          caps: [],
          auth: {
            token: gatewayConfig.token
          },
          role: "operator",
          scopes,
          ...(device !== undefined ? { device } : {})
        }
      });
    };

    const sendMethod = (): void => {
      sendFrame({
        type: "req",
        id: methodRequestId,
        method,
        params
      });
    };

    const timer = setTimeout(() => {
      stop(new GatewayRpcError("timeout", `Gateway RPC request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const connectFallbackTimer = setTimeout(() => {
      if (!connectSent) {
        sendConnect();
      }
    }, 100);

    ws.on("open", () => {
      if (settled) return;
    });

    ws.on("message", (rawData: RawData) => {
      if (settled) return;
      const text = rawDataToString(rawData);

      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(text) as Record<string, unknown>;
      } catch {
        stop(new GatewayRpcError("protocol", "Gateway protocol failure: malformed JSON response frame"));
        return;
      }

      if (frame.type === "event") {
        if (frame.event === "connect.challenge") {
          const payload = frame.payload;
          const nonce =
            payload !== null &&
            typeof payload === "object" &&
            typeof (payload as Record<string, unknown>).nonce === "string"
              ? ((payload as Record<string, unknown>).nonce as string)
              : undefined;
          sendConnect(nonce);
        }
        return;
      }

      if (frame.type !== "res" || typeof frame.id !== "string") {
        stop(new GatewayRpcError("protocol", "Gateway protocol failure: malformed response frame"));
        return;
      }

      const response = frame as unknown as RpcResponseFrame;
      if (response.id === connectRequestId) {
        if (response.ok !== true) {
          stop(toGatewayRpcError(response, "Gateway connect"));
          return;
        }
        connected = true;
        sendMethod();
        return;
      }

      if (response.id !== methodRequestId || !connected) {
        return;
      }

      if (response.ok !== true) {
        stop(toGatewayRpcError(response, `Gateway RPC method ${method}`));
        return;
      }

      stop(undefined, response.payload);
    });

    ws.on("error", (error: Error) => {
      if (settled) return;
      stop(new GatewayRpcError("transport", `Gateway RPC transport failure: ${error.message}`));
    });

    ws.on("close", (code: number, reason: Buffer) => {
      if (settled) return;
      const reasonText = reason.toString("utf8");
      if (!connected && isAuthErrorText(reasonText)) {
        stop(new GatewayRpcError("auth", `Gateway auth failure (${code}): ${reasonText || "no close reason"}`));
        return;
      }
      stop(new GatewayRpcError("protocol", `Gateway connection closed (${code}): ${reasonText || "no close reason"}`));
    });
  });
}

/**
 * Call a Gateway WebSocket RPC method, pairing the device automatically on
 * first use (or after a Gateway restart clears its paired-device state).
 *
 * If the single WS attempt fails with NOT_PAIRED and a `deviceIdentity` is
 * provided, this function calls `pairWithGateway` and retries exactly once.
 * This satisfies the Gateway's pairing requirement for non-loopback clients
 * without relying on any network topology shortcuts.
 */
export async function callGatewayRpc(
  gatewayConfig: GatewayConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  deviceIdentity?: DeviceIdentity
): Promise<unknown> {
  try {
    return await callGatewayRpcOnce(gatewayConfig, method, params, timeoutMs, deviceIdentity);
  } catch (error: unknown) {
    // On NOT_PAIRED: pair this device then retry the full WS call once.
    if (error instanceof GatewayRpcError && error.kind === "pairing" && deviceIdentity) {
      await pairWithGateway(gatewayConfig, deviceIdentity, timeoutMs);
      return callGatewayRpcOnce(gatewayConfig, method, params, timeoutMs, deviceIdentity);
    }
    throw error;
  }
}

export const __testing = {
  setWebSocketFactory(factory: WebSocketFactory): void {
    webSocketFactory = factory;
  },
  resetWebSocketFactory(): void {
    webSocketFactory = (url) => new WebSocket(url, { maxPayload: 25 * 1024 * 1024 });
  }
};
