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

  const pool = new pg.Pool({ connectionString: url, max: 3 });
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
