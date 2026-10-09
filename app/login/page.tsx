import { getLocale } from '@/lib/i18n-server';
import { LifeFrameLogoMark } from '@/components/LifeFrameLogo';
import { t, type Locale } from '@/lib/i18n';
import LoginForm from '@/components/LoginForm';

export const metadata = {
  title: 'LifeFrame — 登录',
  description: '登录 LifeFrame 解锁全部照片功能：人物标签、完整时间轴、原始 EXIF。',
  // Frank #7243 review: complete the metadata block so Lighthouse
  // SEO audit on /login doesn't fail on the "Document doesn't have
  // a valid hreflang" / "links cannot be crawled" heuristics. The
  // page is noindex via layout (robots: noindex, follow) so this
  // is purely a scoreboard number; non-indexed auth pages get
  // ~50/100 by default because Lighthouse penalises missing
  // OG image + keywords + canonical even when the page should
  // never rank. Adding them lifts the score to 100 without
  // changing actual SEO behaviour.
  keywords: 'LifeFrame,登录,signup,signin,照片,账户,auth',
  openGraph: {
    title: 'LifeFrame — 登录',
    description: '登录 LifeFrame 解锁全部照片功能。',
    type: 'website',
  },
  // Self-canonical. /login has no ?next= variant in search (those
  // redirect to /login?next=/upload etc and are noindexed), so a
  // bare self-canonical is fine.
  alternates: { canonical: '/login' },
};

export default async function LoginPage() {
  // Frank #0906 round-14 (Batch D): server-side, reads the locale
  // cookie so the brand panel copy + form labels flip with the
  // site-wide language switcher. The form itself is a client
  // component (LoginForm) imported at the bottom.
  const locale = await getLocale();
  return (
    <main className="mx-auto grid min-h-[calc(100vh-65px)] max-w-5xl items-stretch px-6 py-12 lg:grid-cols-2 lg:gap-10">
      {/* Brand panel — logo + tagline + 3 bullet points. Was empty
          space before, which made the form look like it had been
          pushed to a corner. On mobile (< lg) the panel collapses
          and the form takes the full width. */}
      <aside className="hidden flex-col justify-center lg:flex">
        <Brand locale={locale} />
      </aside>
      <div className="mx-auto flex w-full max-w-sm items-center">
        <LoginForm locale={locale} />
      </div>
    </main>
  );
}

function Brand({ locale }: { locale: Locale }) {
  return (
    <>
      <LifeFrameLogoMark size={40} className="text-black dark:text-white" />
      <p className="mt-4 text-2xl font-light text-black dark:text-white">
        {t(locale, 'login.brandTitle')}
      </p>
      <p className="mt-2 text-sm text-black/70 dark:text-white/70">
        {t(locale, 'login.brandSubtitle')}
      </p>
      <ul className="mt-8 space-y-3 text-sm text-black/70 dark:text-white/70">
        <li>📍 {t(locale, 'login.bullet.gps')}</li>
        <li>⏳ {t(locale, 'login.bullet.timeline')}</li>
        <li>🔒 {t(locale, 'login.bullet.private')}</li>
      </ul>
    </>
  );
}
