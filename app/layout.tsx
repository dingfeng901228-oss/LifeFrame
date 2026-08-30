import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { PWARegistrar } from '@/components/PWARegistrar';
import { AuthButton } from '@/components/AuthButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AdminLink } from '@/components/AdminLink';
import { HomeLogo } from '@/components/HomeLogo';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { getLocale } from '@/lib/i18n-server';
import { t } from '@/lib/i18n';

const SITE_URL = 'https://lifeframe.frank2025.com';
const DESCRIPTION =
  '个人照片生活记录与时空记忆展示网站。3D 地球仪 + 时间轴 + EXIF 自动读取，把你的照片按时间和空间重新组织成可探索的「生活博物馆」。';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'LifeFrame — 用照片，留下生活的痕迹',
    template: '%s · LifeFrame',
  },
  description: DESCRIPTION,
  applicationName: 'LifeFrame',
  authors: [{ name: 'Frank Ding' }],
  keywords: [
    'LifeFrame',
    '照片',
    '回忆',
    '地球仪',
    '时间轴',
    'EXIF',
    '照片管理',
    '记忆博物馆',
    '个人相册',
    'Life Journal',
    'photo journal',
  ],
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: SITE_URL,
    siteName: 'LifeFrame',
    title: 'LifeFrame — 用照片，留下生活的痕迹',
    description: DESCRIPTION,
    // Frank #7243 Task 7: replace the app-icon OG image with a
    // proper 1200x630 social-share banner. The banner was generated
    // via image_generate (1280x720 JPEG — close enough to the
    // 1.91:1 OG standard; most platforms accept either 16:9 or
    // 1.91:1 and re-crop to fit). Alt text describes the brand
    // pitch instead of just "Logo" so social previews are useful
    // when the image fails to load.
    images: [
      {
        url: '/og-banner.jpg',
        width: 1280,
        height: 720,
        alt: 'LifeFrame — 用照片，留下生活的痕迹',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LifeFrame — 用照片，留下生活的痕迹',
    description: DESCRIPTION,
    images: ['/og-banner.jpg'],
  },
  // Most pages are auth-gated; /welcome overrides to index: true.
  robots: { index: false, follow: true },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

// Next.js App Router: `viewport` export generates <meta name="theme-color">
// and <meta name="viewport"> automatically — no manual <head> tags needed.
export const viewport = {
  themeColor: '#0a1c3a',
  width: 'device-width',
  initialScale: 1,
};

// Pre-hydration script. Reads the stored theme preference (or
// falls back to the OS preference) and applies the matching class
// to <html> before React hydrates. Without this, the page would
// flash the default dark theme for a frame on every load for
// users who chose "light" or whose OS is in light mode.
const themeBootstrap = `
(function () {
  try {
    var v = localStorage.getItem('lifeframe-theme');
    var resolved;
    if (v === 'light' || v === 'dark') {
      resolved = v;
    } else {
      resolved = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    var root = document.documentElement;
    if (resolved === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  } catch (e) {}
})();
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Frank #7304: read locale from cookie on every server render
  // so the html lang + nav.start text + downstream app/page.tsx
  // + HomeGallery.tsx all see the same value via lib/i18n.ts::t().
  const locale = await getLocale();
  return (
    <html lang={locale === 'ja' ? 'ja' : 'zh-Hans'}>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen antialiased">
        <header className="relative z-10 flex items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-6 py-4 text-[var(--text-primary)]">
          <HomeLogo />
          <nav className="flex items-center gap-4 text-sm text-[var(--text-secondary)] sm:gap-6">
            {/* Frank #7129 #1: removed the global-nav "上传" link.
                Upload functionality moved into /admin/upload
                (Frank #7117 #1 / commit 79fddee) and is reachable
                via the AdminLink → /admin/photos sub-nav tab. The
                top-level nav no longer needs to advertise it; non-
                admins never reached /upload anyway (the page
                redirected non-admins to /). */}
            <AdminLink />
            {/* Frank #7243 Task 5 (Day 2): "桌面：登录 + 开始记录".
                Hidden on mobile because the mobile hero already
                surfaces "开始创建我的 LifeFrame" as the primary
                CTA (Task 4) — adding another nav button would
                crowd the small viewport. Routes to /login — the
                login page already redirects signed-in users back
                to / (so this same link works for both "first
                visit" and "returning user" flows). */}
            <Link
              href="/login"
              className="hidden transition hover:text-[var(--text-primary)] sm:inline"
            >
              {t(locale, 'nav.start')}
            </Link>
            {/* Frank #7304: LanguageSwitcher (zh | ja). Writes to
                the lifeframe-locale cookie + triggers router.refresh()
                on change. Lives in the header nav but is shown on
                all viewports (it's compact — single <select>). */}
            <LanguageSwitcher current={locale} />
            <ThemeToggle />
            <AuthButton />
          </nav>
        </header>
        <main>{children}</main>
        <PWARegistrar />
        <OnboardingFlow />
      </body>
    </html>
  );
}
