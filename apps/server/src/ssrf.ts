import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";

export function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export function parseEndpoint(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error(
      "Use an HTTP(S) URL on port 80 or 443 without credentials or fragments.",
    );
  return url;
}
export async function resolveEndpoint(value: string) {
  const url = parseEndpoint(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Endpoint DNS lookup timed out.")),
        5000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new Error("Endpoint must resolve only to public IP addresses.");
  return { url, address: addresses[0] };
}
/** Pin the validated DNS result for this request; preserve the original Host and TLS name. */
export async function sendWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeout: number,
) {
  const target = await resolveEndpoint(url);
  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [target.address]);
        else callback(null, target.address.address, target.address.family);
      },
    },
  });
  try {
    const result = await request(target.url, {
      method: "POST",
      body,
      headers,
      dispatcher: agent,
      headersTimeout: timeout,
      bodyTimeout: timeout,
      signal: AbortSignal.timeout(timeout),
    });
    const status = result.statusCode;
    const retryAfter = result.headers["retry-after"];
    // Receiver bodies can contain secrets or unbounded data. Do not persist or drain them.
    result.body.destroy();
    return {
      status,
      retryAfter: Array.isArray(retryAfter) ? retryAfter[0] : retryAfter,
    };
  } finally {
    await agent.destroy();
  }
}
