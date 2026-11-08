import { Worker } from "bullmq";
import { createServer } from "node:http";
import { Registry, Counter, collectDefaultMetrics } from "prom-client";
import { config, redisConnection } from "./config.js";
import { deliver } from "./delivery.js";
import { pool } from "./db.js";
import { logger } from "./log.js";
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const deliveries = new Counter({
  name: "hookrelay_delivery_attempts_total",
  help: "Delivery attempts",
  labelNames: ["outcome"],
  registers: [registry],
});
const worker = new Worker(
  "hookrelay-deliveries",
  async (job) => {
    const result = await deliver(job.data);
    if (result)
      deliveries.inc({
        outcome: result.succeeded
          ? "succeeded"
          : result.retry
            ? "retry"
            : "failed",
      });
  },
  { connection: redisConnection, concurrency: config.WORKER_CONCURRENCY },
);
worker.on("failed", (job) =>
  logger.error(
    { jobId: job?.id },
    "Delivery job infrastructure failure; will be reconciled.",
  ),
);
worker.on("error", () => logger.error("Worker connection error."));
const metrics = createServer(async (req, res) => {
  if (req.url != "/metrics") {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}).listen(9092, "0.0.0.0");
logger.info(
  { concurrency: config.WORKER_CONCURRENCY },
  "Delivery worker started",
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await worker.close();
    metrics.close();
    await pool.end();
    process.exit(0);
  });
