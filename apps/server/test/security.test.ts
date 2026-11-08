import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhook } from "@hookrelay/sdk";
import { publicAddress, parseEndpoint, resolveEndpoint } from "../src/ssrf.js";
import { retryDelay, shouldRetry } from "../src/retry.js";
import {
  encrypt,
  decrypt,
  hashPassword,
  checkPassword,
} from "../src/crypto.js";

describe("webhook signatures", () => {
  it("verifies raw bytes and rejects tampering, stale and future timestamps", () => {
    const now = Math.floor(Date.now() / 1000),
      body = '{"hello":"world"}',
      secret = "test-secret";
    const signature = signWebhook(secret, "event-123", now, body);
    expect(
      verifyWebhook(secret, "event-123", String(now), signature, body),
    ).toBe(true);
    expect(
      verifyWebhook(secret, "event-123", String(now), signature, body + " "),
    ).toBe(false);
    expect(
      verifyWebhook(secret, "event-124", String(now), signature, body),
    ).toBe(false);
    for (const timestamp of [now - 400, now + 400])
      expect(
        verifyWebhook(
          secret,
          "event-123",
          String(timestamp),
          signWebhook(secret, "event-123", timestamp, body),
          body,
        ),
      ).toBe(false);
    expect(verifyWebhook(secret, "event-123", "NaN", signature, body)).toBe(
      false,
    );
    expect(verifyWebhook(secret, "event-123", String(now), "bad", body)).toBe(
      false,
    );
    expect(
      verifyWebhook(
        secret,
        "event-123",
        String(now),
        "é".repeat(signature.length),
        body,
      ),
    ).toBe(false);
  });
});
describe("SSRF policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])("blocks %s", (address) => expect(publicAddress(address)).toBe(false));
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "allows public %s",
    (address) => expect(publicAddress(address)).toBe(true),
  );
  it.each([
    "file:///etc/passwd",
    "ftp://example.com",
    "http://user:password@example.com",
    "http://example.com:4000",
    "https://example.com/#fragment",
  ])("rejects unsafe URL %s", (url) =>
    expect(() => parseEndpoint(url)).toThrow(),
  );
  it("rejects loopback resolution", async () => {
    await expect(resolveEndpoint("http://127.0.0.1")).rejects.toThrow("public");
    await expect(resolveEndpoint("http://[::1]")).rejects.toThrow("public");
  });
});
describe("retry policy", () => {
  it.each([null, 408, 429, 500, 503])("retries %s", (status) =>
    expect(shouldRetry(status)).toBe(true),
  );
  it.each([200, 301, 400, 401, 403, 404, 422])("does not retry %s", (status) =>
    expect(shouldRetry(status)).toBe(false),
  );
  it("applies bounded jitter, exponential backoff and Retry-After", () => {
    expect(retryDelay(1, undefined, 0, () => 0)).toBe(1000);
    expect(retryDelay(2, undefined, 0, () => 1)).toBe(4000);
    expect(retryDelay(1, "120", 0, () => 0)).toBe(120000);
    expect(retryDelay(1, new Date(60000).toUTCString(), 0, () => 0)).toBe(
      60000,
    );
    expect(retryDelay(1, "junk", 0, () => 0)).toBe(1000);
    expect(retryDelay(1, "999999999", 0, () => 0)).toBe(86400000);
  });
});
describe("credential storage", () => {
  it("uses authenticated encryption with randomized IVs", () => {
    const a = encrypt("whsec_test"),
      b = encrypt("whsec_test");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("whsec_test");
    const bytes = Buffer.from(a, "base64");
    bytes[15] ^= 1;
    expect(() => decrypt(bytes.toString("base64"))).toThrow();
  });
  it("salts password hashes and rejects wrong passwords", async () => {
    const a = await hashPassword("correct-horse-battery");
    expect(await checkPassword("correct-horse-battery", a)).toBe(true);
    expect(await checkPassword("incorrect", a)).toBe(false);
    expect(await hashPassword("correct-horse-battery")).not.toBe(a);
  });
});
