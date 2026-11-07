-- Indexes for account search (rooms an account created, holds a role in, or saved in).
-- Safe to re-run; CONCURRENTLY avoids locking.

create index concurrently if not exists rooms_creator_account_id_idx
  on public.rooms (creator_account_id);
create index concurrently if not exists room_roles_account_id_idx
  on public.room_roles (account_id);
create index concurrently if not exists subrooms_creator_account_id_idx
  on public.subrooms (creator_account_id);
create index concurrently if not exists subroom_saves_saved_by_account_id_idx
  on public.subroom_saves (saved_by_account_id);
