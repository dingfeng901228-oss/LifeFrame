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
