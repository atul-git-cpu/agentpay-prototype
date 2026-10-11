/**
 * Postgres access. Ledger code depends only on the small `Sql` interface below,
 * so it runs the same on Neon (via node-postgres) and on an in-memory Postgres in tests.
 */
import pg from "pg";

export type Row = Record<string, unknown>;
export type Sql = <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]>;

export type Database = {
  sql: Sql;
  /** Runs fn inside BEGIN/COMMIT; rolls back on error. */
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

let shared: Database | undefined;

/** Connects to DATABASE_URL (Neon). One pool per process. */
export function getDatabase(): Database {
  if (shared) return shared;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Missing DATABASE_URL in .env (your Neon connection string). See README Phase 3.");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid URL. In .env it must be exactly\n" +
        "  DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require\n" +
        "with no quotes, no `psql` prefix and only one DATABASE_URL line.",
    );
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) {
    throw new Error(
      `DATABASE_URL looks wrong (protocol "${parsed.protocol}", host "${parsed.hostname}"). ` +
        "Copy the Connection string from Neon's Connect dialog; the host ends in neon.tech.",
    );
  }
  // Neon uses valid public certificates: verify them explicitly (also avoids pg's sslmode warning).
  // sslmode=disable is only for a local test database.
  const noSsl = parsed.searchParams.get("sslmode") === "disable";
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  const pool = new pg.Pool({
    connectionString: parsed.toString(), ssl: noSsl ? false : { rejectUnauthorized: true }, max: 3,
    idleTimeoutMillis: 10_000,
  });
  const sql: Sql = async (text, params) => (await pool.query(text, params as unknown[])).rows;

  shared = {
    sql,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(async (text, params) => (await client.query(text, params as unknown[])).rows);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return shared;
}
