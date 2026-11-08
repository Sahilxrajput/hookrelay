import type { Queue } from "bullmq";
import { db, sql } from "./db.js";
export async function publishPending(queue: Queue) {
  // Reconcile jobs after Redis loss or exhausted infrastructure retries. Delivery rows
  // and attempt numbers remain authoritative, so duplicate queue jobs are harmless.
  await db.execute(
    sql`UPDATE outbox_events o SET published_at=NULL FROM deliveries d WHERE o.delivery_id=d.id AND o.generation=d.generation AND o.attempt=d.attempt_count+1 AND d.status IN ('pending','processing') AND (d.locked_until IS NULL OR d.locked_until<now()) AND o.published_at<now()-interval '60 seconds'`,
  );
  await db.transaction(async (tx) => {
    const rows = (
      await tx.execute(
        sql`SELECT * FROM outbox_events WHERE published_at IS NULL AND available_at<=now() ORDER BY available_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
      )
    ).rows;
    for (const row of rows) {
      await queue.add(
        "deliver",
        {
          deliveryId: row.delivery_id,
          generation: row.generation,
          attempt: row.attempt,
        },
        { jobId: String(row.id) },
      );
      await tx.execute(
        sql`UPDATE outbox_events SET published_at=now() WHERE id=${row.id}`,
      );
    }
  });
}
