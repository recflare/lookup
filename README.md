# roomindex

Search archived Rec Room rooms by name, by blob key, or by account, and see everything
stored about them. A Cloudflare Worker serves a static UI from `public/` and a JSON API backed by a
Postgres database (Supabase in the original setup, but any Postgres works), connected
through Hyperdrive with the `postgres` (Postgres.js) driver.

## Layout

```
src/index.ts            fetch handler and API routes
src/queries.ts          search and room-detail SQL
src/blob.ts             normalises a pasted blob key / hash into the stored forms
src/db.ts               per-request Postgres client via Hyperdrive
public/                 the UI (index.html, app.js, styles.css), served as static assets
db/migrations/          idempotent SQL applied with `npm run db:migrate`
scripts/restore-dump.sh pg_restore wrapper for loading a database dump
scripts/migrate.sh      applies db/migrations/*.sql in order
scripts/deploy.sh       deploys with the Hyperdrive id taken from .env
.env.example            template for local configuration (copy to .env)
```

## Data model, briefly

A room has subrooms; each subroom has a few saves; each save is a blob
(`subroom_saves.data_blob_key`, like `13pcfb752scyh8j7eozjpqbsh.room`) with a base64
hash. Rooms also have a metadata blob (`rooms.meta_blob_key`, like `room/<key>.meta`).
Some saves were built from a unity asset (`subroom_saves.source_unity_asset_id`), which
has one CDN bundle per platform target (`unity_asset_bundles.asset_key`, like
`3iaehzyxfn0o7ua2dm22zsi1m.assetbundle`) and child subassets. Blob search resolves any
of these back to its room, and the UI highlights the matching save and bundle inside the room.

The expected schema is the one produced by the archive tooling: `rooms`, `subrooms`,
`subroom_saves`, `room_tags`, `room_roles`, `inventions`, `unity_assets`,
`unity_asset_bundles`, `unity_asset_subassets`, and optionally `accounts`,
`save_htr_files`, and `save_unity_assets`. Load it from a `pg_dump` archive with
`npm run db:restore -- path/to/backup.dump` (see below).

## Setup

```bash
npm install
npx skills experimental_install   # restores the Supabase agent skills from skills-lock.json
cp .env.example .env              # fill in the connection strings
npm run types                     # generates worker-configuration.d.ts (Env type)
npm run db:migrate                # adds the search indexes
npm run dev                       # http://localhost:8787
curl localhost:8787/api/health
```

### Database connection

Supabase offers two hosts. The direct one (`db.<project-ref>.supabase.co:5432`, user
`postgres`) is IPv6-only; from an IPv4-only machine use the session pooler
(`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<project-ref>`). Hyperdrive
runs on Cloudflare's network and can use either.

**Percent-encode the password** in the URLs in `.env`. A password with characters that
are invalid in a URL makes wrangler fail with `Invalid URL`:

```bash
node -p 'encodeURIComponent(process.argv[1])' 'raw-password-here'
```

`src/db.ts` also re-encodes the credentials it receives from the Hyperdrive binding,
because workerd's local binding inserts them raw into `connectionString`.

`wrangler dev` reads the Hyperdrive connection string for local development from
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in `.env`.

Supabase's session pooler allows only a handful of concurrent clients on small plans,
and in local development every Worker connection is one of them. The API opens at most
3 per request; if you see `max clients reached in session mode`, wait a moment or point
the Hyperdrive config for production at the direct host so it does not share the pooler
with local development.

### Loading a database dump

`scripts/restore-dump.sh` restores a pg_dump custom-format archive using `DATABASE_URL`
from the environment or `.env`. It passes `--no-owner --no-privileges` so a dump taken
under a different database role restores cleanly.

```bash
npm run db:restore -- path/to/backup.dump
# or, to drop and recreate objects that already exist:
npm run db:restore -- path/to/backup.dump --clean --if-exists
```

### Database indexes

`db/migrations/` adds pg_trgm (for `ILIKE` name search) and B-tree indexes on the blob
keys, hashes, and account columns. The migrations are idempotent:

```bash
npm run db:migrate
```

On Supabase, a database over the plan's disk limit is switched to read-only mode and
`create index` fails with "read-only transaction" until data is removed or the plan is
upgraded. Tables that may be dropped to save disk (`accounts`, `save_htr_files`,
`save_unity_assets`) are optional: the room-detail API checks for them per request and
leaves the related fields empty when they are missing.

## Deploying

Create the Hyperdrive config once. This stores the database credentials on Cloudflare,
not in the repo:

```bash
npx wrangler hyperdrive create roomindex-db \
  --connection-string="postgres://USER:ENCODED_PASSWORD@HOST:5432/postgres?sslmode=require"
```

Put the id it prints in `.env` as `HYPERDRIVE_ID`, then:

```bash
npm run deploy
```

`scripts/deploy.sh` substitutes the id into a temporary copy of `wrangler.jsonc`
(`wrangler.deploy.jsonc`, gitignored) and deploys from that, so the committed config
contains no account details. The deployed URL is public; put Cloudflare Access in front
of the Worker if the data should not be.

## Routes

| Route                          | Purpose                                                        |
|--------------------------------|----------------------------------------------------------------|
| `GET /`                        | The UI. State lives in the query string: `?by=blob&q=…&room=…` |
| `GET /health`                  | Liveness, no external calls                                    |
| `GET /api/health`              | Runs a query through Hyperdrive, reports table count           |
| `GET /api/search?by=name&q=…`  | Rooms whose name contains `q` (case-insensitive), or whose id / source id equals it. First 50. |
| `GET /api/search?by=blob&q=…`  | Rooms owning a subroom save, a room-meta blob, or a unity asset bundle whose key or hash is `q`. Accepts `abc`, `abc.room`, `room/abc.meta`, `abc.assetbundle`, or the base64 hash. |
| `GET /api/search?by=account&q=…` | Rooms an account created, holds a role in, created subrooms in, or saved in. `q` is an account id, or a username when the `accounts` table exists. First 200, creators first. |
| `GET /api/rooms/:id`           | Room row, tags, roles (first 500), subrooms with every save, each save's source unity asset with its bundles and subasset count, inventions created there (first 200), raw JSON. |

## Scripts

| Script               | Does                                                |
|----------------------|-----------------------------------------------------|
| `npm run dev`        | Local dev server                                    |
| `npm run deploy`     | Deploy to Cloudflare (Hyperdrive id from `.env`)    |
| `npm run types`      | Regenerate `Env` from wrangler config               |
| `npm run typecheck`  | Types + `tsc --noEmit`                              |
| `npm test`           | Run vitest in the Workers runtime                   |
| `npm run tail`       | Stream production logs                              |
| `npm run db:restore` | Restore a dump with pg_restore                      |
| `npm run db:migrate` | Apply `db/migrations/*.sql`                         |

## Notes

- Room and invention images are referenced by filename only. The UI tries
  `https://img.rec.net/<filename>` and hides the image when that fails; that host no
  longer resolves, so change `IMG_BASE` in `public/app.js` if you have a mirror.
- Clients are created per request on purpose; do not cache them at module scope.
- Hyperdrive owns the connection pool, so `max: 5` per request is enough.
- If you later want PostgREST, Auth, or Storage, add `@supabase/supabase-js`
  alongside this; it uses the project URL plus API keys rather than Postgres credentials.
