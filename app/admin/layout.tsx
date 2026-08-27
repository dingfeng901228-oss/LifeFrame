import Link from 'next/link';

// Frank #7117 #1: /admin layout adds a sub-nav so the two admin
// surfaces — 📷 管理照片 (/admin/photos) and 📤 上传照片
// (/admin/upload) — are reachable from any admin page without
// bouncing back through the global header. The global <header>
// in app/layout.tsx already gives you Home / 上传 / 后台 / Theme /
// 账号 — this sub-nav sits below it as a horizontal divider that
// only appears on /admin/* routes.
//
// The pages still render their own page-title header (e.g.
// 🛠️ 照片管理 with the ← 返回首页 link in /admin/photos), so the
// sub-nav is a thin affordance on top, not a duplicate of the
// page H1. Active-state highlighting is left out for now — the
// pages are visually distinct enough that a tiny "你在这里" cue
// isn't needed yet.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="mx-auto flex max-w-6xl items-center gap-6 border-b border-white/10 px-6 py-3 text-sm">
        <Link
          href="/admin/photos"
          className="text-white/70 transition hover:text-white"
        >
          📷 管理照片
        </Link>
        <Link
          href="/admin/upload"
          className="text-white/70 transition hover:text-white"
        >
          📤 上传照片
        </Link>
      </nav>
      {children}
    </>
  );
}
