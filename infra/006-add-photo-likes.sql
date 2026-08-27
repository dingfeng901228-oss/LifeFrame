-- infra/006-add-photo-likes.sql
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Migration for §8 of 需求0827 (PhotoLike). One row per (user, photo).
-- The unique constraint at the DB layer enforces "one user, one like"
-- (spec §8.3 "防止重复点赞"). The API catches the duplicate-key error
-- from concurrent inserts and treats it as idempotent so the toggle
-- endpoint is safe to call twice in a row from the same browser tab.
--
-- Like count is NOT denormalized on photos.like_count — we compute
-- on-the-fly via COUNT in the API. For a single-user personal site
-- this is fine; if it ever becomes a perf cliff, add a denormalized
-- counter + an AFTER INSERT/DELETE trigger.

create table if not exists public.photo_likes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_key text not null references public.photos(key) on delete cascade,
  -- One like per (user, photo). Catches accidental double-insert from
  -- the API as well as the "防止重复点赞" requirement (§8.3).
  unique (user_id, photo_key)
);

-- Lookup by photo (most common query — "how many likes on this photo").
-- Listing within a photo is sorted newest-first.
create index if not exists photo_likes_photo_key_idx
  on public.photo_likes (photo_key, created_at desc);

-- Lookup by user (e.g. "show all photos I liked" — not on the
-- current UI but cheap to add now).
create index if not exists photo_likes_user_id_idx
  on public.photo_likes (user_id);

comment on table public.photo_likes is
  '§8 of 需求0827: one row per (user_id, photo_key). Unique constraint enforces no-double-likes.';

alter table public.photo_likes enable row level security;

-- Read: public (likes are public engagement signal — visible to
-- anon too, so the home page can show ❤ counts on photos a guest is
-- allowed to see via the photos table RLS).
create policy "Public read photo likes"
  on public.photo_likes
  for select
  using (true);

-- Write: only the authenticated user can insert / delete their own
-- row. auth.uid() inside the USING clause is enforced by Supabase —
-- client cannot spoof. service_role bypasses RLS for admin tooling.
create policy "Users manage their own likes"
  on public.photo_likes
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ON DELETE CASCADE on photo_key means bulk-deleting a photo (§2 admin)
-- automatically cleans up its likes — no orphan rows.
comment on constraint photo_likes_photo_key_fkey on public.photo_likes is
  'ON DELETE CASCADE: when the photo is deleted via §2 admin bulk delete, the likes go with it.';