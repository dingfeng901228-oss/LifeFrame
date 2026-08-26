import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import { PWARegistrar } from '@/components/PWARegistrar';
import { AuthButton } from '@/components/AuthButton';

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
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'LifeFrame Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LifeFrame — 用照片，留下生活的痕迹',
    description: DESCRIPTION,
    images: ['/icon-512.png'],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="min-h-screen bg-black text-white antialiased">
        <header className="relative z-10 flex items-center justify-between border-b border-white/10 px-6 py-4">
          <Link href="/" className="text-lg font-medium tracking-wide">
            LifeFrame
          </Link>
          <nav className="flex items-center gap-6 text-sm text-white/60">
            <Link href="/upload" className="hover:text-white">
              上传
            </Link>
            <AuthButton />
          </nav>
        </header>
        <main>{children}</main>
        <PWARegistrar />
      </body>
    </html>
  );
}
