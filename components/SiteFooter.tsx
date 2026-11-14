import Link from 'next/link';
import {
  SITE_GITHUB_URL,
  SITE_NAME,
  SITE_URL,
} from '@/lib/site-config';
import { t, type Locale } from '@/lib/i18n';
import { LifeFrameLogoMark } from '@/components/LifeFrameLogo';

/**
 * Frank #0906 round-13 (P1 #8): unified site footer.
 *
 * Replaces the two hand-written footers in app/page.tsx and
 * app/welcome/page.tsx. P1 #8 issues were:
 *   - The home page footer crammed copyright + url +
 *     productIntro link + contact link + tagline all in
 *     one inline row separated by "·" — visually noisy and
 *     the "位置数据可选择保留或删除" privacy line looked like
 *     text, not a notice.
 *   - The welcome page footer was its own thing; this
 *     keeps both pages consistent.
 *
 * Layout (3-row desktop, 1-col stacked mobile):
 *   Row 1 — Brand block: site title + subtitle + copyright
 *   Row 2 — Links: 产品介绍 / 联系开发者 / 源代码 /
 *           GitHub
 *   Row 3 — Privacy notice (with hover tooltip explaining
 *           the toggle behavior)
 */
export function SiteFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="border-t border-black/10 dark:border-white/10">
      {/* Frank #0906 round-15: the two columns sat at opposite ends
          of a 3-column grid, ~450 px apart. The grid is now sized
          to the content so the brand block and the link list read
          as one band. The padding was also pulled in — the footer
          used to add a full 96 px band of black below the feature
          cards. */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid gap-8 md:grid-cols-[minmax(0,18rem)_minmax(0,9rem)] md:gap-10">
          {/* Brand block */}
          <div>
            <div className="flex items-center gap-2">
              <LifeFrameLogoMark
                size={28}
                className="text-black dark:text-white"
              />
              <p className="text-base font-light text-black dark:text-white">
                {SITE_NAME}
              </p>
            </div>
            <p className="mt-1 text-xs text-black/75 dark:text-white/75">
              {t(locale, 'footer.brand.title')}
            </p>
            <p className="mt-1 text-xs text-black/80 dark:text-white/80">
              {t(locale, 'footer.brand.subtitle')}
            </p>
            {/* The copyright line is one translated string, so the
                spaces around "·" can never collapse. */}
            <p className="mt-3 text-xs text-black/80 dark:text-white/80">
              {t(locale, 'footer.copyright')}
            </p>
            <p className="mt-1">
              <Link
                href={SITE_URL}
                className="text-xs text-black/80 transition hover:text-black dark:text-white/80 dark:hover:text-white"
              >
                {t(locale, 'footer.siteUrl')}
              </Link>
            </p>
          </div>

          {/* Links column */}
          <div>
            <p className="text-xs uppercase tracking-wider text-black/80 dark:text-white/80">
              {/* Section label is the same in both locales — it's a
                  UI affordance, not content. */}
              <span aria-hidden="true">Links</span>
            </p>
            <ul className="mt-3 space-y-1.5 text-xs">
              <li>
                <Link
                  href="/welcome"
                  prefetch={false}
                  className="text-black/80 transition hover:text-black dark:text-white/80 dark:hover:text-white"
                >
                  {t(locale, 'footer.productIntro')}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:dingfeng901112@gmail.com"
                  className="text-black/80 transition hover:text-black dark:text-white/80 dark:hover:text-white"
                >
                  {t(locale, 'footer.contactDev')}
                </a>
              </li>
              <li>
                <a
                  href={SITE_GITHUB_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-black/80 transition hover:text-black dark:text-white/80 dark:hover:text-white"
                >
                  {t(locale, 'footer.sources')} ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Privacy notice row — a dedicated block, plus the
            explanation as ALWAYS-VISIBLE small text. It used to
            live in a ⓘ hover tooltip, so on a phone (and for
            anyone who does not hover) the actual behaviour was
            invisible. */}
        <div className="mt-6 flex items-start gap-2 rounded-md border border-black/15 bg-black/[0.02] px-3 py-2 text-xs text-black/80 dark:border-white/15 dark:bg-white/[0.02] dark:text-white/80">
          <span aria-hidden="true">🔒</span>
          <p>{t(locale, 'footer.tagline')}</p>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-black/75 dark:text-white/75">
          {t(locale, 'footer.privacy.tooltip')}
        </p>
      </div>
    </footer>
  );
}
