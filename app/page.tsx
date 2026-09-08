import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeGallery } from '@/components/HomeGallery';
import { SiteFooter } from '@/components/SiteFooter';
import { getLocale } from '@/lib/i18n-server';
import { t, type Locale } from '@/lib/i18n';

// Frank #7243 Task 6: home page has the hero (globe + CTAs) +
// one H2 section (Features) + footer. B3 commit 94faa4c also
// added Privacy + FAQ sections (3 H2 minimum for doc acceptance),
// but Frank removed them on #7281 since the site is for his
// personal use only — privacy commitment and FAQ don't apply
// when there's no public marketing audience.
//
// Frank #7304 (B7): page is now async so getLocale() can run
// here and pass `locale` down to HomeGallery (a client component)
// so the entire home page — hero, features, footer — flips
// between Chinese / Japanese atomically.
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

// Frank #7304: build the feature cards from the translation
// dict so adding / changing copy never touches JSX. Same shape
// as before — three cards (time travel, life journey, auto
// organize) — just strings come from t().
function buildFeatures(locale: Locale) {
  return [
    {
      icon: '⏳',
      title: t(locale, 'features.timeTravel.title'),
      body: t(locale, 'features.timeTravel.body'),
    },
    {
      icon: '🌏',
      title: t(locale, 'features.lifeJourney.title'),
      body: t(locale, 'features.lifeJourney.body'),
    },
    {
      icon: '📷',
      title: t(locale, 'features.autoOrganize.title'),
      body: t(locale, 'features.autoOrganize.body'),
    },
  ];
}

export default async function Home() {
  const locale = await getLocale();
  const FEATURES = buildFeatures(locale);
  return (
    <>
      {/* Hero — globe + CTAs. Mobile: content-fit (HomeGallery's
          internal flex layout handles mobile stacking). Desktop:
          Frank #0906 round-13: capped at 80vh so the Features
          section below is visible without scrolling on most
          monitors. HomeGallery's internal flex layout handles
          desktop stacking (hero text + globe + controls + timeline
          in a column). */}
      <section
        aria-label="LifeFrame 简介"
        className="relative w-full lg:overflow-hidden"
      >
        <HomeGallery locale={locale} />
      </section>

      {/* Features — three core capability cards. The other two
          sections (隐私承诺 + 常见问题) were added in B3 commit
          94faa4c and removed in B5 (#7281) since this site is
          for Frank's personal use only. Frank #7304: heading
          + eyebrow + per-card title + body all come from t(). */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="mx-auto max-w-4xl px-6 py-16 sm:py-24"
      >
        <p className="mb-2 text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          {t(locale, 'features.eyebrow')}
        </p>
        <h2
          id="features-heading"
          className="mb-10 text-3xl font-light text-black dark:text-white sm:text-4xl"
        >
          {t(locale, 'features.heading')}
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
              <p className="mt-2 text-sm leading-relaxed text-black/70 dark:text-white/75">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Footer — Frank #0906 round-13 (P1 #8): use the unified
          <SiteFooter /> component instead of an inline footer. */}
      <SiteFooter locale={locale} />
    </>
  );
}
