import Link from 'next/link';
import { getSupabaseAdmin, type PhotoRow } from '@/lib/supabase';

// §2 of 需求0827 — admin photo management. Grid view with thumbnail
// + filename + taken_at + location_name + categories + visibility.
//
// Bulk select + bulk delete + secondary-confirm modal are added in
// follow-up commits (§2.b). For now this is just the read side so
// Frank can see all his photos in one place regardless of visibility
// or person-category (admin uses service_role which bypasses RLS).
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
        <>
          <p className="mb-6 text-sm text-white/40">
            共 {photos?.length ?? 0} 张照片
            （按 created_at desc，最多 500 · 批量删除/筛选后续 commit）
          </p>
          {photos && photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((p) => (
                <PhotoTile key={p.id} photo={p} />
              ))}
            </div>
          ) : (
            <p className="text-white/40">还没有照片</p>
          )}
        </>
      )}
    </main>
  );
}

function PhotoTile({ photo }: { photo: PhotoRow }) {
  const cats = photo.categories ?? [];
  return (
    <div className="overflow-hidden rounded border border-white/10 bg-black/30">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.thumbnail_url || photo.public_url}
        alt={photo.filename}
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
      <div className="p-2 text-xs">
        <p className="truncate text-white/80" title={photo.filename}>
          {photo.filename}
        </p>
        {photo.taken_at && (
          <p className="mt-1 text-white/40 tabular-nums">
            📅 {new Date(photo.taken_at).toLocaleDateString('zh-CN')}
          </p>
        )}
        {photo.location_name && (
          <p className="truncate text-white/40" title={photo.location_name}>
            📍 {photo.location_name}
          </p>
        )}
        <p className="mt-1 text-[10px] uppercase tracking-wider text-white/30">
          {cats.includes('person') && '👤 '}
          {cats.includes('scenery') && '🏞️ '}
          · {photo.visibility}
        </p>
      </div>
    </div>
  );
}