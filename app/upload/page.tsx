import { redirect } from 'next/navigation';

// Frank #7117 #1: upload functionality moved into the admin
// section (new /admin/upload route, admin-gated by middleware).
// The old top-level /upload route now just forwards to the new
// path so existing bookmarks / in-flight links don't 404. The
// admin check + permission-denied UI that used to live here
// (commits 88bb8c8 + e6109d6 for the soft-refresh + perm
// surfaces) is gone — it's now handled inside /admin/upload
// itself, and /admin/* is gated by middleware so non-admins
// never reach here anyway.
export default function UploadPage(): never {
  redirect('/admin/upload');
}