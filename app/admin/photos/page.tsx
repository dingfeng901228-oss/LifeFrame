import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase';
import { AdminPhotosClient } from './AdminPhotosClient';

// §2 of 需求0827 — admin photo management. Server Component fetches
// the full photo set (service_role bypasses RLS so Frank sees every
// photo regardless of visibility or person-category), then hands off
// to a Client Component for selection state + bulk-delete UX.
//
// Bulk delete (§2.b.2) lives at /api/admin/photos/delete which itself
// re-validates admin role — never trust a cookie alone for write
// paths.
export const dynamic = 'force-dynamic';

export default async function AdminPhotosPage() {
  const supabase = getSupabaseAdmin();
  const { data: photos, error } = await supabase
    .from('photos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-[0.4em] text-white/40 uppercase">
            Admin · §2
          </p>
          <h1 className="mt-2 text-3xl font-light">🛠️ 照片管理</h1>
        </div>
        <Link
          href="/"
          className="text-sm text-white/60 transition hover:text-white"
        >
          ← 返回首页
        </Link>
      </div>

      {error ? (
        <p className="rounded border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-300">
          加载失败：{error.message}
        </p>
      ) : (
        <AdminPhotosClient initialPhotos={photos ?? []} />
      )}
    </main>
  );
}