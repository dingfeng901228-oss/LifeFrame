'use client';

import { useRef, useState } from 'react';
import { extractExif, type PhotoExif } from '@/lib/exif';
import { MapPicker, type PickedLocation } from '@/components/MapPicker';

type Status = 'idle' | 'ready' | 'signing' | 'uploading' | 'done' | 'error';

export function UploadForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [exif, setExif] = useState<PhotoExif | null>(null);
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [takenAtManual, setTakenAtManual] = useState<string>('');
  const [mapOpen, setMapOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setKey(null);
    setPublicUrl(null);
    setExif(null);
    setPicked(null);
    setTakenAtManual('');
    const f = e.target.files?.[0];
    if (!f) {
      setFile(null);
      setFileName(null);
      setFileSize(null);
      setStatus('idle');
      return;
    }
    setFile(f);
    setFileName(f.name);
    setFileSize(f.size);

    try {
      // Read EXIF header only (fast) so the user can see GPS + camera + time
      // and decide whether to override before clicking upload.
      const exifData = await extractExif(f);
      setExif(exifData);
      if (exifData.takenAt) {
        setTakenAtManual(exifData.takenAt.slice(0, 16));
      }
    } catch {
      // ignore EXIF errors — we still let the user upload
    }
    setStatus('ready');
  }

  async function doUpload() {
    if (!file) return;
    setStatus('signing');
    setError(null);
    try {
      // Final payload: picked location overrides EXIF GPS, manual time
      // overrides EXIF DateTimeOriginal.
      const finalLat = picked?.lat ?? exif?.lat;
      const finalLng = picked?.lng ?? exif?.lng;
      const finalTaken = takenAtManual
        ? new Date(takenAtManual).toISOString()
        : exif?.takenAt;

      const signRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          exif: {
            takenAt: finalTaken,
            lat: finalLat,
            lng: finalLng,
            make: exif?.make,
            model: exif?.model,
            locationName: picked?.name,
          },
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
    setPicked(null);
    setTakenAtManual('');
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const busy = status === 'signing' || status === 'uploading';
  const showPreUpload = file && !busy && status !== 'done';
  const showUploadBtn = status === 'ready';

  return (
    <div className="space-y-6">
      {/* File input */}
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
        {status === 'ready' && (
          <span className="text-sky-300">
            已读取 EXIF
            {fileName ? ` · ${fileName}` : ''}
            {fileSize != null ? ` · ${(fileSize / 1024).toFixed(1)} KB` : ''}
            {' '}— 可改时间/地点后点上传
          </span>
        )}
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

      {/* Manual time override — only shown before upload so the user can
          decide what to send. */}
      {showPreUpload && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
          <p className="mb-2 text-white/50">拍摄时间（可选 — 优先用 EXIF）</p>
          <input
            type="datetime-local"
            value={takenAtManual}
            onChange={(e) => setTakenAtManual(e.target.value)}
            className="rounded border border-white/15 bg-white/5 px-2 py-1 text-xs text-white"
          />
        </div>
      )}

      {/* Map picker — only shown before upload so picking a location
          actually flows into the upload payload. */}
      {showPreUpload && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
          <p className="mb-2 text-white/50">
            拍摄地点（可选 — 优先用 EXIF GPS）
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {picked ? (
                <span className="text-white/80">
                  📍{' '}
                  <span className="font-medium text-white">
                    {picked.name}
                  </span>
                  <span className="ml-2 text-white/40">
                    ({picked.lat.toFixed(4)}, {picked.lng.toFixed(4)})
                  </span>
                </span>
              ) : exif?.lat != null && exif?.lng != null ? (
                <span className="text-white/60">
                  📍 EXIF GPS: {exif.lat.toFixed(4)}, {exif.lng.toFixed(4)}
                </span>
              ) : (
                <span className="text-white/40">
                  无 GPS — 选择地点让照片出现在地球仪上
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              disabled={busy}
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              {picked ? '🗺️ 更改地点' : '🗺️ 选择地点'}
            </button>
          </div>
        </div>
      )}

      {/* Explicit upload trigger. The user picks time/location first,
          then clicks here. The picked values are sent in the upload
          payload. */}
      {showUploadBtn && (
        <button
          type="button"
          onClick={doUpload}
          disabled={busy}
          className="block w-full rounded bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          上传
        </button>
      )}

      {/* EXIF readout */}
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

      {/* Result */}
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

      {mapOpen && (
        <MapPicker
          initial={picked}
          onSelect={(loc) => {
            setPicked(loc);
            setMapOpen(false);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}