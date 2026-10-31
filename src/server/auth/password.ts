import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

// OWASP-recommended scrypt cost (N=2^15, r=8, p=1) ≈ 32 MiB per hash.
const PARAMS = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  "password123",
  "password1234",
  "1234567890",
  "12345678910",
  "qwertyuiop",
  "iloveyou123",
  "welcome123",
  "carenest123",
  "letmein1234",
  "admin12345",
]);

/** Returns a reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "This password is too common. Choose another.";
  if (email && password.toLowerCase() === email.toLowerCase()) return "Your password must not be your email.";
  return null;
}

/** Hash format: `scrypt$N$r$p$<salt base64>$<hash base64>` (self-describing so costs can rise later). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Verifying against this when the user does not exist keeps login timing uniform,
// so response time does not reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
