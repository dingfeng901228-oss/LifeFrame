import './globals.css';
import Link from 'next/link';
import { PWARegistrar } from '@/components/PWARegistrar';

export const metadata = {
  title: 'LifeFrame · 用照片，留下生活的痕迹',
  description: '个人照片生活记录与时空记忆展示网站',
  applicationName: 'LifeFrame',
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
          <nav className="flex gap-6 text-sm text-white/60">
            <Link href="/" className="hover:text-white">
              地球仪
            </Link>
            <Link href="/upload" className="hover:text-white">
              上传
            </Link>
          </nav>
        </header>
        <main>{children}</main>
        <PWARegistrar />
      </body>
    </html>
  );
}
