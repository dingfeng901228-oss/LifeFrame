-- infra/005-add-photo-user-id.sql
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Migration for §1 of 需求0827 (Guest/User/Admin + person 照片登录墙):
-- 1. Add user_id column to photos (FK to auth.users, nullable for legacy)
-- 2. Replace the permissive "Public read photos" policy from
--    supabase-schema.sql with two role-aware policies:
--      - anon:        can SELECT only photos WITHOUT 'person' in categories
--      - authenticated: can SELECT all photos
--
-- Visibility (private/unlisted/public) stays independent — it's for
-- share/sitemap (§24 of 要件定義書), not for category-based role gating.
-- Combined rule:
--   anon       : non-person photos (regardless of visibility)
--   authed user: all photos
--   admin     : all photos (admin distinction deferred to §2 of 需求0827)
--
-- Backfill Frank's existing photos after running this migration:
--   UPDATE photos
--     SET user_id = (SELECT id FROM auth.users WHERE email = '<frank-email>')
--     WHERE user_id IS NULL;
-- Then promote Frank to admin in Supabase Auth dashboard:
--   Auth → Users → Frank → Edit user → app_metadata → {"role": "admin"}
-- Other accounts (if any) default to 'user' per app_metadata, which is
-- what the lib/permissions.ts getViewer() helper reads.

alter table public.photos
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists photos_user_id_idx on public.photos (user_id);

comment on column public.photos.user_id is
  'Owner of the photo (FK to auth.users). NULL = legacy upload before this migration. Used for cascade delete + future moderation. Role-based category gating (§1 of 需求0827) is independent: photos with categories @> ARRAY[''person''] require authentication regardless of owner.';

-- Drop the old permissive policy and replace with two role-aware ones.
drop policy if exists "Public read photos" on public.photos;

create policy "Anon reads non-person photos"
  on public.photos
  for select
  to anon
  using (not (categories @> array['person']::text[]));

create policy "Authenticated reads all photos"
  on public.photos
  for select
  to authenticated
  using (true);

-- INSERT / UPDATE / DELETE policies: still bypassed via service_role
-- (RLS doesn't apply). Frank's client-side upload action will set
-- user_id from the session in a follow-up commit (§1.b / upload wiring).
-- (Future: tighten INSERT with auth.uid() = user_id check, deferred to §2.)