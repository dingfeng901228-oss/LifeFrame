import type { Metadata } from 'next';
import { HomeGallery } from '@/components/HomeGallery';

// Override the layout's default robots: { index: false } so / is
// indexable. robots.txt already declares `allow: ['/', '/welcome']`
// (see app/robots.ts) and #1643af4 already lets guests browse /
// via the RLS-filtered HomeGallery — Google just needs the page
// to agree with robots.txt instead of tagging itself noindex.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function Home() {
  return (
    <div className="relative h-[calc(100vh-65px)] w-full overflow-hidden">
      <HomeGallery />
    </div>
  );
}
