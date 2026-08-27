-- infra/007-add-photo-comments.sql
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Migration for §9–§12 of 需求0827 (PhotoComment). One row per comment.
-- §11 first-phase scope: 发布/查看/删除自己/Admin删任意 (no edit,
-- no reply, no @-mention, no rich text). The first-phase scope is
-- intentional — keep it simple.
--
-- Length: §12 hard cap at 1-500 chars via CHECK constraint. The API
-- also enforces it application-side (defense-in-depth). HTML escape
-- happens in the POST handler before insert; the stored content is
-- already safe, so the client renders with dangerouslySetInnerHTML.
--
-- ON DELETE CASCADE on photo_key means §2 admin bulk-deleting a photo
-- wipes its comments automatically. ON DELETE CASCADE on user_id
-- means deleting an auth.users row (rare in MVP) also cleans up.

create table if not exists public.photo_comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  photo_key text not null references public.photos(key) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- §12 length: 1-500 chars. Enforced again in the POST handler.
  content text not null check (
    char_length(content) >= 1
    and char_length(content) <= 500
  )
);

-- Listing within a photo is sorted oldest-first (chronological
-- reading order). The composite index covers the WHERE + ORDER BY
-- without a sort step.
create index if not exists photo_comments_photo_key_idx
  on public.photo_comments (photo_key, created_at asc);

-- Per-user lookup (deferred for "my comments" view but cheap to add).
create index if not exists photo_comments_user_id_idx
  on public.photo_comments (user_id);

comment on table public.photo_comments is
  '§9 of 需求0827: user comments on photos. CHECK constraint caps content at 1-500 chars (§12).';

alter table public.photo_comments enable row level security;

-- Read: public — comments are visible to anon too (they are public
-- engagement signals on photos the viewer is allowed to see).
create policy "Public read photo comments"
  on public.photo_comments
  for select
  using (true);

-- Insert: authenticated only. auth.uid() must equal user_id, so a
-- client can't spoof someone else's author. Server-side (defense
-- in depth) also validates in the POST handler.
create policy "Users create their own comments"
  on public.photo_comments
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Delete: owner only via the authenticated role. Admin moderation
-- (delete any comment) goes through service_role which bypasses
-- RLS — no separate policy needed.
create policy "Users delete their own comments"
  on public.photo_comments
  for delete
  to authenticated
  using (user_id = auth.uid());

-- No UPDATE policy — §11 explicitly defers comment editing from the
-- first phase. Adding it later is straightforward (same shape as
-- the insert policy).