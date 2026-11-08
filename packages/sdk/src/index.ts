import { createHmac, timingSafeEqual } from "node:crypto";

export function signWebhook(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): string {
  return `v1=${createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("hex")}`;
}

/** Pass the raw request body, before JSON parsing. */
export function verifyWebhook(
  secret: string,
  id: string,
  timestamp: string,
  signature: string,
  body: string,
  toleranceSeconds = 300,
): boolean {
  const time = Number(timestamp);
  if (
    !Number.isSafeInteger(time) ||
    Math.abs(Date.now() / 1000 - time) > toleranceSeconds
  )
    return false;
  const expected = signWebhook(secret, id, time, body);
  const supplied = Buffer.from(signature),
    valid = Buffer.from(expected);
  return supplied.length === valid.length && timingSafeEqual(supplied, valid);
}

export class HookRelay {
  constructor(private options: { apiKey: string; baseUrl: string }) {}
  async send(
    type: string,
    data: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<{ id: string; duplicate: boolean }> {
    const response = await fetch(
      `${this.options.baseUrl.replace(/\/$/, "")}/v1/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify({ type, data }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `HookRelay returned ${response.status}: ${await response.text()}`,
      );
    return response.json() as Promise<{ id: string; duplicate: boolean }>;
  }
}
