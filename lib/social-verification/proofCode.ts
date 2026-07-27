import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createSocialProofCode() {
  const bytes = randomBytes(8);
  const code = Array.from(
    bytes,
    (value) => alphabet[value % alphabet.length],
  ).join("");
  return `SR-${code.slice(0, 4)}-${code.slice(4)}`;
}
