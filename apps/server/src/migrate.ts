import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
const connection = await pool.connect();
try {
  await connection.query("SELECT pg_advisory_lock(741283)");
  await connection.query(
    "CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (await connection.query("SELECT 1 FROM migrations WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    await connection.query("BEGIN");
    try {
      await connection.query(readFileSync(dir + name, "utf8"));
      await connection.query("INSERT INTO migrations(name) VALUES($1)", [name]);
      await connection.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await connection.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await connection.query("SELECT pg_advisory_unlock(741283)");
  connection.release();
  await pool.end();
}
