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