import { createHash, randomBytes } from "node:crypto";

/** 256-bit random, URL-safe token for sessions, invitations and similar bearer secrets. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes, so a database leak does not expose usable links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
