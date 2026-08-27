import type { MetadataRoute } from 'next';

const SITE_URL = 'https://lifeframe.frank2025.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // / and /welcome are both indexable. / is the canonical home
      // URL; middleware redirects guests from / to /welcome (marketing
      // landing) so crawlers see real content instead of a redirect
      // chain into the login form. /login, /upload, and /api remain
      // disallowed — they're auth-gated or internal.
      allow: ['/', '/welcome'],
      disallow: ['/login', '/upload', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}