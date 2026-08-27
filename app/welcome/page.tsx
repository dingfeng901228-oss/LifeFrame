import type { Metadata } from 'next';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'LifeFrame — 用照片，留下生活的痕迹',
  description:
    '个人照片生活记录与时空记忆展示网站。3D 地球仪 + 时间轴 + EXIF 自动读取，把你的照片按时间和空间重新组织成可探索的「生活博物馆」。',
  // Override the layout's default robots: { index: false } so this
  // public marketing page actually shows up in Google.
  robots: { index: true, follow: true },
};

const SITE_URL = 'https://lifeframe.frank2025.com';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'LifeFrame',
  alternateName: 'LifeFrame · 写真で、暮らしの軌跡を残す',
  url: SITE_URL,
  description:
    '个人照片生活记录与时空记忆展示网站。3D 地球仪 + 时间轴 + EXIF 自动读取，把你的照片按时间和空间重新组织成可探索的「生活博物馆」。',
  inLanguage: 'zh-Hans',
  author: { '@type': 'Person', name: 'Frank Ding' },
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'Web Browser',
};

const features = [
  {
    title: '🌍 3D 地球仪',
    body:
      '每张照片按 GPS 投射到地球仪上。点击照片点进入详情。多张照片在同一位置会聚合成「集群」数字徽章，可一键展开查看。',
  },
  {
    title: '⏳ 时间轴',
    body:
      '一条从 1990 到现在的进度条。每张照片是一个章节标记。拖动筛选 ±30 天的地球仪照片，像播放器一样「拖动滑块」。',
  },
  {
    title: '📅 On This Day',
    body:
      '「今天历史上」——显示去年、前年拍的同一天照片。最适合每年生日/纪念日翻开看。',
  },
  {
    title: '📷 EXIF 自动',
    body:
      '上传自动读取拍摄时间、GPS、相机型号。没有 GPS 的老照片也能手动选地点（地图选点 / 使用当前位置）。',
  },
  {
    title: '🏷️ 多标签分类',
    body:
      '人物 / 风景等分类多选。所有照片上传后都能重新组织。',
  },
  {
    title: '🔒 私人默认',
    body:
      '所有照片默认私人（登录才能看）。后续会加公开/私密切换，让你能把精选的旅行照片分享给朋友。',
  },
];

export default async function WelcomePage() {
  // Fetch a small set of public/unlisted scenery photos so guests can
  // browse without signing in (Frank #7071: /welcome 游客模式 浏览
  // 风景照片). RLS auto-excludes 'person' category photos for anon;
  // we additionally filter visibility to public/unlisted so private
  // photos stay hidden from the marketing page (privacy §24: private
  // is owner-only by definition).
  const supabase = await createSupabaseServerClient();
  const { data: photos } = await supabase
    .from('photos')
    .select(
      'key, thumbnail_url, public_url, filename, taken_at, location_name, categories, visibility',
    )
    .in('visibility', ['public', 'unlisted'])
    .order('taken_at', { ascending: false })
    .limit(50);
  const sceneryPhotos = (photos ?? [])
    .filter((p) => !(p.categories ?? []).includes('person'))
    .slice(0, 8);

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
              Personal photo journal
            </p>
            <h1 className="text-4xl font-light leading-tight text-black dark:text-white sm:text-5xl">
              用照片，留下生活的痕迹
            </h1>
            <p className="mt-3 text-sm tracking-widest text-black/40 dark:text-white/40">
              写真で、暮らしの軌跡を残す
            </p>
          </header>

          <section className="mb-16 space-y-5 text-lg leading-relaxed text-black/75 dark:text-white/75">
            <p>
              LifeFrame 是一个<strong className="text-black dark:text-white">个人照片生活记录与时空记忆展示网站</strong>。
              把你的照片按<strong className="text-black dark:text-white">时间</strong>
              和<strong className="text-black dark:text-white">空间</strong>
              重新组织成可探索的「生活博物馆」。
            </p>
            <p>
              不是传统的瀑布流相册。是一颗会慢慢自转的
              <strong className="text-black dark:text-white">3D 地球仪</strong>、
              一条像播放器进度条一样的
              <strong className="text-black dark:text-white">时间轴</strong>，
              以及一张「今天历史上」卡片。
            </p>
          </section>

          <section className="mb-16">
            <h2 className="mb-6 text-2xl font-light text-black dark:text-white">核心功能</h2>
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

          {sceneryPhotos.length > 0 && (
            <section className="mb-16">
              <div className="mb-6 flex items-baseline justify-between">
                <h2 className="text-2xl font-light text-black dark:text-white">
                  🌍 风景照片
                </h2>
                <Link
                  href="/login"
                  className="text-sm text-black/60 dark:text-white/60 transition hover:text-black dark:hover:text-white"
                >
                  登录查看更多 →
                </Link>
              </div>
              <p className="mb-6 text-sm text-black/50 dark:text-white/50">
                公开分享的风景类照片 — 人物照片需要登录查看
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {sceneryPhotos.map((p) => (
                  <Link
                    key={p.key}
                    href={`/p/${encodeURIComponent(p.key)}`}
                    className="group relative overflow-hidden rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] transition hover:border-black/30 dark:hover:border-white/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.thumbnail_url || p.public_url}
                      alt={p.filename}
                      className="aspect-square w-full object-cover transition group-hover:scale-105"
                      loading="lazy"
                    />
                    {p.location_name && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <p className="truncate text-xs text-white/90">
                          📍 {p.location_name}
                        </p>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="mb-16 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-10 text-center">
            <p className="mb-2 text-black/60 dark:text-white/60">准备好开始记录了吗？</p>
            <p className="mb-6 text-sm text-black/40 dark:text-white/40">
              邮箱 + 密码注册，不需要信用卡
            </p>
            <Link
              href="/login"
              className="inline-block rounded-full bg-black px-8 py-3 text-sm font-medium text-white transition hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              登录 / 注册 →
            </Link>
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
          </footer>
        </article>
      </main>
    </>
  );
}