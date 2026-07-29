import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedBrokerageSecret = {
  authTag: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

export function readBrokerageEncryptionKey(value: string) {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) {
    throw new Error("BROKERAGE_ENCRYPTION_UNAVAILABLE");
  }
  return key;
}

export function encryptBrokerageSecret(
  plaintext: string,
  key: Buffer,
  keyVersion = 1,
): EncryptedBrokerageSecret {
  if (key.length !== 32 || !plaintext) {
    throw new Error("BROKERAGE_ENCRYPTION_UNAVAILABLE");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    keyVersion,
  };
}

export function decryptBrokerageSecret(
  value: EncryptedBrokerageSecret,
  key: Buffer,
) {
  if (key.length !== 32) {
    throw new Error("BROKERAGE_ENCRYPTION_UNAVAILABLE");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
