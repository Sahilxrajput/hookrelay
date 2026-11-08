import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Express } from "express";
import { config as dotenv } from "dotenv";
dotenv({ path: "../../.env", quiet: true });
const enabled = process.env.RUN_INTEGRATION === "1";
describe.skipIf(!enabled)("PostgreSQL API and delivery integration", () => {
  let app: Express,
    pool: pg.Pool,
    admin: pg.Pool,
    agent: ReturnType<typeof request.agent>,
    other: ReturnType<typeof request.agent>;
  let deliver: typeof import("../src/delivery.js").deliver;
  let project: string,
    key: string,
    endpoint: string,
    event: string,
    delivery: string;
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const origin = "http://localhost:3000";
  beforeAll(async () => {
    const original = process.env.DATABASE_URL!;
    admin = new pg.Pool({ connectionString: original });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(original);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.APP_ORIGIN = origin;
    ({ pool } = await import("../src/db.js"));
    await pool.query(
      readFileSync(
        new URL("../migrations/0001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    ({ app } = await import("../src/app.js"));
    ({ deliver } = await import("../src/delivery.js"));
    agent = request.agent(app);
    other = request.agent(app);
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
  it("registers and authenticates using a session", async () => {
    const result = await agent
      .post("/auth/register")
      .set("Origin", origin)
      .send({ email: "test@example.com", password: "correct-horse-battery" });
    expect(result.status).toBe(201);
    expect((await agent.get("/auth/me")).body.email).toBe("test@example.com");
    expect((await request(app).get("/projects")).status).toBe(401);
    expect(
      (await agent.post("/projects").send({ name: "forged" })).status,
    ).toBe(403);
  });
  it("creates a project and a hashed API key", async () => {
    const result = await agent
      .post("/projects")
      .set("Origin", origin)
      .send({ name: "Test project" });
    expect(result.status).toBe(201);
    project = result.body.id;
    const created = await agent
      .post(`/projects/${project}/keys`)
      .set("Origin", origin)
      .send({ name: "Test key" });
    expect(created.status).toBe(201);
    key = created.body.key;
    const stored = await pool.query("SELECT key_hash FROM api_keys");
    expect(stored.rows[0].key_hash).not.toBe(key);
    const list = await agent.get(`/projects/${project}/keys`);
    expect(list.body[0].key).toBeUndefined();
    expect(list.body[0].key_hash).toBeUndefined();
  });
  it("enforces tenant boundaries", async () => {
    await other
      .post("/auth/register")
      .set("Origin", origin)
      .send({ email: "other@example.com", password: "correct-horse-battery" });
    expect((await other.get(`/projects/${project}/events`)).status).toBe(404);
    expect(
      (
        await other
          .post(`/projects/${project}/keys`)
          .set("Origin", origin)
          .send({ name: "no" })
      ).status,
    ).toBe(404);
  });
  it("rejects private endpoints and stores encrypted signing secrets", async () => {
    const bad = await agent
      .post(`/projects/${project}/endpoints`)
      .set("Origin", origin)
      .send({ name: "Blocked", url: "http://127.0.0.1", subscriptions: ["*"] });
    expect(bad.status).toBe(400);
    const { encrypt } = await import("../src/crypto.js");
    const inserted = await pool.query(
      "INSERT INTO endpoints(project_id,name,url,secret_encrypted) VALUES($1,$2,$3,$4) RETURNING id",
      [
        project,
        "Receiver",
        "https://example.com/hook",
        encrypt("whsec_integration"),
      ],
    );
    endpoint = inserted.rows[0].id;
    await pool.query(
      "INSERT INTO endpoint_events(endpoint_id,event_type) VALUES($1,$2)",
      [endpoint, "order.created"],
    );
    const listed = await agent.get(`/projects/${project}/endpoints`);
    expect(listed.body[0].secret_encrypted).toBeUndefined();
  });
  it("ingests concurrent idempotent events atomically with a single fan-out", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/v1/events")
          .set("Authorization", `Bearer ${key}`)
          .set("Idempotency-Key", "order-123")
          .send({ type: "order.created", data: { id: 123 } }),
      ),
    );
    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(4);
    event = responses[0].body.id;
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect((await pool.query("SELECT * FROM outbox_events")).rowCount).toBe(1);
    delivery = (await pool.query("SELECT id FROM deliveries")).rows[0].id;
    const conflict = await request(app)
      .post("/v1/events")
      .set("Authorization", `Bearer ${key}`)
      .set("Idempotency-Key", "order-123")
      .send({ type: "order.created", data: { id: 999 } });
    expect(conflict.status).toBe(409);
  });
  it("does not fan out unsubscribed events", async () => {
    const res = await request(app)
      .post("/v1/events")
      .set("Authorization", `Bearer ${key}`)
      .send({ type: "other.event", data: {} });
    expect(res.status).toBe(202);
    expect(
      (
        await pool.query("SELECT id FROM deliveries WHERE event_id=$1", [
          res.body.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("signs a delivery and schedules a rate-limited retry transactionally", async () => {
    const { verifyWebhook } = await import("@hookrelay/sdk");
    const send = vi.fn(
      async (_url: string, body: string, headers: Record<string, string>) => {
        expect(
          verifyWebhook(
            "whsec_integration",
            event,
            headers["webhook-timestamp"],
            headers["webhook-signature"],
            body,
          ),
        ).toBe(true);
        return { status: 429, retryAfter: "120" };
      },
    );
    await deliver({ deliveryId: delivery, generation: 0, attempt: 1 }, send);
    const row = (
      await pool.query("SELECT * FROM deliveries WHERE id=$1", [delivery])
    ).rows[0];
    expect(row.status).toBe("pending");
    expect(row.next_attempt_at.getTime() - Date.now()).toBeGreaterThan(115000);
    expect(
      (await pool.query("SELECT * FROM outbox_events WHERE attempt=2"))
        .rowCount,
    ).toBe(1);
    await deliver({ deliveryId: delivery, generation: 0, attempt: 1 }, send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("moves a permanent error to the DLQ and preserves attempts on replay", async () => {
    await pool.query(
      "UPDATE deliveries SET next_attempt_at=now() WHERE id=$1",
      [delivery],
    );
    await deliver(
      { deliveryId: delivery, generation: 0, attempt: 2 },
      async () => ({ status: 400, retryAfter: undefined }),
    );
    const dlq = await agent.get(`/projects/${project}/dlq`);
    expect(dlq.body[0].id).toBe(delivery);
    const replay = await agent
      .post(`/projects/${project}/deliveries/${delivery}/replay`)
      .set("Origin", origin)
      .send({});
    expect(replay.status).toBe(202);
    expect(replay.body.generation).toBe(1);
    expect((await pool.query("SELECT * FROM delivery_attempts")).rowCount).toBe(
      2,
    );
    const stale = vi.fn(async () => ({ status: 200, retryAfter: undefined }));
    await deliver({ deliveryId: delivery, generation: 0, attempt: 2 }, stale);
    expect(stale).not.toHaveBeenCalled();
    await deliver(
      { deliveryId: delivery, generation: 1, attempt: 1 },
      async () => ({ status: 204, retryAfter: undefined }),
    );
    const detail = await agent.get(`/projects/${project}/events/${event}`);
    expect(detail.body.deliveries[0].status).toBe("succeeded");
    expect(detail.body.attempts).toHaveLength(3);
    expect(detail.body.replays).toHaveLength(1);
  });
  it("stops disabled endpoints before network delivery", async () => {
    const ev = await request(app)
      .post("/v1/events")
      .set("Authorization", `Bearer ${key}`)
      .send({ type: "order.created", data: { id: 456 } });
    const id = (
      await pool.query("SELECT id FROM deliveries WHERE event_id=$1", [
        ev.body.id,
      ])
    ).rows[0].id;
    await agent
      .patch(`/projects/${project}/endpoints/${endpoint}`)
      .set("Origin", origin)
      .send({ enabled: false });
    const send = vi.fn(async () => ({ status: 200, retryAfter: undefined }));
    await deliver({ deliveryId: id, generation: 0, attempt: 1 }, send);
    expect(send).not.toHaveBeenCalled();
    expect(
      (await pool.query("SELECT status FROM deliveries WHERE id=$1", [id]))
        .rows[0].status,
    ).toBe("failed");
  });
  it("recovers an expired processing lease and prevents concurrent sends", async () => {
    await pool.query("UPDATE endpoints SET enabled=true WHERE id=$1", [
      endpoint,
    ]);
    const ev = await request(app)
      .post("/v1/events")
      .set("Authorization", `Bearer ${key}`)
      .send({ type: "order.created", data: { id: 789 } });
    const id = (
      await pool.query("SELECT id FROM deliveries WHERE event_id=$1", [
        ev.body.id,
      ])
    ).rows[0].id;
    await pool.query(
      "UPDATE deliveries SET status='processing',locked_until=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    const send = vi.fn(async () => ({ status: 200, retryAfter: undefined }));
    await Promise.all([
      deliver({ deliveryId: id, generation: 0, attempt: 1 }, send),
      deliver({ deliveryId: id, generation: 0, attempt: 1 }, send),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("returns analytics and rejects revoked keys", async () => {
    const stats = await agent.get(`/projects/${project}/stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.succeeded).toBe(2);
    const list = await agent.get(`/projects/${project}/keys`);
    await agent
      .delete(`/projects/${project}/keys/${list.body[0].id}`)
      .set("Origin", origin);
    expect(
      (
        await request(app)
          .post("/v1/events")
          .set("Authorization", `Bearer ${key}`)
          .send({ type: "order.created", data: {} })
      ).status,
    ).toBe(401);
  });
  it("publishes through real Redis and recovers a lost queue job", async () => {
    const { Queue, Worker } = await import("bullmq");
    const { redisConnection } = await import("../src/config.js");
    const { publishPending } = await import("../src/outbox.js");
    const name = `integration-${randomUUID()}`;
    const queue = new Queue(name, {
      connection: redisConnection,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    });
    let worker: InstanceType<typeof Worker> | undefined;
    try {
      const ev = await agent
        .post(`/projects/${project}/events`)
        .set("Origin", origin)
        .send({ type: "order.created", data: { queue_test: true } });
      expect(ev.status).toBe(202);
      const id = (
        await pool.query("SELECT id FROM deliveries WHERE event_id=$1", [
          ev.body.id,
        ])
      ).rows[0].id;
      await publishPending(queue);
      expect(await queue.getWaitingCount()).toBeGreaterThan(0);
      // Simulate Redis loss, then advance the reconciliation threshold in PostgreSQL.
      await queue.drain();
      await pool.query(
        "UPDATE outbox_events SET published_at=now()-interval '61 seconds' WHERE delivery_id=$1",
        [id],
      );
      await publishPending(queue);
      const send = vi.fn(async () => ({ status: 204, retryAfter: undefined }));
      worker = new Worker(name, (job) => deliver(job.data, send), {
        connection: redisConnection,
        concurrency: 2,
      });
      await vi.waitFor(
        async () => {
          expect(
            (
              await pool.query("SELECT status FROM deliveries WHERE id=$1", [
                id,
              ])
            ).rows[0].status,
          ).toBe("succeeded");
        },
        { timeout: 10000, interval: 100 },
      );
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await worker?.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 15000);
  it("exhausts network failures into the DLQ after the configured limit", async () => {
    const { config } = await import("../src/config.js");
    const ev = await agent
      .post(`/projects/${project}/events`)
      .set("Origin", origin)
      .send({ type: "order.created", data: { timeout_test: true } });
    const id = (
      await pool.query("SELECT id FROM deliveries WHERE event_id=$1", [
        ev.body.id,
      ])
    ).rows[0].id;
    for (let attempt = 1; attempt <= config.MAX_ATTEMPTS; attempt++) {
      await pool.query(
        "UPDATE deliveries SET next_attempt_at=now() WHERE id=$1",
        [id],
      );
      await deliver({ deliveryId: id, generation: 0, attempt }, async () => {
        throw new Error("Timeout");
      });
    }

    const row = (
      await pool.query(
        "SELECT status,attempt_count FROM deliveries WHERE id=$1",
        [id],
      )
    ).rows[0];
    expect(row.status).toBe("failed");
    expect(row.attempt_count).toBe(config.MAX_ATTEMPTS);
    expect(
      (
        await pool.query(
          "SELECT id FROM outbox_events WHERE delivery_id=$1 AND attempt>$2",
          [id, config.MAX_ATTEMPTS],
        )
      ).rowCount,
    ).toBe(0);
  });
});
