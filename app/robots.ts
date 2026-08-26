import type { MetadataRoute } from 'next';

const SITE_URL = 'https://lifeframe.frank2025.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // Only the public landing page is indexable. Everything else
      // is behind auth (middleware redirects to /login) or API, so
      // there's no point letting crawlers try.
      allow: ['/welcome'],
      disallow: ['/login', '/upload', '/api', '/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}