import { redirect } from 'next/navigation';
import { UploadForm } from './UploadForm';
import { getViewer, isAdmin } from '@/lib/permissions';

export const metadata = {
  title: '上传照片 · LifeFrame',
};

// Frank #7084: §E.3 + #7084 — only admins can upload. Non-admins
// (regular signed-in users) are redirected to the home page.
// Middleware already redirects unauthenticated users to /login,
// so this only triggers when a non-admin user hits /upload directly.
export default async function UploadPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect('/');
  }

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