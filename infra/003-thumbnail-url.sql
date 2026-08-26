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
