import { createServer } from "node:http";
import { app, registry } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { logger } from "./log.js";
const server = app.listen(config.PORT, () =>
  logger.info({ port: config.PORT }, "HookRelay API listening"),
);
const metrics = createServer(async (req, res) => {
  if (req.url != "/metrics") {
    res.writeHead(404).end();
    return;
  }
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}).listen(9091, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(async () => {
      metrics.close();
      await pool.end();
      process.exit(0);
    });
  });
