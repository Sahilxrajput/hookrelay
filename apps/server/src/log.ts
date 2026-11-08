import pino from "pino";
export const logger = pino({
  redact: [
    "password",
    "secret",
    "token",
    "apiKey",
    "authorization",
    "headers",
    "payload",
  ],
  level: process.env.LOG_LEVEL || "info",
});
