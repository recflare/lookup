import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

/**
 * Open a Postgres client for the current request via Hyperdrive.
 *
 * Hyperdrive owns the real connection pool, so creating a client per request
 * is cheap and is the recommended pattern. Do not cache this at module scope:
 * Worker isolates are shared across requests.
 */
export function createDb(env: Env): Sql {
  return postgres(connectionUrl(env.HYPERDRIVE), {
    // Workers cap concurrent outbound connections, and in local development
    // every connection is a real session on the database's pooler, which
    // Supabase caps per plan (session-mode "max clients"). Keep this small.
    max: 3,
    // Skip the extra round-trip to fetch array type OIDs. Enable if the
    // schema uses array columns and you need them parsed.
    fetch_types: false,
    // Prepared statements let Hyperdrive cache query plans.
    prepare: true,
    connection: {
      application_name: "roomindex",
    },
  });
}

/**
 * Rebuild the connection URL with the user and password percent-encoded.
 *
 * `env.HYPERDRIVE.connectionString` inserts the credentials raw. In production
 * they are URL-safe tokens, but in local development (`wrangler dev`) they are
 * the real database credentials, and a password with characters such as
 * `?`, `@`, `|` or `\` makes the string unparseable by the driver.
 */
function connectionUrl(hd: Hyperdrive): string {
  const raw = hd.connectionString;
  // Everything from the path onward, e.g. "/postgres?sslmode=disable".
  const pathAndQuery = raw.slice(raw.lastIndexOf("/"));
  const scheme = raw.slice(0, raw.indexOf("://"));
  return `${scheme}://${encodeURIComponent(hd.user)}:${encodeURIComponent(hd.password)}@${hd.host}:${hd.port}${pathAndQuery}`;
}
