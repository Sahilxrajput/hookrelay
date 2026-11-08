import { publishPending } from "./outbox.js";
import { db, sql, pool } from "./db.js";
import { queue } from "./queue.js";
import { logger } from "./log.js";
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
  });
logger.info("Outbox publisher started");
let cleanupAt = 0;
while (!stopped) {
  try {
    await publishPending(queue);
    if (Date.now() - cleanupAt > 3600000) {
      await db.execute(sql`DELETE FROM sessions WHERE expires_at<now()`);
      cleanupAt = Date.now();
    }
  } catch {
    logger.error("Outbox publication failed; retrying.");
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
await queue.close();
await pool.end();
