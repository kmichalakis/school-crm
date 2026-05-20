import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const iterations = 120_000;
const keyLength = 32;
const digest = "sha256";
const minimumPasswordLength = 10;

export function validatePasswordPolicy(password: string, username?: string) {
  const issues: string[] = [];
  const normalizedUsername = username?.trim().toLowerCase();

  if (password.length < minimumPasswordLength) {
    issues.push(`Ο κωδικός πρέπει να έχει τουλάχιστον ${minimumPasswordLength} χαρακτήρες.`);
  }

  if (!/[A-Za-zΑ-Ωα-ω]/.test(password) || !/[0-9]/.test(password)) {
    issues.push("Ο κωδικός πρέπει να περιέχει γράμματα και αριθμούς.");
  }

  if (normalizedUsername && password.toLowerCase().includes(normalizedUsername)) {
    issues.push("Ο κωδικός δεν πρέπει να περιέχει το username.");
  }

  return issues;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");

  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, iterationsValue, salt, hash] = storedHash.split(":");

  if (scheme !== "pbkdf2" || !iterationsValue || !salt || !hash) {
    return false;
  }

  const derivedHash = pbkdf2Sync(password, salt, Number(iterationsValue), keyLength, digest);
  const storedBuffer = Buffer.from(hash, "hex");

  if (storedBuffer.length !== derivedHash.length) {
    return false;
  }

  return timingSafeEqual(storedBuffer, derivedHash);
}
