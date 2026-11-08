import { db, sql } from "./db.js";
import { hash } from "./crypto.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function ingest(
  projectId: string,
  type: string,
  data: Record<string, unknown>,
  idempotencyKey?: string,
  onlyEndpoint?: string,
) {
  const fingerprint = hash(canonical({ type, data }));
  return db.transaction(async (tx) => {
    const inserted = await tx.execute(
      sql`INSERT INTO events(project_id,type,payload,idempotency_key,request_hash) VALUES(${projectId},${type},${JSON.stringify(data)}::jsonb,${idempotencyKey ?? null},${fingerprint}) ON CONFLICT(project_id,idempotency_key) DO NOTHING RETURNING id`,
    );
    if (!inserted.rows.length) {
      const existing = (
        await tx.execute(
          sql`SELECT id,request_hash FROM events WHERE project_id=${projectId} AND idempotency_key=${idempotencyKey}`,
        )
      ).rows[0];
      if (existing.request_hash !== fingerprint)
        throw new HttpError(
          409,
          "This idempotency key was already used with a different event.",
        );
      return { id: existing.id as string, duplicate: true };
    }
    const id = inserted.rows[0].id as string;
    const endpoints = (
      await tx.execute(
        sql`SELECT e.id FROM endpoints e WHERE e.project_id=${projectId} AND e.enabled AND e.deleted_at IS NULL AND ${onlyEndpoint ? sql`e.id=${onlyEndpoint}` : sql`EXISTS(SELECT 1 FROM endpoint_events s WHERE s.endpoint_id=e.id AND s.event_type IN (${type},'*'))`}`,
      )
    ).rows;
    for (const endpoint of endpoints) {
      const delivery = (
        await tx.execute(
          sql`INSERT INTO deliveries(event_id,endpoint_id) VALUES(${id},${endpoint.id}) RETURNING id`,
        )
      ).rows[0];
      await tx.execute(
        sql`INSERT INTO outbox_events(delivery_id,generation,attempt) VALUES(${delivery.id},0,1)`,
      );
    }
    return { id, duplicate: false };
  });
}
