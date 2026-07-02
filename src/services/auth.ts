import jwt from "jsonwebtoken";

// SECURITY: Refuse to start if JWT_SECRET is not explicitly set in environment.
// A missing secret must never silently fall back to a known/predictable string.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. " +
    "Set a strong random secret in your .env file before starting the server."
  );
}

const OTP_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_OTP_ATTEMPTS = 5;

interface PendingOTP {
  code: string;
  expiresAt: number;
  attempts: number; // Brute-force protection: lockout after MAX_OTP_ATTEMPTS
}

// In-memory store for OTPs. In a production app, use Redis or a Database.
const otpStore = new Map<string, PendingOTP>();

/**
 * Generates a random 4-digit OTP, stores it, and returns it.
 */
export function generateOTP(phoneNumber: string): string {
  // Generate 4 digit code
  const code = Math.floor(1000 + Math.random() * 9000).toString();
  
  otpStore.set(phoneNumber, {
    code,
    expiresAt: Date.now() + OTP_EXPIRATION_MS,
    attempts: 0
  });

  return code;
}

/**
 * Validates the OTP for a given phone number.
 */
export function validateOTP(phoneNumber: string, code: string): boolean {
  const pending = otpStore.get(phoneNumber);
  
  if (!pending) {
    return false;
  }
  
  // Check expiry
  if (Date.now() > pending.expiresAt) {
    otpStore.delete(phoneNumber);
    return false;
  }

  // Brute-force lockout: invalidate after too many wrong attempts
  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    otpStore.delete(phoneNumber);
    return false;
  }

  if (pending.code === code) {
    otpStore.delete(phoneNumber);
    return true;
  }

  // Wrong guess — increment attempt counter
  pending.attempts++;
  return false;
}

/**
 * Issues a JWT token for the authenticated phone number.
 */
export function issueToken(phoneNumber: string): string {
  return jwt.sign({ phoneNumber }, JWT_SECRET!, { expiresIn: "7d" });
}

/**
 * Verifies a JWT token.
 */
export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET!);
  } catch (err) {
    return null;
  }
}
