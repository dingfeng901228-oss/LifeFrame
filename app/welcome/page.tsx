import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n-server';

const SITE_URL = 'https://lifeframe.frank2025.com';

export const metadata: Metadata = {
  title: 'LifeFrame — 用照片，留下生活的痕迹',
  description:
    '个人照片生活记录与时空记忆展示网站。3D 地球仪 + 时间轴 + EXIF 自动读取，把你的照片按时间和空间重新组织成可探索的「生活博物馆」。',
  // Override the layout's default robots: { index: false } so this
  // public marketing page actually shows up in Google.
  robots: { index: true, follow: true },
  // Frank #7243 Task 7 (SEO): self-referential canonical. The page
  // is unique (not a duplicate of /) — Google can index both /
  // and /welcome as separate entries.
  alternates: {
    canonical: '/welcome',
  },
};

export default async function WelcomePage() {
  // Frank #0906 round-13 (P0 #4): read locale server-side so the
  // welcome page copy flips with the site-wide language switcher.
  // Previously all Chinese-only; Japanese-locale visitors saw
  // Chinese. Now it follows the cookie via lib/i18n-server.ts.
  const locale = await getLocale();

  // Frank #0906 round-13: metadata needs to be locale-aware too.
  // export const metadata below uses `t` only at the function
  // level for the JSON-LD description (which is built inside the
  // component) — `metadata` itself stays a static literal because
  // Next 15 metadata export forbids dynamic per-request values.
  // The actual locale-correct title is rendered inside the page
  // via <h1> below; metadata uses the canonical zh form which
  // Google picks up regardless of user-locale.
  // Frank #7108 #4: removed the in-page scenery photo grid. Guests
  // can browse scenery on the actual globe at /, which is the
  // experience Frank actually wants. The CTA pair at the bottom of
  // this page now offers 登录/注册 and 游客模式浏览 side-by-side.

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'LifeFrame',
    alternateName: 'LifeFrame · 写真で、暮らしの軌跡を残す',
    url: SITE_URL,
    description: t(locale, 'welcome.tagline'),
    inLanguage: locale === 'ja' ? 'ja' : 'zh-Hans',
    author: { '@type': 'Person', name: 'Frank Ding' },
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web Browser',
  };

  const features: Array<{
    title: string;
    body: string;
  }> = [
    {
      title: t(locale, 'welcome.features.globe.title'),
      body: t(locale, 'welcome.features.globe.body'),
    },
    {
      title: t(locale, 'welcome.features.timeline.title'),
      body: t(locale, 'welcome.features.timeline.body'),
    },
    {
      title: t(locale, 'welcome.features.onthisday.title'),
      body: t(locale, 'welcome.features.onthisday.body'),
    },
    {
      title: t(locale, 'welcome.features.exif.title'),
      body: t(locale, 'welcome.features.exif.body'),
    },
    {
      title: t(locale, 'welcome.features.tags.title'),
      body: t(locale, 'welcome.features.tags.body'),
    },
    {
      title: t(locale, 'welcome.features.private.title'),
      body: t(locale, 'welcome.features.private.body'),
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <article>
          <header className="mb-16">
            <p className="mb-4 text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
              {t(locale, 'welcome.hero.eyebrow')}
            </p>
            <h1 className="text-4xl font-light leading-tight text-black dark:text-white sm:text-5xl">
              {t(locale, 'welcome.hero.title')}
            </h1>
            <p className="mt-3 text-sm tracking-widest text-black/40 dark:text-white/40">
              {t(locale, 'welcome.hero.subtitle')}
            </p>
          </header>

          <section className="mb-16 space-y-5 text-lg leading-relaxed text-black/75 dark:text-white/75">
            <p>
              {t(locale, 'welcome.intro.p1')}
            </p>
            <p>{t(locale, 'welcome.intro.p2')}</p>
          </section>

          <section className="mb-16">
            <h2 className="mb-6 text-2xl font-light text-black dark:text-white">
              {t(locale, 'welcome.features.heading')}
            </h2>
            <ul className="space-y-6">
              {features.map((f) => (
                <li
                  key={f.title}
                  className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-5"
                >
                  <h3 className="mb-2 text-lg font-medium text-black dark:text-white">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-black/65 dark:text-white/65">
                    {f.body}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mb-16 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-10 text-center">
            {/* Frank #7117 #3: dropped the "准备好开始记录了吗？"
                warm-up line above the CTA pair — Frank felt the
                phrasing was heavier than the rest of the page
                warranted. The mb-6 spacing on the next <p>
                covers the gap. */}
            <p className="mb-6 text-sm text-black/40 dark:text-white/40">
              {t(locale, 'welcome.cta.hint')}
            </p>
            {/* Frank #7108 #4: dual-CTA. Primary 登录/注册 still
                routes through /login. Secondary 🌍 游客模式浏览 goes
                to /, where the HomeGallery component renders the
                3D globe with RLS-filtered public / non-person photos
                — that's the guest-browse experience Frank asked for.
                Middleware was loosened so !session can actually
                reach / (previously bounced back to /welcome). */}
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/login"
                className="inline-block rounded-full bg-black px-8 py-3 text-sm font-medium text-white transition hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
              >
                {t(locale, 'welcome.cta.primary')}
              </Link>
              <Link
                href="/"
                className="inline-block rounded-full border border-black/20 px-8 py-3 text-sm font-medium text-black/80 transition hover:border-black/40 hover:text-black dark:border-white/20 dark:text-white/80 dark:hover:border-white/40 dark:hover:text-white"
              >
                {t(locale, 'welcome.cta.secondary')}
              </Link>
            </div>
          </section>

          <footer className="border-t border-black/10 dark:border-white/10 pt-8 text-xs text-black/40 dark:text-white/40">
            <p>© 2026 Frank Ding · LifeFrame</p>
            <p className="mt-1">
              <Link
                href={SITE_URL}
                className="hover:text-black/60 dark:hover:text-white/60 transition"
              >
                {SITE_URL}
              </Link>
            </p>
            <p className="mt-1">{t(locale, 'welcome.footer.tagline')}</p>
          </footer>
        </article>
      </main>
    </>
  );
}
