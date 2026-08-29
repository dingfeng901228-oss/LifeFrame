import type { MetadataRoute } from 'next';

const SITE_URL = 'https://lifeframe.frank2025.com';

// Frank #7243 P0: sitemap lists ONLY public landing pages.
// Per-photo URLs (/p/[key]) are intentionally excluded —
// those pages can be private / unlisted, and surfacing them
// in a public sitemap would leak their existence (search
// engines index the URLs even when the page returns a 404
// or redirect to /login). Photo URLs are reachable via the
// gallery UI or shared directly via copy-link, not via search.
//
// Both / and /welcome are public. / is the canonical home
// (RLS-filtered gallery — guests see public-only photos).
// /welcome is the marketing landing page with the long
// description + feature list + dual CTA. Listing both means
// search engines can index whichever one a shared link
// points at first, and the WebSite JSON-LD on /welcome
// declares the canonical site URL so we don't fragment.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/welcome`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ];
}