import type { MetadataRoute } from 'next';

const SITE_URL = 'https://lifeframe.frank2025.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default — text / HTML crawlers. / and /welcome are the only
      // indexable entry points; /login, /upload, /admin, /api are
      // auth-gated or internal. Photo content is never reachable
      // from a public HTML route — the auth-gated image proxy at
      // /api/photos/[key]/image returns X-Robots-Tag: noimageindex
      // (Task 3) and the image-bot block below prevents Google /
      // Bing Images from crawling even that route.
      {
        userAgent: '*',
        allow: ['/', '/welcome'],
        disallow: ['/login', '/upload', '/admin', '/api'],
      },
      // Frank #7243 Task 3: keep image content out of Google
      // Images / Bing Images. The image proxy already returns
      // X-Robots-Tag: noimageindex on every response, but
      // Googlebot / Bingbot still crawl HTML pages — the only
      // way to keep photo content from showing up in image
      // search is to block the dedicated image bots across the
      // whole site. Listed as separate rules so the wildcard
      // rule above isn't overridden.
      {
        userAgent: ['Googlebot-Image', 'Bingbot-Image'],
        disallow: ['/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}