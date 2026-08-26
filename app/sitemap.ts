import type { MetadataRoute } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase';

const SITE_URL = 'https://lifeframe.frank2025.com';

// Dynamic sitemap. Includes /welcome (always) plus every /p/[key]
// where the photo's visibility is 'public'. 'unlisted' is excluded
// (it's reachable by direct URL but should NOT be searchable).
// 'private' obviously excluded. If Supabase is down, we still
// return /welcome so the sitemap file is valid; better an
// incomplete sitemap than a 500.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseEntries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/welcome`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1.0,
    },
  ];

  try {
    const supabase = getSupabaseAdmin();
    const { data: publicPhotos, error } = await supabase
      .from('photos')
      .select('key, created_at')
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!error && publicPhotos) {
      const photoEntries: MetadataRoute.Sitemap = publicPhotos.map((p) => ({
        url: `${SITE_URL}/p/${p.key}`,
        lastModified: new Date(p.created_at),
        changeFrequency: 'weekly',
        priority: 0.7,
      }));
      return [...baseEntries, ...photoEntries];
    }
  } catch {
    // Fall through to base entries.
  }

  return baseEntries;
}