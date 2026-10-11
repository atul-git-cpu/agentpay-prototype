export function DbError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  const missing = /DATABASE_URL/.test(msg);
  return (
    <div className="empty" role="alert">
      <h3>The dashboard can't reach its database</h3>
      <p>
        {missing
          ? "DATABASE_URL isn't set. In Vercel, add it under Settings → Environment Variables (use the read-only connection string from `npm run dashboard:setup`), then redeploy."
          : `Connecting failed: ${msg}`}
      </p>
    </div>
  );
}
