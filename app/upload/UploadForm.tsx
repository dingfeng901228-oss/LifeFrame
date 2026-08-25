'use client';

import { useRef, useState } from 'react';
import { extractExif, type PhotoExif } from '@/lib/exif';

type Status = 'idle' | 'signing' | 'uploading' | 'done' | 'error';

export function UploadForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [exif, setExif] = useState<PhotoExif | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setKey(null);
    setPublicUrl(null);
    setExif(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileSize(file.size);

    try {
      // Extract EXIF first (fast — reads header only) so we can include
      // it as R2 object metadata on upload.
      const exifData = await extractExif(file);
      setExif(exifData);

      setStatus('signing');
      const signRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          exif: exifData,
        }),
      });
      if (!signRes.ok) {
        const text = await signRes.text();
        throw new Error(`signing failed (${signRes.status}): ${text}`);
      }
      const { url, key, publicUrl } = (await signRes.json()) as {
        url: string;
        key: string;
        publicUrl: string;
      };
      setKey(key);

      setStatus('uploading');
      // SDK puts x-amz-meta-* into the URL query string; R2 applies them.
      // We only need to PUT the file body.
      const put = await fetch(url, {
        method: 'PUT',
        body: file,
      });
      if (!put.ok) {
        const text = await put.text();
        throw new Error(`upload failed (${put.status}): ${text}`);
      }

      setPublicUrl(publicUrl);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  function reset() {
    setStatus('idle');
    setError(null);
    setKey(null);
    setPublicUrl(null);
    setFileName(null);
    setFileSize(null);
    setExif(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const busy = status === 'signing' || status === 'uploading';

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="sr-only">选择图片</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onChange}
          disabled={busy}
          className="block w-full cursor-pointer rounded border border-white/15 bg-white/5 px-3 py-3 text-sm text-white file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-2 file:text-black hover:bg-white/10 disabled:opacity-50"
        />
      </label>

      <div className="min-h-6 text-sm">
        {status === 'idle' && <span className="text-white/40">等选择</span>}
        {status === 'signing' && (
          <span className="text-sky-300">向 R2 申请签名 URL…</span>
        )}
        {status === 'uploading' && <span className="text-sky-300">PUT 到 R2…</span>}
        {status === 'done' && (
          <span className="text-emerald-300">
            上传成功 ✅{fileName ? ` · ${fileName}` : ''}
            {fileSize != null ? ` · ${(fileSize / 1024).toFixed(1)} KB` : ''}
          </span>
        )}
        {status === 'error' && <span className="text-rose-300">失败：{error}</span>}
      </div>

      {exif && (exif.takenAt || exif.lat != null || exif.make || exif.model) && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-white/70">
          <p className="mb-1 text-white/50">EXIF</p>
          {exif.takenAt && <p>📅 {new Date(exif.takenAt).toLocaleString('zh-CN')}</p>}
          {exif.lat != null && exif.lng != null && (
            <p>📍 {exif.lat.toFixed(4)}, {exif.lng.toFixed(4)}</p>
          )}
          {(exif.make || exif.model) && (
            <p>📷 {[exif.make, exif.model].filter(Boolean).join(' ')}</p>
          )}
        </div>
      )}

      {publicUrl && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
          <p className="text-white/50">对象 Key</p>
          <code className="mt-1 block break-all text-xs text-white/80">{key}</code>
          <p className="mt-3 text-white/50">公开 URL</p>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all text-xs text-sky-300 underline"
          >
            {publicUrl}
          </a>
        </div>
      )}

      {status !== 'idle' && (
        <button
          type="button"
          onClick={reset}
          className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
        >
          重选
        </button>
      )}
    </div>
  );
}
