import type { Sql } from "./db";
import { blobTargets } from "./blob";

type Row = Record<string, unknown>;

export interface RoomSummary extends Row {
  id: string;
  source_room_id: string | null;
  name: string;
  description: string | null;
  image_filename: string | null;
  creator_account_id: string | null;
  created_at: string | null;
  published_at: string | null;
  max_players: number | null;
  stats: Row | null;
  subroom_count: number;
  tags: string[];
}

export interface BlobMatch {
  kind: "save" | "room_meta" | "asset_bundle";
  matched_key: string | null;
  matched_hash: string | null;
  subroom_id?: string;
  subroom_name?: string | null;
  save_id?: string;
  save_created_at?: string | null;
  unity_asset_id?: string;
  bundle_target?: number;
}

export interface SearchResult extends RoomSummary {
  matches: BlobMatch[];
}

const SEARCH_LIMIT = 50;

const summaryColumns = (sql: Sql) => sql`
  r.id::text, r.source_room_id::text, r.name, r.description, r.image_filename,
  r.creator_account_id::text, r.created_at, r.published_at, r.max_players, r.stats,
  (select count(*)::int from subrooms s where s.room_id = r.id) as subroom_count,
  coalesce((select jsonb_agg(t.tag order by t.is_primary_genre desc nulls last, t.tag)
            from room_tags t where t.room_id = r.id), '[]'::jsonb) as tags
`;

export async function searchByName(sql: Sql, q: string): Promise<SearchResult[]> {
  const term = q.trim();
  if (!term) return [];
  const lower = term.toLowerCase();
  const numeric = /^\d{1,19}$/.test(term) ? term : null;
  const rows = await sql<RoomSummary[]>`
    select ${summaryColumns(sql)}
    from rooms r
    where r.name ilike ${"%" + escapeLike(term) + "%"}
      ${numeric ? sql`or r.id = ${numeric}::bigint or r.source_room_id = ${numeric}::bigint` : sql``}
    order by
      (lower(r.name) = ${lower}) desc,
      (lower(r.name) like ${escapeLike(lower) + "%"}) desc,
      length(r.name) asc,
      r.id asc
    limit ${SEARCH_LIMIT}
  `;
  return rows.map((r) => ({ ...r, matches: [] }));
}

export async function searchByBlob(sql: Sql, q: string): Promise<SearchResult[]> {
  const { saveKeys, metaKeys, assetKeys, hashes } = blobTargets(q);
  if (saveKeys.length + metaKeys.length + assetKeys.length + hashes.length === 0) return [];

  type SaveHit = RoomSummary & {
    subroom_id: string; subroom_name: string | null; save_id: string;
    save_created_at: string | null; matched_key: string; matched_hash: string | null;
  };
  type MetaHit = RoomSummary & { matched_key: string | null; matched_hash: string | null };
  type BundleHit = SaveHit & { unity_asset_id: string; bundle_target: number };

  // Only run the lookups the pasted value could satisfy. Keys are indexed on
  // subroom_saves; the rooms meta-blob index is pending (see README), so the
  // meta lookup is the slow one and is skipped for `.room` keys.
  const savesQuery =
    saveKeys.length + hashes.length === 0
      ? Promise.resolve([] as SaveHit[])
      : sql<SaveHit[]>`
          select ${summaryColumns(sql)},
                 sr.id::text as subroom_id, sr.name as subroom_name,
                 s.id::text as save_id, s.created_at as save_created_at,
                 s.data_blob_key as matched_key, s.data_blob_hash as matched_hash
          from subroom_saves s
          join subrooms sr on sr.id = s.subroom_id
          join rooms r on r.id = sr.room_id
          where ${saveKeys.length ? sql`s.data_blob_key in ${sql(saveKeys)}` : sql`false`}
             or ${hashes.length ? sql`s.data_blob_hash in ${sql(hashes)}` : sql`false`}
          order by s.created_at desc
          limit ${SEARCH_LIMIT}
        `;
  const metasQuery =
    metaKeys.length + hashes.length === 0
      ? Promise.resolve([] as MetaHit[])
      : sql<MetaHit[]>`
          select ${summaryColumns(sql)}, r.meta_blob_key as matched_key, r.meta_blob_hash as matched_hash
          from rooms r
          where ${metaKeys.length ? sql`r.meta_blob_key in ${sql(metaKeys)}` : sql`false`}
             or ${hashes.length ? sql`r.meta_blob_hash in ${sql(hashes)}` : sql`false`}
          limit ${SEARCH_LIMIT}
        `;
  // Asset bundles are the CDN form of a unity asset; a save's source asset
  // leads back to its subroom and room.
  const bundlesQuery =
    assetKeys.length + hashes.length === 0
      ? Promise.resolve([] as BundleHit[])
      : sql<BundleHit[]>`
          select ${summaryColumns(sql)},
                 sr.id::text as subroom_id, sr.name as subroom_name,
                 s.id::text as save_id, s.created_at as save_created_at,
                 b.asset_key as matched_key, b.asset_hash as matched_hash,
                 b.unity_asset_id::text as unity_asset_id, b.target as bundle_target
          from unity_asset_bundles b
          join subroom_saves s on s.source_unity_asset_id = b.unity_asset_id
          join subrooms sr on sr.id = s.subroom_id
          join rooms r on r.id = sr.room_id
          where ${assetKeys.length ? sql`b.asset_key in ${sql(assetKeys)}` : sql`false`}
             or ${hashes.length ? sql`b.asset_hash in ${sql(hashes)}` : sql`false`}
          order by s.created_at desc
          limit ${SEARCH_LIMIT}
        `;
  const [saves, metas, bundles] = await Promise.all([savesQuery, metasQuery, bundlesQuery]);

  const byRoom = new Map<string, SearchResult>();
  const add = (row: RoomSummary, match: BlobMatch) => {
    const { matched_key: _k, matched_hash: _h, subroom_id: _s, subroom_name: _n, save_id: _i, save_created_at: _c,
            unity_asset_id: _u, bundle_target: _t, ...room } = row as Row;
    const existing = byRoom.get(room.id as string);
    if (existing) existing.matches.push(match);
    else byRoom.set(room.id as string, { ...(room as RoomSummary), matches: [match] });
  };
  for (const s of saves) {
    add(s, {
      kind: "save",
      matched_key: s.matched_key,
      matched_hash: s.matched_hash,
      subroom_id: s.subroom_id,
      subroom_name: s.subroom_name,
      save_id: s.save_id,
      save_created_at: s.save_created_at,
    });
  }
  for (const m of metas) {
    add(m, { kind: "room_meta", matched_key: m.matched_key, matched_hash: m.matched_hash });
  }
  for (const b of bundles) {
    add(b, {
      kind: "asset_bundle",
      matched_key: b.matched_key,
      matched_hash: b.matched_hash,
      subroom_id: b.subroom_id,
      subroom_name: b.subroom_name,
      save_id: b.save_id,
      save_created_at: b.save_created_at,
      unity_asset_id: b.unity_asset_id,
      bundle_target: b.bundle_target,
    });
  }
  return [...byRoom.values()];
}

export interface RoomDetail {
  room: Row;
  creator: Row | null;
  tags: Row[];
  roles: Row[];
  roles_total: number;
  subrooms: Row[];
  saves: Row[];
  inventions: Row[];
  inventions_total: number;
  /** unity_assets rows referenced by saves' source_unity_asset_id, with their bundles. */
  unity_assets: UnityAsset[];
}

export interface UnityAsset extends Row {
  unity_asset_id: string;
  bundles: Row[];
  subasset_count: number;
}

const ROLES_LIMIT = 500;
const INVENTIONS_LIMIT = 200;

export async function getRoom(sql: Sql, id: string): Promise<RoomDetail | null> {
  const [room] = await sql<Row[]>`
    select r.*, r.id::text as id, r.source_room_id::text as source_room_id,
           r.creator_account_id::text as creator_account_id
    from rooms r where r.id = ${id}::bigint
  `;
  if (!room) return null;

  const creatorId = room.creator_account_id as string | null;
  const has = await optionalTables(sql);
  const [creator, tags, roles, [rolesCount], subrooms, inventions, [inventionsCount]] = await Promise.all([
    creatorId && has.accounts
      ? sql<Row[]>`select account_id::text as account_id, username, display_name, profile, first_seen_at, updated_at
                   from accounts where account_id = ${creatorId}::bigint`.then((r) => r[0] ?? null)
      : Promise.resolve(null),
    sql<Row[]>`select tag, type, is_primary_genre from room_tags where room_id = ${id}::bigint
               order by is_primary_genre desc nulls last, type, tag`,
    sql<Row[]>`select rr.account_id::text as account_id, rr.role, rr.invited_role,
                      rr.last_changed_by_account_id::text as last_changed_by_account_id
                      ${has.accounts ? sql`, a.username, a.display_name` : sql`, null as username, null as display_name`}
               from room_roles rr
               ${has.accounts ? sql`left join accounts a on a.account_id = rr.account_id` : sql``}
               where rr.room_id = ${id}::bigint
               order by rr.role desc, rr.account_id
               limit ${ROLES_LIMIT}`,
    sql<{ n: number }[]>`select count(*)::int as n from room_roles where room_id = ${id}::bigint`,
    sql<Row[]>`select s.*, s.id::text as id, s.room_id::text as room_id,
                      s.source_subroom_id::text as source_subroom_id,
                      s.creator_account_id::text as creator_account_id,
                      s.staged_subroom_data_save_id::text as staged_subroom_data_save_id,
                      s.current_save_id::text as current_save_id
               from subrooms s where s.room_id = ${id}::bigint order by s.id`,
    sql<Row[]>`select i.id::text as id, i.source_invention_id::text as source_invention_id, i.name,
                      i.creator_player_id::text as creator_player_id, i.is_published, i.is_featured,
                      i.num_downloads::text as num_downloads, i.cheer_count::text as cheer_count,
                      i.created_at, i.modified_at, i.image_filename
               from inventions i join rooms r on r.source_room_id = i.creation_room_id
               where r.id = ${id}::bigint
               order by i.created_at desc nulls last
               limit ${INVENTIONS_LIMIT}`,
    sql<{ n: number }[]>`select count(*)::int as n from inventions i join rooms r on r.source_room_id = i.creation_room_id
                         where r.id = ${id}::bigint`,
  ]);

  const subroomIds = subrooms.map((s) => s.id as string);
  const saves =
    subroomIds.length === 0
      ? []
      : await sql<Row[]>`
          select sv.*, sv.id::text as id, sv.subroom_id::text as subroom_id,
                 sv.source_save_id::text as source_save_id,
                 sv.saved_by_account_id::text as saved_by_account_id,
                 ${has.save_htr_files ? sql`(select count(*)::int from save_htr_files f where f.save_id = sv.id)` : sql`null::int`} as htr_file_count,
                 ${has.save_unity_assets ? sql`(select count(*)::int from save_unity_assets u where u.save_id = sv.id)` : sql`null::int`} as unity_asset_count
          from subroom_saves sv
          where sv.subroom_id in ${sql(subroomIds)}
          order by sv.subroom_id, sv.created_at desc nulls last
        `;

  const assetIds = [...new Set(saves.map((sv) => sv.source_unity_asset_id as string | null).filter((x): x is string => !!x))];
  const unity_assets = assetIds.length === 0 ? [] : await unityAssets(sql, assetIds);

  return {
    room,
    creator,
    unity_assets,
    tags,
    roles,
    roles_total: rolesCount?.n ?? roles.length,
    subrooms,
    saves,
    inventions,
    inventions_total: inventionsCount?.n ?? inventions.length,
  };
}

async function unityAssets(sql: Sql, ids: string[]): Promise<UnityAsset[]> {
  const [assets, bundles] = await Promise.all([
    sql<(Row & { unity_asset_id: string; subasset_count: number })[]>`
      select u.*, u.unity_asset_id::text as unity_asset_id,
             u.created_by_account_id::text as created_by_account_id,
             (select count(*)::int from unity_asset_subassets x where x.parent_unity_asset_id = u.unity_asset_id) as subasset_count
      from unity_assets u
      where u.unity_asset_id in ${sql(ids)}
    `,
    sql<Row[]>`
      select b.unity_asset_id::text as unity_asset_id, b.target, b.version, b.asset_key, b.asset_hash,
             b.size_bytes::text as size_bytes, b.uploaded_at
      from unity_asset_bundles b
      where b.unity_asset_id in ${sql(ids)}
      order by b.unity_asset_id, b.target
    `,
  ]);
  const byId = new Map<string, UnityAsset>();
  for (const a of assets) byId.set(a.unity_asset_id, { ...a, bundles: [] });
  for (const b of bundles) byId.get(b.unity_asset_id as string)?.bundles.push(b);
  return [...byId.values()];
}

/**
 * Tables that may be dropped to stay under the Supabase disk quota. Checked per
 * request so the API keeps working while the database is being trimmed.
 */
async function optionalTables(sql: Sql): Promise<{ accounts: boolean; save_htr_files: boolean; save_unity_assets: boolean }> {
  const [row] = await sql<{ accounts: boolean; save_htr_files: boolean; save_unity_assets: boolean }[]>`
    select to_regclass('public.accounts') is not null as accounts,
           to_regclass('public.save_htr_files') is not null as save_htr_files,
           to_regclass('public.save_unity_assets') is not null as save_unity_assets
  `;
  return row ?? { accounts: false, save_htr_files: false, save_unity_assets: false };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
