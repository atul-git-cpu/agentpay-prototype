export function DbError({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  const missing = /DATABASE_URL/.test(msg);
  return (
    <div className="empty" role="alert">
      <h3>This page can&apos;t load its data right now</h3>
      <p>
        {missing
          ? "The site isn't connected to its database. In Vercel, add DATABASE_URL under Settings, Environment Variables (use the read-only connection string from npm run dashboard:setup), then redeploy."
          : `The database didn't respond: ${msg}. Try again in a minute.`}
      </p>
    </div>
  );
}
