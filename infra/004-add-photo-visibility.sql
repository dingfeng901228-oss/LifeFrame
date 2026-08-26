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
