import { createHash, randomBytes } from "node:crypto";

/** Invitation secrets: 256 bits of entropy, stored only as a SHA-256 hash. */
export function newInviteToken() {
  const token = `gl_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const newShareToken = () => `br_${randomBytes(24).toString("base64url")}`;

export const INVITE_TTL_MS = 7 * 24 * 3_600_000;
