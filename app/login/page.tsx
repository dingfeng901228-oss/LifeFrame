import { getLocale } from '@/lib/i18n-server';
import { LifeFrameLogoMark } from '@/components/LifeFrameLogo';
import { t, type Locale } from '@/lib/i18n';
import LoginForm from '@/components/LoginForm';

export const metadata = {
  title: 'LifeFrame — 登录',
  description: '登录 LifeFrame 解锁全部照片功能。',
};

export default async function LoginPage() {
  // Frank #0906 round-14 (Batch D): server-side, reads the locale
  // cookie so the brand panel copy + form labels flip with the
  // site-wide language switcher. The form itself is a client
  // component (LoginForm) imported at the bottom.
  const locale = await getLocale();
  return (
    <div className="mx-auto grid min-h-[calc(100vh-65px)] max-w-5xl items-stretch px-6 py-12 lg:grid-cols-2 lg:gap-10">
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
    </div>
  );
}

function Brand({ locale }: { locale: Locale }) {
  return (
    <>
      <LifeFrameLogoMark size={40} className="text-black dark:text-white" />
      <p className="mt-4 text-2xl font-light text-black dark:text-white">
        {t(locale, 'login.brandTitle')}
      </p>
      <p className="mt-2 text-sm text-black/60 dark:text-white/60">
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
