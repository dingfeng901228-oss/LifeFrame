import { UploadForm } from './UploadForm';

export const metadata = {
  title: '上传照片 · LifeFrame',
};

export default function UploadPage() {
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
