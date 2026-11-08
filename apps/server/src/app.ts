import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db, sql } from "./db.js";
import { config } from "./config.js";
import { token, hash, hashPassword, checkPassword, encrypt } from "./crypto.js";
import { resolveEndpoint } from "./ssrf.js";
import { HttpError, ingest } from "./events.js";
import { logger } from "./log.js";
import { Registry, collectDefaultMetrics, Counter } from "prom-client";

export const app = express();
export const registry = new Registry();
collectDefaultMetrics({ register: registry });
const requests = new Counter({
  name: "hookrelay_http_requests_total",
  help: "HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});
app.disable("x-powered-by");
app.use(helmet(), express.json({ limit: "256kb" }), cookieParser());
app.use((req, res, next) => {
  res.on("finish", () =>
    requests.inc({
      method: req.method,
      route: req.route?.path || "unmatched",
      status: String(res.statusCode),
    }),
  );
  next();
});
app.use(
  rateLimit({
    windowMs: 60000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.get("/health", async (_req, res) => {
  await db.execute(sql`SELECT 1`);
  res.json({ status: "ok" });
});
// The metrics listener binds separately; no public metrics route.
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
});
const uuid = z.uuid();
const name = z.string().trim().min(1).max(80);
const eventType = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);
const eventInput = z.object({
  type: eventType,
  data: z.record(z.string(), z.unknown()),
});
const authLimit = rateLimit({
  windowMs: 900000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.NODE_ENV === "production",
  path: "/",
};
app.use((req, _res, next) => {
  if (
    ["POST", "PATCH", "DELETE", "PUT"].includes(req.method) &&
    !req.path.startsWith("/v1/")
  ) {
    if (req.get("origin") !== new URL(config.APP_ORIGIN).origin)
      throw new HttpError(403, "Request origin is not allowed.");
  }
  next();
});
async function session(res: Response, userId: unknown) {
  const value = token();
  await db.execute(
    sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${hash(value)},${userId},now()+interval '7 days')`,
  );
  res.cookie("hr_session", value, { ...cookieOptions, maxAge: 7 * 86400000 });
}
app.post("/auth/register", authLimit, async (req, res) => {
  const input = credentials.parse(req.body);
  const password = await hashPassword(input.password);
  const rows = (
    await db.execute(
      sql`INSERT INTO users(email,password_hash) VALUES(${input.email},${password}) ON CONFLICT(email) DO NOTHING RETURNING id,email`,
    )
  ).rows;
  if (!rows.length)
    throw new HttpError(409, "An account with this email already exists.");
  await session(res, rows[0].id);
  res.status(201).json(rows[0]);
});
app.post("/auth/login", authLimit, async (req, res) => {
  const input = credentials.parse(req.body);
  const user = (
    await db.execute(sql`SELECT * FROM users WHERE email=${input.email}`)
  ).rows[0];
  // Use scrypt even for unknown emails to reduce account timing differences.
  const valid = await checkPassword(
    input.password,
    user
      ? String(user.password_hash)
      : "00000000000000000000000000000000:" + "00".repeat(64),
  );
  if (!user || !valid) throw new HttpError(401, "Invalid email or password.");
  await session(res, user.id);
  res.json({ id: user.id, email: user.email });
});
app.post("/auth/logout", async (req, res) => {
  if (req.cookies.hr_session)
    await db.execute(
      sql`DELETE FROM sessions WHERE token_hash=${hash(req.cookies.hr_session)}`,
    );
  res.clearCookie("hr_session", cookieOptions).status(204).end();
});
async function userAuth(req: Request, res: Response, next: NextFunction) {
  const user =
    req.cookies.hr_session &&
    (
      await db.execute(
        sql`SELECT u.id,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=${hash(req.cookies.hr_session)} AND s.expires_at>now()`,
      )
    ).rows[0];
  if (!user) throw new HttpError(401, "Sign in to continue.");
  res.locals.user = user;
  next();
}
app.get("/auth/me", userAuth, (_req, res) => res.json(res.locals.user));
app.post("/v1/events", async (req, res) => {
  const value = req
    .get("authorization")
    ?.match(/^Bearer (hr_live_[A-Za-z0-9_-]+)$/)?.[1];
  if (!value) throw new HttpError(401, "A valid Bearer API key is required.");
  const key = (
    await db.execute(
      sql`SELECT project_id FROM api_keys WHERE key_hash=${hash(value)} AND revoked_at IS NULL`,
    )
  ).rows[0];
  if (!key) throw new HttpError(401, "API key is invalid or revoked.");
  const input = eventInput.parse(req.body);
  const idempotency = req.get("idempotency-key");
  if (idempotency !== undefined) z.string().min(1).max(200).parse(idempotency);
  const result = await ingest(
    String(key.project_id),
    input.type,
    input.data,
    idempotency,
  );
  res.status(result.duplicate ? 200 : 202).json(result);
});
app.use("/projects", userAuth);
app.get("/projects", async (_req, res) =>
  res.json(
    (
      await db.execute(
        sql`SELECT id,name,created_at FROM projects WHERE user_id=${res.locals.user.id} ORDER BY created_at`,
      )
    ).rows,
  ),
);
app.post("/projects", async (req, res) =>
  res
    .status(201)
    .json(
      (
        await db.execute(
          sql`INSERT INTO projects(user_id,name) VALUES(${res.locals.user.id},${name.parse(req.body.name)}) RETURNING id,name,created_at`,
        )
      ).rows[0],
    ),
);
app.use("/projects/:projectId", async (req, res, next) => {
  const id = uuid.parse(req.params.projectId);
  const project = (
    await db.execute(
      sql`SELECT id FROM projects WHERE id=${id} AND user_id=${res.locals.user.id}`,
    )
  ).rows[0];
  if (!project) throw new HttpError(404, "Project not found.");
  res.locals.projectId = id;
  next();
});
app.get("/projects/:projectId/keys", async (_req, res) =>
  res.json(
    (
      await db.execute(
        sql`SELECT id,name,prefix,revoked_at,created_at FROM api_keys WHERE project_id=${res.locals.projectId} ORDER BY created_at DESC`,
      )
    ).rows,
  ),
);
app.post("/projects/:projectId/keys", async (req, res) => {
  const key = token("hr_live_");
  const row = (
    await db.execute(
      sql`INSERT INTO api_keys(project_id,name,prefix,key_hash) VALUES(${res.locals.projectId},${name.parse(req.body.name)},${key.slice(0, 16)},${hash(key)}) RETURNING id,name,prefix,created_at`,
    )
  ).rows[0];
  res.status(201).json({ ...row, key });
});
app.delete("/projects/:projectId/keys/:id", async (req, res) => {
  const result = await db.execute(
    sql`UPDATE api_keys SET revoked_at=now() WHERE id=${uuid.parse(req.params.id)} AND project_id=${res.locals.projectId} AND revoked_at IS NULL RETURNING id`,
  );
  if (!result.rows.length) throw new HttpError(404, "Active key not found.");
  res.status(204).end();
});
app.get("/projects/:projectId/endpoints", async (_req, res) =>
  res.json(
    (
      await db.execute(
        sql`SELECT e.id,e.name,e.url,e.enabled,e.created_at,COALESCE(array_agg(s.event_type) FILTER(WHERE s.event_type IS NOT NULL),'{}') AS subscriptions FROM endpoints e LEFT JOIN endpoint_events s ON s.endpoint_id=e.id WHERE e.project_id=${res.locals.projectId} AND e.deleted_at IS NULL GROUP BY e.id ORDER BY e.created_at DESC`,
      )
    ).rows,
  ),
);
app.post("/projects/:projectId/endpoints", async (req, res) => {
  const input = z
    .object({
      name,
      url: z.url().max(2048),
      subscriptions: z
        .array(z.union([eventType, z.literal("*")]))
        .min(1)
        .max(50),
    })
    .parse(req.body);
  try {
    await resolveEndpoint(input.url);
  } catch {
    throw new HttpError(
      400,
      "URL must resolve to a public HTTP(S) endpoint on port 80 or 443.",
    );
  }
  const secret = token("whsec_");
  const endpoint = await db.transaction(async (tx) => {
    const row = (
      await tx.execute(
        sql`INSERT INTO endpoints(project_id,name,url,secret_encrypted) VALUES(${res.locals.projectId},${input.name},${input.url},${encrypt(secret)}) RETURNING id,name,url,enabled,created_at`,
      )
    ).rows[0];
    for (const subscription of new Set(input.subscriptions))
      await tx.execute(
        sql`INSERT INTO endpoint_events(endpoint_id,event_type) VALUES(${row.id},${subscription})`,
      );
    return row;
  });
  res
    .status(201)
    .json({ ...endpoint, secret, subscriptions: input.subscriptions });
});
app.patch("/projects/:projectId/endpoints/:id", async (req, res) => {
  const enabled = z.boolean().parse(req.body.enabled);
  const result = await db.execute(
    sql`UPDATE endpoints SET enabled=${enabled} WHERE id=${uuid.parse(req.params.id)} AND project_id=${res.locals.projectId} AND deleted_at IS NULL RETURNING id,enabled`,
  );
  if (!result.rows.length) throw new HttpError(404, "Endpoint not found.");
  res.json(result.rows[0]);
});
app.delete("/projects/:projectId/endpoints/:id", async (req, res) => {
  const result = await db.execute(
    sql`UPDATE endpoints SET enabled=false,deleted_at=now() WHERE id=${uuid.parse(req.params.id)} AND project_id=${res.locals.projectId} AND deleted_at IS NULL RETURNING id`,
  );
  if (!result.rows.length) throw new HttpError(404, "Endpoint not found.");
  res.status(204).end();
});
app.post("/projects/:projectId/endpoints/:id/test", async (req, res) => {
  const endpoint = (
    await db.execute(
      sql`SELECT id FROM endpoints WHERE id=${uuid.parse(req.params.id)} AND project_id=${res.locals.projectId} AND enabled AND deleted_at IS NULL`,
    )
  ).rows[0];
  if (!endpoint) throw new HttpError(404, "Enabled endpoint not found.");
  res
    .status(202)
    .json(
      await ingest(
        res.locals.projectId,
        "hookrelay.test",
        { message: "Your webhook is connected.", test: true },
        undefined,
        String(endpoint.id),
      ),
    );
});
app.post("/projects/:projectId/events", async (req, res) => {
  const input = eventInput.parse(req.body);
  res
    .status(202)
    .json(await ingest(res.locals.projectId, input.type, input.data));
});
app.get("/projects/:projectId/events", async (req, res) => {
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .default(0)
    .parse(req.query.offset);
  const q = z.string().max(100).default("").parse(req.query.q);
  res.json(
    (
      await db.execute(
        sql`SELECT e.id,e.type,e.payload,e.created_at,count(d.id)::int AS deliveries,count(d.id) FILTER(WHERE d.status='succeeded')::int AS succeeded,count(d.id) FILTER(WHERE d.status='failed')::int AS failed FROM events e LEFT JOIN deliveries d ON d.event_id=e.id WHERE e.project_id=${res.locals.projectId} AND (e.type ILIKE ${"%" + q + "%"} OR e.id::text ILIKE ${"%" + q + "%"}) GROUP BY e.id ORDER BY e.created_at DESC LIMIT 25 OFFSET ${offset}`,
      )
    ).rows,
  );
});
app.get("/projects/:projectId/events/:id", async (req, res) => {
  const event = (
    await db.execute(
      sql`SELECT * FROM events WHERE id=${uuid.parse(req.params.id)} AND project_id=${res.locals.projectId}`,
    )
  ).rows[0];
  if (!event) throw new HttpError(404, "Event not found.");
  const deliveries = (
    await db.execute(
      sql`SELECT d.*,ep.name AS endpoint_name,ep.url FROM deliveries d JOIN endpoints ep ON ep.id=d.endpoint_id WHERE d.event_id=${event.id} ORDER BY d.created_at`,
    )
  ).rows;
  const attempts = (
    await db.execute(
      sql`SELECT a.* FROM delivery_attempts a JOIN deliveries d ON d.id=a.delivery_id WHERE d.event_id=${event.id} ORDER BY a.created_at`,
    )
  ).rows;
  const replays = (
    await db.execute(
      sql`SELECT r.id,r.delivery_id,r.generation,r.created_at FROM replays r JOIN deliveries d ON d.id=r.delivery_id WHERE d.event_id=${event.id} ORDER BY r.created_at`,
    )
  ).rows;
  res.json({ ...event, deliveries, attempts, replays });
});
app.get("/projects/:projectId/dlq", async (req, res) => {
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .default(0)
    .parse(req.query.offset);
  res.json(
    (
      await db.execute(
        sql`SELECT d.*,e.type,ep.name AS endpoint_name FROM deliveries d JOIN events e ON e.id=d.event_id JOIN endpoints ep ON ep.id=d.endpoint_id WHERE e.project_id=${res.locals.projectId} AND d.status='failed' ORDER BY d.updated_at DESC LIMIT 25 OFFSET ${offset}`,
      )
    ).rows,
  );
});
app.post("/projects/:projectId/deliveries/:id/replay", async (req, res) => {
  const result = await db.transaction(async (tx) => {
    const row = (
      await tx.execute(
        sql`SELECT d.* FROM deliveries d JOIN events e ON e.id=d.event_id JOIN endpoints ep ON ep.id=d.endpoint_id WHERE d.id=${uuid.parse(req.params.id)} AND e.project_id=${res.locals.projectId} AND d.status='failed' AND ep.enabled AND ep.deleted_at IS NULL FOR UPDATE OF d`,
      )
    ).rows[0];
    if (!row)
      throw new HttpError(
        409,
        "Only failed deliveries to an enabled endpoint can be replayed.",
      );
    const generation = Number(row.generation) + 1;
    await tx.execute(
      sql`UPDATE deliveries SET status='pending',generation=${generation},attempt_count=0,next_attempt_at=now(),locked_until=NULL,lock_token=NULL,last_error=NULL,last_status=NULL,updated_at=now() WHERE id=${row.id}`,
    );
    await tx.execute(
      sql`INSERT INTO replays(delivery_id,user_id,generation) VALUES(${row.id},${res.locals.user.id},${generation})`,
    );
    await tx.execute(
      sql`INSERT INTO outbox_events(delivery_id,generation,attempt) VALUES(${row.id},${generation},1)`,
    );
    return { id: row.id, generation };
  });
  res.status(202).json(result);
});
app.get("/projects/:projectId/stats", async (_req, res) => {
  const project = res.locals.projectId;
  const totals = (
    await db.execute(
      sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE d.status='succeeded')::int AS succeeded,count(*) FILTER(WHERE d.status='failed')::int AS failed,count(*) FILTER(WHERE d.status IN ('pending','processing'))::int AS pending FROM deliveries d JOIN events e ON e.id=d.event_id WHERE e.project_id=${project}`,
    )
  ).rows[0];
  const events = (
    await db.execute(
      sql`SELECT count(*)::int AS count FROM events WHERE project_id=${project}`,
    )
  ).rows[0];
  const latency = (
    await db.execute(
      sql`SELECT COALESCE(round(avg(a.duration_ms)),0)::int AS latency FROM delivery_attempts a JOIN deliveries d ON d.id=a.delivery_id JOIN events e ON e.id=d.event_id WHERE e.project_id=${project} AND a.created_at>now()-interval '24 hours' AND a.status_code BETWEEN 200 AND 299`,
    )
  ).rows[0];
  const timeline = (
    await db.execute(
      sql`SELECT date_trunc('hour',a.created_at) AS hour,count(*) FILTER(WHERE a.status_code BETWEEN 200 AND 299)::int AS succeeded,count(*) FILTER(WHERE a.status_code IS NULL OR a.status_code NOT BETWEEN 200 AND 299)::int AS failed FROM delivery_attempts a JOIN deliveries d ON d.id=a.delivery_id JOIN events e ON e.id=d.event_id WHERE e.project_id=${project} AND a.created_at>now()-interval '24 hours' GROUP BY 1 ORDER BY 1`,
    )
  ).rows;
  res.json({ ...totals, events: events.count, ...latency, timeline });
});
app.use((_req, _res, next) => next(new HttpError(404, "Route not found.")));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res
      .status(400)
      .json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    err.status === 413
  ) {
    res.status(413).json({ error: "Payload exceeds 256 KB." });
    return;
  }
  // Do not log SQL parameters, credentials, receiver bodies, or event payloads.
  logger.error(
    { errorType: err instanceof Error ? err.name : "unknown" },
    "Request failed",
  );
  res.status(500).json({ error: "An internal error occurred." });
});
