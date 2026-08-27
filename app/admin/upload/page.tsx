import { redirect } from 'next/navigation';
import { getViewer, isAdmin } from '@/lib/permissions';
import { UploadForm } from '@/app/upload/UploadForm';

export const metadata = {
  title: '上传照片 · LifeFrame',
};

// Frank #7117 #1: upload moved into the admin section. The route
// now lives at /admin/upload (admin-gated by the existing
// middleware matcher for /admin/* + this defense-in-depth admin
// check). UploadForm itself stayed at app/upload/UploadForm.tsx
// to avoid file-move churn — it's a self-contained client
// component, imports via the @/* alias work from any depth.
//
// Frank #7108 #1's cancel/reselect/cancel-upload UX (commit
// 5798fb2) and Frank #7108 #2's getSession fix for the soft-
// refresh bug (commit e6109d6) both live in UploadForm.tsx and
// apply here unchanged — this is just a host-route move.
export default async function AdminUploadPage() {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    redirect('/');
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-light text-white">📤 上传照片</h1>
      <p className="mt-2 text-sm text-white/50">
        选一张图片直接 PUT 到 Cloudflare R2。EXIF（拍摄时间 / GPS /
        相机型号）会在浏览器侧读取后跟签名 URL 一起写到 Supabase。
      </p>
      <div className="mt-10">
        <UploadForm />
      </div>
    </div>
  );
}
