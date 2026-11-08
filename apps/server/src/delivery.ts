import { randomUUID } from "node:crypto";
import { db, sql } from "./db.js";
import { decrypt } from "./crypto.js";
import { signWebhook } from "@hookrelay/sdk";
import { config } from "./config.js";
import { retryDelay, shouldRetry } from "./retry.js";
import { sendWebhook } from "./ssrf.js";

export type DeliveryJob = {
  deliveryId: string;
  generation: number;
  attempt: number;
};
export async function deliver(job: DeliveryJob, send = sendWebhook) {
  const lock = randomUUID();
  const claimed = (
    await db.execute(
      sql`UPDATE deliveries SET status='processing',locked_until=now()+interval '60 seconds',lock_token=${lock},updated_at=now() WHERE id=${job.deliveryId} AND generation=${job.generation} AND attempt_count=${job.attempt - 1} AND status IN ('pending','processing') AND next_attempt_at<=now() AND (locked_until IS NULL OR locked_until<now()) RETURNING *`,
    )
  ).rows[0];
  if (!claimed) return;
  const source = (
    await db.execute(
      sql`SELECT e.id,e.type,e.payload,e.created_at,ep.url,ep.enabled,ep.deleted_at,ep.secret_encrypted FROM events e JOIN endpoints ep ON ep.id=${claimed.endpoint_id} WHERE e.id=${claimed.event_id}`,
    )
  ).rows[0];
  const started = Date.now();
  let status: number | null = null,
    error: string | null = null,
    retryAfter: string | undefined;
  const disabled = !source.enabled || !!source.deleted_at;
  if (disabled) error = "Endpoint is disabled or deleted.";
  else {
    const body = JSON.stringify({
      id: source.id,
      type: source.type,
      data: source.payload,
      created_at: source.created_at,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const result = await send(
        String(source.url),
        body,
        {
          "content-type": "application/json",
          "user-agent": "HookRelay/0.1",
          "webhook-id": String(source.id),
          "webhook-timestamp": String(timestamp),
          "webhook-signature": signWebhook(
            decrypt(String(source.secret_encrypted)),
            String(source.id),
            timestamp,
            body,
          ),
        },
        config.DELIVERY_TIMEOUT_MS,
      );
      status = result.status;
      retryAfter = result.retryAfter;
      if (status < 200 || status >= 300)
        error = `Endpoint returned HTTP ${status}.`;
    } catch {
      error =
        "Delivery failed: connection, timeout, or endpoint security validation.";
    }
  }
  const succeeded = status !== null && status >= 200 && status < 300;
  const retry =
    !disabled &&
    !succeeded &&
    shouldRetry(status) &&
    job.attempt < config.MAX_ATTEMPTS;
  const next = new Date(
    Date.now() +
      retryDelay(
        job.attempt,
        status === 429 || status === 503 ? retryAfter : undefined,
      ),
  );
  await db.transaction(async (tx) => {
    const active = (
      await tx.execute(
        sql`SELECT id FROM deliveries WHERE id=${job.deliveryId} AND lock_token=${lock} FOR UPDATE`,
      )
    ).rows[0];
    if (!active) return;
    await tx.execute(
      sql`INSERT INTO delivery_attempts(delivery_id,generation,attempt,status_code,duration_ms,error) VALUES(${job.deliveryId},${job.generation},${job.attempt},${status},${Date.now() - started},${error})`,
    );
    await tx.execute(
      sql`UPDATE deliveries SET status=${succeeded ? "succeeded" : retry ? "pending" : "failed"},attempt_count=${job.attempt},last_status=${status},last_error=${error},next_attempt_at=${next},locked_until=NULL,lock_token=NULL,updated_at=now() WHERE id=${job.deliveryId}`,
    );
    if (retry)
      await tx.execute(
        sql`INSERT INTO outbox_events(delivery_id,generation,attempt,available_at) VALUES(${job.deliveryId},${job.generation},${job.attempt + 1},${next})`,
      );
  });
  return { succeeded, retry, status };
}
