import Link from 'next/link';
import { UploadForm } from './UploadForm';
import { getViewer, isAdmin } from '@/lib/permissions';

export const metadata = {
  title: '上传照片 · LifeFrame',
};

// Frank #7084: §E.3 + #7084 — only admins can upload. Frank #7108 #2:
// the previous version silently `redirect('/')`'d non-admins, which
// combined with the getViewer() → getUser() network race in
// lib/permissions.ts produced a "looks like a soft refresh" UX for
// admin users clicking 上传 from `/` — the page would flicker to
// /upload, see role=guest due to getUser() flakiness, then 307 back
// to /. Now: admin sees the form, non-admin gets an explicit
// "权限不足" surface so the behaviour is unambiguous regardless of
// auth state.
export default async function UploadPage() {
  const viewer = await getViewer();
  if (isAdmin(viewer)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-light text-black dark:text-white">上传照片</h1>
        <p className="mt-2 text-sm text-black/50 dark:text-white/50">
          P0 stub：选一张图片直接 PUT 到 Cloudflare R2。后续会在浏览器侧自动读取 EXIF
          时间 / GPS、并在签名 URL 落地后写入 Supabase 元数据。
        </p>
        <div className="mt-10">
          <UploadForm />
        </div>
      </div>
    );
  }

  // Non-admin branch (signed-in regular user, or getSession race
  // returns guest for one render). Show explicit permission-denied
  // UI instead of silently bouncing back to `/` so the user (or any
  // future debug session) can see exactly what happened.
  return (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <p className="text-5xl" aria-hidden="true">🔒</p>
      <h1 className="mt-6 text-2xl font-light text-black dark:text-white">
        上传功能仅限 admin
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-black/65 dark:text-white/65">
        当前账号不是 admin。在 Supabase Auth → Users 里把当前用户的{' '}
        <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-black/80 dark:bg-white/[0.08] dark:text-white/80">
          app_metadata
        </code>{' '}
        设为{' '}
        <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-black/80 dark:bg-white/[0.08] dark:text-white/80">
          {"{ \"role\": \"admin\" }"}
        </code>{' '}
        后重新登录即可。
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm">
        <Link
          href="/"
          className="rounded-full bg-black px-6 py-2 text-white transition hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          返回首页
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-black/15 px-6 py-2 text-black/70 transition hover:border-black/40 hover:text-black dark:border-white/15 dark:text-white/70 dark:hover:border-white/40 dark:hover:text-white"
        >
          切换账号
        </Link>
      </div>
    </div>
  );
}