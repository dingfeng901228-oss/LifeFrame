import type { MetadataRoute } from 'next';

const SITE_URL = 'https://lifeframe.frank2025.com';

// Only the public marketing page is indexable. Home /, /login, /upload
// are all behind auth (middleware redirects to /login) so search engines
// can never reach them — listing them here would just be noise.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/welcome`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 1.0,
    },
  ];
}