import Link from 'next/link';
import {
  SITE_AUTHOR,
  SITE_GITHUB_URL,
  SITE_NAME,
  SITE_URL,
} from '@/lib/site-config';
import { t, type Locale } from '@/lib/i18n';

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
      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-8 md:grid-cols-3 md:gap-10">
          {/* Brand block */}
          <div className="md:col-span-2">
            <p className="text-base font-light text-black dark:text-white">
              {SITE_NAME}
            </p>
            <p className="mt-1 text-xs text-black/55 dark:text-white/55">
              {t(locale, 'footer.brand.title')}
            </p>
            <p className="mt-1 text-xs text-black/40 dark:text-white/40">
              {t(locale, 'footer.brand.subtitle')}
            </p>
            <p className="mt-3 text-xs text-black/40 dark:text-white/40">
              © 2026 {SITE_AUTHOR} · {SITE_NAME}
            </p>
            <p className="mt-1">
              <Link
                href={SITE_URL}
                className="text-xs text-black/50 transition hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"
              >
                {SITE_URL}
              </Link>
            </p>
          </div>

          {/* Links column */}
          <div>
            <p className="text-xs uppercase tracking-wider text-black/40 dark:text-white/40">
              {/* Section label is the same in both locales — it's a
                  UI affordance, not content. */}
              <span aria-hidden="true">Links</span>
            </p>
            <ul className="mt-3 space-y-1.5 text-xs">
              <li>
                <Link
                  href="/welcome"
                  className="text-black/70 transition hover:text-black dark:text-white/70 dark:hover:text-white"
                >
                  {t(locale, 'footer.productIntro')}
                </Link>
              </li>
              <li>
                <a
                  href="mailto:dingfeng901112@gmail.com"
                  className="text-black/70 transition hover:text-black dark:text-white/70 dark:hover:text-white"
                >
                  {t(locale, 'footer.contactDev')}
                </a>
              </li>
              <li>
                <a
                  href={SITE_GITHUB_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-black/70 transition hover:text-black dark:text-white/70 dark:hover:text-white"
                >
                  {t(locale, 'footer.sources')} ↗
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Privacy notice row — the previous version made this
            look like just another inline link; now it's a dedicated
            block with a 🔒 icon + tooltip explaining the actual
            user-facing behavior (the toggle is in /admin/upload). */}
        <div className="mt-8 flex items-start gap-2 rounded-md border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-black/70 dark:border-white/10 dark:bg-white/[0.02] dark:text-white/70">
          <span aria-hidden="true">🔒</span>
          <p>
            {t(locale, 'footer.tagline')}
            <span
              className="ml-2 cursor-help text-black/40 dark:text-white/40"
              title={t(locale, 'footer.privacy.tooltip')}
              aria-label={t(locale, 'footer.privacy.tooltip')}
            >
              ⓘ
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
