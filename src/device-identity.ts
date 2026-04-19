import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// SPKI DER prefix for Ed25519 public keys; the 32-byte raw key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface DeviceIdentity {
  deviceId: string;
  publicKeyRaw: string; // base64url-encoded 32-byte Ed25519 public key
  privateKeyPem: string;
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const rawPublicKey = spkiDer.subarray(ED25519_SPKI_PREFIX.length);
  const deviceId = createHash("sha256").update(rawPublicKey).digest("hex");
  return {
    deviceId,
    publicKeyRaw: toBase64Url(rawPublicKey),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string
  };
}

/**
 * Load the device identity from `filePath` if it exists and is valid, otherwise
 * generate a fresh one and write it to `filePath` (0600) for future runs.
 *
 * A stable device identity is required so the Gateway can recognise and pair
 * this device across reconnects.  Ephemeral identities (new key per call)
 * always appear as unknown devices and fail the Gateway's pairing check.
 */
export function loadOrCreateDeviceIdentity(filePath: string): DeviceIdentity {
  if (existsSync(filePath)) {
    try {
      const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      if (
        typeof data.deviceId === "string" &&
        data.deviceId.length > 0 &&
        typeof data.publicKeyRaw === "string" &&
        data.publicKeyRaw.length > 0 &&
        typeof data.privateKeyPem === "string" &&
        data.privateKeyPem.startsWith("-----")
      ) {
        // Enforce restrictive permissions even on an existing file (e.g. if it
        // was copied from another location with broader permissions).
        try {
          chmodSync(filePath, 0o600);
        } catch {
          // Non-fatal — best effort on read-only filesystems or Docker volumes.
        }
        return data as unknown as DeviceIdentity;
      }
    } catch {
      // Fall through to generate a new identity below.
    }
  }

  const identity = generateDeviceIdentity();
  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Warning: could not persist device identity to ${filePath}: ${msg}`);
  }
  return identity;
}
