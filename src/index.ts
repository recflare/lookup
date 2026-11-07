import { createDb } from "./db";
import { getRoom, searchByAccount, searchByBlob, searchByName } from "./queries";

/**
 * roomindex Worker.
 *
 * API:
 *   GET /api/health              - round-trips to Postgres through Hyperdrive
 *   GET /api/search?by=name&q=   - rooms whose name contains q (or id / source id)
 *   GET /api/search?by=blob&q=   - rooms owning a save, meta, or asset-bundle blob with key/hash q
 *   GET /api/search?by=account&q= - rooms created, owned, or saved by an account id (or username)
 *   GET /api/rooms/:id           - everything stored about one room
 * Everything else is served from ./public (static assets).
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return Response.json({ ok: true });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET") return error(405, "method not allowed");

    const sql = createDb(env);
    try {
      return await route(url, sql);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "request failed",
          path: url.pathname,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return error(500, "internal error");
    } finally {
      // Return the client's connections to Hyperdrive after the response is sent.
      ctx.waitUntil(sql.end({ timeout: 5 }));
    }
  },
} satisfies ExportedHandler<Env>;

type Sql = ReturnType<typeof createDb>;

async function route(url: URL, sql: Sql): Promise<Response> {
  const path = url.pathname;

  if (path === "/api/health") {
    const [row] = await sql<{ tables: number }[]>`
      select (select count(*)::int from pg_tables where schemaname = 'public') as tables
    `;
    return Response.json({ ok: true, tables: row?.tables ?? 0 });
  }

  if (path === "/api/search") {
    const q = url.searchParams.get("q")?.trim() ?? "";
    const by = url.searchParams.get("by") ?? "name";
    if (!q) return error(400, "q is required");
    if (q.length > 200) return error(400, "q is too long");
    if (by !== "name" && by !== "blob" && by !== "account") return error(400, "by must be name, blob, or account");
    const results =
      by === "name" ? await searchByName(sql, q)
      : by === "blob" ? await searchByBlob(sql, q)
      : await searchByAccount(sql, q);
    return cached({ by, q, count: results.length, results });
  }

  const roomMatch = /^\/api\/rooms\/(\d{1,19})$/.exec(path);
  if (roomMatch) {
    const detail = await getRoom(sql, roomMatch[1]!);
    if (!detail) return error(404, "room not found");
    return cached(detail);
  }

  return error(404, "not found");
}

function cached(body: unknown): Response {
  return Response.json(body, {
    headers: { "cache-control": "public, max-age=60" },
  });
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
