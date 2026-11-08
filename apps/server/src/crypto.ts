import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";
const derive = promisify(scrypt);
export const token = (prefix = "") =>
  prefix + randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  const key = (await derive(password, salt, 64)) as Buffer;
  const other = Buffer.from(encoded, "hex");
  return other.length === key.length && timingSafeEqual(key, other);
}
export function encrypt(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(config.ENCRYPTION_KEY, "hex"),
    iv,
  );
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decrypt(encoded: string) {
  const data = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(config.ENCRYPTION_KEY, "hex"),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
