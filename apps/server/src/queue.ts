import { Queue } from "bullmq";
import { redisConnection } from "./config.js";
export const queue = new Queue("hookrelay-deliveries", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 20,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});
