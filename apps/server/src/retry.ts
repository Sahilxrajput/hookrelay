export const shouldRetry = (status: number | null) =>
  status === null || status === 408 || status === 429 || status >= 500;
export function retryDelay(
  attempt: number,
  retryAfter?: string,
  now = Date.now(),
  random = Math.random,
): number {
  const backoff =
    Math.min(3600000, 1000 * 2 ** Math.min(attempt, 12)) *
    (0.5 + random() * 0.5);
  const server = retryAfter
    ? /^\d+(\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter) * 1000
      : Date.parse(retryAfter) - now
    : 0;
  // Bound hostile Retry-After headers to 24 hours.
  return Math.ceil(
    Math.max(backoff, Number.isFinite(server) ? Math.min(server, 86400000) : 0),
  );
}
