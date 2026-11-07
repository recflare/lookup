-- Indexes for the roomindex search paths. Safe to re-run.
-- CONCURRENTLY avoids locking the tables; run outside a transaction (psql autocommit).

create extension if not exists pg_trgm with schema extensions;

-- Name search: ILIKE '%term%' uses a trigram GIN index.
create index concurrently if not exists rooms_name_trgm_idx
  on public.rooms using gin (name extensions.gin_trgm_ops);

-- Blob lookups: exact match on save and room-meta blob keys/hashes.
create index concurrently if not exists subroom_saves_data_blob_key_idx
  on public.subroom_saves (data_blob_key);
create index concurrently if not exists subroom_saves_data_blob_hash_idx
  on public.subroom_saves (data_blob_hash);
create index concurrently if not exists rooms_meta_blob_key_idx
  on public.rooms (meta_blob_key);
create index concurrently if not exists rooms_meta_blob_hash_idx
  on public.rooms (meta_blob_hash);

-- Inventions created inside a room (joined via rooms.source_room_id).
create index concurrently if not exists inventions_creation_room_id_idx
  on public.inventions (creation_room_id);
