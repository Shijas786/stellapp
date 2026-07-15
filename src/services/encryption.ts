import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const ALGORITHM = "aes-256-gcm";
const KEY_HEX = process.env.ENCRYPTION_KEY;

if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error("ENCRYPTION_KEY environment variable must be a 32-byte hex string (64 characters).");
}

const MASTER_KEY = Buffer.from(KEY_HEX, "hex");

// ─── Per-user key derivation ──────────────────────────────────────────────────
// Derives a unique 32-byte AES key for each user via HKDF(SHA-256).
// Info field encodes "stellapp-wallet-v1:<userId>" so keys are purpose-bound
// and cannot be reused across contexts even if the derivation inputs leak.
function deriveUserKey(userId: string): Buffer {
  const raw = crypto.hkdfSync(
    "sha256",
    MASTER_KEY,
    Buffer.alloc(0),           // no salt — master key is already high entropy
    `stellapp-wallet-v1:${userId}`,
    32
  );
  return Buffer.from(raw);
}

// ─── New API (use these everywhere) ──────────────────────────────────────────

/**
 * Encrypts plain text with a key derived from the master key + userId.
 * Returns "iv:encryptedText:authTag" (all hex) — same wire format as before
 * so the DB column type doesn't change.
 */
export function encryptForUser(text: string, userId: string): string {
  const key = deriveUserKey(userId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/**
 * Decrypts a value that was encrypted with encryptForUser().
 * Throws on auth-tag mismatch (i.e. wrong userId or tampered ciphertext).
 */
export function decryptForUser(encryptedData: string, userId: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format. Expected iv:text:authTag");
  }

  const [ivHex, encryptedHex, authTagHex] = parts;
  const key = deriveUserKey(userId);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Transparent migration helper.
 * Tries decrypting with the per-user derived key first.
 * Falls back to the legacy global key for rows that were encrypted before
 * the HKDF upgrade. Returns { plaintext, migrated } where migrated=true
 * signals the caller should re-encrypt with encryptForUser() and persist.
 */
export function decryptForUserWithMigration(
  encryptedData: string,
  userId: string
): { plaintext: string; migrated: boolean } {
  try {
    const plaintext = decryptForUser(encryptedData, userId);
    return { plaintext, migrated: false };
  } catch {
    // Fall back to legacy global key (pre-HKDF rows)
    const plaintext = decrypt(encryptedData);
    return { plaintext, migrated: true };
  }
}

// ─── Legacy API (kept for migration reads only — do not use for new writes) ──

/**
 * @deprecated Use encryptForUser() for all new writes.
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${encrypted}:${authTag}`;
}

/**
 * @deprecated Use decryptForUser() or decryptForUserWithMigration() instead.
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format. Expected iv:text:authTag");
  }

  const [ivHex, encryptedHex, authTagHex] = parts;

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
