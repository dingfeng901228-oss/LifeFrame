import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeGallery } from '@/components/HomeGallery';

// Frank #7243 Task 6: home page is the canonical public landing —
// contains the hero (globe + CTAs), three core capabilities,
// privacy commitment, FAQ, and footer. Doc Task 6 acceptance: at
// least 3 semantic H2 sections below the H1 hero.
//
// canonical: self-referential per Task 7. The page is indexable
// (overrides layout default noindex) because it's the primary
// public landing. Per Task 8/B4 scope, the h2 headings + sections
// also give search engines indexable body text below the hero.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
  alternates: {
    canonical: '/',
  },
};

const FEATURES = [
  {
    icon: '⏳',
    title: '时间旅行',
    body: '按年月重看生活的片段。',
  },
  {
    icon: '🌏',
    title: '人生足迹',
    body: '将照片中的地点汇成一张专属地图。',
  },
  {
    icon: '📷',
    title: '照片自动整理',
    body: '读取拍摄时间与地点，减少手动分类。',
  },
];

const FAQS = [
  {
    q: 'LifeFrame 是公开的照片分享网站吗？',
    a: '不是。所有照片默认「私密」（仅登录用户可见）。公开的风景照片可以通过首页 3D 地球仪浏览，但私人内容不会泄露。',
  },
  {
    q: '支持哪些照片格式？',
    a: 'JPEG / PNG / HEIC / WebP。批量上传最多 30 张/批，自动读取 EXIF（拍摄时间、GPS、相机型号）。',
  },
  {
    q: '位置信息会被上传吗？',
    a: '默认情况下，上传时会清除原图 EXIF 中的 GPS 坐标（保护位置隐私）。如需保留原图坐标，可以在上传表单勾选「保留原图 EXIF GPS 坐标」。',
  },
  {
    q: '如何删除照片？',
    a: '登录后访问 /admin/photos，选中要删除的照片，点击「🗑️ 删除」按钮即可（同步删除 R2 存储原图 + 缩略图，无残留）。',
  },
  {
    q: '如何联系开发者？',
    a: '见页面底部 Footer 的邮箱链接。',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero — globe + CTAs. Mobile: content-fit (HomeGallery's
          internal flex layout handles mobile stacking). Desktop:
          min-h-viewport so the hero fills the first viewport
          without the marketing sections scrolling it off. */}
      <section
        aria-label="LifeFrame 简介"
        className="relative lg:min-h-[calc(100vh-65px)] lg:w-full lg:overflow-hidden"
      >
        <HomeGallery />
      </section>

      {/* Section 1 — three core capabilities (H2 #1 of 3 minimum).
          Doc Task 6 acceptance: at least 3 semantic H2 sections
          below the H1 hero, each with descriptive body content. */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="mx-auto max-w-4xl px-6 py-16 sm:py-24"
      >
        <p className="mb-2 text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          Features
        </p>
        <h2
          id="features-heading"
          className="mb-10 text-3xl font-light text-black dark:text-white sm:text-4xl"
        >
          三项核心能力
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
              <p className="mt-2 text-sm leading-relaxed text-black/70 dark:text-white/70">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Section 2 — privacy commitment (H2 #2 of 3 minimum). Doc
          Task 6 acceptance: explicit privacy statement so users
          understand the boundary BEFORE signing up. Pairs with
          the docx 优化需求 Task 3 acceptance (no leaked EXIF /
          no public image URLs). */}
      <section
        id="privacy"
        aria-labelledby="privacy-heading"
        className="border-y border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]"
      >
        <div className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
          <p className="mb-2 text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
            Privacy
          </p>
          <h2
            id="privacy-heading"
            className="mb-6 text-3xl font-light text-black dark:text-white sm:text-4xl"
          >
            隐私承诺
          </h2>
          <ul className="space-y-4 text-sm leading-relaxed text-black/75 dark:text-white/75 sm:text-base">
            <li>
              <strong className="text-black dark:text-white">默认私密：</strong>{' '}
              所有照片默认「private」可见性，仅登录用户可访问。任何访客无法直接读取 R2 上的原始图片 URL（即使知道 URL 也会被代理拦截返回 401/403/404）。
            </li>
            <li>
              <strong className="text-black dark:text-white">GPS 默认剥离：</strong>{' '}
              上传时默认清除原图 EXIF 中的 GPS 坐标（保护位置隐私）。需要保留可以勾选「保留原图 EXIF GPS 坐标」。
            </li>
            <li>
              <strong className="text-black dark:text-white">公开分享可控：</strong>{' '}
              任何照片都可显式切换到「public」进入 sitemap 和社交分享；切换是单向可逆操作，没有自动传播。
            </li>
            <li>
              <strong className="text-black dark:text-white">删除可逆：</strong>{' '}
              在 <code className="font-mono text-xs">/admin/photos</code> 删除照片会同步清理 R2 原图 + 缩略图 + 点赞 + 评论，无残留。
            </li>
          </ul>
        </div>
      </section>

      {/* Section 3 — FAQ (H2 #3 of 3 minimum). Doc Task 6 explicit
          list: 是否公开？支持哪些照片？如何删除？ — we cover
          these plus location retention and developer contact.
          <dl>/<dt>/<dd> for semantic question/answer pairs. */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="mx-auto max-w-3xl px-6 py-16 sm:py-24"
      >
        <p className="mb-2 text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          FAQ
        </p>
        <h2
          id="faq-heading"
          className="mb-10 text-3xl font-light text-black dark:text-white sm:text-4xl"
        >
          常见问题
        </h2>
        <dl className="space-y-6">
          {FAQS.map((f) => (
            <div key={f.q}>
              <dt className="text-base font-medium text-black dark:text-white sm:text-lg">
                {f.q}
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-black/70 dark:text-white/70 sm:text-base">
                {f.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Footer — privacy policy + contact + site URL. Doc Task 6
          requires these at the bottom of the public landing so
          visitors can find contact info without leaving the
          homepage. Privacy policy currently lives inline in the
          privacy section above (no separate /privacy route yet
          — can add one as a follow-up). */}
      <footer className="border-t border-black/10 dark:border-white/10">
        <div className="mx-auto max-w-3xl px-6 py-10 text-xs text-black/40 dark:text-white/40">
          <p>© 2026 Frank Ding · LifeFrame</p>
          <p className="mt-1">
            <Link
              href="https://lifeframe.frank2025.com"
              className="transition hover:text-black/70 dark:hover:text-white/70"
            >
              https://lifeframe.frank2025.com
            </Link>
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link
              href="/welcome"
              className="transition hover:text-black/70 dark:hover:text-white/70"
            >
              产品介绍
            </Link>
            <a
              href="mailto:dingfeng901112@gmail.com"
              className="transition hover:text-black/70 dark:hover:text-white/70"
            >
              联系开发者
            </a>
            <span>·</span>
            <span>位置数据可选择保留或移除</span>
          </p>
        </div>
      </footer>
    </>
  );
}
