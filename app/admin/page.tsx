import { redirect } from 'next/navigation';

// §2 of 需求0827 — /admin is the admin entry point. There's no
// separate dashboard yet (it's on the §27 backlog), so forward to
// /admin/photos which is the actual admin surface for now. The
// middleware matcher already gates /admin/* to admin role, so this
// redirect only ever runs for admins.
export default function AdminPage(): never {
  redirect('/admin/photos');
}