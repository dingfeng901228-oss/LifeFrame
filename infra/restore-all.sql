-- =============================================================================
-- LifeFrame — full database restore script
-- =============================================================================
-- Frank #7243 round-2: the Supabase project `utikkddqzilphrsszjpw` was
-- deleted (DNS for *.supabase.co returns NXDOMAIN for that ref, same
-- as a randomly-invented ref). The R2 photo bucket is INTACT — 555
-- objects, every original JPEG with its GPS + DateTimeOriginal EXIF.
--
-- HOW TO RESTORE
--   1. Supabase dashboard → create (or restore) a project.
--   2. SQL Editor → New query → paste this whole file → Run.
--   3. Note the new project ref (the `xxxx` in
--      https://xxxx.supabase.co).
--   4. Update .env.local + the Vercel env vars:
--        NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
--        SUPABASE_SERVICE_ROLE_KEY
--   5. Run: node scripts/reindex-r2-to-supabase.mjs
--      (reads every object in R2, pulls the EXIF, writes the rows)
--
-- The re-index script uses the service_role key over PostgREST, so it
-- bypasses RLS — it can write rows that the anon policy forbids.
-- =============================================================================

-- Lifeframe photos table
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  key text not null unique,                   -- R2 object key (uploads/2026-08-25/...)
  public_url text not null,                    -- full R2 public URL
  filename text not null,                      -- original filename from upload
  content_type text,                           -- mime type (image/jpeg etc.)
  size_bytes bigint,                           -- file size in bytes
  taken_at timestamptz,                        -- EXIF DateTimeOriginal
  lat double precision,                        -- EXIF GPSLatitude (decimal)
  lng double precision,                        -- EXIF GPSLongitude (decimal)
  camera_make text,                            -- EXIF Make
  camera_model text                            -- EXIF Model
);

-- Indexes for common queries
create index if not exists photos_taken_at_idx on public.photos (taken_at desc nulls last);
create index if not exists photos_created_at_idx on public.photos (created_at desc);
create index if not exists photos_geo_idx on public.photos (lat, lng) where lat is not null and lng is not null;

-- RLS: public read for Gallery (write is server-side via service_role, bypasses RLS)
alter table public.photos enable row level security;

create policy "Public read photos"
  on public.photos
  for select
  using (true);

-- No explicit insert/update/delete policies: service_role bypasses RLS entirely.
-- When user auth is added later, tighten with auth.uid() based policies.


-- ---------- 001-add-categories.sql ----------
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


-- ---------- 002-add-location-name.sql ----------
-- Migration 002: add human-readable location_name to photos
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Stores the Nominatim reverse-geocode result (e.g. "Tokyo, Shinjuku") so
-- the home page can render "📍 Tokyo" instead of "📍 35.6895, 139.6917".
-- The raw lat/lng columns stay — they're still the source of truth for
-- the globe and the map picker.
--
-- Nullable: photos uploaded before this migration won't have it, and
-- that's fine — UI falls back to lat/lng display.

alter table public.photos
  add column if not exists location_name text;

comment on column public.photos.location_name is
  'human-readable location from Nominatim reverse geocode (e.g. Tokyo, Shinjuku). null = unknown / pre-migration row';


-- ---------- 003-thumbnail-url.sql ----------
-- Migration 003: thumbnail URL on photos
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Adds two columns to hold the 256×256 webp thumbnail variant of each
-- photo. Populated on demand by the /api/process-thumbnail endpoint,
-- which is called from UploadForm after a successful upload (and can be
-- re-run any time for backfill).
--
-- Both columns are nullable — older rows and rows whose thumbnail
-- generation failed will have nulls, and UI code falls back to the
-- original public_url.

alter table public.photos
  add column if not exists thumbnail_key text,
  add column if not exists thumbnail_url text;

comment on column public.photos.thumbnail_key is
  'R2 object key for the 256x256 webp thumbnail variant. null = thumbnail not generated yet (run /api/process-thumbnail or wait for backfill).';

comment on column public.photos.thumbnail_url is
  'Public R2 URL for the thumbnail. null = not generated yet; UI falls back to public_url (original) when this is null.';


-- ---------- 004-add-photo-visibility.sql ----------
-- infra/004-add-photo-visibility.sql
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Adds per-photo visibility levels for the §24 sharing feature.
-- Three states per 要件定義書 §24:
--   private  - default. Owner only. Not in sitemap.
--   unlisted - anyone with the direct URL can view. NOT in sitemap,
--              not indexed by search engines.
--   public  - anyone with the direct URL can view, AND the URL is
--              emitted into sitemap.xml so search engines can index it.
--
-- Existing rows get the default 'private' on the ALTER. New uploads
-- also default to 'private' unless the upload-url request body
-- specifies otherwise.

alter table public.photos
  add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'unlisted', 'public'));

create index if not exists photos_visibility_idx
  on public.photos (visibility);

comment on column public.photos.visibility is
  'Share level for §24: ''private'' (default, owner only), ''unlisted'' (anyone with the link, not in sitemap), or ''public'' (link + sitemap entry so search engines can index the photo page).';


-- ---------- 005-add-photo-user-id.sql ----------
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

-- ---------- 006-add-photo-likes.sql ----------
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

-- ---------- 007-add-photo-comments.sql ----------
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

-- ---------- 008-set-public-for-demo.sql ----------
-- infra/008-set-public-for-demo.sql
-- Run in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run)
--
-- Frank #7096: /welcome guest mode shows 0 photos because all of
-- Frank's photos are visibility='private' (migration 004 default).
-- RLS already excludes 'person' category photos for anon, so the
-- only missing piece is making non-person photos public.
--
-- This migration flips every non-person photo to visibility='public'
-- so they show on:
--   • /welcome  — "🌍 风景照片" grid
--   • /timeline — month-grouped photos
--   • /stats    — country / city breakdown
--
-- After running, refresh /welcome in the browser — the scenery grid
-- should now show your non-person photos.
--
-- Reverting: use /admin/photos (E.3 bulk-update API) to flip
-- individual photos back to 'private' if needed. Person photos are
-- NOT touched by this query (the WHERE clause excludes them), so any
-- private person photos stay private.

UPDATE photos
SET visibility = 'public'
WHERE NOT (categories @> ARRAY['person']::text[]);

-- =============================================================================
-- Sanity check — run after the script above, expect 1 row per photo:
--   select count(*) from public.photos;
--   select count(*) from public.photos where lat is not null;
-- =============================================================================
