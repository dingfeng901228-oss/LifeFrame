-- Migration 001: add photo categories
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Adds a `categories` text[] column to photos for the 人物 / 风景
-- multi-tag classification. Empty array = uncategorized.
--
-- Today's rollout: the homepage detail modal already renders the
-- categories field if present. Editing categories from the UI lands in
-- a future commit; for now the column is populated by the upload
-- action if the client sends a `categories` array.

alter table public.photos
  add column if not exists categories text[] not null default '{}'::text[];

-- Add a GIN index so category filtering stays fast once the photo
-- collection grows past a few hundred rows.
create index if not exists photos_categories_idx
  on public.photos
  using gin (categories);

-- Convenience policy: any-contains comparison helper. The client side
-- will likely filter with `categories @> array['person']::text[]`.
comment on column public.photos.categories is
  'multi-tag classification: subset of {person, scenery}. empty = uncategorized';
