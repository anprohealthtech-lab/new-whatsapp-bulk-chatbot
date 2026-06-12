import crypto from "node:crypto";
import { config } from "../config.js";

const VERSION = "v1";

export function encryptCredential(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCredential(payload: string): string {
  if (!payload.startsWith(`${VERSION}.`)) {
    throw new Error("Unsupported encrypted credential format");
  }

  const [, ivValue, tagValue, encryptedValue] = payload.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted credential payload is malformed");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function getEncryptionKey(): Buffer {
  const value = config.VOICE_CREDENTIAL_ENCRYPTION_KEY;
  if (!value) {
    throw new Error("VOICE_CREDENTIAL_ENCRYPTION_KEY is required for tenant provider credentials");
  }

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32) {
    throw new Error("VOICE_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hex characters");
  }
  return decoded;
}
