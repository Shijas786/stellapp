import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "stellapp-super-secret-jwt-key";
const OTP_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

interface PendingOTP {
  code: string;
  expiresAt: number;
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
    expiresAt: Date.now() + OTP_EXPIRATION_MS
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
  
  if (Date.now() > pending.expiresAt) {
    otpStore.delete(phoneNumber);
    return false;
  }
  
  if (pending.code === code) {
    otpStore.delete(phoneNumber);
    return true;
  }
  
  return false;
}

/**
 * Issues a JWT token for the authenticated phone number.
 */
export function issueToken(phoneNumber: string): string {
  return jwt.sign({ phoneNumber }, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Verifies a JWT token.
 */
export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}
