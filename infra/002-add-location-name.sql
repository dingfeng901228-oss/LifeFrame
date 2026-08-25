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
