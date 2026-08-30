import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeGallery } from '@/components/HomeGallery';

// Frank #7243 Task 6: home page has the hero (globe + CTAs) +
// one H2 section (Features) + footer. B3 commit 94faa4c also
// added Privacy + FAQ sections (3 H2 minimum for doc acceptance),
// but Frank removed them on #7281 since the site is for his
// personal use only — privacy commitment and FAQ don't apply
// when there's no public marketing audience.
//
// canonical: self-referential per Task 7. The page is indexable
// (overrides layout default noindex) because it's the primary
// entry point. The Features H2 below the hero gives search
// engines some indexable body text.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
  alternates: {
    canonical: '/',
  },
};

const FEATURES = [
  {
    icon: '⏳',
    title: '时间旅行',
    body: '按年月重看生活的片段。',
  },
  {
    icon: '🌏',
    title: '人生足迹',
    body: '将照片中的地点汇成一张专属地图。',
  },
  {
    icon: '📷',
    title: '照片自动整理',
    body: '读取拍摄时间与地点，减少手动分类。',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero — globe + CTAs. Mobile: content-fit (HomeGallery's
          internal flex layout handles mobile stacking). Desktop:
          min-h-viewport so the hero fills the first viewport
          without the marketing sections scrolling it off. */}
      <section
        aria-label="LifeFrame 简介"
        className="relative lg:min-h-[calc(100vh-65px)] lg:w-full lg:overflow-hidden"
      >
        <HomeGallery />
      </section>

      {/* Features — three core capability cards. The other two
          sections (隐私承诺 + 常见问题) were added in B3 commit
          94faa4c and removed in B5 (#7281) since this site is
          for Frank's personal use only. */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="mx-auto max-w-4xl px-6 py-16 sm:py-24"
      >
        <p className="mb-2 text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          Features
        </p>
        <h2
          id="features-heading"
          className="mb-10 text-3xl font-light text-black dark:text-white sm:text-4xl"
        >
          三项核心能力
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="rounded-lg border border-black/10 bg-black/[0.02] p-6 dark:border-white/10 dark:bg-white/[0.02]"
            >
              <div className="text-3xl" aria-hidden="true">
                {f.icon}
              </div>
              <h3 className="mt-3 text-lg font-medium text-black dark:text-white">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-black/70 dark:text-white/70">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Footer — contact + site URL. Slimmed down from the B3
          marketing-style footer (Frank #7281 — personal-use site,
          no need for prominent contact + tagline). */}
      <footer className="border-t border-black/10 dark:border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-10 text-xs text-black/40 dark:text-white/40">
          <p>© 2026 Frank Ding · LifeFrame</p>
          <p className="mt-1">
            <Link
              href="https://lifeframe.frank2025.com"
              className="transition hover:text-black/70 dark:hover:text-white/70"
            >
              https://lifeframe.frank2025.com
            </Link>
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link
              href="/welcome"
              className="transition hover:text-black/70 dark:hover:text-white/70"
            >
              产品介绍
            </Link>
            <a
              href="mailto:dingfeng901112@gmail.com"
              className="transition hover:text-black/70 dark:hover:text-white/70"
            >
              联系开发者
            </a>
            <span>·</span>
            <span>位置数据可选择保留或移除</span>
          </p>
        </div>
      </footer>
    </>
  );
}
