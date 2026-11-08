import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
dotenv({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});
export const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    APP_ORIGIN: z.string().url().default("http://localhost:3000"),
    PORT: z.coerce.number().default(4000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
    DELIVERY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(30000)
      .default(10000),
    MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    NODE_ENV: z.string().default("development"),
  })
  .parse(process.env);
const redis = new URL(config.REDIS_URL);
export const redisConnection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username || undefined,
  password: redis.password || undefined,
  db: Number(redis.pathname.slice(1) || 0),
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
  maxRetriesPerRequest: null,
};
