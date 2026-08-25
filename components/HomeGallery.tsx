'use client';

import { useEffect, useState } from 'react';
import { Globe } from '@/components/Globe';
import { createClient } from '@supabase/supabase-js';

type PhotoRow = {
  lat: number | null;
  lng: number | null;
  public_url: string;
  filename: string;
  taken_at: string | null;
  created_at: string;
};

export function HomeGallery() {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setLoading(false);
      return;
    }
    const supabase = createClient(url, key);
    supabase
      .from('photos')
      .select('lat, lng, public_url, filename, taken_at, created_at')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) {
          console.error('[gallery fetch error]', error.message);
        } else if (data) {
          setPhotos(data as PhotoRow[]);
        }
        setLoading(false);
      });
  }, []);

  const markers = photos
    .filter((p): p is PhotoRow & { lat: number; lng: number } =>
      p.lat != null && p.lng != null,
    )
    .map((p) => ({
      location: [p.lat, p.lng] as [number, number],
      size: 0.06,
    }));

  return (
    <>
      <div className="absolute inset-0">
        <Globe markers={markers} />
      </div>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-xs tracking-[0.4em] text-white/50 uppercase">
          写真で、暮らしの軌跡を残す
        </p>
        <h1 className="mt-4 text-3xl font-light text-white md:text-4xl">
          用照片，留下生活的痕迹。
        </h1>
        <p className="mt-3 max-w-sm text-sm text-white/50">
          {loading
            ? '加载中…'
            : photos.length === 0
              ? '首页 3D 地球仪 — 上传第一张照片点亮地点'
              : `${photos.length} 张照片已点亮地点`}
        </p>
      </div>
    </>
  );
}
