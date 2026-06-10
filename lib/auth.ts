import { createHash, timingSafeEqual } from "node:crypto";

// The session `id` is public (it's drawn on everyone's map), so it cannot also
// be the credential. Each session mints a high-entropy `secret` kept only on
// the client; we store its SHA-256 and verify ownership on sensitive calls.
//
// SHA-256 (no salt/KDF) is appropriate here: the secret is a 128-bit random
// token, not a low-entropy human password, so brute force is infeasible and a
// slow KDF would only add latency to a hot path.

export const SECRET_MIN = 16;
export const SECRET_MAX = 256;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function isValidSecret(secret: unknown): secret is string {
  return (
    typeof secret === "string" &&
    secret.length >= SECRET_MIN &&
    secret.length <= SECRET_MAX
  );
}

// Constant-time compare of two hex hashes (avoids leaking match progress via
// timing). Returns false on any length/format mismatch.
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// Session ids are public labels but still untrusted input — bound their size so
// they can't be used to bloat the store or queries.
export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && id.length >= 8 && id.length <= 128;
}
