#!/usr/bin/env node
/**
 * Generate a fresh Ed25519 device keypair for E2E tests.
 *
 * Outputs two environment variables to test/.env that docker compose reads:
 *
 *   OPENCLAW_E2E_DEVICE_IDENTITY
 *     JSON-encoded DeviceIdentity for the MCP gateway container.
 *     Passed in via OPENCLAW_DEVICE_IDENTITY so the MCP gateway uses a
 *     stable private key that matches the pre-registered public key.
 *
 *   OPENCLAW_E2E_DEVICE_PAIRING
 *     JSON-encoded pairing record for the OpenClaw Gateway container.
 *     Passed in via OPENCLAW_DEVICE_PAIRING so the Gateway accepts the
 *     device on the very first WS connect — no runtime HTTP pairing needed.
 *
 * Usage:
 *   node test/generate-pairing.mjs
 *
 * This script is run automatically by the `npm test` E2E step.
 */

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// SPKI DER prefix for Ed25519 public keys; the 32-byte raw key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function toBase64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Generate a fresh Ed25519 keypair.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spkiDer = publicKey.export({ type: "spki", format: "der" });
const rawPublicKey = spkiDer.subarray(ED25519_SPKI_PREFIX.length);
const deviceId = createHash("sha256").update(rawPublicKey).digest("hex");
const publicKeyRaw = toBase64Url(rawPublicKey);
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

// Device identity consumed by the MCP gateway (OPENCLAW_DEVICE_IDENTITY).
const deviceIdentity = { deviceId, publicKeyRaw, privateKeyPem };

// Full paired-device record consumed by the OpenClaw Gateway via
// OPENCLAW_DEVICE_PAIRING.  The entrypoint writes this verbatim to
// $OPENCLAW_STATE_DIR/devices/paired.json (keyed by deviceId).
//
// The gateway's WS connect auth flow checks:
//   1. paired.publicKey === presented publicKey
//   2. listEffectivePairedDeviceRoles(paired) includes the requested role
//      → requires tokens[role] (non-revoked) AND roles/role includes the role
//   3. roleScopesAllow({ role, requestedScopes, allowedScopes: approvedScopes })
//      → approvedScopes must cover operator.admin and operator.read
//
// A record with only deviceId + publicKey is rejected with NOT_PAIRED because
// listEffectivePairedDeviceRoles returns [] when tokens is empty.
const nowMs = Date.now();
const pairedRecord = {
  deviceId,
  publicKey: publicKeyRaw,
  role: "operator",
  roles: ["operator"],
  scopes: ["operator.admin", "operator.read"],
  approvedScopes: ["operator.admin", "operator.read"],
  tokens: {
    operator: {
      token: randomBytes(32).toString("base64url"),
      role: "operator",
      scopes: ["operator.admin", "operator.read"],
      createdAtMs: nowMs
    }
  },
  createdAtMs: nowMs,
  approvedAtMs: nowMs
};

// paired.json format: object keyed by deviceId.
const devicePairing = { [deviceId]: pairedRecord };

// Escape a JSON string value for inclusion in a shell .env file.
// JSON.stringify produces valid JSON with escaped newlines, which is what
// docker compose --env-file expects for multi-line values.
function envValue(obj) {
  return JSON.stringify(JSON.stringify(obj));
}

const envContent = [
  `OPENCLAW_E2E_DEVICE_IDENTITY=${envValue(deviceIdentity)}`,
  `OPENCLAW_E2E_DEVICE_PAIRING=${envValue(devicePairing)}`,
  ""
].join("\n");

const envFile = join(__dirname, ".env");
writeFileSync(envFile, envContent, { mode: 0o600 });

console.log(`E2E device keypair generated: deviceId=${deviceId.slice(0, 16)}…`);
console.log(`Written to ${envFile}`);
